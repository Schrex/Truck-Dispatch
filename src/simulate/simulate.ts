/**
 * The real day at one moment: the Trip builder's output, and Dave's
 * Assignments as the production API would send them, each with its Trip part.
 * The page feeds these to the real board lanes, the Driver cards and the
 * Truck log. Pure; nothing is saved and the Worker is not asked.
 */
import type { Assignment } from '../../shared/types';
import { buildTripDay, linkedAssignment, routeAt, type AssignmentTrips, type TripDay, type TripJob, type TruckLogColumn, type TruckLogTrip, type TruckLogUnplanned } from '../../shared/trips';
import { REAL_DAY, easternIso, type PlannedAssignment, type Scenario } from './realDay';
import { tripAnswers, type PlannedMadeAssignment, type UnplannedAnswer } from './answers';

/** The last minute of the day: the clock's end, when the day is over. */
export const DAY_END = 23 * 60 + 59;

/** "10:02" for minutes since midnight. */
export const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Dave Assigned the day the evening before (17:00 ET on Sun 15 Nov). */
const ASSIGNED_AT = '2026-11-15T22:00:00Z';
/** Dave answers the Unplanned work next morning (08:00 ET on Tue 17 Nov). */
const ANSWERED_AT = '2026-11-17T13:00:00Z';

export interface SimulatedDay {
  /** Everything the Trip builder knows at the clock's time, for the Truck log (#60, #61). */
  tripDay: TripDay;
  /** Randy's Assignments in Dave's order, then the ones Dave made from Unplanned work, as GET api/assignments would send them, with their Trip parts. */
  assignments: Assignment[];
  /** Each Assignment's label ("A1", "A3") by its id, for the Trip log. */
  labels: Record<string, string>;
  /** The Truck log's body: one column per Assignment, then the Unplanned work, and the drives to and from the shop. */
  truckLog: { columns: TruckLogColumn[]; unplanned: TruckLogUnplanned[]; shopTrips: TruckLogTrip[] };
}

const placeName = (id: string | null) => REAL_DAY.places.find((p) => p.id === id)?.name ?? null;
const jobName = (job: TripJob | null) => (job ? [job.jobNumber, job.name].filter(Boolean).join(' ') : null);

/** One planned Assignment as the API sends it at `now`: its route as it was then, Changed once Dave changed it. */
function asAssignment(planned: PlannedAssignment | PlannedMadeAssignment, position: number, now: string, trips: AssignmentTrips | undefined): Assignment {
  // Made afterwards from Unplanned work: Assigned when Dave answered, never Added or Changed.
  const made = 'unplannedId' in planned;
  const assignedAt = made ? ANSWERED_AT : ASSIGNED_AT;
  const route = routeAt(planned, now);
  const before = (at: string) => Date.parse(at) <= Date.parse(now);
  const changed = planned.changes.map((c) => c.changedAt).filter(before).sort().at(-1) ?? null;
  const { driver } = REAL_DAY;
  let part: Assignment['trips'];
  if (trips) {
    const { assignmentId: _id, empties: _empties, job: _job, ...shown } = trips;
    part = shown;
  }
  return {
    id: planned.id,
    date: REAL_DAY.date,
    driverId: driver.id,
    driverName: driver.name,
    // No Truck named: Randy takes his own, Truck 55.
    truckId: null,
    truckNumber: null,
    fromPlaceId: route.fromPlaceId,
    fromPlaceName: placeName(route.fromPlaceId),
    toPlaceId: route.toPlaceId,
    toPlaceName: placeName(route.toPlaceId),
    materialId: null,
    materialName: planned.materialName,
    foremanId: null,
    foremanName: null,
    note: null,
    position,
    createdAt: assignedAt,
    updatedAt: changed ?? assignedAt,
    changedAt: changed,
    cancelledAt: planned.cancelledAt && before(planned.cancelledAt) ? planned.cancelledAt : null,
    assignedAt,
    handedFromId: null,
    sinceSent: changed ? 'changed' : null,
    trips: part,
    ...(made && { fromTheTruck: true }),
  };
}

/** The real day under one scenario, with Dave's answers to its Unplanned work, at `minutes` past midnight, US Eastern. */
export function simulateAt(scenario: Scenario, minutes: number, answers: UnplannedAnswer[] = []): SimulatedDay {
  // The Worker knows the whole of the clock's minute.
  const now = easternIso(REAL_DAY.date, `${clockTime(minutes)}:59`);
  // Dave answers the whole day's Unplanned work, so a made Assignment keeps its route whatever the clock shows.
  const wholeDay = answers.length === 0 ? [] : buildTripDay({ places: REAL_DAY.places, visits: REAL_DAY.visits, assignments: scenario.assignments, now: easternIso(REAL_DAY.date, '23:59:59'), dayOver: true }).unplanned;
  const answered = tripAnswers(answers, wholeDay, scenario.assignments.length);
  // A linked Assignment is rerouted from its Unplanned work's first Trip: shown on its new route, Changed from then.
  const planned = scenario.assignments.map((a) => {
    const link = answered.input.links?.find((l) => l.assignmentId === a.id);
    return link ? linkedAssignment(a, link) : a;
  });
  const all = [...planned, ...answered.made];
  const tripDay = buildTripDay({
    places: REAL_DAY.places,
    visits: REAL_DAY.visits,
    assignments: scenario.assignments,
    answers: answered.input,
    now,
    // The reading before the day exists all day; the one after it only once it was taken (22:12 that evening).
    meter: {
      startOdometer: REAL_DAY.meter.startOdometer,
      endOdometer: Date.parse(REAL_DAY.meter.endReadAt) <= Date.parse(now) ? REAL_DAY.meter.endOdometer : null,
    },
    // At the clock's end the day is over: the Truck stopped wherever it last stopped.
    dayOver: minutes === DAY_END,
    jobs: REAL_DAY.jobs,
    ignition: REAL_DAY.ignition,
    // Randy is the only Driver; his Assignments name no Truck, so his own, Truck 55.
    truck: {
      id: REAL_DAY.truck.id,
      drivers: [REAL_DAY.driver],
      assignments: all.map(() => ({ driverId: REAL_DAY.driver.id, truckId: null })),
    },
  });
  const assignments = all.map((planned, i) =>
    asAssignment(planned, i, now, tripDay.assignments.find((t) => t.assignmentId === planned.id)),
  );
  const columns = assignments.map((a): TruckLogColumn => {
    const trips = tripDay.assignments.find((t) => t.assignmentId === a.id);
    return {
      id: a.id,
      job: jobName(trips?.job ?? null),
      pickUp: a.fromPlaceName,
      dropOff: a.toPlaceName,
      material: a.materialName,
      loads: trips?.loads ?? 0,
      tons: trips?.tons ?? null,
      truckingHours: trips?.truckingHours ?? null,
      ...(a.fromTheTruck && { fromTheTruck: true }),
    };
  });
  // The Unplanned work: its Places and times only. Which way material went, Dave says.
  const unplanned = tripDay.unplanned.map(
    (w): TruckLogUnplanned => ({
      id: w.id,
      places: w.places.map((p) => placeName(p.placeId) ?? p.code),
      tripsLeftAt: w.trips.map((t) => t.leftAt),
      truckingHours: w.truckingHours,
    }),
  );
  const shopTrips = tripDay.shopTrips.map(
    (t): TruckLogTrip => ({
      leftAt: t.leftAt,
      arrivedAt: t.arrivedAt,
      from: placeName(t.fromPlaceId) ?? t.fromCode,
      to: placeName(t.toPlaceId) ?? t.toCode,
      miles: t.miles,
    }),
  );
  const labels = Object.fromEntries(all.map((a) => [a.id, a.label]));
  return { tripDay, assignments, labels, truckLog: { columns, unplanned, shopTrips } };
}
