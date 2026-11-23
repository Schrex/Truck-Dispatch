import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { LATEST_INSPECTIONS } from './inspectionQueries';
import { isActive } from './lists';
import { NOTE_LIMIT, type TruckProblem } from '../../shared/types';

/**
 * Truck problems (GLOSSARY.md): something wrong with a Truck, reported by a
 * Driver with a note, open until Dave marks it fixed, and kept forever after.
 * Only Drivers report them: a Needs repair answer opens one, in the same batch
 * as the Inspection (see inspections.ts), and a Driver reports one during the
 * day on the Truck of his latest check-in today. Dave does not add them.
 *
 *   GET  api/truck-problems[?open=1][&truckId=]   open first, then fixed, newest first → 200 { problems }
 *   POST api/truck-problems  { driverId, truckId, text }  report one during the day     → 201 { problem }
 *   POST api/truck-problems/:id/fix  { note? }    Mark fixed                            → 200 { problem }
 */
export async function handleTruckProblems(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response | null> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'truck-problems') {
    if (reading) return listProblems(env, query);
    if (method === 'POST') return reportProblem(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  const fixing = /^truck-problems\/([^/]+)\/fix$/.exec(route);
  if (fixing) {
    if (method === 'POST') return markFixed(request, env, decodeURIComponent(fixing[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  return null;
}

/** A problem's columns with its Truck's number and its reporter's name, as a TruckProblem. */
export const SELECT_PROBLEM = `SELECT p.id, p.truck_id AS truckId, t.number AS truckNumber,
       p.reported_by_driver_id AS reportedByDriverId, d.name AS reportedByName, p.reported_at AS reportedAt, p.text,
       p.inspection_id AS inspectionId, p.fixed_at AS fixedAt, p.fixed_note AS fixedNote
  FROM truck_problems p JOIN trucks t ON t.id = p.truck_id LEFT JOIN drivers d ON d.id = p.reported_by_driver_id`;

/** Problems reported together (one Inspection's) keep the order they were added in, the checklist's. */
const IN_ORDER_ADDED = 'p.rowid';

/** The statement that opens a problem; the caller runs it in its own batch. */
export function openProblem(env: Env, problem: { id?: string; truckId: string; driverId: string; reportedAt: string; text: string; inspectionId: string | null }): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO truck_problems (id, truck_id, reported_by_driver_id, reported_at, text, inspection_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(problem.id ?? crypto.randomUUID(), problem.truckId, problem.driverId, problem.reportedAt, problem.text, problem.inspectionId);
}

/** The statement that reads the problems an Inspection opened, in its answers' order. */
export function problemsOf(env: Env, inspectionId: string): D1PreparedStatement {
  return env.DB.prepare(`${SELECT_PROBLEM} WHERE p.inspection_id = ? ORDER BY ${IN_ORDER_ADDED}`).bind(inspectionId);
}

/** Open ones first, newest reported first; then fixed ones, newest fixed first. */
async function listProblems(env: Env, query: URLSearchParams): Promise<Response> {
  const where: string[] = [];
  const binds: string[] = [];
  if (query.get('open') === '1') where.push('p.fixed_at IS NULL');
  const truckId = query.get('truckId');
  if (truckId) {
    where.push('p.truck_id = ?');
    binds.push(truckId);
  }
  const { results: problems } = await env.DB.prepare(
    `${SELECT_PROBLEM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.fixed_at IS NOT NULL, COALESCE(p.fixed_at, p.reported_at) DESC, p.reported_at DESC, ${IN_ORDER_ADDED}`,
  )
    .bind(...binds)
    .all<TruckProblem>();
  return json({ problems });
}

/**
 * Report a problem: a Driver reports one during the day, with a note, on the
 * Truck of his latest check-in today (the newest Inspection, as check-ins are
 * read). A Truck he checked in to earlier and then switched from does not
 * count, and neither does a Driver or Truck removed since. It has no Inspection.
 */
async function reportProblem(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  const { now, today } = clock(env);

  const errors: Record<string, string> = {};
  if (body.text != null && typeof body.text !== 'string') errors.text = 'Write the note as text.';
  else if (!text(body.text)) errors.text = 'Say what the problem is.';
  else if (text(body.text).length > NOTE_LIMIT) errors.text = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  const driverId = text(body.driverId);
  const truckId = text(body.truckId);
  const [driverActive, truckActive, checkedIn] = await Promise.all([
    driverId ? isActive(env, 'drivers', driverId) : false,
    truckId ? isActive(env, 'trucks', truckId) : false,
    env.DB.prepare(`SELECT truckId FROM (${LATEST_INSPECTIONS}) WHERE driverId = ?`).bind(today, driverId).first<string>('truckId'),
  ]);
  if (!driverActive) errors.driverId = 'Pick your name again: this Driver is not in the list.';
  else if (!truckActive) errors.truckId = 'Pick a Truck from the list.';
  else if (checkedIn !== truckId) errors.truckId = 'Report a problem on the Truck you are checked in to today.';
  if (Object.keys(errors).length > 0) return refuse(errors);

  const id = crypto.randomUUID();
  await openProblem(env, { id, truckId, driverId, reportedAt: now.toISOString(), text: text(body.text), inspectionId: null }).run();
  return json({ problem: await readProblem(env, id) }, 201);
}

/**
 * Mark fixed: closes a problem at the Worker's now, with Dave's note if any.
 * One already fixed is answered as it is, so a retried tap changes nothing.
 */
async function markFixed(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  const problem = await readProblem(env, id);
  if (!problem) return json({ error: 'not_found' }, 404);
  if (problem.fixedAt) return json({ problem });

  if (body.note != null && typeof body.note !== 'string') return refuse({ note: 'Write the note as text.' });
  const note = text(body.note);
  if (note.length > NOTE_LIMIT) return refuse({ note: `Keep the note to ${NOTE_LIMIT} characters or fewer.` });

  // Only an open one is closed: two taps at once both answer the first one's close.
  await env.DB.prepare('UPDATE truck_problems SET fixed_at = ?, fixed_note = ? WHERE id = ? AND fixed_at IS NULL')
    .bind(clock(env).now.toISOString(), note || null, id)
    .run();
  return json({ problem: await readProblem(env, id) });
}

async function readProblem(env: Env, id: string): Promise<TruckProblem | null> {
  return env.DB.prepare(`${SELECT_PROBLEM} WHERE p.id = ?`).bind(id).first<TruckProblem>();
}
