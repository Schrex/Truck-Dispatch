/**
 * The Trip builder (phase 3, docs/design/telematics-backend.md): from one
 * Truck's raw HCSS Fleet visits for one day, and that day's Assignments with
 * their earlier versions, work out the Trips, which are Loads, and what the
 * board and the Driver's card show. Pure, so the Worker and the simulation
 * page run the same code, and it is tested on one real day's shape.
 */
import type { AssignmentTripPart, TripStatus } from './types';

/** Minutes and the US Eastern day, as the rest of the app uses them. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BUSINESS_TIME_ZONE = 'America/New_York';

/** Rules tuned on 16 Nov: shorter than this is a drive-through. */
export const DRIVE_THROUGH_MINUTES = 2;
/** Two visits to the same Place this close together are one (a short exit). */
export const SHORT_EXIT_MINUTES = 5;
/** Day miles and Trip miles further apart than this mean something was missed. */
export const MILES_TOLERANCE = 1;

export type TripPlaceKind = 'plant' | 'job_site' | 'shop' | 'yard' | null;

/** A Place as the Trip builder needs it: its kind, and its geofence code on the truck map. */
export interface TripPlace {
  id: string;
  /** Short name, as the board shows a Place. */
  name: string;
  /** Long name, e.g. Fleet's geofence description. */
  fullName?: string | null;
  kind: TripPlaceKind;
  geofenceCode: string | null;
}

/** One raw row of HCSS Fleet entry/exit: one visit to one geofence. Never changed by people. */
export interface FleetVisit {
  geofenceCode: string;
  /** ISO 8601. */
  enteredAt: string;
  /** Null while the Truck is still there. */
  exitedAt: string | null;
  entryOdometer: number;
  /** Ignored while the visit is open: Fleet fills it with the current reading. */
  exitOdometer: number | null;
}

/** An Assignment's From and To, now or as an earlier version kept in assignment_changes. */
export interface Route {
  fromPlaceId: string | null;
  toPlaceId: string | null;
}

/** An Assignment as matching needs it. */
export interface TripAssignment extends Route {
  id: string;
  label: string;
  cancelledAt: string | null;
  /** Earlier versions: the From and To it had before each change (assignment_changes). */
  changes: { changedAt: string; before: Route }[];
}

export type TripKind = 'load' | 'empty' | null;

/** Which rule decided a Trip, and in words why. Rule 7 is "nothing fits". */
export interface Match {
  kind: TripKind;
  assignmentId: string | null;
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  reason: string;
}

/** A visit after cleaning, with the raw rows it came from. */
export interface CleanVisit {
  geofenceCode: string;
  placeId: string | null;
  enteredAt: string;
  exitedAt: string | null;
  entryOdometer: number;
  exitOdometer: number | null;
  /** Where the Truck was when the day began (Fleet cuts visits at local midnight). */
  startOfDay: boolean;
  /** Indexes of the raw visits joined into this one. */
  raw: number[];
}

export interface Trip {
  fromPlaceId: string | null;
  toPlaceId: string | null;
  fromCode: string;
  toCode: string;
  leftAt: string;
  arrivedAt: string;
  miles: number;
  /** Written to the trips table: the visit it reaches is past the drive-through test, so it can no longer change. */
  written: boolean;
  match: Match;
}

export type AssignmentStatus = TripStatus;

/**
 * One Assignment's Trips at `now`: its Trip part, as the board's block and the
 * Driver's card show it (shared/types.ts, Assignment.trips), and the counts
 * behind it. The Truck log's column reads the same.
 */
export interface AssignmentTrips extends AssignmentTripPart {
  assignmentId: string;
  /** Its Trips that are not Loads: ways back and drives to its pickup. */
  empties: number;
}

/** A Driver as the Truck's day needs one. */
export interface TruckDayDriver {
  id: string;
  name: string;
}

/**
 * The Truck's day at `now`: the Truck log's header. Only what is known by
 * then; null for what is not (yet).
 */
export interface TruckDay {
  /** The one Driver who fits; null when none does or when several do. */
  driver: TruckDayDriver | null;
  /** Every Driver who fits. More than one: the Truck log asks "Who was driving?". */
  driverCandidates: TruckDayDriver[];
  /** When the Truck first started: first ignition on, or its first exit from the shop. */
  startAt: string | null;
  /** When it last stopped, once it is back at the shop or yard: its arrival there, or ignition off after it. */
  endAt: string | null;
  /** Meter reading before the day. */
  startMiles: number | null;
  /** Meter reading after the day; null until it exists. */
  endMiles: number | null;
  /** Start time to end time, in hours, 2 decimals; null without an end time. */
  totalHours: number | null;
}

/** One ignition change from the ping history. */
export interface IgnitionEvent {
  /** ISO 8601. */
  at: string;
  on: boolean;
}

/** Who might have driven the Truck: that day's Drivers and their Assignments. */
export interface TruckDayInput {
  id: string;
  drivers: (TruckDayDriver & { defaultTruckId: string | null })[];
  /** Every Driver's Assignments that day; a null Truck means the Driver's usual one. */
  assignments: { driverId: string | null; truckId: string | null }[];
}

export interface TripDay {
  /** Raw visits known at `now`, as the Worker would hold them. */
  known: { visit: FleetVisit; state: 'open' | 'closed' }[];
  dropped: { raw: number; reason: string }[];
  merged: { into: number; raw: number[]; reason: string }[];
  visits: CleanVisit[];
  trips: Trip[];
  assignments: AssignmentTrips[];
  /** The Truck's day: Driver, start and end, miles, Total hours. */
  truckDay: TruckDay;
  /** Geofence codes with no Place: listed for Dave in Settings. */
  unknownCodes: string[];
  miles: {
    trips: number;
    insidePlaces: number;
    day: number | null;
    /** Null until the day's meter readings exist. */
    ok: boolean | null;
  };
}

export interface TripDayInput {
  places: TripPlace[];
  visits: FleetVisit[];
  assignments: TripAssignment[];
  /** What the Worker knows: only data up to this moment. */
  now: string;
  /** The meter readings around the day; the end one is null until it exists. */
  meter?: { startOdometer: number; endOdometer: number | null } | null;
  /** The Truck and who might have driven it, for the Truck's Driver. */
  truck?: TruckDayInput | null;
  /** The Truck's ignition changes that day, from the ping history. */
  ignition?: IgnitionEvent[];
}

const ms = (iso: string) => new Date(iso).getTime();
const round = (n: number) => Math.round(n * 100) / 100;

const localClock = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "08:24" in US Eastern, as screens show times. */
export function easternTime(iso: string): string {
  return localClock.format(new Date(iso)).slice(0, 5);
}

function isLocalMidnight(iso: string): boolean {
  return localClock.format(new Date(iso)) === '00:00:00';
}

/** The visits the Worker would hold at `now`: later ones unknown, ones not left yet still open. */
function knownAt(visits: FleetVisit[], now: string) {
  const at = ms(now);
  return visits
    .map((visit, raw) => ({ visit, raw }))
    .filter(({ visit }) => ms(visit.enteredAt) <= at)
    .sort((a, b) => ms(a.visit.enteredAt) - ms(b.visit.enteredAt))
    .map(({ visit, raw }) => {
      const open = visit.exitedAt === null || ms(visit.exitedAt) > at;
      return { raw, visit: open ? { ...visit, exitedAt: null, exitOdometer: null } : visit, state: open ? ('open' as const) : ('closed' as const) };
    });
}

/** Clean the known visits: drop drive-throughs, join short exits, mark where the day began. */
function clean(known: ReturnType<typeof knownAt>, places: TripPlace[]) {
  const placeOf = new Map(places.filter((p) => p.geofenceCode).map((p) => [p.geofenceCode!.toLowerCase(), p.id]));
  const dropped: TripDay['dropped'] = [];
  const merged: TripDay['merged'] = [];
  const visits: CleanVisit[] = [];
  for (const { raw, visit } of known) {
    if (visit.exitedAt !== null) {
      const minutes = (ms(visit.exitedAt) - ms(visit.enteredAt)) / MINUTE;
      if (minutes < DRIVE_THROUGH_MINUTES) {
        dropped.push({ raw, reason: `Drive-through: ${Math.round(minutes * 60)} s at ${visit.geofenceCode}, under ${DRIVE_THROUGH_MINUTES} min` });
        continue;
      }
    }
    const placeId = placeOf.get(visit.geofenceCode.toLowerCase()) ?? null;
    const last = visits.at(-1);
    if (last && last.exitedAt !== null && last.geofenceCode.toLowerCase() === visit.geofenceCode.toLowerCase()) {
      const gap = (ms(visit.enteredAt) - ms(last.exitedAt)) / MINUTE;
      if (gap <= SHORT_EXIT_MINUTES) {
        last.exitedAt = visit.exitedAt;
        last.exitOdometer = visit.exitOdometer;
        last.raw.push(raw);
        const into = visits.length - 1;
        const note = merged.find((m) => m.into === into);
        if (note) note.raw = [...last.raw];
        else merged.push({ into, raw: [...last.raw], reason: `Short exit: left ${visit.geofenceCode} for ${Math.round(gap)} min and came back` });
        continue;
      }
    }
    visits.push({ ...visit, placeId, startOfDay: isLocalMidnight(visit.enteredAt), raw: [raw] });
  }
  return { visits, dropped, merged };
}

/** The Assignment as it was at `at`: the earliest change after it kept what it had then. */
export function routeAt(assignment: TripAssignment, at: string): Route {
  const later = assignment.changes.filter((c) => ms(c.changedAt) > ms(at)).sort((a, b) => ms(a.changedAt) - ms(b.changedAt));
  return later[0]?.before ?? { fromPlaceId: assignment.fromPlaceId, toPlaceId: assignment.toPlaceId };
}

const RULES: {
  rule: Match['rule'];
  kind: TripKind;
  fits: (r: Route, from: string | null, to: string | null) => boolean;
  reason: string;
}[] = [
  { rule: 1, kind: 'load', fits: (r, a, b) => !!a && !!b && r.fromPlaceId === a && r.toPlaceId === b, reason: 'From and To match the Assignment' },
  { rule: 2, kind: 'empty', fits: (r, a, b) => !!a && !!b && r.fromPlaceId === b && r.toPlaceId === a, reason: 'The way back of the Assignment' },
  // Rule 3 (shop or yard) needs no Assignment; it is checked between 2 and 4.
  { rule: 4, kind: 'empty', fits: (r, _a, b) => !!b && r.fromPlaceId === b, reason: 'Going to the Assignment’s pickup' },
  { rule: 5, kind: 'load', fits: (r, a) => !!a && r.fromPlaceId === a && r.toPlaceId === null, reason: 'Leaves the Assignment’s pickup; its To is empty' },
];

/** Match one Trip to the Assignments, first rule that fits; two at one rule is for Dave to choose. */
export function matchTrip(
  trip: { fromPlaceId: string | null; toPlaceId: string | null; leftAt: string },
  assignments: TripAssignment[],
  places: TripPlace[],
): Match {
  const kindOf = (id: string | null) => places.find((p) => p.id === id)?.kind ?? null;
  const live = assignments.filter((a) => a.cancelledAt === null || ms(a.cancelledAt) > ms(trip.leftAt));
  const routes = live.map((a) => ({ a, r: routeAt(a, trip.leftAt) }));
  const { fromPlaceId: from, toPlaceId: to } = trip;

  const at = (rule: (typeof RULES)[number]): Match | null => {
    const fit = routes.filter(({ r }) => rule.fits(r, from, to));
    if (fit.length === 1) return { kind: rule.kind, assignmentId: fit[0].a.id, rule: rule.rule, reason: rule.reason };
    if (fit.length > 1)
      return { kind: null, assignmentId: null, rule: rule.rule, reason: `${fit.length} Assignments fit (${fit.map((f) => f.a.label).join(', ')}); Dave chooses` };
    return null;
  };

  for (const rule of RULES.slice(0, 2)) {
    const m = at(rule);
    if (m) return m;
  }
  const shopish = (k: TripPlaceKind) => k === 'shop' || k === 'yard';
  if (shopish(kindOf(from)) || shopish(kindOf(to))) return { kind: 'empty', assignmentId: null, rule: 3, reason: 'To or from the shop or a yard' };
  for (const rule of RULES.slice(2)) {
    const m = at(rule);
    if (m) return m;
  }
  if (to && kindOf(from) === 'plant') {
    const m = at({ rule: 6, kind: 'load', fits: (r, _a, b) => r.toPlaceId === b && r.fromPlaceId === null, reason: 'From a plant to the Assignment’s drop; its From is empty' });
    if (m) return m;
  }
  return { kind: null, assignmentId: null, rule: 7, reason: 'No Assignment fits; Dave answers next morning' };
}

/** Pair the cleaned visits into Trips: from one visit's exit to the next visit's entry. */
function pair(visits: CleanVisit[], now: string): Omit<Trip, 'match'>[] {
  const trips: Omit<Trip, 'match'>[] = [];
  for (let i = 0; i + 1 < visits.length; i++) {
    const from = visits[i];
    const to = visits[i + 1];
    if (from.exitedAt === null || from.exitOdometer === null) continue;
    const settled = to.exitedAt !== null || ms(now) - ms(to.enteredAt) >= DRIVE_THROUGH_MINUTES * MINUTE;
    trips.push({
      fromPlaceId: from.placeId,
      toPlaceId: to.placeId,
      fromCode: from.geofenceCode,
      toCode: to.geofenceCode,
      leftAt: from.exitedAt,
      arrivedAt: to.enteredAt,
      miles: round(to.entryOdometer - from.exitOdometer),
      written: settled,
    });
  }
  return trips;
}

/** Now, Done or neither (proposal P5): Now while the Truck's latest Trip is its and the Truck is not back at the shop. */
function summarize(assignments: TripAssignment[], trips: Trip[], places: TripPlace[]): AssignmentTrips[] {
  const written = trips.filter((t) => t.written);
  const latest = written.at(-1);
  const kindOf = (id: string | null) => places.find((p) => p.id === id)?.kind ?? null;
  const atShop = latest ? ['shop', 'yard'].includes(kindOf(latest.toPlaceId) ?? '') : false;
  return assignments.map((a) => {
    const own = written.filter((t) => t.match.assignmentId === a.id);
    const loads = own.filter((t) => t.match.kind === 'load');
    const status: AssignmentStatus = own.length === 0 ? 'none' : latest?.match.assignmentId === a.id && !atShop ? 'now' : 'done';
    const first = own[0];
    const last = own.at(-1);
    return {
      assignmentId: a.id,
      loads: loads.length,
      empties: own.length - loads.length,
      // Tons come from the Loads' Tickets (phase 4); none are read yet.
      tons: null,
      status,
      since: first?.leftAt ?? null,
      lastLoadAt: loads.at(-1)?.arrivedAt ?? null,
      truckingHours: first && last ? round((ms(last.arrivedAt) - ms(first.leftAt)) / HOUR) : null,
    };
  });
}

/**
 * The Truck's Driver: the Drivers whose Assignments that day name the Truck
 * (a null Truck names the Driver's usual one), otherwise the Drivers whose
 * usual Truck it is. One fits: that Driver. More: nobody is chosen.
 */
function truckDrivers(truck: TruckDayInput | null | undefined): TruckDayDriver[] {
  if (!truck) return [];
  const usual = (d: TruckDayInput['drivers'][number]) => d.defaultTruckId === truck.id;
  const named = truck.drivers.filter((d) =>
    truck.assignments.some((a) => a.driverId === d.id && (a.truckId ?? d.defaultTruckId) === truck.id),
  );
  return (named.length > 0 ? named : truck.drivers.filter(usual)).map(({ id, name }) => ({ id, name }));
}

/** The Truck log's header at `now`. */
function truckDayOf(input: TripDayInput, visits: CleanVisit[], trips: Trip[]): TruckDay {
  const at = ms(input.now);
  const kindOf = (id: string | null) => input.places.find((p) => p.id === id)?.kind ?? null;
  const shopish = (id: string | null) => ['shop', 'yard'].includes(kindOf(id) ?? '');
  const ignition = (input.ignition ?? []).filter((e) => ms(e.at) <= at).sort((a, b) => ms(a.at) - ms(b.at));

  const firstOn = ignition.find((e) => e.on)?.at ?? null;
  const firstShopExit = trips.find((t) => shopish(t.fromPlaceId))?.leftAt ?? null;
  const starts = [firstOn, firstShopExit].filter((s): s is string => s !== null).sort((a, b) => ms(a) - ms(b));
  const startAt = starts[0] ?? null;

  // Stopped for the day: the last Trip ended at the shop or yard and the Truck is still there.
  const lastTrip = trips.at(-1);
  const back = lastTrip && shopish(lastTrip.toPlaceId) && visits.at(-1)?.exitedAt === null ? lastTrip.arrivedAt : null;
  const lastOff = ignition.at(-1);
  const endAt = back && lastOff && !lastOff.on && ms(lastOff.at) > ms(back) ? lastOff.at : back;

  const candidates = truckDrivers(input.truck);
  return {
    driver: candidates.length === 1 ? candidates[0] : null,
    driverCandidates: candidates,
    startAt,
    endAt,
    startMiles: input.meter?.startOdometer ?? null,
    endMiles: input.meter?.endOdometer ?? null,
    totalHours: startAt && endAt ? round((ms(endAt) - ms(startAt)) / HOUR) : null,
  };
}

/** One Truck's day as the Worker would know it at `now`. */
export function buildTripDay(input: TripDayInput): TripDay {
  const known = knownAt(input.visits, input.now);
  const { visits, dropped, merged } = clean(known, input.places);
  const trips: Trip[] = pair(visits, input.now).map((t) => ({ ...t, match: matchTrip(t, input.assignments, input.places) }));
  // Inside cleaned visits only: a drive-through's miles are already in the Trip across it,
  // and a short exit's miles are inside the joined visit.
  const insidePlaces = round(visits.reduce((sum, v) => sum + (v.exitOdometer === null ? 0 : v.exitOdometer - v.entryOdometer), 0));
  const tripMiles = round(trips.reduce((sum, t) => sum + t.miles, 0));
  const day = input.meter && input.meter.endOdometer !== null ? round(input.meter.endOdometer - input.meter.startOdometer) : null;
  const unknownCodes = [...new Set(visits.filter((v) => v.placeId === null).map((v) => v.geofenceCode))];
  return {
    known: known.map(({ visit, state }) => ({ visit, state })),
    dropped,
    merged,
    visits,
    trips,
    assignments: summarize(input.assignments, trips, input.places),
    truckDay: truckDayOf(input, visits, trips),
    unknownCodes,
    miles: {
      trips: tripMiles,
      insidePlaces,
      day,
      ok: day === null ? null : Math.abs(day - tripMiles - insidePlaces) <= MILES_TOLERANCE,
    },
  };
}
