import type { Env } from './app';
import { clock } from './clock';
import { json, refuse, text } from './http';
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

  if (['health', 'today'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/** Each Assignment with its Driver's name and Truck's number, so the page never has to look them up. */
const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName,
       a.truck_id AS truckId, t.number AS truckNumber, a.note,
       a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id LEFT JOIN trucks t ON t.id = a.truck_id`;

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
  const truckId = text(body.truckId) || null;
  if (truckId && !(await exists(env, 'trucks', truckId))) errors.truckId = 'Pick a Truck from the list.';
  if (Object.keys(errors).length > 0) return refuse(errors);

  const id = crypto.randomUUID();
  const now = clock(env).now.toISOString();
  await env.DB.prepare(
    'INSERT INTO assignments (id, date, driver_id, truck_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, body.date, driverId, truckId, text(body.note) || null, now, now)
    .run();
  const assignment = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.id = ?`).bind(id).first<Assignment>();
  return json({ assignment }, 201);
}

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each field that is wrong. Fields it does not know are ignored. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isCalendarDate(body.date)) errors.date = 'Pick a date.';
  if (body.driverId != null && typeof body.driverId !== 'string') errors.driverId = 'Pick a Driver from the list.';
  if (body.truckId != null && typeof body.truckId !== 'string') errors.truckId = 'Pick a Truck from the list.';
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
