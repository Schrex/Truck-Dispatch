import type { Env } from './app';
import { clock } from './clock';
import type { Assignment, Driver, FieldErrorsBody, NewAssignment } from '../../shared/types';

/** The JSON API under /api/ (or /truck-dispatch/api/). */
export async function handleApi(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'health' && reading) {
    return json({ ok: true, environment: env.ENVIRONMENT ?? 'unknown', commit: env.COMMIT_SHA ?? null });
  }

  if (route === 'today' && reading) {
    const { today, tomorrow } = clock(env);
    return json({ today, tomorrow });
  }

  if (route === 'drivers' && reading) {
    const { results } = await env.DB.prepare('SELECT id, name FROM drivers ORDER BY name').all<Driver>();
    return json({ drivers: results });
  }

  if (route === 'assignments') {
    if (reading) return readDay(env, query.get('date'));
    if (method === 'POST') return addAssignment(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  const one = /^assignments\/([^/]+)$/.exec(route);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'PUT') return changeAssignment(request, env, id);
    if (method === 'DELETE') return deleteAssignment(env, id);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT, DELETE' });
  }

  if (['health', 'today', 'drivers'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/** Each Assignment with its Driver's name, so the page never has to look it up. */
const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName, a.note,
       a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id`;

/** A day's Assignments by Driver name, then in the order they were added; those with no Driver last. */
async function readDay(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const { results } = await env.DB.prepare(
    `${SELECT_ASSIGNMENT} WHERE a.date = ? ORDER BY a.driver_id IS NULL, d.name COLLATE NOCASE, a.created_at, a.rowid`,
  )
    .bind(date)
    .all<Assignment>();
  return json({ assignments: results });
}

async function addAssignment(request: Request, env: Env): Promise<Response> {
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  const id = crypto.randomUUID();
  const now = clock(env).now.toISOString();
  await env.DB.prepare(
    'INSERT INTO assignments (id, date, driver_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, read.date, read.driverId, read.note, now, now)
    .run();
  return json({ assignment: await findAssignment(env, id) }, 201);
}

/** Replaces every field: one left out or empty is cleared. The Assignment may move to another Driver or day. */
async function changeAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  await env.DB.prepare('UPDATE assignments SET date = ?, driver_id = ?, note = ?, updated_at = ? WHERE id = ?')
    .bind(read.date, read.driverId, read.note, clock(env).now.toISOString(), id)
    .run();
  return json({ assignment: await findAssignment(env, id) });
}

/** A real delete: nothing of the Assignment is kept. */
async function deleteAssignment(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  await env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/** Days before today (US Eastern) are read-only: nothing on them is added, changed, moved or deleted. */
function isPast(env: Env, date: string): boolean {
  return date < clock(env).today;
}

function onPastDay(): Response {
  return json({ error: 'past_day', message: 'This Assignment is on a day before today, which is read-only.' }, 409);
}

function findAssignment(env: Env, id: string): Promise<Assignment | null> {
  return env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.id = ?`).bind(id).first<Assignment>();
}

/** The Assignment a request sends, checked and tidied, or the response refusing it. */
async function readAssignment(
  request: Request,
  env: Env,
): Promise<{ date: string; driverId: string | null; note: string | null } | Response> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return json({ error: 'json_required' }, 415);
  }
  let body: Partial<NewAssignment>;
  try {
    body = (await request.json()) as Partial<NewAssignment>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const errors = validate(body);
  const driverId = text(body.driverId) || null;
  if (driverId && !(await env.DB.prepare('SELECT 1 FROM drivers WHERE id = ?').bind(driverId).first())) {
    errors.driverId = 'Pick a Driver from the list.';
  }
  if (!errors.date && isPast(env, body.date as string)) errors.date = 'Days before today are read-only. Pick today or a later day.';
  if (Object.keys(errors).length > 0) return refuse(errors);
  return { date: body.date as string, driverId, note: text(body.note) || null };
}

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each field that is wrong. Fields it does not know are ignored. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isCalendarDate(body.date)) errors.date = 'Pick a date.';
  if (body.driverId != null && typeof body.driverId !== 'string') errors.driverId = 'Pick a Driver from the list.';
  if (body.note != null && typeof body.note !== 'string') errors.note = 'Write the note as text.';
  else if (text(body.note).length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  return errors;
}

/** YYYY-MM-DD and a real day on the calendar (2026-02-30 is not). */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function refuse(fields: Record<string, string>): Response {
  return json({ error: 'invalid', fields } satisfies FieldErrorsBody, 400);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
