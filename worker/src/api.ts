import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { exists, handleList, isList, listOrder } from './lists';
import { checkTyped, saveLinked, typedIn, type Typed } from './typedNames';
import { addDays, dayState, holidayName, isCalendarDate, mondayOf, sinceSent, unassignedOn, weekDates } from '../../shared/days';
import type { Assignment, BusinessDay, CopiedDay, Day, DriverAssignment, DriverDay, ListName, NewAssignment, TypedNames, Was, Week } from '../../shared/types';

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

  const nextOf = /^drivers\/([^/]+)\/next-sent$/.exec(route);
  if (nextOf) {
    if (reading) return nextSent(env, decodeURIComponent(nextOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const driverDay = /^drivers\/([^/]+)\/days\/([^/]+)$/.exec(route);
  if (driverDay) {
    if (reading) return readDriverDay(env, decodeURIComponent(driverDay[1]), decodeURIComponent(driverDay[2]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const sending = /^days\/([^/]+)\/send$/.exec(route);
  if (sending) {
    if (method === 'POST') return sendDay(env, decodeURIComponent(sending[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const startingFrom = /^days\/([^/]+)\/start-from$/.exec(route);
  if (startingFrom) {
    const date = decodeURIComponent(startingFrom[1]);
    if (reading) return readStartFrom(env, date);
    if (method === 'POST') return startFrom(env, date);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  const copyingTo = /^days\/([^/]+)\/copy-to$/.exec(route);
  if (copyingTo) {
    if (method === 'POST') return copyTo(request, env, decodeURIComponent(copyingTo[1]));
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

  const moving = /^assignments\/([^/]+)\/move$/.exec(route);
  if (moving) {
    if (method === 'POST') return moveAssignment(request, env, decodeURIComponent(moving[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const puttingBack = /^assignments\/([^/]+)\/put-back$/.exec(route);
  if (puttingBack) {
    if (method === 'POST') return putBack(env, decodeURIComponent(puttingBack[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const one = /^assignments\/([^/]+)$/.exec(route);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'PATCH') return changeAssignment(request, env, id);
    if (method === 'DELETE') return takeOff(env, id);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH, DELETE' });
  }

  if (['health', 'today'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/**
 * How many days after today a Driver has Assignments on, so Settings can warn
 * before he is removed that work is still planned for him.
 */
/**
 * The first day after tomorrow (US Eastern) that is Sent and holds one of the
 * Driver's Assignments that is not cancelled, or null, so the Driver view can
 * point him to it ("Next from Dave: Mon, Nov 23") when it is beyond its
 * Yesterday, Today and Tomorrow, as on a weekend before a Monday.
 */
async function nextSent(env: Env, driverId: string): Promise<Response> {
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare(
    `SELECT MIN(a.date) AS date FROM assignments a JOIN day_sends s ON s.date = a.date
      WHERE a.driver_id = ? AND a.date > ? AND a.cancelled_at IS NULL`,
  )
    .bind(driverId, clock(env).tomorrow)
    .first<{ date: string | null }>();
  return json({ date: row?.date ?? null });
}

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
       a.position, a.created_at AS createdAt, a.updated_at AS updatedAt, a.changed_at AS changedAt, a.cancelled_at AS cancelledAt,
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
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  const [{ results }, { results: sends }] = await env.DB.batch<AssignmentRow & { sentAt: string }>([
    env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? ${DAY_ORDER}`).bind(date),
    env.DB.prepare('SELECT sent_at AS sentAt FROM day_sends WHERE date = ?').bind(date),
  ]);
  return json({ assignments: results.map(marked), sentAt: sends[0]?.sentAt ?? null } satisfies Day);
}

/**
 * The fields a Driver reads that can be shown as "was …": each by the id that
 * says whether it really changed (a rename is not a change) and the name the
 * Driver is shown. The note has no id; its text is both.
 */
const WAS_FIELDS = [
  ['truckId', 'truckNumber'],
  ['fromPlaceId', 'fromPlaceName'],
  ['toPlaceId', 'toPlaceName'],
  ['materialId', 'materialName'],
  ['foremanId', 'foremanName'],
  ['note', 'note'],
] as const satisfies readonly (readonly [keyof Assignment, keyof Was])[];

/**
 * One Driver's Assignments on a day, for the Driver view. A Draft answers only
 * that it is a Draft: Drivers see nothing of a day before Dave Sends it. A
 * Sent day answers his Assignments in Dave's order, cancelled ones included
 * (struck through for him), each marked Changed or Added by the shared day
 * rules; a Changed one also says what its fields were when the day was Sent,
 * from the first earlier fields kept after the Send (changes are kept only
 * once a day is Sent, so the first is the day as he was sent it). Days before
 * today are read like the rest, so the phone still shows today after midnight
 * Eastern until it refreshes.
 */
async function readDriverDay(env: Env, driverId: string, date: string): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const [{ results: sends }, { results: rows }, { results: kept }] = await env.DB.batch<{ sentAt: string } & AssignmentRow & { id: string; before: string }>([
    env.DB.prepare('SELECT sent_at AS sentAt FROM day_sends WHERE date = ?').bind(date),
    env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.driver_id = ? ${DAY_ORDER}`).bind(date, driverId),
    env.DB.prepare(
      `SELECT c.assignment_id AS id, c.before FROM assignment_changes c JOIN assignments a ON a.id = c.assignment_id
        WHERE a.date = ? AND a.driver_id = ? ORDER BY c.changed_at DESC, c.rowid DESC`,
    ).bind(date, driverId),
  ]);
  const sentAt = sends[0]?.sentAt;
  if (!sentAt) return json({ date, state: 'draft' } satisfies DriverDay);
  // Newest first, so the last one set for each Assignment is its first.
  const asSent = new Map(kept.map((row) => [row.id, JSON.parse(row.before) as Partial<Assignment>]));
  const assignments = rows.map(marked).map((assignment): DriverAssignment => {
    const before = asSent.get(assignment.id);
    return { ...assignment, was: assignment.sinceSent === 'changed' && before ? wasWhenSent(assignment, before) : {} };
  });
  return json({ date, state: 'sent', sentAt, assignments } satisfies DriverDay);
}

/** The fields a Driver reads that are not as they were when Sent, each with the name it had then. */
function wasWhenSent(now: Assignment, before: Partial<Assignment>): Was {
  const was: Was = {};
  for (const [id, name] of WAS_FIELDS) if ((before[id] ?? null) !== now[id]) was[name] = (before[name] ?? null) as string | null;
  return was;
}

/**
 * The state of each day of a week, Monday to Sunday, for the week strip: by
 * the shared day rules from each day's Assignments and its first Send, with
 * how many are Unassigned (cancelled ones left out) and its Holiday. Asked
 * by its Monday, so a week is always the same seven days; any other date is
 * refused. Days before today are read like the rest.
 */
async function readWeek(env: Env, monday: string): Promise<Response> {
  if (!isCalendarDate(monday) || mondayOf(monday) !== monday) return refuse({ date: 'Give the Monday the week starts on.' });
  const sunday = addDays(monday, 6);
  type Row = { date: string; driverId: string | null; createdAt: string; changedAt: string | null; cancelledAt: string | null };
  const [{ results: rows }, { results: sends }] = await env.DB.batch<Row & { sentAt: string }>([
    env.DB.prepare(
      `SELECT date, driver_id AS driverId, created_at AS createdAt, changed_at AS changedAt, cancelled_at AS cancelledAt
         FROM assignments WHERE date BETWEEN ? AND ?`,
    ).bind(monday, sunday),
    env.DB.prepare('SELECT date, sent_at AS sentAt FROM day_sends WHERE date BETWEEN ? AND ?').bind(monday, sunday),
  ]);
  const days = weekDates(monday).map((date) => {
    const planned = rows.filter((row) => row.date === date);
    const { state } = dayState(planned, sends.find((send) => send.date === date)?.sentAt ?? null);
    return { date, state, unassigned: unassignedOn(planned), holiday: holidayName(date) };
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
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  if (isPast(env, date)) return refuse({ date: PAST_DAY.send });
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
 * The columns a copy takes from its source, each an entry of a list: kept
 * only while that entry is active, so a copy holds only what exists now (a
 * removed Driver's work goes to Unassigned). Named rather than skipped, so a
 * column a later migration adds is never copied by accident. The note, the
 * times and whether it was cancelled are not copied; the position is new.
 */
const COPIED = [
  { column: 'driver_id', table: 'drivers' },
  { column: 'truck_id', table: 'trucks' },
  { column: 'from_place_id', table: 'places' },
  { column: 'to_place_id', table: 'places' },
  { column: 'material_id', table: 'materials' },
  { column: 'foreman_id', table: 'foremen' },
] as const;

/**
 * The latest day before `date` that has Assignments to copy, or null when
 * there is none. Cancelled ones are left out: a copy leaves them behind, so a
 * day of only call-offs has nothing to start from.
 */
async function latestEarlierDay(env: Env, date: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT MAX(date) AS date FROM assignments WHERE date < ? AND cancelled_at IS NULL')
    .bind(date)
    .first<{ date: string | null }>();
  return row?.date ?? null;
}

/** The day Start from on `date` would copy, so the page can name it on the button. */
async function readStartFrom(env: Env, date: string): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  return json({ from: await latestEarlierDay(env, date) });
}

/** Start from: copies the latest earlier day that has Assignments onto an empty day. */
async function startFrom(env: Env, date: string): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a day to start.' });
  if (isPast(env, date)) return refuse({ date: PAST_DAY.date });
  const from = await latestEarlierDay(env, date);
  if (!from) return json({ error: 'nothing_to_copy', message: 'No earlier day has Assignments to start from.' }, 409);
  return copyOnto(env, from, date);
}

/** Copy to: copies a day before today onto another day, today or later, that is still empty (the next Working day, on the Board). */
async function copyTo(request: Request, env: Env, from: string): Promise<Response> {
  const body = await readJson<{ to?: unknown }>(request);
  if (body instanceof Response) return body;
  if (!isCalendarDate(from)) return refuse({ date: 'Pick a day to copy.' });
  if (!isPast(env, from)) return refuse({ date: 'Copy to copies a day before today. Pick an earlier day.' });
  const to = body.to;
  if (!isCalendarDate(to)) return refuse({ to: 'Pick a day to copy onto.' });
  if (isPast(env, to)) return refuse({ to: PAST_DAY.date });
  return copyOnto(env, from, to);
}

/**
 * Copies a day's Assignments that are not cancelled onto an empty day, in the
 * order the day is read, each with only the COPIED columns (removed entries
 * left out) and a fresh position in its lane: 0, 1, 2... The check that the
 * target day is empty (cancelled ones count) and the copy are one statement,
 * so work added meanwhile is never copied over. Copies on a Sent day that was
 * emptied are created after its Send, so they are Added.
 */
async function copyOnto(env: Env, from: string, to: string): Promise<Response> {
  const kept = COPIED.map(({ column, table }) => `(SELECT id FROM ${table} WHERE id = a.${column} AND active = 1) AS ${column}`);
  const { results: sources } = await env.DB.prepare(
    `SELECT ${kept.join(', ')} FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id
      WHERE a.date = ? AND a.cancelled_at IS NULL ${DAY_ORDER}`,
  )
    .bind(from)
    .all<Record<(typeof COPIED)[number]['column'], string | null>>();
  if (sources.length === 0) return json({ error: 'nothing_to_copy', message: 'That day has no Assignments to copy.' }, 409);

  // A fresh position in each lane, in the source's order; a removed Driver's work joins Unassigned.
  const lanes = new Map<string | null, number>();
  const rows = sources.map((source) => {
    const position = lanes.get(source.driver_id) ?? 0;
    lanes.set(source.driver_id, position + 1);
    return { ...source, id: crypto.randomUUID(), position };
  });
  const columns = [...COPIED.map(({ column }) => column), 'id', 'position'];
  const now = clock(env).now.toISOString();
  const { meta } = await env.DB.prepare(
    `INSERT INTO assignments (date, created_at, updated_at, ${columns.join(', ')})
     SELECT ?, ?, ?, ${columns.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?)
      WHERE NOT EXISTS (SELECT 1 FROM assignments WHERE date = ?)`,
  )
    .bind(to, now, now, JSON.stringify(rows), to)
    .run();
  if (!meta.changes) return json({ error: 'day_planned', message: 'That day already has Assignments, so nothing was copied onto it.' }, 409);

  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? ${DAY_ORDER}`).bind(to).all<AssignmentRow>();
  return json({ from, to, assignments: results.map(marked) } satisfies CopiedDay, 201);
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
 * On a Sent day a new Driver (or Unassigned) does not move it: it is
 * cancelled for the first Driver, so he is told it is off his day, and a copy
 * with the fields sent is added last in the new lane (Added); the answer then
 * carries the copy and the cancelled one. A cancelled Assignment is refused
 * until it is put back.
 */
async function changeAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  if (existing.cancelledAt) return isCancelled();
  const read = await readChange(request, env, existing.date);
  if (read instanceof Response) return read;

  const changes = { ...read.changes };
  for (const { field } of read.typed) changes[field.idKey] = null; // Linked when saved.
  const keys = Object.keys(changes) as ChangeKey[];
  if (keys.length === 0) return json({ assignment: existing });

  const now = clock(env).now.toISOString();
  const copyId = crypto.randomUUID();
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
    const keep = keepBefore(env, id, now, `cancelled_at IS NULL AND (${differs})`, ...values);
    if (!('driverId' in changes)) {
      const update = env.DB.prepare(
        `UPDATE assignments SET ${set.join(', ')}, updated_at = ?, changed_at = ? WHERE id = ? AND cancelled_at IS NULL AND (${differs})`,
      ).bind(...binds, now, now, id, ...values);
      return [keep, update];
    }
    // A real change of Driver on a Sent day: a copy with the fields sent (the
    // rest the first one's own), last in the new lane, then the first one
    // cancelled only if the copy was made, and the plain update only if not.
    // The day's Send is read in the same batch, so it cannot slip in between.
    const columns = Object.values(COLUMN_OF);
    const sent = columns.map((column) => keys.findIndex((key) => COLUMN_OF[key] === column));
    const copy = env.DB.prepare(
      `INSERT INTO assignments (id, date, ${columns.join(', ')}, position, created_at, updated_at)
       SELECT ?, date, ${columns.map((column, i) => (sent[i] === -1 ? column : '?')).join(', ')}, ${LAST_IN_LANE}, ?, ? FROM assignments
        WHERE id = ? AND cancelled_at IS NULL AND driver_id IS NOT ? AND date IN (SELECT date FROM day_sends)`,
    ).bind(copyId, ...sent.filter((at) => at !== -1).map((at) => values[at]), existing.date, changes.driverId, copyId, now, now, id, changes.driverId);
    const cancel = env.DB.prepare(
      'UPDATE assignments SET cancelled_at = ?1, changed_at = ?1, updated_at = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM assignments WHERE id = ?3)',
    ).bind(now, id, copyId);
    const update = env.DB.prepare(
      `UPDATE assignments SET ${set.join(', ')}, updated_at = ?, changed_at = ? WHERE id = ? AND cancelled_at IS NULL AND (${differs})
          AND NOT EXISTS (SELECT 1 FROM assignments WHERE id = ?)`,
    ).bind(...binds, now, now, id, ...values, copyId);
    return [keep, copy, cancel, update];
  });
  const copy = await findAssignment(env, copyId);
  if (copy) return json({ assignment: copy, cancelled: await findAssignment(env, id) });
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
    'note', b.note, 'position', b.position, 'cancelledAt', b.cancelled_at)
  FROM assignments b LEFT JOIN drivers d ON d.id = b.driver_id LEFT JOIN trucks t ON t.id = b.truck_id
  LEFT JOIN places pf ON pf.id = b.from_place_id LEFT JOIN places pt ON pt.id = b.to_place_id
  LEFT JOIN materials m ON m.id = b.material_id LEFT JOIN foremen f ON f.id = b.foreman_id
  WHERE b.id = assignments.id`;

/**
 * On a Sent day, keeps an Assignment's fields as they were before a change
 * (FIELDS_BEFORE) in the add-only assignment_changes record, so the Driver
 * can be shown what it was. Kept only when its day is Sent and `when` (SQL on
 * its row, with `binds` for its ?s) holds; put it in the same batch, before
 * the write that changes it, so it reads the row as it was.
 */
function keepBefore(env: Env, id: string, now: string, when = 'TRUE', ...binds: unknown[]): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assignment_changes (id, assignment_id, changed_at, before)
     SELECT ?, id, ?, (${FIELDS_BEFORE}) FROM assignments WHERE id = ? AND date IN (SELECT date FROM day_sends) AND (${when})`,
  ).bind(crypto.randomUUID(), now, id, ...binds);
}

/** Which way "Do this first" ("earlier") and "Do this later" ("later") move an Assignment in its lane. */
const DIRECTIONS = { earlier: -1, later: 1 } as const;

/**
 * Moves an Assignment one place in its lane (its day and Driver, or
 * Unassigned), swapping it with its neighbour, and numbers the lane 0, 1, 2…
 * in its new order, so Assignments that shared a position (saved before they
 * had one) each get their own. Only the one moved is recorded as changed: the
 * neighbour that shifted is not, so a Driver is not told it changed. Answers
 * the lane in its new order. Cancelled ones keep their place and are stepped
 * over: it swaps with the nearest one that is not cancelled, and the first (or
 * last) not cancelled cannot move earlier (or later).
 */
async function moveAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson<{ direction?: unknown }>(request);
  if (body instanceof Response) return body;
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  if (existing.cancelledAt) return isCancelled();
  const direction = body.direction;
  if (direction !== 'earlier' && direction !== 'later') return refuse({ direction: 'Move it earlier or later.' });

  const lane = await readLane(env, existing.date, existing.driverId);
  const from = lane.findIndex((a) => a.id === id);
  // Cancelled ones keep their place but are stepped over: it swaps with the nearest one still on.
  let to = from + DIRECTIONS[direction];
  while (lane[to]?.cancelledAt) to += DIRECTIONS[direction];
  if (to < 0 || to >= lane.length) {
    const end = direction === 'earlier' ? 'first' : 'last';
    return json({ error: 'lane_end', message: `This Assignment is already ${end} in its lane.` }, 409);
  }
  const order = lane.map((a) => a.id);
  [order[from], order[to]] = [order[to], order[from]];

  const now = clock(env).now.toISOString();
  // On a Sent day, the moved one's fields as they were (its place among them),
  // kept as any change is; the neighbour that shifted keeps nothing.
  const keep = keepBefore(env, id, now);
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

function isCancelled(): Response {
  return json({ error: 'cancelled', message: 'This Assignment is cancelled. Put it back first to change it.' }, 409);
}

/**
 * ✕: on a Draft day a real delete, so a planning mistake leaves nothing
 * behind (204). On a Sent day the Assignment is cancelled instead and kept in
 * its place, so a Driver who has seen it is told it is off; its fields as they
 * were are kept, as for any change after the Send. Answers it cancelled; one
 * already cancelled stays as it was. Which of the two happens is decided in
 * the statements themselves, so a Send at the same moment cannot fall between.
 */
async function takeOff(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const now = clock(env).now.toISOString();
  const sent = 'date IN (SELECT date FROM day_sends)';
  await env.DB.batch([
    keepBefore(env, id, now, 'cancelled_at IS NULL'),
    env.DB.prepare(`DELETE FROM assignments WHERE id = ? AND NOT ${sent}`).bind(id),
    env.DB.prepare(
      `UPDATE assignments SET cancelled_at = ?1, changed_at = ?1, updated_at = ?1 WHERE id = ?2 AND cancelled_at IS NULL AND ${sent}`,
    ).bind(now, id),
  ]);
  const cancelled = await findAssignment(env, id);
  if (cancelled) return json({ assignment: cancelled });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Put back: a cancelled Assignment is on its Driver's day again, where it
 * always stayed, and is recorded as changed (its fields as they were kept),
 * so the Driver is told. One that is not cancelled stays as it was.
 */
async function putBack(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const now = clock(env).now.toISOString();
  await env.DB.batch([
    keepBefore(env, id, now, 'cancelled_at IS NOT NULL'),
    env.DB.prepare(
      'UPDATE assignments SET cancelled_at = NULL, changed_at = ?1, updated_at = ?1 WHERE id = ?2 AND cancelled_at IS NOT NULL',
    ).bind(now, id),
  ]);
  return json({ assignment: await findAssignment(env, id) });
}

/** What the Worker says when a day sent is not a calendar date. */
const PICK_DATE = 'Pick a date.';

/** Every refusal of a day before today, in one place so they read alike: a date given for new work, a Send, and an Assignment already on one. */
const PAST_DAY = {
  date: 'Days before today are read-only. Pick today or a later day.',
  send: 'Days before today are read-only, so they cannot be Sent.',
  assignment: 'This Assignment is on a day before today, which is read-only.',
} as const;

/** Days before today (US Eastern) are read-only: nothing on them is added, changed, moved, deleted, cancelled or put back. */
function isPast(env: Env, date: string): boolean {
  return date < clock(env).today;
}

function onPastDay(): Response {
  return json({ error: 'past_day', message: PAST_DAY.assignment }, 409);
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
  if (!isCalendarDate(body.date)) errors.date = PICK_DATE;
  else if (isPast(env, body.date)) errors.date = PAST_DAY.date;
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

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each reference or note that is not text, or a note too long. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of REFERENCES) if (body[r.key] != null && typeof body[r.key] !== 'string') errors[r.key] = r.message;
  if (body.note != null && typeof body.note !== 'string') errors.note = 'Write the note as text.';
  else if (text(body.note).length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  return errors;
}
