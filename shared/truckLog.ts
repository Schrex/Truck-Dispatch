/**
 * The Truck log's body from a Trip day: one column per Assignment, the
 * Unplanned work and the ties ("Which Assignment?") after them, the drives to
 * and from the shop, and each Assignment's Trip part. Shared so the Simulation
 * and the Worker never disagree. Pure.
 */
import type { Assignment, DayLanes } from './types';
import { driverAt, type TripDay, type TripJob, type TripPlace, type TruckDayInput, type TruckLogColumn, type TruckLogTrip, type TruckLogUnplanned, type TruckLogWhichAssignment } from './trips';

/** An Assignment as the Truck log needs it: its route at the log's time, by Place name. */
export type TruckLogAssignment = Pick<Assignment, 'id' | 'fromPlaceName' | 'toPlaceName' | 'materialName' | 'fromTheTruck'>;

export interface TruckLogInput<A extends TruckLogAssignment> {
  tripDay: TripDay;
  /** The Places, to name where Trips went; a code with no Place shows as Fleet's geofence code. */
  places: Pick<TripPlace, 'id' | 'name'>[];
  /** The Assignments in Dave's order: one column each. */
  assignments: A[];
  /** Each Assignment's label ("A1") by id, for "Which Assignment?"; the id when it has none. */
  labels?: Record<string, string>;
}

export interface TruckLog<A extends TruckLogAssignment> {
  /** The Assignments as given, each with its Trip part once a Trip matched it (none before). */
  assignments: (A & { trips: Assignment['trips'] })[];
  columns: TruckLogColumn[];
  unplanned: TruckLogUnplanned[];
  whichAssignment: TruckLogWhichAssignment[];
  shopTrips: TruckLogTrip[];
}

const jobName = (job: TripJob | null) => (job ? [job.jobNumber, job.name].filter(Boolean).join(' ') : null);

export function truckLog<A extends TruckLogAssignment>({ tripDay, places, assignments, labels = {} }: TruckLogInput<A>): TruckLog<A> {
  const placeName = (id: string | null) => places.find((p) => p.id === id)?.name ?? null;
  const tripsOf = (id: string) => tripDay.assignments.find((t) => t.assignmentId === id);
  const withParts = assignments.map((a) => {
    const trips = tripsOf(a.id);
    let part: Assignment['trips'];
    // No Trip matched it: no Trip part, so another Truck's part for it is never overwritten.
    if (trips && trips.status !== 'none') {
      const { assignmentId: _id, empties: _empties, job: _job, ...shown } = trips;
      part = shown;
    }
    return { ...a, trips: part };
  });
  const columns = assignments.map((a): TruckLogColumn => {
    const trips = tripsOf(a.id);
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
  // The ties: planned work, so not Unplanned work; Dave picks which.
  const whichAssignment = tripDay.whichAssignment.map(
    (q): TruckLogWhichAssignment => ({
      id: q.id,
      from: placeName(q.trip.fromPlaceId) ?? q.trip.fromCode,
      to: placeName(q.trip.toPlaceId) ?? q.trip.toCode,
      candidates: q.candidates.map((id) => labels[id] ?? id),
    }),
  );
  return { assignments: withParts, columns, unplanned, whichAssignment, shopTrips };
}

/**
 * The Unplanned work and ties as the lanes show them, from a Trip day and the
 * Truck log body built from it: each piece with the Driver at the time it
 * leaves (null with no check-in to the Truck before it: "Driver not known"),
 * and each tie with its Assignments by id. Never a guessed Driver.
 */
export function truckLogLanes(tripDay: TripDay, log: Pick<TruckLog<TruckLogAssignment>, 'unplanned' | 'whichAssignment'>, truck: TruckDayInput | null): DayLanes {
  // The body is built from the same Trip day in the same order: it gives the Places' names.
  return {
    unplanned: tripDay.unplanned.map((w, i) => ({ id: w.id, places: log.unplanned[i].places, leftAt: w.leftAt, arrivedAt: w.arrivedAt, driver: driverAt(truck, w.leftAt) })),
    whichAssignment: tripDay.whichAssignment.map((q, i) => ({ id: q.id, from: log.whichAssignment[i].from, to: log.whichAssignment[i].to, assignmentIds: q.candidates })),
  };
}
