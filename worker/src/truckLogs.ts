import type { Env } from './app';
import { DAY_ORDER, SELECT_ASSIGNMENT, marked, type AssignmentRow } from './assignmentQueries';
import { clock } from './clock';
import { codesWithNoPlaceIn } from './fleetImports';
import { json, refuse } from './http';
import { addDays, easternMoment, easternTime, isCalendarDate } from '../../shared/days';
import { buildTripDay, routeAt, type FleetVisit, type TripAssignment, type TripJob, type TripPlace } from '../../shared/trips';
import { truckLog } from '../../shared/truckLog';
import type { Assignment, TruckLogDay } from '../../shared/types';

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
  const truck = await DB.prepare('SELECT id, number FROM trucks WHERE id = ?').bind(truckId).first<{ id: string; number: string }>();
  if (!truck) return json({ error: 'not_found' }, 404);

  // A visit is filed under the US Eastern day it was entered on.
  const from = easternMoment(date, 0, 0);
  const to = easternMoment(addDays(date, 1), 0, 0);
  // Assigned ones naming the Truck (none named: the Driver's usual one), cancelled and discarded ones included.
  const NAMES_TRUCK = 'a.date = ?1 AND a.assigned_at IS NOT NULL AND COALESCE(a.truck_id, d.default_truck_id) = ?2';
  const [latest, visits, rows, discarded, changes, places, jobs, drivers] = await DB.batch<Record<string, unknown>>([
    DB.prepare(
      `SELECT MAX(i.imported_at) AS importedAt FROM fleet_import_days d JOIN fleet_imports i ON i.id = d.import_id WHERE d.truck_id = ? AND d.date = ?`,
    ).bind(truck.id, date),
    DB.prepare(
      `SELECT geofence_code AS geofenceCode, entered_at AS enteredAt, exited_at AS exitedAt, entry_odometer AS entryOdometer, exit_odometer AS exitOdometer
         FROM fleet_visits WHERE truck_id = ? AND entered_at >= ? AND entered_at < ? ORDER BY entered_at`,
    ).bind(truck.id, from, to),
    DB.prepare(`${SELECT_ASSIGNMENT} WHERE ${NAMES_TRUCK} ${DAY_ORDER}`).bind(date, truck.id),
    DB.prepare(`SELECT a.id FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id WHERE ${NAMES_TRUCK} AND a.discarded_at IS NOT NULL`).bind(date, truck.id),
    DB.prepare(
      `SELECT c.assignment_id AS id, c.changed_at AS changedAt, c.before FROM assignment_changes c
         JOIN assignments a ON a.id = c.assignment_id LEFT JOIN drivers d ON d.id = a.driver_id
        WHERE ${NAMES_TRUCK} ORDER BY c.changed_at`,
    ).bind(date, truck.id),
    DB.prepare(
      `SELECT id, short_name AS name, full_name AS fullName, kind, CASE WHEN active = 1 THEN geofence_code END AS geofenceCode, job_id AS jobId FROM places`,
    ),
    DB.prepare('SELECT id, name, job_number AS jobNumber FROM jobs'),
    DB.prepare('SELECT id, name, default_truck_id AS defaultTruckId FROM drivers'),
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
  }));

  const tripDay = buildTripDay({
    places: tripPlaces,
    jobs: jobs.results as unknown as TripJob[],
    // An xlsx export gives no odometers: stored as null, its Trips made with miles blank.
    visits: stored satisfies FleetVisit[],
    assignments: tripAssignments,
    now: moment,
    dayOver,
    truck: {
      id: truck.id,
      drivers: drivers.results as unknown as { id: string; name: string; defaultTruckId: string | null }[],
      assignments: assignmentRows.map((a) => ({ driverId: a.driverId, truckId: a.truckId })),
    },
  });

  // Shown as the board shows them: discarded ones are hidden, though their Trips stay theirs.
  const placeName = (id: string | null) => tripPlaces.find((p) => p.id === id)?.name ?? null;
  const shown = assignmentRows
    .filter((a) => !discardedIds.has(a.id))
    .map((row): Assignment => {
      const route = routeAt(tripAssignments.find((t) => t.id === row.id)!, moment);
      return { ...marked(row), fromPlaceId: route.fromPlaceId, fromPlaceName: placeName(route.fromPlaceId), toPlaceId: route.toPlaceId, toPlaceName: placeName(route.toPlaceId) };
    });
  const { assignments, ...log } = truckLog({ tripDay, places: tripPlaces, assignments: shown, labels });

  return json({
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
  } satisfies TruckLogDay);
}
