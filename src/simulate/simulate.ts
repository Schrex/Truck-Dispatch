/**
 * The real day at one moment: the Trip builder's output, and Dave's
 * Assignments as the production API would send them, each with its Trip part.
 * The page feeds these to the real board lanes (and, later, the Driver cards
 * and the Truck log). Pure; nothing is saved and the Worker is not asked.
 */
import type { Assignment } from '../../shared/types';
import { buildTripDay, routeAt, type AssignmentTrips, type TripDay } from '../../shared/trips';
import { REAL_DAY, easternIso, type PlannedAssignment, type Scenario } from './realDay';

/** The last minute of the day: the clock's end, when the next morning's meter reading exists. */
export const DAY_END = 23 * 60 + 59;

/** "10:02" for minutes since midnight. */
export const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Dave Assigned the day the evening before (17:00 ET on Sun 15 Nov). */
const ASSIGNED_AT = '2026-11-15T22:00:00Z';

export interface SimulatedDay {
  /** Everything the Trip builder knows at the clock's time, for the Truck log (#60, #61). */
  tripDay: TripDay;
  /** Randy's Assignments in Dave's order, as GET api/assignments would send them, with their Trip parts. */
  assignments: Assignment[];
}

/** One planned Assignment as the API sends it at `now`: its route as it was then, Changed once Dave changed it. */
function asAssignment(planned: PlannedAssignment, position: number, now: string, trips: AssignmentTrips | undefined): Assignment {
  const route = routeAt(planned, now);
  const placeName = (id: string | null) => REAL_DAY.places.find((p) => p.id === id)?.name ?? null;
  const before = (at: string) => Date.parse(at) <= Date.parse(now);
  const changed = planned.changes.map((c) => c.changedAt).filter(before).sort().at(-1) ?? null;
  const { driver } = REAL_DAY;
  let part: Assignment['trips'];
  if (trips) {
    const { assignmentId: _id, empties: _empties, ...shown } = trips;
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
    createdAt: ASSIGNED_AT,
    updatedAt: changed ?? ASSIGNED_AT,
    changedAt: changed,
    cancelledAt: planned.cancelledAt && before(planned.cancelledAt) ? planned.cancelledAt : null,
    assignedAt: ASSIGNED_AT,
    handedFromId: null,
    sinceSent: changed ? 'changed' : null,
    trips: part,
  };
}

/** The real day under one scenario at `minutes` past midnight, US Eastern. */
export function simulateAt(scenario: Scenario, minutes: number): SimulatedDay {
  // The Worker knows the whole of the clock's minute.
  const now = easternIso(REAL_DAY.date, `${clockTime(minutes)}:59`);
  const tripDay = buildTripDay({
    places: REAL_DAY.places,
    visits: REAL_DAY.visits,
    assignments: scenario.assignments,
    now,
    // The reading before the day exists all day; the one after it only once the day is over.
    meter: { startOdometer: REAL_DAY.meter.startOdometer, endOdometer: minutes === DAY_END ? REAL_DAY.meter.endOdometer : null },
    ignition: REAL_DAY.ignition,
    // Randy is the only Driver; his Assignments name no Truck, so his own, Truck 55.
    truck: {
      id: REAL_DAY.truck.id,
      drivers: [REAL_DAY.driver],
      assignments: scenario.assignments.map(() => ({ driverId: REAL_DAY.driver.id, truckId: null })),
    },
  });
  const assignments = scenario.assignments.map((planned, i) =>
    asAssignment(planned, i, now, tripDay.assignments.find((t) => t.assignmentId === planned.id)),
  );
  return { tripDay, assignments };
}
