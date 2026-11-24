/**
 * The Trip builder (phase 3, docs/design/telematics-backend.md): from one
 * Truck's raw HCSS Fleet visits for one day, and that day's Assignments with
 * their earlier versions, work out the Trips, which are Loads, and what the
 * board and the Driver's card show. Pure, so the Worker and the simulation
 * page run the same code, and it is tested on one real day's shape.
 */
import type { AssignmentTripPart, TripStatus, Work } from './types';

/** Minutes and the US Eastern day, as the rest of the app uses them. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BUSINESS_TIME_ZONE = 'America/New_York';

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
  /** The Job it belongs to, if any. */
  jobId?: string | null;
}

/** A Job as the Truck log names it: "J25008 Los Flamboyanes". */
export interface TripJob {
  id: string;
  name: string;
  jobNumber: string | null;
}

/** One raw row of HCSS Fleet entry/exit: one visit to one geofence. Never changed by people. */
export interface FleetVisit {
  geofenceCode: string;
  /** ISO 8601. */
  enteredAt: string;
  /** Null while the Truck is still there. */
  exitedAt: string | null;
  /** Null when the export gives none (an xlsx export has no odometers). */
  entryOdometer: number | null;
  /** Ignored while the visit is open: Fleet fills it with the current reading. Null when the export gives none. */
  exitOdometer: number | null;
}

/**
 * What matching reads of an Assignment at a moment of the day: its From, To,
 * At and kind (Haul, Move or Other), now or as an earlier version kept in assignment_changes. To carry
 * another field, add it here and its default to ROUTE_DEFAULTS: routeAt and
 * savedRoute pick it up.
 */
export interface Route {
  fromPlaceId: string | null;
  toPlaceId: string | null;
  /** Where the Truck works: fills a missing From or To; alone, it gives At Trips. */
  atPlaceId: string | null;
  /** Haul, Move or Other: a Move's From → To Trips are Move Trips; an Other takes the Trips nothing else fits. */
  work: Work;
}

/** Each Route field, and what it is when the values saved before a change lack it (an older saved copy). */
const ROUTE_DEFAULTS: Route = { fromPlaceId: null, toPlaceId: null, atPlaceId: null, work: 'haul' };

/**
 * The route the rules match: At stands in for a missing From or To (At + To is
 * At → To, From + At is From → At). With both set, or neither, it is as is.
 */
function filledRoute(r: Route): Route {
  if (r.atPlaceId === null) return r;
  if (r.fromPlaceId === null && r.toPlaceId !== null) return { ...r, fromPlaceId: r.atPlaceId };
  if (r.fromPlaceId !== null && r.toPlaceId === null) return { ...r, toPlaceId: r.atPlaceId };
  return r;
}

/** The route in `values`: an Assignment, or the values saved before a change (assignment_changes.before). */
export function savedRoute(values: Partial<Route>): Route {
  const route = { ...ROUTE_DEFAULTS };
  for (const key of Object.keys(ROUTE_DEFAULTS) as (keyof Route)[]) if (values[key] !== undefined) Object.assign(route, { [key]: values[key] });
  return route;
}

/** An Assignment as matching needs it. */
export interface TripAssignment extends Route {
  id: string;
  label: string;
  cancelledAt: string | null;
  /** Earlier versions: the route it had before each change (assignment_changes); a key it lacks is its default. */
  changes: { changedAt: string; before: Partial<Route> }[];
  /** Whose it is: with check-ins (TruckDayInput.checkIns), a Trip matches only its Driver's Assignments. */
  driverId?: string | null;
  /** The Truck it names; null names its Driver's usual one. Read only when nobody checked in before a Trip. */
  truckId?: string | null;
  /** Its note: an Other's text, the Why of the Trips it takes ("Other: Shop, on deck"). */
  note?: string | null;
}

/** Dave's "Not a haul" (fuel, a repair, personal): the one spelling for a Trip's kind and for his answer. */
export const NOT_A_HAUL = 'not_a_haul';

/**
 * NOT_A_HAUL: Dave answered its Unplanned work "Not a haul", or it fit nothing
 * else and counts on its Driver's Other. 'at': an At Trip, one that starts or
 * ends at the At of an Assignment with no From or To. 'move': a Move Trip, a
 * Move's From → To. At and Move Trips count toward Now / Done and Trucking
 * hours, never toward Loads.
 */
export type TripKind = 'load' | 'empty' | 'at' | 'move' | typeof NOT_A_HAUL | null;

/*
 * The rules named in code. Rules 1, 2, 4, 5 and 6 fit a Trip to an
 * Assignment's route and are numbered only in RULES and matchTrip. The last
 * three run in this order after them: a new rule goes before any of them by
 * taking its number and moving those after it up, here only.
 */
/** To or from the shop or a yard: empty, no Assignment. */
export const SHOP_OR_YARD = 3;
/** Starts or ends at the At of an Assignment with only At: an At Trip. */
export const AT_ONLY = 7;
/** Nothing else fits, and the Driver is on an Other then: not a haul, on that Other. */
export const ON_AN_OTHER = 8;
/** "Nothing fits": the last rule, after every rule that can fit a Trip. */
export const NOTHING_FITS = 9;

/** Which rule decided a Trip, and in words why. */
export interface Match {
  kind: TripKind;
  assignmentId: string | null;
  rule: 1 | 2 | typeof SHOP_OR_YARD | 4 | 5 | 6 | typeof AT_ONLY | typeof ON_AN_OTHER | typeof NOTHING_FITS;
  reason: string;
  /** An At Trip's At (rule AT_ONLY): the Trip log reads "at TIUNY". */
  atPlaceId?: string;
  /**
   * A tie: the Assignments (ids, in Dave's order) that fit equally at `rule`.
   * The Truck did planned work and Dave picks which ("Which Assignment?").
   */
  candidates?: string[];
}

/** A visit after cleaning, with the raw rows it came from. */
export interface CleanVisit {
  geofenceCode: string;
  placeId: string | null;
  enteredAt: string;
  exitedAt: string | null;
  entryOdometer: number | null;
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
  /** From the odometers; null when either visit has none (an xlsx export). */
  miles: number | null;
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
  /** Its empty Trips: ways back and drives to its pickup (never its At Trips). */
  empties: number;
  /** Its Job: its To's, then its At's, then its From's, the first that belongs to a Job (its route at `now`). */
  job: TripJob | null;
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
  /**
   * When it last stopped. While the day goes on, only once it is back at the
   * shop or yard: its arrival there, or ignition off after it. Once the day is
   * over, wherever it stopped: the later of its last arrival and last ignition off.
   */
  endAt: string | null;
  /** Meter reading before the day. */
  startMiles: number | null;
  /** Meter reading after the day; null until it exists. */
  endMiles: number | null;
  /** Start time to end time, in hours, 2 decimals; null without an end time. */
  totalHours: number | null;
}

/** One Assignment as a column of the Truck log (the paper's "Order"), ready to write in. */
export interface TruckLogColumn {
  /** The Assignment's id. */
  id: string;
  /** "J25008 Los Flamboyanes": its To's Job, then its At's, then its From's; null when none belongs to a Job. */
  job: string | null;
  pickUp: string | null;
  dropOff: string | null;
  material: string | null;
  /** Null for an At-only Haul (At, no From or To): shown blank "from Tickets". */
  loads: number | null;
  /** From the Loads' Tickets (phase 4); null until they are read. */
  tons: number | null;
  /** Null until it has a Trip. */
  truckingHours: number | null;
  /** Made by Dave from Unplanned work: the column is marked "From the Truck". */
  fromTheTruck?: boolean;
  /** Set for a Move or an Other, which haul no Loads: its # of loads and # of tons are blank. Absent for a Haul. */
  work?: Exclude<Work, 'haul'>;
}

/**
 * One piece of Unplanned work as the Truck log shows it, after Dave's
 * columns: its Places and times, never a Pick up or Drop off.
 */
export interface TruckLogUnplanned {
  /** The Unplanned work's id. */
  id: string;
  /** Where it went, in order: the Place's short name, else Fleet's geofence code. */
  places: string[];
  /** When each of its Trips left: out on the first, back on the last. */
  tripsLeftAt: string[];
  truckingHours: number;
}

/** A tie as the Truck log asks it: "Which Assignment? A2 or A3 · 11:30 Villager → Walworth Dolomite". */
export interface TruckLogWhichAssignment {
  /** The Trip's leftAt. */
  id: string;
  /** Where from and to: the Place's short name, else Fleet's geofence code. */
  from: string;
  to: string;
  /** The Assignments that fit it equally, by label ("A2", "A3"), in Dave's order. */
  candidates: string[];
}

/** One Trip as the Truck log lists it (the drives to and from the shop). */
export interface TruckLogTrip {
  leftAt: string;
  arrivedAt: string;
  /** Where from and to: the Place's short name, else Fleet's geofence code. */
  from: string;
  to: string;
  /** Null when the visits gave no odometers. */
  miles: number | null;
}

/** One Place a piece of Unplanned work went to: its Place, else only Fleet's geofence code. */
export interface UnplannedPlace {
  placeId: string | null;
  code: string;
}

/**
 * Unplanned work (GLOSSARY.md): Trips in a row that no Assignment
 * explains, between the Trips an Assignment explains (or the shop), taken as
 * one piece for Dave to answer. The Truck cannot tell which way material
 * went, so it has its Places and times only: no From, no To, no Job, no Loads.
 */
export interface UnplannedWork {
  /**
   * Its first Trip's leftAt. Stable while the piece grows during the day, so
   * an answer to it (later: make an Assignment, link, not a haul) can name it.
   */
  id: string;
  /** Its Trips in order; none belongs to an Assignment. */
  trips: Trip[];
  /** Where it went, in the order first reached, each once: "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney". */
  places: UnplannedPlace[];
  /** Leaving on its first Trip. */
  leftAt: string;
  /** Arriving at the end of its last. */
  arrivedAt: string;
  /** leftAt to arrivedAt, in hours, 2 decimals. */
  truckingHours: number;
}

/** A tie: "Which Assignment? A1 or A3". */
export interface WhichAssignment {
  /** The Trip's leftAt. */
  id: string;
  trip: Trip;
  /** The Assignments (ids, in Dave's order) that fit it equally. */
  candidates: string[];
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
  /**
   * Dave's answer to "Who was driving?" (#77), picked when he answered the
   * Truck's Unplanned work: the Driver, when more than one fits. Ignored otherwise.
   */
  drivenBy?: string | null;
  /**
   * The check-ins to the Truck that day (an Inspection naming it, by its
   * Driver, at its time); never one from an earlier day. With them, the
   * Driver at a Trip's time is the Driver of the latest check-in at or before
   * it, and the Trip matches only that Driver's Assignments, whatever Truck
   * they name. With no check-in before a Trip nobody is guessed: the Truck
   * log asks "Who was driving?" and the Trip matches the Assignments that
   * name the Truck. Left out (a made-up day with no check-ins to give), the
   * Driver comes from the Assignments as before and every Assignment is matched.
   */
  checkIns?: TruckCheckIn[];
}

/** A Driver's check-in to the Truck: from `at` on, until another Driver checks in to it, he is driving it. */
export interface TruckCheckIn {
  driverId: string;
  /** ISO 8601. */
  at: string;
}

export interface TripDay {
  /** Raw visits known at `now`, as the Worker would hold them. */
  known: { visit: FleetVisit; state: 'open' | 'closed' }[];
  dropped: { raw: number; reason: string }[];
  merged: { into: number; raw: number[]; reason: string }[];
  visits: CleanVisit[];
  trips: Trip[];
  assignments: AssignmentTrips[];
  /** The Unplanned work: Trips no Assignment explains, in pieces, for Dave to answer next morning. */
  unplanned: UnplannedWork[];
  /** The Trips two or more Assignments fit equally: planned work, not Unplanned work; Dave picks which. */
  whichAssignment: WhichAssignment[];
  /** The Trips to or from the shop or a yard (rule SHOP_OR_YARD): leaving in the morning, getting back at the end of the day. */
  shopTrips: Trip[];
  /** The Truck's day: Driver, start and end, miles, Total hours. */
  truckDay: TruckDay;
  /** Geofence codes with no Place: listed for Dave in Settings. */
  unknownCodes: string[];
  miles: {
    /** Null when a Trip has no miles (visits with no odometers). */
    trips: number | null;
    /** Null when a closed visit has no odometers. */
    insidePlaces: number | null;
    day: number | null;
    /** Null until the day's meter readings exist, or without Trip miles. */
    ok: boolean | null;
  };
}

/**
 * "Make an Assignment" (#75): Dave's answer to one piece of Unplanned work.
 * An ordinary Assignment, From the Truck: Assigned afterwards, never Added.
 * Its From is where Dave says the Truck loaded; its To, the piece's other Place.
 */
export interface MadeAssignment extends TripAssignment {
  /** The Unplanned work it answers (UnplannedWork.id). */
  unplannedId: string;
}

/**
 * Dave's answers to the day's Unplanned work, as inputs to the Trip builder.
 * The builder re-matches with them, so Loads, Jobs and hours always come from
 * the rules, never from Dave typing them. Each kind of answer is its own list
 * (#76 adds links and Not a haul, #77 splits).
 */
export interface UnplannedAnswers {
  /** "Make an Assignment": each claims only the Trips of the piece it answers. */
  madeAssignments?: MadeAssignment[];
  /** "Link to an Assignment": each reroutes that Assignment (planned, or made from another piece) from the piece's first Trip. */
  links?: UnplannedLink[];
  /** "Not a haul": the pieces whose Trips were no haul, with Dave's note. */
  notAHauls?: NotAHaul[];
  /**
   * Split (#77): the leftAt of each Trip where Dave split a run that held two
   * hauls. A new piece of Unplanned work starts at that Trip, named by it; a
   * split at a run's first Trip, or at a Trip in no run, changes nothing.
   */
  splits?: string[];
}

/**
 * "Link to an Assignment" (#76): Dave says one piece of Unplanned work was
 * that Assignment's, on a new route. It is recorded as a change to the
 * Assignment's route (assignment_changes) from the leave time of the piece's
 * first Trip, as a reroute is.
 */
export interface UnplannedLink {
  /** The Unplanned work it answers (UnplannedWork.id, its first Trip's leftAt). */
  unplannedId: string;
  assignmentId: string;
  /** The route from then on: From where Dave says the Truck loaded, To the piece's other Place. */
  fromPlaceId: string | null;
  toPlaceId: string | null;
}

/** "Not a haul" (#76): the piece's Trips stay in the Trip log and in Total hours, but belong to no Assignment. */
export interface NotAHaul {
  /** The Unplanned work it answers (UnplannedWork.id). */
  unplannedId: string;
  /** Dave's note (fuel, repair, personal), if any. */
  note: string | null;
}

export interface TripDayInput {
  places: TripPlace[];
  /** The Jobs its Places belong to, for each Assignment's Job. */
  jobs?: TripJob[];
  visits: FleetVisit[];
  assignments: TripAssignment[];
  /** What the Worker knows: only data up to this moment. */
  now: string;
  /**
   * Dave's Not considered list (Settings): geofence codes whose visits are
   * dropped before Trips are built, however long the Truck stayed, matched
   * ignoring case. Every other visit is a stop.
   */
  notConsidered: string[];
  /** The meter readings around the day; the end one is null until it exists. */
  meter?: { startOdometer: number; endOdometer: number | null } | null;
  /** The Truck and who might have driven it, for the Truck's Driver. */
  truck?: TruckDayInput | null;
  /** The Truck's ignition changes that day, from the ping history. */
  ignition?: IgnitionEvent[];
  /** The day is over (end of day, or its data is all in): the Truck stopped wherever it last stopped. */
  dayOver?: boolean;
  /** Dave's answers to the Unplanned work; made Assignments are summed after `assignments`. */
  answers?: UnplannedAnswers;
}

const ms = (iso: string) => new Date(iso).getTime();
const round = (n: number) => Math.round(n * 100) / 100;
const later = (a: string, b: string) => (ms(a) >= ms(b) ? a : b);

/** A Place's kind, or null for no Place. */
const kindOf = (places: TripPlace[], id: string | null): TripPlaceKind => places.find((p) => p.id === id)?.kind ?? null;
/** The shop or a yard: where a Truck's day starts and ends. */
const isShopOrYard = (kind: TripPlaceKind) => kind === 'shop' || kind === 'yard';

const localClock = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

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

/** A geofence code as codes are matched: trimmed, ignoring case. */
export const codeKey = (code: string) => code.trim().toLowerCase();

/** Clean the known visits: drop the ones not considered, join short exits, mark where the day began. */
function clean(known: ReturnType<typeof knownAt>, places: TripPlace[], notConsidered: string[]) {
  const placeOf = new Map(places.filter((p) => p.geofenceCode).map((p) => [codeKey(p.geofenceCode!), p.id]));
  const skipped = new Set(notConsidered.map(codeKey));
  const dropped: TripDay['dropped'] = [];
  const merged: TripDay['merged'] = [];
  const visits: CleanVisit[] = [];
  for (const { raw, visit } of known) {
    if (skipped.has(codeKey(visit.geofenceCode))) {
      dropped.push({ raw, reason: `Not considered: ${visit.geofenceCode}` });
      continue;
    }
    const placeId = placeOf.get(codeKey(visit.geofenceCode)) ?? null;
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

/**
 * The Assignment once Dave links Unplanned work to it: rerouted from the
 * piece's first Trip (its id), with what it had then kept as the change's
 * `before`. A later change it had is overtaken by the link.
 */
export function linkedAssignment<A extends TripAssignment>(assignment: A, link: UnplannedLink): A {
  const changedAt = link.unplannedId;
  return {
    ...assignment,
    fromPlaceId: link.fromPlaceId,
    toPlaceId: link.toPlaceId,
    changes: [...assignment.changes.filter((c) => ms(c.changedAt) <= ms(changedAt)), { changedAt, before: routeAt(assignment, changedAt) }],
  };
}

/** The Assignment as it was at `at`: the earliest change after it kept what it had then. */
export function routeAt(assignment: TripAssignment, at: string): Route {
  const later = assignment.changes.filter((c) => ms(c.changedAt) > ms(at)).sort((a, b) => ms(a.changedAt) - ms(b.changedAt));
  return savedRoute(later[0]?.before ?? assignment);
}

const RULES: {
  rule: Match['rule'];
  kind: TripKind;
  fits: (r: Route, from: string | null, to: string | null) => boolean;
  reason: string;
}[] = [
  { rule: 1, kind: 'load', fits: (r, a, b) => !!a && !!b && r.fromPlaceId === a && r.toPlaceId === b, reason: 'From and To match the Assignment' },
  { rule: 2, kind: 'empty', fits: (r, a, b) => !!a && !!b && r.fromPlaceId === b && r.toPlaceId === a, reason: 'The way back of the Assignment' },
  // SHOP_OR_YARD needs no Assignment; it is checked between 2 and 4.
  { rule: 4, kind: 'empty', fits: (r, _a, b) => !!b && r.fromPlaceId === b, reason: 'Going to the Assignment’s pickup' },
  { rule: 5, kind: 'load', fits: (r, a) => !!a && r.fromPlaceId === a && r.toPlaceId === null, reason: 'Leaves the Assignment’s pickup; its To is empty' },
];

/** Match one Trip to the Assignments, first rule that fits; two at one rule is for Dave to choose. */
export function matchTrip(
  trip: { fromPlaceId: string | null; toPlaceId: string | null; leftAt: string },
  assignments: TripAssignment[],
  places: TripPlace[],
): Match {
  const live = assignments
    .filter((a) => a.cancelledAt === null || ms(a.cancelledAt) > ms(trip.leftAt))
    .map((a) => ({ a, r: routeAt(a, trip.leftAt) }));
  // An Other fits no Trip by Place, and a Move only with both ends: neither is filled from At.
  const routes = live
    .filter(({ r }) => r.work === 'haul' || (r.work === 'move' && r.fromPlaceId !== null && r.toPlaceId !== null))
    .map(({ a, r }) => ({ a, r: filledRoute(r) }));
  const { fromPlaceId: from, toPlaceId: to } = trip;

  const at = (rule: (typeof RULES)[number]): Match | null => {
    const fit = routes.filter(({ r }) => rule.fits(r, from, to));
    // A Move's loaded Trip is a Move Trip, never a Load.
    if (fit.length === 1 && rule.kind === 'load' && fit[0].r.work === 'move')
      return { kind: 'move', assignmentId: fit[0].a.id, rule: rule.rule, reason: 'From and To match the Move' };
    if (fit.length === 1) return { kind: rule.kind, assignmentId: fit[0].a.id, rule: rule.rule, reason: rule.reason };
    if (fit.length > 1)
      return {
        kind: null,
        assignmentId: null,
        rule: rule.rule,
        reason: `${fit.length} Assignments fit (${fit.map((f) => f.a.label).join(', ')}); Dave chooses`,
        candidates: fit.map((f) => f.a.id),
      };
    return null;
  };

  for (const rule of RULES.slice(0, 2)) {
    const m = at(rule);
    if (m) return m;
  }
  if (isShopOrYard(kindOf(places, from)) || isShopOrYard(kindOf(places, to))) return { kind: 'empty', assignmentId: null, rule: SHOP_OR_YARD, reason: 'To or from the shop or a yard' };
  for (const rule of RULES.slice(2)) {
    const m = at(rule);
    if (m) return m;
  }
  if (to && kindOf(places, from) === 'plant') {
    const m = at({ rule: 6, kind: 'load', fits: (r, _a, b) => r.toPlaceId === b && r.fromPlaceId === null, reason: 'From a plant to the Assignment’s drop; its From is empty' });
    if (m) return m;
  }
  // Only At: which way material went is unknown, so an At Trip, never a Load. Never on a null At.
  const m = at({ rule: AT_ONLY, kind: 'at', fits: (r, a, b) => isAtOnly(r) && (r.atPlaceId === a || r.atPlaceId === b), reason: 'Starts or ends at the Assignment’s At' });
  if (m) return m.assignmentId ? { ...m, atPlaceId: routes.find(({ a }) => a.id === m.assignmentId)!.r.atPlaceId! } : m;
  // Nothing else fits, and the Driver is on an Other then: not a haul, on the latest-ordered one.
  const other = live.filter(({ r }) => r.work === 'other').at(-1)?.a;
  if (other) return { kind: NOT_A_HAUL, assignmentId: other.id, rule: ON_AN_OTHER, reason: `Other: ${other.note?.trim() || 'no text'}` };
  return { kind: null, assignmentId: null, rule: NOTHING_FITS, reason: 'No Assignment fits; Dave answers next morning' };
}

/** At and no From or To: its Trips there are At Trips, and its Loads come from Tickets. */
const isAtOnly = (r: Route) => r.atPlaceId !== null && r.fromPlaceId === null && r.toPlaceId === null;

/** Pair the cleaned visits into Trips: from one visit's exit to the next visit's entry, as soon as the Truck arrives. */
function pair(visits: CleanVisit[]): Omit<Trip, 'match'>[] {
  const trips: Omit<Trip, 'match'>[] = [];
  for (let i = 0; i + 1 < visits.length; i++) {
    const from = visits[i];
    const to = visits[i + 1];
    if (from.exitedAt === null) continue;
    trips.push({
      fromPlaceId: from.placeId,
      toPlaceId: to.placeId,
      fromCode: from.geofenceCode,
      toCode: to.geofenceCode,
      leftAt: from.exitedAt,
      arrivedAt: to.enteredAt,
      // No odometers (an xlsx export): the Trip is still made, its miles blank.
      miles: to.entryOdometer === null || from.exitOdometer === null ? null : round(to.entryOdometer - from.exitOdometer),
    });
  }
  return trips;
}

/** An Assignment's Job: the Job of its To, then its At, then its From; the first that belongs to a Job. */
function jobOf(route: Route, places: TripPlace[], jobs: TripJob[]): TripJob | null {
  const jobAt = (placeId: string | null) => {
    const jobId = places.find((p) => p.id === placeId)?.jobId;
    return jobs.find((j) => j.id === jobId) ?? null;
  };
  return jobAt(route.toPlaceId) ?? jobAt(route.atPlaceId) ?? jobAt(route.fromPlaceId);
}

/** Now, Done or neither (proposal P5): Now while the Truck's latest Trip is its and the Truck is not back at the shop. */
function summarize(input: TripDayInput, assignments: TripAssignment[], trips: Trip[]): AssignmentTrips[] {
  const { places, now } = input;
  const latest = trips.at(-1);
  const atShop = latest ? isShopOrYard(kindOf(places, latest.toPlaceId)) : false;
  return assignments.map((a) => {
    const own = trips.filter((t) => t.match.assignmentId === a.id);
    const loads = own.filter((t) => t.match.kind === 'load');
    const moves = own.filter((t) => t.match.kind === 'move');
    const route = routeAt(a, now);
    const status: AssignmentStatus = own.length === 0 ? 'none' : latest?.match.assignmentId === a.id && !atShop ? 'now' : 'done';
    const first = own[0];
    const last = own.at(-1);
    return {
      assignmentId: a.id,
      job: jobOf(route, places, input.jobs ?? []),
      // Only At: no Load is guessed, so none are counted; they come from Tickets.
      loads: isAtOnly(route) && loads.length === 0 ? null : loads.length,
      empties: own.filter((t) => t.match.kind === 'empty').length,
      // Tons come from the Loads' Tickets (phase 4); none are read yet.
      tons: null,
      status,
      since: first?.leftAt ?? null,
      lastLoadAt: loads.at(-1)?.arrivedAt ?? null,
      // A Move's "Done 8:15": when the machine got there.
      ...(route.work === 'move' ? { movedAt: moves.at(-1)?.arrivedAt ?? null } : {}),
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

/**
 * The Driver at a moment, from the check-ins: the Driver of the latest
 * check-in to the Truck at or before `at`. Null when nobody checked in by
 * then, or the Truck's check-ins are not given.
 */
export function driverAt(truck: TruckDayInput | null | undefined, at: string): TruckDayDriver | null {
  const latest = (truck?.checkIns ?? [])
    .filter((c) => ms(c.at) <= ms(at))
    .reduce<TruckCheckIn | null>((last, c) => (last === null || ms(c.at) >= ms(last.at) ? c : last), null);
  const driver = latest && truck!.drivers.find((d) => d.id === latest.driverId);
  return driver ? { id: driver.id, name: driver.name } : null;
}

/**
 * The Assignments a Trip leaving at `at` is matched against. With check-ins:
 * the Driver at that time's, whatever Truck they name; with no check-in
 * before it, the ones that name the Truck (a null Truck names the Driver's
 * usual one). Without check-ins given: all of them.
 */
function assignmentsAt(input: TripDayInput, at: string): TripAssignment[] {
  const truck = input.truck;
  if (!truck?.checkIns) return input.assignments;
  const driver = driverAt(truck, at);
  if (driver) return input.assignments.filter((a) => a.driverId === driver.id);
  const usualTruck = (driverId: string | null | undefined) => truck.drivers.find((d) => d.id === driverId)?.defaultTruckId ?? null;
  return input.assignments.filter((a) => (a.truckId ?? usualTruck(a.driverId)) === truck.id);
}

/** The Truck log's header at `now`. */
function truckDayOf(input: TripDayInput, visits: CleanVisit[], trips: Trip[]): TruckDay {
  const at = ms(input.now);
  const shopish = (id: string | null) => isShopOrYard(kindOf(input.places, id));
  const ignition = (input.ignition ?? []).filter((e) => ms(e.at) <= at).sort((a, b) => ms(a.at) - ms(b.at));

  const firstOn = ignition.find((e) => e.on)?.at ?? null;
  const firstShopExit = trips.find((t) => shopish(t.fromPlaceId))?.leftAt ?? null;
  const starts = [firstOn, firstShopExit].filter((s): s is string => s !== null).sort((a, b) => ms(a) - ms(b));
  const startAt = starts[0] ?? null;

  const lastTrip = trips.at(-1);
  let endAt: string | null;
  if (input.dayOver) {
    // The day is over: it stopped wherever it last stopped, at its last arrival or the ignition off after it.
    const stops = [lastTrip?.arrivedAt, [...ignition].reverse().find((e) => !e.on)?.at].filter((s): s is string => !!s);
    endAt = stops.length > 0 ? stops.reduce(later) : null;
  } else {
    // Stopped for the day: the last Trip ended at the shop or yard and the Truck is still there.
    const back = lastTrip && shopish(lastTrip.toPlaceId) && visits.at(-1)?.exitedAt === null ? lastTrip.arrivedAt : null;
    const lastOff = ignition.at(-1);
    endAt = back && lastOff && !lastOff.on && ms(lastOff.at) > ms(back) ? lastOff.at : back;
  }

  const checkedIn = driverAt(input.truck, input.now);
  const candidates = checkedIn ? [checkedIn] : truckDrivers(input.truck);
  const picked = candidates.find((c) => c.id === input.truck?.drivenBy) ?? null;
  // With check-ins, nobody is guessed: only a check-in or Dave's pick names the Driver.
  const guessed = !input.truck?.checkIns && candidates.length === 1 ? candidates[0] : null;
  return {
    driver: checkedIn ?? guessed ?? picked,
    driverCandidates: candidates,
    startAt,
    endAt,
    startMiles: input.meter?.startOdometer ?? null,
    endMiles: input.meter?.endOdometer ?? null,
    totalHours: startAt && endAt ? round((ms(endAt) - ms(startAt)) / HOUR) : null,
  };
}

/** "Nothing fits", so no Assignments tied for the Trip either. */
const fitsNone = (m: Match) => m.kind === null && m.rule === NOTHING_FITS;

/**
 * The drive back into a piece of Unplanned work's own Places. Where a piece
 * of Unplanned work already went, a Trip back there that only an empty guess
 * for one Assignment explains (rule 4, "going to the Assignment's pickup")
 * is the Unplanned work's way back, not that Assignment's: on 16 Nov the 14:33 drive from
 * Bishop Kearney back to J25008 is the Unplanned work's, so A1 keeps its
 * 3.02 h. A Trip on an Assignment's route (rules 1, 2), to the shop (3), a
 * Load guess (5, 6) or a tie still belongs to the planned work and ends the
 * piece. The spec says only "a run covers the way back"; this is the rule
 * chosen for it.
 */
const BACK_INTO_UNPLANNED: Match = {
  kind: null,
  assignmentId: null,
  rule: NOTHING_FITS,
  reason: 'Back to where this Unplanned work already went; Dave answers it with the rest',
};

/**
 * Each run of Trips nothing fits, with the drives back into it. Every Trip is
 * walked. Returns the Trips with their matches, and the runs as index lists
 * into them.
 */
function unplannedRuns(trips: Trip[]): { trips: Trip[]; runs: number[][] } {
  const out: Trip[] = [];
  const runs: number[][] = [];
  let open: number[] | null = null;
  const visited = new Set<string>();
  for (const t of trips) {
    // A tie is never taken: it is "Which Assignment?", not Unplanned work.
    const backInto = open !== null && t.match.rule === 4 && !t.match.candidates && visited.has(t.toCode.toLowerCase());
    if (fitsNone(t.match) || backInto) {
      if (open === null) {
        open = [];
        runs.push(open);
        visited.clear();
        visited.add(t.fromCode.toLowerCase());
      }
      open.push(out.length);
      visited.add(t.toCode.toLowerCase());
      out.push(backInto ? { ...t, match: BACK_INTO_UNPLANNED } : t);
    } else {
      open = null;
      out.push(t);
    }
  }
  return { trips: out, runs };
}

/**
 * Cut the runs at Dave's splits. Only the pieces change: which Trips are in a
 * run (and so taken back from the planned work) was decided before, as if
 * nothing were split.
 */
function splitRuns(trips: Trip[], runs: number[][], splits: string[]): number[][] {
  if (splits.length === 0) return runs;
  const at = new Set(splits.map(ms));
  return runs.flatMap((run) => {
    const parts: number[][] = [];
    for (const i of run) {
      if (parts.length === 0 || at.has(ms(trips[i].leftAt))) parts.push([]);
      parts.at(-1)!.push(i);
    }
    return parts;
  });
}

/** A run's id: its first Trip's leftAt, as UnplannedWork.id. */
const runId = (trips: Trip[], run: number[]) => trips[run[0]].leftAt;

/**
 * Match a Trip of a piece of Unplanned work against the Assignment Dave made
 * for it. Before its first Load, a drive to its pickup is just that (rule 4),
 * not "the way back" (rule 2): nothing was hauled yet to come back from.
 */
function matchMade(trip: Trip, made: TripAssignment, places: TripPlace[], loaded: boolean): Match {
  const m = matchTrip(trip, [made], places);
  if (m.rule === 2 && !loaded) return { kind: 'empty', assignmentId: made.id, rule: 4, reason: 'Going to the Assignment’s pickup' };
  return m;
}

/**
 * Apply "Make an Assignment". The rule that keeps a made Assignment from
 * claiming earlier Trips (e.g. A1's ways back, when its route is A1's
 * reversed): it is matched only against the Trips of the Unplanned work it
 * answers, never against the rest of the day, and Dave's planned Assignments
 * are matched without it. A Trip of that piece it does not fit stays
 * Unplanned work.
 */
function answerRuns(trips: Trip[], runs: number[][], answers: UnplannedAnswers, assignments: TripAssignment[], places: TripPlace[]): Trip[] {
  const out = [...trips];
  const claim = (unplannedId: string, owner: TripAssignment) => {
    const run = runs.find((r) => runId(trips, r) === unplannedId);
    if (!run) return;
    let loaded = false;
    for (const i of run) {
      const m = matchMade(trips[i], owner, places, loaded);
      if (m.assignmentId === null) continue;
      if (m.kind === 'load') loaded = true;
      out[i] = { ...trips[i], match: m };
    }
  };
  for (const made of answers.madeAssignments ?? []) claim(made.unplannedId, made);
  // A link stays inside its own piece the same way: the rerouted Assignment is
  // matched only against that piece's Trips. Every other Trip keeps the match
  // it had against Dave's Assignments as planned, so the reroute (which runs
  // on to the end of the day) never takes a Trip after the piece, and never
  // one before it either.
  for (const link of answers.links ?? []) {
    const a = assignments.find((x) => x.id === link.assignmentId);
    if (a) claim(link.unplannedId, linkedAssignment(a, link));
  }
  for (const no of answers.notAHauls ?? []) {
    const run = runs.find((r) => runId(trips, r) === no.unplannedId);
    for (const i of run ?? [])
      out[i] = { ...trips[i], match: { kind: NOT_A_HAUL, assignmentId: null, rule: NOTHING_FITS, reason: no.note ? `Not a haul: ${no.note}` : 'Not a haul' } };
  }
  return out;
}

/** Still Unplanned work: no Assignment counts it and Dave has not said it was not a haul. */
const unanswered = (t: Trip) => t.match.assignmentId === null && t.match.kind !== NOT_A_HAUL;

/** The pieces of Unplanned work: in each run, the Trips still nobody's, in rows. */
function piecesOf(trips: Trip[], runs: number[][]): UnplannedWork[] {
  const rows: Trip[][] = [];
  for (const run of runs) {
    let row: Trip[] | null = null;
    for (const i of run) {
      const t = trips[i];
      if (!unanswered(t)) {
        row = null;
        continue;
      }
      if (row === null) rows.push((row = []));
      row.push(t);
    }
  }
  return rows.map((run): UnplannedWork => {
    const places: UnplannedPlace[] = [];
    for (const t of run)
      for (const [placeId, code] of [[t.fromPlaceId, t.fromCode], [t.toPlaceId, t.toCode]] as const)
        if (!places.some((p) => p.code.toLowerCase() === code.toLowerCase())) places.push({ placeId, code });
    const leftAt = run[0].leftAt;
    const arrivedAt = run.at(-1)!.arrivedAt;
    return { id: leftAt, trips: run, places, leftAt, arrivedAt, truckingHours: round((ms(arrivedAt) - ms(leftAt)) / HOUR) };
  });
}

/** One Truck's day as the Worker would know it at `now`. */
export function buildTripDay(input: TripDayInput): TripDay {
  const known = knownAt(input.visits, input.now);
  const { visits, dropped, merged } = clean(known, input.places, input.notConsidered);
  const matched = pair(visits).map((t) => ({ ...t, match: matchTrip(t, assignmentsAt(input, t.leftAt), input.places) }));
  const grouped = unplannedRuns(matched);
  const answers = input.answers ?? {};
  const runs = splitRuns(grouped.trips, grouped.runs, answers.splits ?? []);
  // A link can name a planned Assignment or one Dave made from another piece.
  const made = answers.madeAssignments ?? [];
  const trips = answerRuns(grouped.trips, runs, answers, [...input.assignments, ...made], input.places);
  // A linked Assignment is summed on its new route (its Job follows it), but it only counts the Trips answerRuns gave it.
  const linked = <A extends TripAssignment>(a: A) => {
    const link = answers.links?.find((l) => l.assignmentId === a.id);
    return link ? linkedAssignment(a, link) : a;
  };
  const unplanned = piecesOf(trips, runs);
  // Inside cleaned visits only: a skipped visit.s miles are already in the Trip across it,
  // and a short exit's miles are inside the joined visit.
  // Without odometers on every Trip and closed visit, the sums are not known.
  const closed = visits.filter((v) => v.exitedAt !== null);
  const insidePlaces = closed.every((v) => v.entryOdometer !== null && v.exitOdometer !== null)
    ? round(closed.reduce((sum, v) => sum + (v.exitOdometer! - v.entryOdometer!), 0))
    : null;
  const tripMiles = trips.every((t) => t.miles !== null) ? round(trips.reduce((sum, t) => sum + t.miles!, 0)) : null;
  const day = input.meter && input.meter.endOdometer !== null ? round(input.meter.endOdometer - input.meter.startOdometer) : null;
  const unknownCodes = [...new Set(visits.filter((v) => v.placeId === null).map((v) => v.geofenceCode))];
  return {
    known: known.map(({ visit, state }) => ({ visit, state })),
    dropped,
    merged,
    visits,
    trips,
    assignments: summarize(input, [...input.assignments, ...made].map(linked), trips),
    unplanned,
    whichAssignment: trips
      .filter((t) => t.match.candidates)
      .map((trip) => ({ id: trip.leftAt, trip, candidates: trip.match.candidates! })),
    shopTrips: trips.filter((t) => t.match.rule === SHOP_OR_YARD),
    truckDay: truckDayOf(input, visits, trips),
    unknownCodes,
    miles: {
      trips: tripMiles,
      insidePlaces,
      day,
      ok: day === null || tripMiles === null || insidePlaces === null ? null : Math.abs(day - tripMiles - insidePlaces) <= MILES_TOLERANCE,
    },
  };
}
