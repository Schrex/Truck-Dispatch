/**
 * The real day at one moment: the Trip builder's output, and Dave's
 * Assignments as the production API would send them, each with its Trip part.
 * The page feeds these to the real board lanes, the Driver cards and the
 * Truck log. Pure; nothing is saved and the Worker is not asked.
 */
import type { Assignment, Driver } from '../../shared/types';
import { buildTripDay, linkedAssignment, routeAt, type TripDay, type TruckLogColumn, type TruckLogTrip, type TruckLogUnplanned, type TruckLogWhichAssignment } from '../../shared/trips';
import { truckLog } from '../../shared/truckLog';
import { DAY_END, minuteClock } from '../../shared/days';
import { REAL_DAY, easternIso, placeName, type PlannedAssignment, type Scenario } from './realDay';
import { tripAnswers, type PlannedMadeAssignment, type UnplannedAnswer } from './answers';


/** Dave Assigned the day the evening before (17:00 ET on Sun 15 Nov). */
const ASSIGNED_AT = '2026-11-15T22:00:00Z';
/** Dave answers the Unplanned work next morning (08:00 ET on Tue 17 Nov). */
const ANSWERED_AT = '2026-11-17T13:00:00Z';

export interface SimulatedDay {
  /** Everything the Trip builder knows at the clock's time, for the Truck log (#60, #61). */
  tripDay: TripDay;
  /** Randy's Assignments in Dave's order, then the ones Dave made from Unplanned work, as GET api/assignments would send them, with their Trip parts. */
  assignments: Assignment[];
  /** The Drivers on the board that day, for the lanes. */
  drivers: Driver[];
  /** Each Assignment's label ("A1", "A3") by its id, for the Trip log. */
  labels: Record<string, string>;
  /** The Truck log's body: one column per Assignment, then the Unplanned work and the ties ("Which Assignment?"), and the drives to and from the shop. */
  truckLog: { columns: TruckLogColumn[]; unplanned: TruckLogUnplanned[]; whichAssignment: TruckLogWhichAssignment[]; shopTrips: TruckLogTrip[] };
}

/** One planned Assignment as the API sends it at `now`, before its Trip part: its route as it was then, Changed once Dave changed it. */
function asAssignment(planned: PlannedAssignment | PlannedMadeAssignment, position: number, now: string, drivers: Driver[]): Assignment {
  // Made afterwards from Unplanned work: Assigned when Dave answered, never Added or Changed.
  const made = 'unplannedId' in planned;
  const assignedAt = made ? ANSWERED_AT : ASSIGNED_AT;
  const route = routeAt(planned, now);
  const before = (at: string) => Date.parse(at) <= Date.parse(now);
  // A link to a made Assignment reroutes it too, but it was made afterwards, so it never shows Changed.
  const changed = made ? null : (planned.changes.map((c) => c.changedAt).filter(before).sort().at(-1) ?? null);
  const driver = drivers.find((d) => d.id === planned.driverId) ?? REAL_DAY.driver;
  const truckId = planned.truckId ?? null;
  return {
    id: planned.id,
    date: REAL_DAY.date,
    driverId: driver.id,
    driverName: driver.name,
    // No Truck named: the Driver takes his own (Randy's is Truck 55).
    truckId,
    truckNumber: truckId === REAL_DAY.truck.id ? REAL_DAY.truck.number : null,
    fromPlaceId: route.fromPlaceId,
    fromPlaceName: placeName(route.fromPlaceId),
    toPlaceId: route.toPlaceId,
    toPlaceName: placeName(route.toPlaceId),
    atPlaceId: route.atPlaceId,
    atPlaceName: placeName(route.atPlaceId),
    materialId: null,
    materialName: planned.materialName,
    foremanId: null,
    foremanName: null,
    customerId: null,
    customerName: null,
    note: planned.note ?? null,
    work: route.work,
    machine: null,
    position,
    createdAt: assignedAt,
    updatedAt: changed ?? assignedAt,
    changedAt: changed,
    cancelledAt: planned.cancelledAt && before(planned.cancelledAt) ? planned.cancelledAt : null,
    assignedAt,
    handedFromId: null,
    sinceSent: changed ? 'changed' : null,
    ...(made && { fromTheTruck: true }),
  };
}

/** What the simulation is asked for: a scenario at one minute, with what Dave has answered and split so far. */
export interface SimulateAtOptions {
  scenario: Scenario;
  /** Minutes past midnight, US Eastern. */
  minutes: number;
  /** Dave's answers to the Unplanned work; none by default. */
  answers?: UnplannedAnswer[];
  /** The Trips (by leftAt) where Dave split Unplanned work in two; none by default. */
  splits?: string[];
}

/** The real day under one scenario, with Dave's answers to its Unplanned work, at `minutes` past midnight, US Eastern. */
export function simulateAt({ scenario, minutes, answers = [], splits = [] }: SimulateAtOptions): SimulatedDay {
  // The Worker knows the whole of the clock's minute.
  const now = easternIso(REAL_DAY.date, `${minuteClock(minutes)}:59`);
  // The real 16 Nov day, unless the scenario makes one up.
  const day = scenario.day ?? REAL_DAY;
  const drivers = scenario.drivers ?? [REAL_DAY.driver];
  // Dave answers the whole day's Unplanned work, as he split it, so a made Assignment keeps its route whatever the clock shows.
  const wholeDay =
    answers.length === 0
      ? []
      : buildTripDay({ places: REAL_DAY.places, notConsidered: REAL_DAY.notConsidered, visits: day.visits, assignments: scenario.assignments, answers: { splits }, now: easternIso(REAL_DAY.date, '23:59:59'), dayOver: true }).unplanned;
  const answered = tripAnswers({ answers, pieces: wholeDay, plannedCount: scenario.assignments.length, driverId: drivers[0].id, splits });
  // A linked Assignment, planned or made from another piece, is rerouted from its Unplanned work's first Trip: shown on its new route, Changed from then.
  const linked = <A extends PlannedAssignment | PlannedMadeAssignment>(a: A) => {
    const link = answered.input.links?.find((l) => l.assignmentId === a.id);
    return link ? linkedAssignment(a, link) : a;
  };
  // A made Assignment names Truck 55 unless it is the Driver's own.
  const made = answered.made.map((m) => ({ ...m, truckId: drivers.find((d) => d.id === m.driverId)?.defaultTruckId === REAL_DAY.truck.id ? null : REAL_DAY.truck.id }));
  const all: (PlannedAssignment | PlannedMadeAssignment)[] = [...scenario.assignments, ...made].map(linked);
  const tripDay = buildTripDay({
    places: REAL_DAY.places,
    notConsidered: REAL_DAY.notConsidered,
    visits: day.visits,
    // Whose each is (none named: Randy's), so the check-ins pick the Assignments a Trip matches.
    assignments: scenario.assignments.map((a) => ({ ...a, driverId: a.driverId ?? REAL_DAY.driver.id, truckId: a.truckId ?? null })),
    answers: answered.input,
    now,
    // The reading before the day exists all day; the one after it only once it was taken (22:12 that evening).
    meter: {
      startOdometer: day.meter.startOdometer,
      endOdometer: Date.parse(day.meter.endReadAt) <= Date.parse(now) ? day.meter.endOdometer : null,
    },
    // At the clock's end the day is over: the Truck stopped wherever it last stopped.
    dayOver: minutes === DAY_END,
    jobs: REAL_DAY.jobs,
    ignition: day.ignition,
    // Whose Assignments name Truck 55 (no Truck named: the Driver's own); more than one, and Dave's pick says who drove.
    truck: {
      id: REAL_DAY.truck.id,
      drivers,
      assignments: all.map((a) => ({ driverId: a.driverId ?? REAL_DAY.driver.id, truckId: a.truckId ?? null })),
      drivenBy: answered.drivenBy,
      // Randy checked in to Truck 55 at the start of the day, unless the scenario says who did.
      checkIns: scenario.checkIns ?? [{ driverId: REAL_DAY.driver.id, at: easternIso(REAL_DAY.date, '00:00:00') }],
    },
  });
  const labels = Object.fromEntries(all.map((a) => [a.id, a.label]));
  const { assignments, ...log } = truckLog({
    tripDay,
    places: REAL_DAY.places,
    assignments: all.map((planned, i) => asAssignment(planned, i, now, drivers)),
    labels,
  });
  return { tripDay, assignments, drivers, labels, truckLog: log };
}
