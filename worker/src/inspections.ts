import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { isActive, listOrder } from './lists';
import { isCalendarDate } from '../../shared/days';
import { INSPECTION_ANSWERS, type CheckIn, type CheckIns, type Inspection, type InspectionAnswer, type InspectionAnswerKind } from '../../shared/types';

/**
 * Check-in (GLOSSARY.md): a Driver picks the Truck he is taking today and
 * does its Inspection. The Inspection is the official record, append-only
 * (ADR 0006): it is added, read, and never changed or deleted.
 *
 *   POST api/inspections        add one, for today only           → 201 { inspection }
 *   GET  api/inspections/:id    read one                          → 200 { inspection }
 *   GET  api/check-ins?date=    each Driver's latest that day     → 200 { date, checkIns }
 */
export async function handleInspections(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response | null> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'check-ins') {
    if (reading) return readCheckIns(env, query.get('date'));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  if (route === 'inspections') {
    if (method === 'POST') return addInspection(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  // The record is never changed or deleted: only a read of one.
  const one = /^inspections\/([^/]+)$/.exec(route);
  if (one) {
    if (!reading) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
    const inspection = await readInspection(env, decodeURIComponent(one[1]));
    return inspection ? json({ inspection }) : json({ error: 'not_found' }, 404);
  }

  return null;
}

/** An Inspection's own columns with its Driver's name and Truck's number, and whether any answer is Needs repair. */
const SELECT_INSPECTION = `SELECT i.id, i.date, i.driver_id AS driverId, d.name AS driverName, i.truck_id AS truckId, t.number AS truckNumber,
       i.done_at AS doneAt, i.other_notes AS otherNotes,
       EXISTS (SELECT 1 FROM inspection_answers a WHERE a.inspection_id = i.id AND a.answer = 'repair') AS needsRepair
  FROM inspections i JOIN drivers d ON d.id = i.driver_id JOIN trucks t ON t.id = i.truck_id`;

/** One saved Inspection with its answers, or null. */
async function readInspection(env: Env, id: string): Promise<Inspection | null> {
  const [{ results: rows }, { results: answers }] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`${SELECT_INSPECTION} WHERE i.id = ?`).bind(id),
    env.DB.prepare(
      `SELECT position, item_id AS itemId, label, answer, repair_note AS repairNote FROM inspection_answers WHERE inspection_id = ? ORDER BY position`,
    ).bind(id),
  ]);
  const row = rows[0];
  if (!row) return null;
  return { ...(row as Omit<Inspection, 'needsRepair' | 'answers'>), needsRepair: row.needsRepair === 1, answers: answers as unknown as InspectionAnswer[] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_LIMIT = 1000;
const ANSWER_KINDS: readonly unknown[] = INSPECTION_ANSWERS;

/** An item of the checklist as it is now, to check an Inspection against and copy its wording from. */
interface ChecklistItem {
  id: string;
  label: string;
  optional: number;
}

/** An answer ready to save: its item's wording copied, a repair note only on Needs repair. */
type Answer = Omit<InspectionAnswer, 'position'>;

/**
 * Adds an Inspection for today: the Driver checks in to its Truck. An id
 * already saved answers that Inspection and saves nothing, whatever was sent,
 * so a Finish retried after a lost reply is never saved twice. Otherwise every
 * item on the checklist that is not optional must be answered, each Needs
 * repair with a note, by an active Driver for an active Truck; the answers are
 * kept in the checklist's order with each item's wording as it is now.
 */
async function addInspection(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  const { now, today } = clock(env);

  const id = text(body.id);
  if (!UUID.test(id)) return refuse({ id: 'Start the Inspection again.' });
  const stored = await readInspection(env, id);
  if (stored) return json({ inspection: stored });

  const errors: Record<string, string> = {};
  if (body.date !== undefined && body.date !== today) errors.date = 'Check in only on today.';
  const driverId = text(body.driverId);
  if (!driverId || !(await isActive(env, 'drivers', driverId))) errors.driverId = 'Pick your name again: this Driver is not in the list.';
  const truckId = text(body.truckId);
  if (!truckId || !(await isActive(env, 'trucks', truckId))) errors.truckId = 'Pick a Truck from the list.';
  if (body.otherNotes != null && typeof body.otherNotes !== 'string') errors.otherNotes = 'Write the notes as text.';
  else if (text(body.otherNotes).length > NOTE_LIMIT) errors.otherNotes = `Keep the notes to ${NOTE_LIMIT} characters or fewer.`;
  const otherNotes = text(body.otherNotes) || null;

  const { results: checklist } = await env.DB.prepare(
    `SELECT id, label, optional FROM inspection_items WHERE active = 1 ORDER BY ${listOrder('inspection-items')}`,
  ).all<ChecklistItem>();
  const answers = checkAnswers(body.answers, checklist, errors);

  if (Object.keys(errors).length > 0) return refuse(errors);

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO inspections (id, date, driver_id, truck_id, done_at, other_notes) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id, today, driverId, truckId, now.toISOString(), otherNotes,
      ),
      ...answers.map((a, position) =>
        env.DB.prepare('INSERT INTO inspection_answers (inspection_id, position, item_id, label, answer, repair_note) VALUES (?, ?, ?, ?, ?, ?)').bind(
          id, position, a.itemId, a.label, a.answer, a.repairNote,
        ),
      ),
    ]);
  } catch (error) {
    // The same Finish arriving twice at once: the first one saved it, and it stands.
    if (!String(error).includes('UNIQUE constraint failed: inspections.id')) throw error;
    return json({ inspection: await readInspection(env, id) });
  }
  return json({ inspection: await readInspection(env, id) }, 201);
}

/**
 * The answers sent, checked against the checklist as it is now, in its order.
 * Each problem goes in `errors` under `answers.<item id>` (or `answers` when
 * they are not a list): an item answered twice, not on the checklist (or
 * removed from it), with an answer that is not OK, Needs repair or N/A, a
 * Needs repair without a note, or an item that is not optional left out.
 */
function checkAnswers(sent: unknown, checklist: ChecklistItem[], errors: Record<string, string>): Answer[] {
  if (!Array.isArray(sent)) {
    errors.answers = 'Answer the checklist.';
    return [];
  }
  const given = new Map<string, Record<string, unknown>>();
  for (const raw of sent) {
    const answer = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const itemId = text(answer.itemId);
    const key = `answers.${itemId}`;
    if (given.has(itemId)) errors[key] = 'Answer each item once.';
    else if (!checklist.some((item) => item.id === itemId)) errors[key] = 'This item is no longer on the checklist.';
    else if (!ANSWER_KINDS.includes(answer.answer)) errors[key] = 'Answer OK, Needs repair or N/A.';
    else if (answer.repairNote != null && typeof answer.repairNote !== 'string') errors[key] = 'Write the note as text.';
    else if (answer.answer === 'repair' && !text(answer.repairNote)) errors[key] = 'Say what needs repair.';
    else if (text(answer.repairNote).length > NOTE_LIMIT) errors[key] = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
    given.set(itemId, answer);
  }
  const answers: Answer[] = [];
  for (const item of checklist) {
    const answer = given.get(item.id);
    if (!answer) {
      if (!item.optional) errors[`answers.${item.id}`] = `Answer ${item.label}.`;
      continue;
    }
    const kind = answer.answer as InspectionAnswerKind;
    answers.push({ itemId: item.id, label: item.label, answer: kind, repairNote: kind === 'repair' ? text(answer.repairNote) : null });
  }
  return answers;
}

/** Each Driver's latest Inspection on a day: the newest done_at, ties broken by insertion order. */
async function readCheckIns(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const { results } = await env.DB.prepare(
    `SELECT i.driverId, d.name AS driverName, i.truckId, t.number AS truckNumber, i.id AS inspectionId, i.doneAt,
            EXISTS (SELECT 1 FROM inspection_answers a WHERE a.inspection_id = i.id AND a.answer = 'repair') AS needsRepair
       FROM (SELECT id, driver_id AS driverId, truck_id AS truckId, done_at AS doneAt,
                    ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY done_at DESC, rowid DESC) AS newest
               FROM inspections WHERE date = ?) i
       JOIN drivers d ON d.id = i.driverId JOIN trucks t ON t.id = i.truckId
      WHERE i.newest = 1
      ORDER BY ${listOrder('drivers', 'd')}`,
  )
    .bind(date)
    .all<Omit<CheckIn, 'needsRepair'> & { needsRepair: number }>();
  const checkIns = results.map((row): CheckIn => ({ ...row, needsRepair: row.needsRepair === 1 }));
  return json({ date, checkIns } satisfies CheckIns);
}
