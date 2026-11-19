import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { exists, handleList, isList } from './lists';
import type { Assignment, NewAssignment } from '../../shared/types';

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

  const [list, entryId, ...rest] = route.split('/');
  if (isList(list) && rest.length === 0) return handleList(request, env, list, entryId, query);

  if (route === 'assignments') {
    if (reading) return readDay(env, query.get('date'));
    if (method === 'POST') return addAssignment(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  if (route === 'assignments/copy') {
    if (method === 'POST') return copyDay(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const one = /^assignments\/([^/]+)$/.exec(route);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'PUT') return changeAssignment(request, env, id);
    if (method === 'DELETE') return deleteAssignment(env, id);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT, DELETE' });
  }

  if (['health', 'today'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/** Each Assignment with the names of its Driver, Truck, Material and Foreman, so the page never has to look them up. */
const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName,
       a.truck_id AS truckId, t.number AS truckNumber,
       a.material_id AS materialId, m.name AS materialName,
       a.foreman_id AS foremanId, f.name AS foremanName, a.note,
       a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id LEFT JOIN trucks t ON t.id = a.truck_id
       LEFT JOIN materials m ON m.id = a.material_id LEFT JOIN foremen f ON f.id = a.foreman_id`;

/** How a day's Assignments are listed: by Driver name, then in the order they were added; those with no Driver last. */
const DAY_ORDER = 'ORDER BY a.driver_id IS NULL, d.name COLLATE NOCASE, a.created_at, a.rowid';

async function readDay(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? ${DAY_ORDER}`).bind(date).all<Assignment>();
  return json({ assignments: results });
}

/**
 * Columns a copy does not take from its source: a copy is a new Assignment on
 * another day, with an empty note. Every other column, including any a later
 * migration adds, is copied as it is (an inactive entry stays on the copy).
 */
const NOT_COPIED = new Set(['id', 'date', 'note', 'created_at', 'updated_at']);

/**
 * Copies every Assignment on one day onto another, adding to what the target
 * day already has. Answers the new Assignments, in the order a day is read.
 */
async function copyDay(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ from?: unknown; to?: unknown }>(request);
  if (body instanceof Response) return body;
  const errors: Record<string, string> = {};
  if (!isCalendarDate(body.from)) errors.from = 'Pick a day to copy from.';
  if (!isCalendarDate(body.to)) errors.to = 'Pick a day to copy onto.';
  else if (isPast(env, body.to)) errors.to = PAST_DATE;
  if (Object.keys(errors).length > 0) return refuse(errors);
  const { from, to } = body as { from: string; to: string };

  const { results: sources } = await env.DB.prepare('SELECT * FROM assignments WHERE date = ? ORDER BY created_at, rowid')
    .bind(from)
    .all<Record<string, unknown>>();
  if (sources.length === 0) return json({ assignments: [] }, 201);

  const now = clock(env).now.toISOString();
  const ids: string[] = [];
  const inserts = sources.map((source) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const row: Record<string, unknown> = { id, date: to, note: null, created_at: now, updated_at: now };
    for (const [column, value] of Object.entries(source)) if (!NOT_COPIED.has(column)) row[column] = value;
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO assignments (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).bind(...columns.map((c) => row[c]));
  });
  await env.DB.batch(inserts);

  const { results } = await env.DB.prepare(
    `${SELECT_ASSIGNMENT} WHERE a.id IN (SELECT value FROM json_each(?)) ${DAY_ORDER}`,
  )
    .bind(JSON.stringify(ids))
    .all<Assignment>();
  return json({ assignments: results }, 201);
}

async function addAssignment(request: Request, env: Env): Promise<Response> {
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  const id = crypto.randomUUID();
  const now = clock(env).now.toISOString();
  await env.DB.prepare(
    `INSERT INTO assignments (id, date, driver_id, truck_id, material_id, foreman_id, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, read.date, read.driverId, read.truckId, read.materialId, read.foremanId, read.note, now, now)
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

  await env.DB.prepare(
    'UPDATE assignments SET date = ?, driver_id = ?, truck_id = ?, material_id = ?, foreman_id = ?, note = ?, updated_at = ? WHERE id = ?',
  )
    .bind(read.date, read.driverId, read.truckId, read.materialId, read.foremanId, read.note, clock(env).now.toISOString(), id)
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
): Promise<
  | { date: string; driverId: string | null; truckId: string | null; materialId: string | null; foremanId: string | null; note: string | null }
  | Response
> {
  const body = await readJson<Partial<NewAssignment>>(request);
  if (body instanceof Response) return body;

  const errors = validate(body);
  const driverId = text(body.driverId) || null;
  if (driverId && !(await env.DB.prepare('SELECT 1 FROM drivers WHERE id = ?').bind(driverId).first())) {
    errors.driverId = 'Pick a Driver from the list.';
  }
  const truckId = text(body.truckId) || null;
  if (truckId && !(await exists(env, 'trucks', truckId))) errors.truckId = 'Pick a Truck from the list.';
  const materialId = text(body.materialId) || null;
  if (materialId && !(await exists(env, 'materials', materialId))) errors.materialId = 'Pick a Material from the list.';
  const foremanId = text(body.foremanId) || null;
  if (foremanId && !(await exists(env, 'foremen', foremanId))) errors.foremanId = 'Pick a Foreman from the list.';
  if (!errors.date && isPast(env, body.date as string)) errors.date = PAST_DATE;
  if (Object.keys(errors).length > 0) return refuse(errors);
  return { date: body.date as string, driverId, truckId, materialId, foremanId, note: text(body.note) || null };
}

const PAST_DATE = 'Days before today are read-only. Pick today or a later day.';

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each field that is wrong. Fields it does not know are ignored. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isCalendarDate(body.date)) errors.date = 'Pick a date.';
  if (body.driverId != null && typeof body.driverId !== 'string') errors.driverId = 'Pick a Driver from the list.';
  if (body.truckId != null && typeof body.truckId !== 'string') errors.truckId = 'Pick a Truck from the list.';
  if (body.materialId != null && typeof body.materialId !== 'string') errors.materialId = 'Pick a Material from the list.';
  if (body.foremanId != null && typeof body.foremanId !== 'string') errors.foremanId = 'Pick a Foreman from the list.';
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
