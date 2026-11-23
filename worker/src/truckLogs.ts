import type { Env } from './app';
import { DAY_ORDER, SELECT_ASSIGNMENT, marked, type AssignmentRow } from './assignmentQueries';
import { clock } from './clock';
import { codesWithNoPlaceIn } from './fleetImports';
import { LATEST_INSPECTIONS } from './inspectionQueries';
import { json, refuse } from './http';
import { addDays, easternMoment, easternTime, isCalendarDate } from '../../shared/days';
import { buildTripDay, routeAt, type FleetVisit, type TripAssignment, type TripJob, type TripPlace, type TruckCheckIn, type TruckDayInput } from '../../shared/trips';
import { truckLog, truckLogLanes } from '../../shared/truckLog';
import type { Assignment, AssignmentTripPart, DayTruck, DriverTruckLog, TruckLogDay } from '../../shared/types';

/**
 * A Truck's stored day: its stored Fleet visits and the day's Assignments that
 * name it, run through the Trip builder (shared/trips.ts, the one place the
 * matching rules live) and the shared Truck log function (shared/truckLog.ts).
 * Nothing here decides what a Trip is or whose it is.
 *
 *   GET api/trucks/:truckId/days/:date[?at=HH:MM]  → 200 TruckLogDay
 */
export async function handleTruckLogs(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response | null> {
  const day = /^trucks\/([^/]+)\/days\/([^/]+)$/.exec(route);
  if (!day) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return readTruckDay(env, decodeURIComponent(day[1]), decodeURIComponent(day[2]), query.get('at'));
}

/** The last minute of a day: a past day opens there, so the drive back to the shop is written. */
const DAY_END = '23:59';

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The moment a clock minute on a date ends, HH:MM:59 US Eastern, as the Simulation reads its clock. */
const endOfMinute = (date: string, hhmm: string) => {
  const [, hour, minute] = CLOCK.exec(hhmm)!;
  return easternMoment(date, Number(hour), Number(minute), 59);
};

const earlier = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b);

async function readTruckDay(env: Env, truckId: string, date: string, at: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  if (at !== null && !CLOCK.test(at)) return refuse({ at: 'Give a time as HH:MM.' });
  const DB = env.DB;
  const truck = await DB.prepare('SELECT id, number FROM trucks WHERE id = ?').bind(truckId).first<StoredTruck>();
  if (!truck) return json({ error: 'not_found' }, 404);
  return json(await storedTruckDay(env, truck, date, at));
}

type StoredTruck = { id: string; number: string };

/**
 * Each Trip part the stored visits give the Assignments on a date, by
 * Assignment id: every Truck with visits that day is built whole, as of its
 * latest Import, as the Truck log route opens it. The Driver's day read
 * attaches them; an Assignment no stored Trip matched has none.
 */
export async function storedTripParts(env: Env, date: string): Promise<Map<string, AssignmentTripPart>> {
  return (await storedDay(env, date)).parts;
}

/**
 * A date's stored Trips as the board reads them: each Assignment's Trip part
 * (as storedTripParts), and each Truck with visits that day, with its
 * Unplanned work (each with the Driver at its time) and ties. No Truck has
 * visits: `trucks` is empty.
 */
export async function storedDay(env: Env, date: string): Promise<{ parts: Map<string, AssignmentTripPart>; trucks: DayTruck[] }> {
  const { results: trucks } = await env.DB.prepare(
    `SELECT DISTINCT t.id, t.number FROM fleet_visits v JOIN trucks t ON t.id = v.truck_id WHERE v.entered_at >= ? AND v.entered_at < ? ORDER BY t.number`,
  )
    .bind(easternMoment(date, 0, 0), easternMoment(addDays(date, 1), 0, 0))
    .all<StoredTruck>();
  const parts = new Map<string, AssignmentTripPart>();
  const days: DayTruck[] = [];
  for (const truck of trucks) {
    const day = await storedTruckDay(env, truck, date, null);
    for (const a of day.assignments) if (a.trips) parts.set(a.id, a.trips);
    days.push({ truckId: truck.id, truckNumber: truck.number, ...day.lanes });
  }
  return { parts, trucks: days };
}

/**
 * A Driver's Truck log for the Driver day read: on today only, the Truck he
 * last checked in to today, else his usual Truck, built as the Truck log route
 * opens today (as of the latest Import). None on any other day, with no
 * Truck, or when that Truck has no stored visits today.
 */
export async function driverTruckLog(env: Env, driverId: string, date: string): Promise<DriverTruckLog | undefined> {
  if (date !== clock(env).today) return undefined;
  const truck = await env.DB.prepare(
    `SELECT t.id, t.number, t.hcss_code AS hcssCode FROM drivers d
       LEFT JOIN (${LATEST_INSPECTIONS}) i ON i.driverId = d.id
       JOIN trucks t ON t.id = COALESCE(i.truckId, d.default_truck_id)
      WHERE d.id = ?
        AND EXISTS (SELECT 1 FROM fleet_visits v WHERE v.truck_id = t.id AND v.entered_at >= ? AND v.entered_at < ?)`,
  )
    .bind(date, driverId, easternMoment(date, 0, 0), easternMoment(addDays(date, 1), 0, 0))
    .first<StoredTruck & { hcssCode: string | null }>();
  if (!truck) return undefined;
  return { ...(await storedTruckDay(env, truck, date, null)), hcssCode: truck.hcssCode };
}

/** A Truck's stored day, built at the clock minute `at` (null: the default clock). `date` and `at` are already checked. */
async function storedTruckDay(env: Env, truck: StoredTruck, date: string, at: string | null): Promise<TruckLogDay> {
  const DB = env.DB;
  // A visit is filed under the US Eastern day it was entered on.
  const from = easternMoment(date, 0, 0);
  const to = easternMoment(addDays(date, 1), 0, 0);
  // Assigned ones naming the Truck (none named: the Driver's usual one), and every one that day of a Driver
  // who checked in to it, whatever Truck they name; cancelled and discarded ones included.
  const READ = `a.date = ?1 AND a.assigned_at IS NOT NULL
    AND (COALESCE(a.truck_id, d.default_truck_id) = ?2 OR a.driver_id IN (SELECT driver_id FROM inspections WHERE date = ?1 AND truck_id = ?2))`;
  const [latest, visits, rows, discarded, changes, places, jobs, drivers, checkIns] = await DB.batch<Record<string, unknown>>([
    DB.prepare(
      `SELECT MAX(i.imported_at) AS importedAt FROM fleet_import_days d JOIN fleet_imports i ON i.id = d.import_id WHERE d.truck_id = ? AND d.date = ?`,
    ).bind(truck.id, date),
    DB.prepare(
      `SELECT geofence_code AS geofenceCode, entered_at AS enteredAt, exited_at AS exitedAt, entry_odometer AS entryOdometer, exit_odometer AS exitOdometer
         FROM fleet_visits WHERE truck_id = ? AND entered_at >= ? AND entered_at < ? ORDER BY entered_at`,
    ).bind(truck.id, from, to),
    DB.prepare(`${SELECT_ASSIGNMENT} WHERE ${READ} ${DAY_ORDER}`).bind(date, truck.id),
    DB.prepare(`SELECT a.id FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id WHERE ${READ} AND a.discarded_at IS NOT NULL`).bind(date, truck.id),
    DB.prepare(
      `SELECT c.assignment_id AS id, c.changed_at AS changedAt, c.before FROM assignment_changes c
         JOIN assignments a ON a.id = c.assignment_id LEFT JOIN drivers d ON d.id = a.driver_id
        WHERE ${READ} ORDER BY c.changed_at`,
    ).bind(date, truck.id),
    DB.prepare(
      `SELECT id, short_name AS name, full_name AS fullName, kind, CASE WHEN active = 1 THEN geofence_code END AS geofenceCode, job_id AS jobId FROM places`,
    ),
    DB.prepare('SELECT id, name, job_number AS jobNumber FROM jobs'),
    DB.prepare('SELECT id, name, default_truck_id AS defaultTruckId FROM drivers'),
    // Check-ins to the Truck that day: an Inspection is filed under its own day, so one from an earlier day never counts.
    DB.prepare('SELECT driver_id AS driverId, done_at AS at FROM inspections WHERE date = ? AND truck_id = ? ORDER BY done_at').bind(date, truck.id),
  ]);

  const asOf = (latest.results[0]?.importedAt as string | null) ?? null;
  const { today, now: workerNow } = clock(env);
  const clockAt = at ?? (date < today ? DAY_END : easternTime(asOf ?? workerNow.toISOString()));
  // Never later than the latest Import: a stale export must not turn a drive-through into Unplanned work.
  const moment = asOf ? earlier(endOfMinute(date, clockAt), asOf) : endOfMinute(date, clockAt);
  const dayOver = date < today && clockAt === DAY_END;

  const stored = visits.results as unknown as { geofenceCode: string; enteredAt: string; exitedAt: string | null; entryOdometer: number | null; exitOdometer: number | null }[];
  const tripPlaces = places.results as unknown as TripPlace[];
  const assignmentRows = rows.results as unknown as AssignmentRow[];
  const discardedIds = new Set(discarded.results.map((r) => r.id));
  const labels = Object.fromEntries(assignmentRows.map((a, i) => [a.id, `A${i + 1}`]));
  const changesOf = (id: string) =>
    (changes.results as unknown as { id: string; changedAt: string; before: string }[])
      .filter((c) => c.id === id)
      .map((c) => {
        const before = JSON.parse(c.before) as { fromPlaceId: string | null; toPlaceId: string | null };
        return { changedAt: c.changedAt, before: { fromPlaceId: before.fromPlaceId ?? null, toPlaceId: before.toPlaceId ?? null } };
      });
  const tripAssignments: TripAssignment[] = assignmentRows.map((a) => ({
    id: a.id,
    label: labels[a.id],
    fromPlaceId: a.fromPlaceId,
    toPlaceId: a.toPlaceId,
    cancelledAt: a.cancelledAt,
    changes: changesOf(a.id),
    driverId: a.driverId,
    truckId: a.truckId,
  }));
  const driverRows = drivers.results as unknown as { id: string; name: string; defaultTruckId: string | null }[];

  const truckInput: TruckDayInput = {
    id: truck.id,
    drivers: driverRows,
    assignments: assignmentRows.map((a) => ({ driverId: a.driverId, truckId: a.truckId })),
    checkIns: checkIns.results as unknown as TruckCheckIn[],
  };
  const tripDay = buildTripDay({
    places: tripPlaces,
    jobs: jobs.results as unknown as TripJob[],
    // An xlsx export gives no odometers: stored as null, its Trips made with miles blank.
    visits: stored satisfies FleetVisit[],
    assignments: tripAssignments,
    now: moment,
    dayOver,
    truck: truckInput,
  });

  // Shown as the board shows them: discarded ones are hidden, though their Trips stay theirs. A checked-in
  // Driver's Assignment that names another Truck is shown only once a Trip on this one is its.
  const placeName = (id: string | null) => tripPlaces.find((p) => p.id === id)?.name ?? null;
  const namesTruck = (a: AssignmentRow) => (a.truckId ?? driverRows.find((d) => d.id === a.driverId)?.defaultTruckId) === truck.id;
  const hasTrips = (a: AssignmentRow) => tripDay.assignments.some((t) => t.assignmentId === a.id && t.status !== 'none');
  const shown = assignmentRows
    .filter((a) => !discardedIds.has(a.id) && (namesTruck(a) || hasTrips(a)))
    .map((row): Assignment => {
      const route = routeAt(tripAssignments.find((t) => t.id === row.id)!, moment);
      return { ...marked(row), fromPlaceId: route.fromPlaceId, fromPlaceName: placeName(route.fromPlaceId), toPlaceId: route.toPlaceId, toPlaceName: placeName(route.toPlaceId) };
    });
  const { assignments, ...log } = truckLog({ tripDay, places: tripPlaces, assignments: shown, labels });

  return {
    truckId: truck.id,
    truckNumber: truck.number,
    date,
    asOf,
    clock: clockAt,
    at: moment,
    dayOver,
    places: tripPlaces,
    tripDay,
    labels,
    assignments,
    truckLog: log,
    codesWithNoPlace: await codesWithNoPlaceIn(DB, stored),
    lanes: truckLogLanes(tripDay, log, truckInput),
  };
}
