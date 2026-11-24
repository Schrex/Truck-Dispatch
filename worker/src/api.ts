import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { handleInspections } from './inspections';
import { handleTruckProblems } from './truckProblems';
import { handleFleetImports } from './fleetImports';
import { handleGeofences } from './geofences';
import { driverTruck, handleTruckLogs, storedDay } from './truckLogs';
import { exists, handleList, isActive, isList } from './lists';
import { checkTyped, idKeysOf, saveLinked, typedIn, type Typed } from './typedNames';
import { DAY_ORDER, SELECT_ASSIGNMENT, marked, type AssignmentRow } from './assignmentQueries';
import { copiedPlain, plainBefore, plainWas, type PlainColumn } from './plainColumns';
import { addDays, dayState, draftsOn, holidayName, isCalendarDate, mondayOf, weekDates } from '../../shared/days';
import { NOTE_LIMIT, type Assignment, type BusinessDay, type CopiedDay, type Day, type DriverAssignment, type DriverDay, type ListName, type NewAssignment, type TypedNames, type Was, type Week } from '../../shared/types';

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

  const nextOf = /^drivers\/([^/]+)\/next-assigned$/.exec(route);
  if (nextOf) {
    if (reading) return nextAssigned(env, decodeURIComponent(nextOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const driverDay = /^drivers\/([^/]+)\/days\/([^/]+)$/.exec(route);
  if (driverDay) {
    if (reading) return readDriverDay(env, decodeURIComponent(driverDay[1]), decodeURIComponent(driverDay[2]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  // Send per day is gone (ADR 0005): a page still offering it is told so.
  if (/^days\/[^/]+\/send$/.test(route)) {
    return json({ error: 'gone', message: 'Days are no longer Sent. Assign each Assignment on its own.' }, 410);
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

  const checkingIn = await handleInspections(request, env, route, query);
  if (checkingIn) return checkingIn;

  const problems = await handleTruckProblems(request, env, route, query);
  if (problems) return problems;

  const fleetImports = await handleFleetImports(request, env, route, query);
  if (fleetImports) return fleetImports;

  const geofences = await handleGeofences(request, env, route);
  if (geofences) return geofences;

  const truckLogs = await handleTruckLogs(request, env, route, query);
  if (truckLogs) return truckLogs;

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

  const assigning = /^assignments\/([^/]+)\/assign$/.exec(route);
  if (assigning) {
    if (method === 'POST') return assignOne(env, decodeURIComponent(assigning[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const puttingBack = /^assignments\/([^/]+)\/put-back$/.exec(route);
  if (puttingBack) {
    if (method === 'POST') return putBack(env, decodeURIComponent(puttingBack[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const clearing = /^assignments\/([^/]+)\/(discard|dismiss)$/.exec(route);
  if (clearing) {
    if (method === 'POST') return clearAway(env, decodeURIComponent(clearing[1]), clearing[2] as 'discard' | 'dismiss');
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
 * The first day after tomorrow (US Eastern) that holds one of the Driver's
 * Assigned Assignments that is not cancelled, or null, so the Driver view can
 * point him to it ("Next from Dave: Mon, Nov 23") when it is beyond its
 * Yesterday, Today and Tomorrow, as on a weekend before a Monday. His Drafts
 * do not count: he sees nothing of them.
 */
async function nextAssigned(env: Env, driverId: string): Promise<Response> {
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare(
    `SELECT MIN(date) AS date FROM assignments
      WHERE driver_id = ? AND date > ? AND assigned_at IS NOT NULL AND cancelled_at IS NULL`,
  )
    .bind(driverId, clock(env).tomorrow)
    .first<{ date: string | null }>();
  return json({ date: row?.date ?? null });
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
 * The position just after the last Assignment in a lane: bind the date and the
 * Driver (null for Unassigned), then an Assignment to leave out (the one moving).
 * Worked out in the same statement that saves, so nothing slips in between.
 */
const LAST_IN_LANE = '(SELECT COALESCE(MAX(position) + 1, 0) FROM assignments WHERE date = ? AND driver_id IS ? AND id IS NOT ?)';

/**
 * A day's Assignments, Drafts and Assigned ones (cancelled ones Dave discarded
 * left out), each marked Changed or Added since it was Assigned, and each one a
 * stored Trip matched with its Trip part. On a day a Truck has stored visits,
 * each such Truck's Unplanned work and ties too, for the lanes (see storedDay).
 */
async function readDay(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  const [{ results }, { withTripPart, trucks }] = await Promise.all([
    env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.discarded_at IS NULL ${DAY_ORDER}`).bind(date).all<AssignmentRow>(),
    storedDay(env, date),
  ]);
  // No key with no stored visits, so such a day answers exactly as before.
  return json({ assignments: results.map(marked).map(withTripPart), ...(trucks.length > 0 && { trucks }) } satisfies Day);
}

/**
 * An Assignment's plain columns (see PlainColumn), declared once: each is
 * read from a request as text, saved by adding ("Who?" too) and changing,
 * carried by a handover, copied by Start from and Copy to as its `copy`
 * says, kept before each change and compared for Changed. Its own checks
 * go in validate. A new one is one line here.
 */
const PLAIN = [
  { key: 'note', column: 'note', missing: null },
] as const satisfies readonly (PlainColumn & { key: keyof NewAssignment & keyof Was })[];

type PlainKey = (typeof PLAIN)[number]['key'];

/**
 * The fields a Driver reads that can be shown as "was …": each by the id that
 * says whether it really changed (a rename is not a change) and the name the
 * Driver is shown. Plain columns (PLAIN) are compared as they are.
 */
const WAS_FIELDS = [
  ['truckId', 'truckNumber'],
  ['fromPlaceId', 'fromPlaceName'],
  ['toPlaceId', 'toPlaceName'],
  ['materialId', 'materialName'],
  ['foremanId', 'foremanName'],
] as const satisfies readonly (readonly [keyof Assignment, keyof Was])[];

/**
 * One Driver's Assignments on a day, for the Driver view: only those Dave has
 * Assigned, in Dave's order, cancelled ones included (struck through for him)
 * until he dismisses them,
 * each marked Changed or Added by the shared day rules. His Drafts are left
 * out: he sees nothing of them. A Changed one also says what its fields were
 * when it was Assigned, from the first earlier fields kept after that (changes
 * are kept only once it is Assigned, so the first is it as he was given it).
 * Days before today are read like the rest, so the phone still shows today
 * after midnight Eastern until it refreshes. Each one a stored Trip matched has
 * its Trip part, by the same whole-Truck days as the board (storedDay).
 * Today, his Truck's stored day comes too, one of those days (driverTruck).
 */
async function readDriverDay(env: Env, driverId: string, date: string): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: PICK_DATE });
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const [[{ results: rows }, { results: kept }], { withTripPart, days }, truck] = await Promise.all([
    env.DB.batch<AssignmentRow & { id: string; before: string }>([
      env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.driver_id = ? AND a.assigned_at IS NOT NULL AND a.dismissed_at IS NULL ${DAY_ORDER}`).bind(date, driverId),
      env.DB.prepare(
        `SELECT c.assignment_id AS id, c.before FROM assignment_changes c JOIN assignments a ON a.id = c.assignment_id
          WHERE a.date = ? AND a.driver_id = ? AND c.changed_at >= a.assigned_at ORDER BY c.changed_at DESC, c.rowid DESC`,
      ).bind(date, driverId),
    ]),
    storedDay(env, date),
    driverTruck(env, driverId, date),
  ]);
  // Newest first, so the last one set for each Assignment is its first.
  const asAssigned = new Map(kept.map((row) => [row.id, JSON.parse(row.before) as Partial<Assignment>]));
  const assignments = rows.map(marked).map((assignment): DriverAssignment => {
    const before = asAssigned.get(assignment.id);
    const was = assignment.sinceSent === 'changed' && before ? wasWhenAssigned(assignment, before) : {};
    return withTripPart({ ...assignment, was });
  });
  const day = truck && days.get(truck.id);
  return json((day ? { date, assignments, truckLog: { ...day, hcssCode: truck.hcssCode } } : { date, assignments }) satisfies DriverDay);
}

/** The fields a Driver reads that are not as they were when Assigned, each with the name it had then. */
function wasWhenAssigned(now: Assignment, before: Partial<Assignment>): Was {
  const was = plainWas(now, before, PLAIN) as Was;
  for (const [id, name] of WAS_FIELDS) if ((before[id] ?? null) !== now[id]) was[name] = (before[name] ?? null) as string | null;
  return was;
}

/**
 * The state of each day of a week, Monday to Sunday, for the week strip: by
 * the shared day rules from each day's Assignments, with how many Drafts it
 * holds (cancelled ones left out) and its Holiday. Asked by its Monday, so a
 * week is always the same seven days; any other date is refused. Days before
 * today are read like the rest.
 */
async function readWeek(env: Env, monday: string): Promise<Response> {
  if (!isCalendarDate(monday) || mondayOf(monday) !== monday) return refuse({ date: 'Give the Monday the week starts on.' });
  const { results: rows } = await env.DB.prepare(
    `SELECT date, assigned_at AS assignedAt, changed_at AS changedAt, cancelled_at AS cancelledAt, handed_from AS handedFromId
       FROM assignments WHERE date BETWEEN ? AND ? AND discarded_at IS NULL`,
  )
    .bind(monday, addDays(monday, 6))
    .all<{ date: string; assignedAt: string | null; changedAt: string | null; cancelledAt: string | null; handedFromId: string | null }>();
  const days = weekDates(monday).map((date) => {
    const planned = rows.filter((row) => row.date === date);
    return { date, state: dayState(planned).state, drafts: draftsOn(planned), holiday: holidayName(date) };
  });
  return json({ days } satisfies Week);
}

/**
 * Assign: gives an Assignment to its Driver, who sees it from then on, and
 * every change to it after this reaches him (Changed). Only one with an active
 * (not removed) Driver can be Assigned, and never a cancelled one (until it is put back) or one on
 * a day before today. One already Assigned is answered as it is, keeping its first time: there is no
 * Assign again. The checks are repeated in the statement, so a change of
 * Driver or a cancel at the same moment cannot slip in between.
 */
async function assignOne(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  if (existing.cancelledAt) return isCancelled();
  if (existing.assignedAt) return json({ assignment: existing });
  if (!existing.driverId) return isUnassigned();
  const now = clock(env).now.toISOString();
  await env.DB.prepare(
    `UPDATE assignments SET assigned_at = ?1, updated_at = ?1
      WHERE id = ?2 AND assigned_at IS NULL AND cancelled_at IS NULL
        AND driver_id IN (SELECT id FROM drivers WHERE active = 1)`,
  )
    .bind(now, id)
    .run();
  const assignment = await findAssignment(env, id);
  if (!assignment) return json({ error: 'not_found' }, 404);
  if (assignment.assignedAt) return json({ assignment });
  if (assignment.cancelledAt) return isCancelled();
  if (assignment.driverId) return driverRemoved();
  return isUnassigned();
}

function driverRemoved(): Response {
  return json({ error: 'driver_removed', message: 'This Driver was removed, so he would never see it. Give it another Driver, then Assign it.' }, 409);
}

function isUnassigned(): Response {
  return json({ error: 'unassigned', message: 'This Assignment has no Driver yet. Give it a Driver, then Assign it.' }, 409);
}

/**
 * The columns a copy takes from its source, each an entry of a list: kept
 * only while that entry is active, so a copy holds only what exists now (a
 * removed Driver's work goes to Unassigned). Named rather than skipped, so a
 * column a later migration adds is never copied by accident. Plain columns
 * are copied as PLAIN declares (the note is not); the times and whether it
 * was cancelled are not copied; the position is new.
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
 * left out) and a fresh position in its lane: 0, 1, 2... Every copy is a
 * Draft, whatever its source was, so Dave Assigns each when it is ready. The
 * check that the target day is empty (cancelled ones count, unless discarded) and the copy are
 * one statement, so work added meanwhile is never copied over.
 */
async function copyOnto(env: Env, from: string, to: string): Promise<Response> {
  const kept = [
    ...COPIED.map(({ column, table }) => `(SELECT id FROM ${table} WHERE id = a.${column} AND active = 1) AS ${column}`),
    ...copiedPlain(PLAIN),
  ];
  const { results: sources } = await env.DB.prepare(
    `SELECT ${kept.join(', ')} FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id
      WHERE a.date = ? AND a.cancelled_at IS NULL ${DAY_ORDER}`,
  )
    .bind(from)
    .all<Record<(typeof COPIED)[number]['column'], string | null> & Record<string, unknown>>();
  if (sources.length === 0) return json({ error: 'nothing_to_copy', message: 'That day has no Assignments to copy.' }, 409);

  // A fresh position in each lane, in the source's order; a removed Driver's work joins Unassigned.
  const lanes = new Map<string | null, number>();
  const rows = sources.map((source) => {
    const position = lanes.get(source.driver_id) ?? 0;
    lanes.set(source.driver_id, position + 1);
    return { ...source, id: crypto.randomUUID(), position };
  });
  const columns = [...COPIED.map(({ column }) => column), ...PLAIN.filter((p) => 'copy' in p).map((p) => p.column), 'id', 'position'];
  const now = clock(env).now.toISOString();
  const { meta } = await env.DB.prepare(
    `INSERT INTO assignments (date, created_at, updated_at, ${columns.join(', ')})
     SELECT ?, ?, ?, ${columns.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?)
      WHERE NOT EXISTS (SELECT 1 FROM assignments WHERE date = ? AND discarded_at IS NULL)`,
  )
    .bind(to, now, now, JSON.stringify(rows), to)
    .run();
  if (!meta.changes) return json({ error: 'day_planned', message: 'That day already has Assignments, so nothing was copied onto it.' }, 409);

  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.discarded_at IS NULL ${DAY_ORDER}`).bind(to).all<AssignmentRow>();
  return json({ from, to, assignments: results.map(marked) } satisfies CopiedDay, 201);
}

/**
 * Adds one Assignment, or the same one for several Drivers: `alsoDriverIds`
 * names the others, each getting his own, last in his lane. All are saved in
 * one batch, so either every Driver has his or none does.
 */
async function addAssignment(request: Request, env: Env): Promise<Response> {
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  const now = clock(env).now.toISOString();
  const columns = ['id', ...SAVED_COLUMNS, 'created_at', 'updated_at'];
  const made = [read.driverId, ...read.alsoDriverIds].map((driverId) => ({ id: crypto.randomUUID(), driverId }));
  // Last in its lane, so adding work never reshuffles the day.
  await saveLinked(env, read.typed, (typed) =>
    made.map(({ id, driverId }) =>
      env.DB.prepare(
        `INSERT INTO assignments (${columns.join(', ')}, position) VALUES (${columns.map(() => '?').join(', ')}, ${LAST_IN_LANE})`,
      ).bind(id, ...savedValues({ ...read, ...typed, driverId }), now, now, read.date, driverId, id)));
  const assignments = await Promise.all(made.map(({ id }) => findAssignment(env, id)));
  return json({ assignment: assignments[0], assignments }, 201);
}

/**
 * Changes only the fields the request sends, so a change made on one device
 * never wipes one made on another; an empty value clears a field. The day is
 * fixed. A new Driver puts it last in his lane, so his day keeps its order.
 * Only a real change is saved and recorded as changed: sending a field as it
 * already is (the same Driver again, say) changes nothing at all. A real
 * change to an Assigned one also keeps its fields as they were before.
 * Once it is Assigned a new Driver (or Unassigned) does not move it: it is
 * cancelled for the first Driver, so he is told it is off his day, and a copy
 * with the fields sent is added last in the new lane, Assigned to the new
 * Driver at once (Added) or, in Unassigned, a Draft; the answer then carries
 * the copy and the cancelled one. A Draft simply moves. A cancelled
 * Assignment is refused until it is put back.
 */
async function changeAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  if (existing.cancelledAt) return isCancelled();
  const read = await readChange(request, env, existing.date);
  if (read instanceof Response) return read;

  const changes = { ...read.changes };
  for (const idKey of idKeysOf(read.typed)) changes[idKey] = null; // Linked when saved.
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
    // First, once it is Assigned, its fields as they were, kept only when the update below really changes it.
    const keep = keepBefore(env, id, now, `cancelled_at IS NULL AND (${differs})`, ...values);
    if (!('driverId' in changes)) {
      const update = env.DB.prepare(
        `UPDATE assignments SET ${set.join(', ')}, updated_at = ?, changed_at = ? WHERE id = ? AND cancelled_at IS NULL AND (${differs})`,
      ).bind(...binds, now, now, id, ...values);
      return [keep, update];
    }
    // A real change of Driver once it is Assigned: a copy with the fields sent
    // (the rest the first one's own), last in the new lane, Assigned now to a
    // new Driver and handed over from the first one, or a Draft in Unassigned;
    // then the first one cancelled only if the copy was made, and the plain
    // update only if not. Whether it is Assigned is read in the same batch, so
    // an Assign cannot slip in between.
    const columns = Object.values(COLUMN_OF);
    const sent = columns.map((column) => keys.findIndex((key) => COLUMN_OF[key] === column));
    const toDriver = changes.driverId !== null;
    const copy = env.DB.prepare(
      `INSERT INTO assignments (id, date, ${columns.join(', ')}, position, created_at, updated_at, assigned_at, handed_from)
       SELECT ?, date, ${columns.map((column, i) => (sent[i] === -1 ? column : '?')).join(', ')}, ${LAST_IN_LANE}, ?, ?, ?, ? FROM assignments
        WHERE id = ? AND cancelled_at IS NULL AND driver_id IS NOT ? AND assigned_at IS NOT NULL`,
    ).bind(
      copyId, ...sent.filter((at) => at !== -1).map((at) => values[at]), existing.date, changes.driverId, copyId, now, now,
      toDriver ? now : null, toDriver ? id : null, id, changes.driverId,
    );
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
    ${plainBefore(PLAIN)}, 'position', b.position, 'cancelledAt', b.cancelled_at)
  FROM assignments b LEFT JOIN drivers d ON d.id = b.driver_id LEFT JOIN trucks t ON t.id = b.truck_id
  LEFT JOIN places pf ON pf.id = b.from_place_id LEFT JOIN places pt ON pt.id = b.to_place_id
  LEFT JOIN materials m ON m.id = b.material_id LEFT JOIN foremen f ON f.id = b.foreman_id
  WHERE b.id = assignments.id`;

/**
 * Once an Assignment is Assigned, keeps its fields as they were before a
 * change (FIELDS_BEFORE) in the add-only assignment_changes record, so the
 * Driver can be shown what it was. Kept only when it is Assigned and `when`
 * (SQL on its row, with `binds` for its ?s) holds; put it in the same batch,
 * before the write that changes it, so it reads the row as it was.
 */
function keepBefore(env: Env, id: string, now: string, when = 'TRUE', ...binds: unknown[]): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO assignment_changes (id, assignment_id, changed_at, before)
     SELECT ?, id, ?, (${FIELDS_BEFORE}) FROM assignments WHERE id = ? AND assigned_at IS NOT NULL AND (${when})`,
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
  // Once it is Assigned, the moved one's fields as they were (its place among them),
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

/** One lane of a day (a Driver's, or Unassigned for null), in its order, as the Board shows it (discarded ones left out). */
async function readLane(env: Env, date: string, driverId: string | null): Promise<Assignment[]> {
  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? AND a.driver_id IS ? AND a.discarded_at IS NULL ${DAY_ORDER}`)
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
 * ✕: a Draft is really deleted, so a planning mistake leaves nothing behind
 * (204). An Assigned one is cancelled instead and kept in its place, so the
 * Driver who has seen it is told it is off; its fields as they were are kept,
 * as for any change after it was Assigned. Answers it cancelled; one already
 * cancelled stays as it was. Which of the two happens is decided in the
 * statements themselves, so an Assign at the same moment cannot fall between.
 */
async function takeOff(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const now = clock(env).now.toISOString();
  await env.DB.batch([
    keepBefore(env, id, now, 'cancelled_at IS NULL'),
    env.DB.prepare('DELETE FROM assignments WHERE id = ? AND assigned_at IS NULL').bind(id),
    env.DB.prepare(
      'UPDATE assignments SET cancelled_at = ?1, changed_at = ?1, updated_at = ?1 WHERE id = ?2 AND cancelled_at IS NULL AND assigned_at IS NOT NULL',
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
      'UPDATE assignments SET cancelled_at = NULL, discarded_at = NULL, dismissed_at = NULL, changed_at = ?1, updated_at = ?1 WHERE id = ?2 AND cancelled_at IS NOT NULL',
    ).bind(now, id),
  ]);
  return json({ assignment: await findAssignment(env, id) });
}

/**
 * Discard (Dave, on the Board) or Dismiss (the Driver, on his view): a
 * cancelled Assignment is cleared away from that one side only, so the Board
 * stops listing what Dave is done with while the Driver is still told it is
 * off, and the other way round. Nothing is deleted and nothing the Driver
 * reads changes, so it is allowed on any day, past ones too. Only a cancelled
 * one can be cleared; doing it again changes nothing. Answers 204.
 */
async function clearAway(env: Env, id: string, how: 'discard' | 'dismiss'): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (!existing.cancelledAt) {
    return json({ error: 'not_cancelled', message: `Only a cancelled Assignment can be ${how === 'discard' ? 'discarded' : 'dismissed'}.` }, 409);
  }
  const column = how === 'discard' ? 'discarded_at' : 'dismissed_at';
  await env.DB.prepare(`UPDATE assignments SET ${column} = ?1 WHERE id = ?2 AND cancelled_at IS NOT NULL AND ${column} IS NULL`)
    .bind(clock(env).now.toISOString(), id)
    .run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/** What the Worker says when a day sent is not a calendar date. */
const PICK_DATE = 'Pick a date.';

/** Every refusal of a day before today, in one place so they read alike: a date given for new work, and an Assignment already on one. */
const PAST_DAY = {
  date: 'Days before today are read-only. Pick today or a later day.',
  assignment: 'This Assignment is on a day before today, which is read-only.',
} as const;

/** Days before today (US Eastern) are read-only: nothing on them is added, changed, moved, Assigned, deleted, cancelled or put back. */
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

/** A field added to NewAssignment does not compile until it is declared in REFERENCES or PLAIN, or handled like date. */
type Undeclared = Exclude<keyof NewAssignment, 'date' | ReferenceKey | PlainKey>;
const everyFieldDeclared: [Undeclared] extends [never] ? true : Undeclared = true;
void everyFieldDeclared;

/**
 * An Assignment as a request sends it, checked and tidied. A Place or Material
 * it typed by name is linked only when it is saved (see saveLinked).
 */
type ReadAssignment = { date: string; typed: Typed[]; alsoDriverIds: string[] } & Record<ReferenceKey | PlainKey, string | null>;

/** The columns adding an Assignment saves, in the order savedValues gives them. */
const SAVED_COLUMNS = ['date', ...REFERENCES.map((r) => r.column), ...PLAIN.map((p) => p.column)];

/** A field a change may send: any but the day, which is fixed. */
type ChangeKey = ReferenceKey | PlainKey;

/** Each field a change may send to its column: what a change sets and a handover carries. */
const COLUMN_OF = Object.fromEntries([...REFERENCES, ...PLAIN].map((c) => [c.key, c.column])) as Record<ChangeKey, string>;

/** The fields a change sends, checked and tidied (empty is null), and the names it typed. */
interface ReadChange {
  changes: Partial<Record<ChangeKey, string | null>>;
  typed: Typed[];
}

function savedValues(read: ReadAssignment): (string | null)[] {
  return [read.date, ...REFERENCES.map((r) => read[r.key]), ...PLAIN.map((p) => read[p.key])];
}

/** The Assignment a request sends, checked and tidied, or the response refusing it. */
async function readAssignment(request: Request, env: Env): Promise<ReadAssignment | Response> {
  const body = await readJson<Partial<NewAssignment & TypedNames> & { alsoDriverIds?: unknown }>(request);
  if (body instanceof Response) return body;

  const errors = await checkFields(env, body);
  if (!isCalendarDate(body.date)) errors.date = PICK_DATE;
  else if (isPast(env, body.date)) errors.date = PAST_DAY.date;
  const also = await readAlso(env, body.alsoDriverIds, text(body.driverId) || null);
  if (typeof also === 'string') errors.alsoDriverIds = also;
  if (Object.keys(errors).length > 0) return refuse(errors);
  const fields = Object.fromEntries([...REFERENCES, ...PLAIN].map((c) => [c.key, text(body[c.key]) || null])) as Record<ReferenceKey | PlainKey, string | null>;
  return { date: body.date as string, ...fields, typed: typedIn(body), alsoDriverIds: also as string[] };
}

/**
 * The other Drivers a new Assignment is also made for, or the message refusing
 * them: each an active Driver, named once, and only beside a first Driver.
 */
async function readAlso(env: Env, sent: unknown, driverId: string | null): Promise<string[] | string> {
  if (sent == null) return [];
  if (!Array.isArray(sent) || !sent.every((id): id is string => typeof id === 'string' && id.trim() !== '')) return 'Pick the Drivers from the list.';
  if (sent.length === 0) return [];
  if (!driverId || new Set([driverId, ...sent]).size !== sent.length + 1) return 'Pick each Driver once.';
  const active = await Promise.all(sent.map((id) => isActive(env, 'drivers', id)));
  return active.every(Boolean) ? sent : 'One of these Drivers was removed. Pick the Drivers again.';
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

/** Field name to a plain message, for each reference or note that is not text, or a note too long. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of REFERENCES) if (body[r.key] != null && typeof body[r.key] !== 'string') errors[r.key] = r.message;
  if (body.note != null && typeof body.note !== 'string') errors.note = 'Write the note as text.';
  else if (text(body.note).length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  return errors;
}
