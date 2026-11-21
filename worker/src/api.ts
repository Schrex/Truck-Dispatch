import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { exists, handleList, isList, listOrder } from './lists';
import { checkTyped, saveLinked, typedIn, type Typed } from './typedNames';
import { addDays, dayState, holidayName, isCalendarDate, mondayOf, sinceSent, weekDates } from '../../shared/days';
import type { Assignment, BusinessDay, Day, ListName, NewAssignment, TypedNames, Week } from '../../shared/types';

/** The JSON API under /api/ (or /truck-dispatch/api/). */
export async function handleApi(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'health' && reading) {
    return json({ ok: true, environment: env.ENVIRONMENT ?? 'unknown', commit: env.COMMIT_SHA ?? null });
  }

  if (route === 'today' && reading) {
    const { today, tomorrow, nextWorkingDay } = clock(env);
    return json({ today, tomorrow, nextWorkingDay } satisfies BusinessDay);
  }

  const laterOf = /^drivers\/([^/]+)\/later-days$/.exec(route);
  if (laterOf) {
    if (reading) return laterDays(env, decodeURIComponent(laterOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const sending = /^days\/([^/]+)\/send$/.exec(route);
  if (sending) {
    if (method === 'POST') return sendDay(env, decodeURIComponent(sending[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const weekOf = /^weeks\/([^/]+)$/.exec(route);
  if (weekOf) {
    if (reading) return readWeek(env, decodeURIComponent(weekOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
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

  const moving = /^assignments\/([^/]+)\/move$/.exec(route);
  if (moving) {
    if (method === 'POST') return moveAssignment(request, env, decodeURIComponent(moving[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const one = /^assignments\/([^/]+)$/.exec(route);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'PATCH') return changeAssignment(request, env, id);
    if (method === 'DELETE') return deleteAssignment(env, id);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH, DELETE' });
  }

  if (['health', 'today'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/**
 * How many days after today a Driver has Assignments on, so Settings can warn
 * before he is removed that work is still planned for him.
 */
async function laterDays(env: Env, driverId: string): Promise<Response> {
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare('SELECT COUNT(DISTINCT date) AS days FROM assignments WHERE driver_id = ? AND date > ?')
    .bind(driverId, clock(env).today)
    .first<{ days: number }>();
  return json({ laterDays: row?.days ?? 0 });
}

/**
 * Each Assignment with the names of its Driver, Truck, Places, Material and
 * Foreman, so the page never has to look them up, and when its day was Sent,
 * from which marked() works out whether it is Changed or Added.
 */
const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName,
       a.truck_id AS truckId, t.number AS truckNumber,
       a.from_place_id AS fromPlaceId, pf.short_name AS fromPlaceName,
       a.to_place_id AS toPlaceId, pt.short_name AS toPlaceName,
       a.material_id AS materialId, m.name AS materialName,
       a.foreman_id AS foremanId, f.name AS foremanName, a.note,
       a.position, a.created_at AS createdAt, a.updated_at AS updatedAt, a.changed_at AS changedAt,
       s.sent_at AS daySentAt
  FROM assignments a LEFT JOIN day_sends s ON s.date = a.date LEFT JOIN drivers d ON d.id = a.driver_id LEFT JOIN trucks t ON t.id = a.truck_id
  LEFT JOIN places pf ON pf.id = a.from_place_id LEFT JOIN places pt ON pt.id = a.to_place_id
  LEFT JOIN materials m ON m.id = a.material_id LEFT JOIN foremen f ON f.id = a.foreman_id`;

/**
 * How a day's Assignments are listed: lane by lane (in the Drivers' order,
 * as their list is read, the Unassigned lane last), then in each lane's order,
 * ties (such as Assignments saved before they had a position) in the order
 * they were added.
 */
const DAY_ORDER = `ORDER BY a.driver_id IS NULL, ${listOrder('drivers', 'd')}, a.driver_id, a.position, a.created_at, a.rowid`;

/**
 * The position just after the last Assignment in a lane: bind the date and the
 * Driver (null for Unassigned), then an Assignment to leave out (the one moving).
 * Worked out in the same statement that saves, so nothing slips in between.
 */
const LAST_IN_LANE = '(SELECT COALESCE(MAX(position) + 1, 0) FROM assignments WHERE date = ? AND driver_id IS ? AND id IS NOT ?)';

/** An Assignment as SELECT_ASSIGNMENT reads it: with its day's sent time in place of whether it is Changed or Added. */
type AssignmentRow = Omit<Assignment, 'sinceSent'> & { daySentAt: string | null };

/** An Assignment as the API answers it: Changed, Added or neither since its day was Sent, by the shared day rules. */
function marked({ daySentAt, ...assignment }: AssignmentRow): Assignment {
  return { ...assignment, sinceSent: sinceSent(assignment, daySentAt) };
}

/** A day's Assignments, each marked Changed or Added since the Send, and when the day was first Sent (null for a Draft). */
async function readDay(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const [{ results }, { results: sends }] = await env.DB.batch<AssignmentRow & { sentAt: string }>([
    env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? ${DAY_ORDER}`).bind(date),
    env.DB.prepare('SELECT sent_at AS sentAt FROM day_sends WHERE date = ?').bind(date),
  ]);
  return json({ assignments: results.map(marked), sentAt: sends[0]?.sentAt ?? null } satisfies Day);
}

/**
 * The state of each day of a week, Monday to Sunday, for the week strip: by
 * the shared day rules from each day's Assignments and its first Send, with
 * how many are Unassigned and its Holiday. Asked by its Monday, so a week is
 * always the same seven days; any other date is refused. Days before today
 * are read like the rest.
 */
async function readWeek(env: Env, monday: string): Promise<Response> {
  if (!isCalendarDate(monday) || mondayOf(monday) !== monday) return refuse({ date: 'Give the Monday the week starts on.' });
  const sunday = addDays(monday, 6);
  type Row = { date: string; driverId: string | null; createdAt: string; changedAt: string | null };
  const [{ results: rows }, { results: sends }] = await env.DB.batch<Row & { sentAt: string }>([
    env.DB.prepare(
      'SELECT date, driver_id AS driverId, created_at AS createdAt, changed_at AS changedAt FROM assignments WHERE date BETWEEN ? AND ?',
    ).bind(monday, sunday),
    env.DB.prepare('SELECT date, sent_at AS sentAt FROM day_sends WHERE date BETWEEN ? AND ?').bind(monday, sunday),
  ]);
  const days = weekDates(monday).map((date) => {
    const planned = rows.filter((row) => row.date === date);
    const { state } = dayState(planned, sends.find((send) => send.date === date)?.sentAt ?? null);
    return { date, state, unassigned: planned.filter((row) => row.driverId === null).length, holiday: holidayName(date) };
  });
  return json({ days } satisfies Week);
}

/**
 * Sends a day to the Drivers: records its first Send. There is no lock and no
 * Send again (ADR 0003), so Sending a Sent day keeps its first time and does
 * nothing else. A day with no Assignments is refused, so the Drivers are never
 * sent nothing; the check and the record are one statement, so an Assignment
 * deleted meanwhile cannot slip between them. No warnings.
 */
async function sendDay(env: Env, date: string): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  if (isPast(env, date)) return refuse({ date: 'Days before today are read-only, so they cannot be Sent.' });
  const [, { results }] = await env.DB.batch<{ sentAt: string }>([
    env.DB.prepare(
      'INSERT OR IGNORE INTO day_sends (date, sent_at) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM assignments WHERE date = ?)',
    ).bind(date, clock(env).now.toISOString(), date),
    env.DB.prepare('SELECT sent_at AS sentAt FROM day_sends WHERE date = ?').bind(date),
  ]);
  if (results.length === 0) {
    return json({ error: 'nothing_to_send', message: 'This day has no Assignments to Send. Plan the day first.' }, 409);
  }
  return json({ date, sentAt: results[0].sentAt });
}

/**
 * Columns a copy does not take from its source: a copy is a new Assignment on
 * another day, with an empty note, not changed yet. Every other column,
 * including any a later migration adds, is copied as it is (an inactive entry
 * stays on the copy).
 */
const NOT_COPIED = new Set(['id', 'date', 'note', 'created_at', 'updated_at', 'changed_at']);

/**
 * Copies every Assignment on today (by the Worker's clock, never a day the
 * page sends) onto a later day, adding to what that day already has. Answers
 * the new Assignments, in the order a day is read.
 */
async function copyDay(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ to?: unknown }>(request);
  if (body instanceof Response) return body;
  const { today: from, now } = clock(env);
  const to = body.to;
  if (!isCalendarDate(to)) return refuse({ to: 'Pick a day to copy onto.' });
  if (to < from) return refuse({ to: PAST_DATE });
  if (to === from) return refuse({ to: 'Today cannot be copied onto itself. Pick a later day.' });

  const { results: sources } = await env.DB.prepare('SELECT * FROM assignments WHERE date = ? ORDER BY created_at, rowid')
    .bind(from)
    .all<Record<string, unknown>>();
  if (sources.length === 0) return json({ assignments: [] }, 201);

  const createdAt = now.toISOString();
  const ids: string[] = [];
  const inserts = sources.map((source) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const row: Record<string, unknown> = { id, date: to, note: null, created_at: createdAt, updated_at: createdAt };
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
    .all<AssignmentRow>();
  return json({ assignments: results.map(marked) }, 201);
}

async function addAssignment(request: Request, env: Env): Promise<Response> {
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  const id = crypto.randomUUID();
  const now = clock(env).now.toISOString();
  const columns = ['id', ...SAVED_COLUMNS, 'created_at', 'updated_at'];
  // Last in its lane, so adding work never reshuffles the day.
  await saveLinked(env, read.typed, (typed) =>
    env.DB.prepare(
      `INSERT INTO assignments (${columns.join(', ')}, position) VALUES (${columns.map(() => '?').join(', ')}, ${LAST_IN_LANE})`,
    ).bind(id, ...savedValues({ ...read, ...typed }), now, now, read.date, read.driverId, id));
  return json({ assignment: await findAssignment(env, id) }, 201);
}

/**
 * Changes only the fields the request sends, so a change made on one device
 * never wipes one made on another; an empty value clears a field. The day is
 * fixed. A new Driver puts it last in his lane, so his day keeps its order.
 * Only a real change is saved and recorded as changed: sending a field as it
 * already is (the same Driver again, say) changes nothing at all. A real
 * change after the day is Sent also keeps its fields as they were before.
 */
async function changeAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const read = await readChange(request, env, existing.date);
  if (read instanceof Response) return read;

  const changes = { ...read.changes };
  for (const { field } of read.typed) changes[field.idKey] = null; // Linked when saved.
  const keys = Object.keys(changes) as ChangeKey[];
  if (keys.length === 0) return json({ assignment: existing });

  const now = clock(env).now.toISOString();
  await saveLinked(env, read.typed, (typed) => {
    const values = keys.map((key) => (key in typed ? typed[key as keyof typeof typed]! : changes[key]));
    const set = keys.map((key) => `${COLUMN_OF[key]} = ?`);
    const binds: unknown[] = [...values];
    // SET and WHERE read the row as it was: a real change of Driver goes last
    // in his lane, and a row whose every field is as sent is not written.
    if ('driverId' in changes) {
      set.push(`position = CASE WHEN driver_id IS ? THEN position ELSE ${LAST_IN_LANE} END`);
      binds.push(changes.driverId, existing.date, changes.driverId, id);
    }
    const differs = keys.map((key) => `${COLUMN_OF[key]} IS NOT ?`).join(' OR ');
    // First, on a Sent day, its fields as they were, kept only when the update below really changes it.
    const keep = env.DB.prepare(
      `INSERT INTO assignment_changes (id, assignment_id, changed_at, before)
       SELECT ?, id, ?, (${FIELDS_BEFORE}) FROM assignments
        WHERE id = ? AND date IN (SELECT date FROM day_sends) AND (${differs})`,
    ).bind(crypto.randomUUID(), now, id, ...values);
    const update = env.DB.prepare(
      `UPDATE assignments SET ${set.join(', ')}, updated_at = ?, changed_at = ? WHERE id = ? AND (${differs})`,
    ).bind(...binds, now, now, id, ...values);
    return [keep, update];
  });
  return json({ assignment: await findAssignment(env, id) });
}

/**
 * An Assignment's fields as the Driver reads them, as JSON, with the names its
 * entries had then (so "was Cobblestone" survives a later rename) and the ids
 * (so later Trips can be matched to where it sent him). Read inside a
 * statement on the assignments table, for its current row.
 */
const FIELDS_BEFORE = `SELECT json_object(
    'driverId', b.driver_id, 'driverName', d.name, 'truckId', b.truck_id, 'truckNumber', t.number,
    'fromPlaceId', b.from_place_id, 'fromPlaceName', pf.short_name, 'toPlaceId', b.to_place_id, 'toPlaceName', pt.short_name,
    'materialId', b.material_id, 'materialName', m.name, 'foremanId', b.foreman_id, 'foremanName', f.name,
    'note', b.note, 'position', b.position)
  FROM assignments b LEFT JOIN drivers d ON d.id = b.driver_id LEFT JOIN trucks t ON t.id = b.truck_id
  LEFT JOIN places pf ON pf.id = b.from_place_id LEFT JOIN places pt ON pt.id = b.to_place_id
  LEFT JOIN materials m ON m.id = b.material_id LEFT JOIN foremen f ON f.id = b.foreman_id
  WHERE b.id = assignments.id`;

/** Which way "Do this first" ("earlier") and "Do this later" ("later") move an Assignment in its lane. */
const DIRECTIONS = { earlier: -1, later: 1 } as const;

/**
 * Moves an Assignment one place in its lane (its day and Driver, or
 * Unassigned), swapping it with its neighbour, and numbers the lane 0, 1, 2…
 * in its new order, so Assignments that shared a position (saved before they
 * had one) each get their own. Only the one moved is recorded as changed: the
 * neighbour that shifted is not, so a Driver is not told it changed. Answers
 * the lane in its new order. The first cannot move earlier nor the last later.
 */
async function moveAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson<{ direction?: unknown }>(request);
  if (body instanceof Response) return body;
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const direction = body.direction;
  if (direction !== 'earlier' && direction !== 'later') return refuse({ direction: 'Move it earlier or later.' });

  const lane = await readLane(env, existing.date, existing.driverId);
  const from = lane.findIndex((a) => a.id === id);
  const to = from + DIRECTIONS[direction];
  if (to < 0 || to >= lane.length) {
    const end = direction === 'earlier' ? 'first' : 'last';
    return json({ error: 'lane_end', message: `This Assignment is already ${end} in its lane.` }, 409);
  }
  const order = lane.map((a) => a.id);
  [order[from], order[to]] = [order[to], order[from]];

  const now = clock(env).now.toISOString();
  // On a Sent day, the moved one's fields as they were (its place among them),
  // kept as any change is; the neighbour that shifted keeps nothing.
  const keep = env.DB.prepare(
    `INSERT INTO assignment_changes (id, assignment_id, changed_at, before)
     SELECT ?, id, ?, (${FIELDS_BEFORE}) FROM assignments WHERE id = ? AND date IN (SELECT date FROM day_sends)`,
  ).bind(crypto.randomUUID(), now, id);
  // One statement renumbers the lane, so it is never left half renumbered.
  const renumber = env.DB.prepare(
    `UPDATE assignments SET position = (SELECT key FROM json_each(?1) WHERE value = assignments.id),
       updated_at = CASE WHEN id = ?2 THEN ?3 ELSE updated_at END,
       changed_at = CASE WHEN id = ?2 THEN ?3 ELSE changed_at END
     WHERE id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(order), id, now);
  await env.DB.batch([keep, renumber]);
  return json({ assignments: await readLane(env, existing.date, existing.driverId) });
}

/** One lane of a day (a Driver's, or Unassigned for null), in its order. */
async function readLane(env: Env, date: string, driverId: string | null): Promise<Assignment[]> {
  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.driver_id IS ? ${DAY_ORDER}`)
    .bind(date, driverId)
    .all<AssignmentRow>();
  return results.map(marked);
}

function dayFixed(): Response {
  return json({ error: 'day_fixed', message: 'An Assignment stays on its day. Add a new one on the other day instead.' }, 409);
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

async function findAssignment(env: Env, id: string): Promise<Assignment | null> {
  const row = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.id = ?`).bind(id).first<AssignmentRow>();
  return row && marked(row);
}

const PICK_PLACE = 'Pick a Place from the list.';

/**
 * An Assignment's references to entries in the lists, declared once: each
 * drives the field's type check, its existence check, and its column in the
 * INSERT and UPDATE. Any entry that exists may be used, active or not.
 */
const REFERENCES = [
  { key: 'driverId', column: 'driver_id', list: 'drivers', message: 'Pick a Driver from the list.' },
  { key: 'truckId', column: 'truck_id', list: 'trucks', message: 'Pick a Truck from the list.' },
  { key: 'fromPlaceId', column: 'from_place_id', list: 'places', message: PICK_PLACE },
  { key: 'toPlaceId', column: 'to_place_id', list: 'places', message: PICK_PLACE },
  { key: 'materialId', column: 'material_id', list: 'materials', message: 'Pick a Material from the list.' },
  { key: 'foremanId', column: 'foreman_id', list: 'foremen', message: 'Pick a Foreman from the list.' },
] as const satisfies readonly { key: keyof NewAssignment; column: string; list: ListName; message: string }[];

type ReferenceKey = (typeof REFERENCES)[number]['key'];

/** A field added to NewAssignment does not compile until it is declared in REFERENCES or handled like date and note. */
type Undeclared = Exclude<keyof NewAssignment, 'date' | 'note' | ReferenceKey>;
const everyFieldDeclared: [Undeclared] extends [never] ? true : Undeclared = true;
void everyFieldDeclared;

/**
 * An Assignment as a request sends it, checked and tidied. A Place or Material
 * it typed by name is linked only when it is saved (see saveLinked).
 */
type ReadAssignment = { date: string; note: string | null; typed: Typed[] } & Record<ReferenceKey, string | null>;

/** The columns adding an Assignment saves, in the order savedValues gives them. */
const SAVED_COLUMNS = ['date', ...REFERENCES.map((r) => r.column), 'note'];

/** A field a change may send: any but the day, which is fixed. */
type ChangeKey = ReferenceKey | 'note';

const COLUMN_OF = Object.fromEntries([...REFERENCES.map((r) => [r.key, r.column]), ['note', 'note']]) as Record<ChangeKey, string>;

/** The fields a change sends, checked and tidied (empty is null), and the names it typed. */
interface ReadChange {
  changes: Partial<Record<ChangeKey, string | null>>;
  typed: Typed[];
}

function savedValues(read: ReadAssignment): (string | null)[] {
  return [read.date, ...REFERENCES.map((r) => read[r.key]), read.note];
}

/** The Assignment a request sends, checked and tidied, or the response refusing it. */
async function readAssignment(request: Request, env: Env): Promise<ReadAssignment | Response> {
  const body = await readJson<Partial<NewAssignment & TypedNames>>(request);
  if (body instanceof Response) return body;

  const errors = await checkFields(env, body);
  if (!isCalendarDate(body.date)) errors.date = 'Pick a date.';
  else if (isPast(env, body.date)) errors.date = PAST_DATE;
  if (Object.keys(errors).length > 0) return refuse(errors);
  const ids = Object.fromEntries(REFERENCES.map((r) => [r.key, text(body[r.key]) || null])) as Record<ReferenceKey, string | null>;
  return { date: body.date as string, ...ids, note: text(body.note) || null, typed: typedIn(body) };
}

/**
 * The fields a change sends, checked and tidied, or the response refusing it.
 * A field left out is not in it; the day may be sent only as it already is.
 */
async function readChange(request: Request, env: Env, date: string): Promise<ReadChange | Response> {
  const body = await readJson<Partial<NewAssignment & TypedNames>>(request);
  if (body instanceof Response) return body;
  if (body.date !== undefined && body.date !== date) return dayFixed();

  const errors = await checkFields(env, body);
  if (Object.keys(errors).length > 0) return refuse(errors);
  const changes: ReadChange['changes'] = {};
  for (const key of Object.keys(COLUMN_OF) as ChangeKey[]) if (key in body) changes[key] = text(body[key]) || null;
  return { changes, typed: typedIn(body) };
}

/**
 * Field name to a plain message, for each field sent that is wrong, the day
 * aside: references not text or not in their list (checked all at once),
 * typed names, and the note. Fields it does not know are ignored.
 */
async function checkFields(env: Env, body: Partial<NewAssignment & TypedNames>): Promise<Record<string, string>> {
  const errors = { ...validate(body), ...checkTyped(body) };
  const found = await Promise.all(REFERENCES.map((r) => {
    const id = text(body[r.key]);
    return !id || errors[r.key] !== undefined || exists(env, r.list, id);
  }));
  REFERENCES.forEach((r, i) => {
    if (!found[i]) errors[r.key] = r.message;
  });
  return errors;
}

const PAST_DATE = 'Days before today are read-only. Pick today or a later day.';

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each reference or note that is not text, or a note too long. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of REFERENCES) if (body[r.key] != null && typeof body[r.key] !== 'string') errors[r.key] = r.message;
  if (body.note != null && typeof body.note !== 'string') errors.note = 'Write the note as text.';
  else if (text(body.note).length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  return errors;
}
