/** Shapes the API takes and returns, shared by the Worker and the page. */

export interface Driver {
  id: string;
  name: string;
  /** The usual Truck, filled in on a new Assignment when the Driver is picked. */
  defaultTruckId: string | null;
  /** Dave's own place for it in the list, 1 first; null for none (after the ordered ones, by name). Set only by a reorder. */
  sortOrder: number | null;
  active: boolean;
}

export interface Truck {
  id: string;
  number: string;
  /** Its EquipmentCode in HCSS Fleet, e.g. MCK-55-17: an Import finds its Truck by it. Typed in Settings, trimmed. */
  hcssCode: string | null;
  hcssGuid: string | null;
  active: boolean;
}

export interface Job {
  id: string;
  name: string;
  jobNumber: string | null;
  active: boolean;
}

/** What a Place is. Stored as these values; the page shows them as words. */
export const PLACE_KINDS = ['plant', 'job_site', 'shop', 'yard'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Anywhere a Truck loads, dumps or parks. */
export interface Place {
  id: string;
  shortName: string;
  fullName: string | null;
  kind: PlaceKind | null;
  jobId: string | null;
  /**
   * A job site's usual Foreman, filled in on a new Assignment there; the
   * Assignment keeps its own. Only a job site has one; picked from the
   * Foremen in use.
   */
  usualForemanId: string | null;
  /**
   * Its geofence code in HCSS Fleet: a Trip finds its Place by it. Typed in
   * Settings, trimmed; unique among active Places, ignoring case.
   */
  geofenceCode: string | null;
  /** Whether it has a geofence code; answered on every read, never saved. */
  onTruckMap: boolean;
  /** Dave's own place for it in the list, 1 first; null for none (after the ordered ones, by name). Set only by a reorder. */
  sortOrder: number | null;
  active: boolean;
}

/** What a Load carries, e.g. 2" minus. */
export interface Material {
  id: string;
  name: string;
  /** Dave's own place for it in the list, 1 first; null for none (after the ordered ones, by name). Set only by a reorder. */
  sortOrder: number | null;
  active: boolean;
}

/** The person running a Job on a given day, whom the Driver reports to. */
export interface Foreman {
  id: string;
  name: string;
  active: boolean;
}

/**
 * One line of the Inspection checklist ("Lights"), kept in Settings. A Driver
 * may leave an optional item unanswered.
 */
export interface InspectionItem {
  id: string;
  label: string;
  optional: boolean;
  /** Dave's own place for it in the list, 1 first; null for none (after the ordered ones, by label). Set only by a reorder. */
  sortOrder: number | null;
  active: boolean;
}

/**
 * The lists Settings edits and the Board picks from, by their API route
 * (GET, POST api/<list>; PATCH api/<list>/<id>). Nothing is ever deleted.
 */
export interface Lists {
  drivers: Driver;
  trucks: Truck;
  jobs: Job;
  places: Place;
  materials: Material;
  foremen: Foreman;
  'inspection-items': InspectionItem;
}
export type ListName = keyof Lists;

/**
 * What the page sends to add an entry (the display name is required; active
 * defaults to true) or to change one (only the fields to change). The order is
 * set for a whole list at once (PUT api/<list>/order), never per entry.
 */
export type EntryFields<L extends ListName> = Partial<Omit<Lists[L], 'id' | 'onTruckMap' | 'sortOrder'>>;

/** The lists Dave puts in his own order. */
export const ORDERED_LISTS = ['drivers', 'places', 'materials', 'inspection-items'] as const satisfies readonly ListName[];
export type OrderedList = (typeof ORDERED_LISTS)[number];

/** Today and tomorrow in US Eastern time, and the next Working day after today, which the board opens on (GET api/today). */
export interface BusinessDay {
  today: string;
  tomorrow: string;
  nextWorkingDay: string;
}

/** What the page sends to add an Assignment. Only the date is required. */
export interface NewAssignment {
  date: string;
  driverId?: string | null;
  truckId?: string | null;
  fromPlaceId?: string | null;
  toPlaceId?: string | null;
  materialId?: string | null;
  foremanId?: string | null;
  note?: string | null;
}

/**
 * What the page sends to add an Assignment. With `alsoDriverIds` the same
 * Assignment is also made for each of those Drivers, one each, all or none.
 */
export type AddAssignment = NewAssignment & TypedNames & { alsoDriverIds?: string[] };

/**
 * What the page sends to change an Assignment: only the fields to change (one
 * left out stays as it is, an empty one is cleared), typed names included.
 * Never its day, which is fixed.
 */
export type AssignmentChange = Partial<Omit<NewAssignment, 'date'> & TypedNames>;

/**
 * A Place or Material an Assignment may give by name instead of by id, when
 * adding or changing it: the Worker links the entry with that name, ignoring
 * case, bringing a removed one back, or adds a new one. A Place added this way
 * has no kind yet.
 */
export interface TypedNames {
  fromPlaceName?: string | null;
  toPlaceName?: string | null;
  materialName?: string | null;
}

/** One piece of work given to one Driver for one day, with the names of its Driver, Truck and Places resolved. */
export interface Assignment {
  id: string;
  date: string;
  driverId: string | null;
  driverName: string | null;
  truckId: string | null;
  truckNumber: string | null;
  fromPlaceId: string | null;
  /** The From Place's short name. */
  fromPlaceName: string | null;
  toPlaceId: string | null;
  /** The To Place's short name. */
  toPlaceName: string | null;
  materialId: string | null;
  materialName: string | null;
  foremanId: string | null;
  foremanName: string | null;
  note: string | null;
  /**
   * Its place in its lane (its date and Driver, or Unassigned), from 0: the
   * order Dave wants the work done. Ties are read in the order they were added.
   */
  position: number;
  createdAt: string;
  updatedAt: string;
  /**
   * When it last really changed: a field the Driver reads took a new value, or
   * it moved in its order (such as to another Driver's lane). Null until then;
   * saving the same values again, or a neighbour moving, leaves it.
   */
  changedAt: string | null;
  /**
   * When ✕ cancelled it after it was Assigned; null when it is not cancelled.
   * A cancelled Assignment is kept in its place, struck through, and opens
   * only to Put back, which empties this again. (✕ deletes a Draft.)
   */
  cancelledAt: string | null;
  /**
   * When Dave Assigned it (POST api/assignments/:id/assign); null while it is
   * a Draft, which its Driver sees nothing of.
   */
  assignedAt: string | null;
  /**
   * The Assignment it was handed over from, when it is the copy made by giving
   * an Assigned Assignment straight to another Driver (Assigned at once, so
   * Added); otherwise null.
   */
  handedFromId: string | null;
  /** Whether it is Changed or Added since it was Assigned; null on a Draft or when neither. */
  sinceSent: SinceSent;
  /**
   * What the Truck's Trips say about it (phase 3), from the Trip builder
   * (shared/trips.ts). Optional: the Worker does not send it yet, and the
   * board block and Driver card look as they always have without it.
   */
  trips?: AssignmentTripPart;
}

/** Whether the Truck is working on an Assignment now, has finished it, or has made no Trip for it. */
export type TripStatus = 'now' | 'done' | 'none';

/** An Assignment's Trips as the screens show them, at one moment of the day. */
export interface AssignmentTripPart {
  /** Loads hauled on it so far. */
  loads: number;
  /** The tons on its Loads' Tickets (phase 4); null until Tickets exist, shown blank "from Tickets". */
  tons: number | null;
  /** Now while the Truck's latest Trip is its and the Truck is not back at the shop; Done once it moved on; none before its first Trip. */
  status: TripStatus;
  /** When work on it began: its first Trip's leave time (ISO 8601), "since 08:24"; null before. */
  since: string | null;
  /** Arrive time of its latest Load (ISO 8601), "last 11:25"; null before its first Load. */
  lastLoadAt: string | null;
  /** From leaving for its first Trip to arriving at the end of its last, loaded or empty, in hours; null before its first Trip. */
  truckingHours: number | null;
}

/**
 * What an Assignment is since it was Assigned: Changed (altered after the
 * Assign) or Added (Assigned on its own day, or handed over from another
 * Driver). The board marks it, and the Driver sees "Changed by Dave" or
 * "Added by Dave".
 */
export type SinceSent = 'changed' | 'added' | null;

/**
 * What a change answers (PATCH api/assignments/:id): the Assignment as it now
 * is. Once it is Assigned, a new Driver cancels it for the first one and adds
 * a copy in the new lane: then `assignment` is the copy (Assigned to the new
 * Driver, or a Draft in Unassigned) and `cancelled` the first one, kept in
 * its place.
 */
export interface ChangedAssignment {
  assignment: Assignment;
  cancelled?: Assignment;
}

/** A day's Assignments (GET api/assignments?date=). */
export interface Day {
  assignments: Assignment[];
}

/**
 * What Start from or Copy to answers: the day copied, the day it was copied
 * onto, and that day's Assignments as they now are (all of them copies, and
 * all Drafts, as a copy is made only onto an empty day).
 */
export interface CopiedDay {
  from: string;
  to: string;
  assignments: Assignment[];
}

/**
 * What a Changed Assignment's fields the Driver reads were when it was
 * Assigned ("was Cobblestone"): only those that differ now, each with the
 * name it had then; null when it was empty (for the Truck, his own).
 */
export type Was = Partial<Pick<Assignment, 'truckNumber' | 'fromPlaceName' | 'toPlaceName' | 'materialName' | 'foremanName' | 'note'>>;

/** An Assignment as a Driver sees it: with what it was when Assigned, empty unless it is Changed. */
export interface DriverAssignment extends Assignment {
  was: Was;
}

/**
 * One Driver's day (GET api/drivers/:id/days/:date): only his Assigned
 * Assignments, in Dave's order, cancelled ones included. His Drafts are left
 * out, so a day with none Assigned has no Assignments ("Nothing from Dave yet").
 */
export interface DriverDay {
  date: string;
  assignments: DriverAssignment[];
}

/**
 * One day on the week strip: its state by the shared day rules (none, Draft,
 * Assigned or Changed), how many Drafts it holds that are not cancelled
 * (Unassigned ones included), and the Holiday on it, if any.
 */
export interface WeekDay {
  date: string;
  state: 'none' | 'draft' | 'assigned' | 'changed';
  drafts: number;
  holiday: string | null;
}

/** A week's seven days, Monday to Sunday (GET api/weeks/:monday). */
export interface Week {
  days: WeekDay[];
}

/** The most characters a note may have: an Assignment's, an Inspection's, a Truck problem's or a fix's. */
export const NOTE_LIMIT = 1000;

/** How a Driver answers one Inspection item: OK, Needs repair or N/A. */
export const INSPECTION_ANSWERS = ['ok', 'repair', 'na'] as const;
export type InspectionAnswerKind = (typeof INSPECTION_ANSWERS)[number];

/**
 * A finished Inspection as the phone sends it (POST api/inspections). The
 * phone makes the id (a UUID) when the Driver starts, so a retried Finish
 * is recognised. The date is the Worker's today; `date`, when sent, must be it.
 * The Driver comes from the body until Drivers sign in through the Hub (ADR 0006).
 */
export interface NewInspection {
  id: string;
  date?: string;
  driverId: string;
  truckId: string;
  answers: { itemId: string; answer: InspectionAnswerKind; repairNote?: string | null }[];
  otherNotes?: string | null;
}

/** One item of a saved Inspection, with the item's wording as it was then. */
export interface InspectionAnswer {
  /** Its place in the Inspection, from 0, in the checklist's order then. */
  position: number;
  itemId: string;
  label: string;
  answer: InspectionAnswerKind;
  repairNote: string | null;
}

/**
 * A saved Inspection: the official record of the Truck's condition, never
 * changed or deleted (ADR 0006). It needs repair when any answer is Needs repair.
 */
export interface Inspection {
  id: string;
  date: string;
  driverId: string;
  driverName: string;
  truckId: string;
  truckNumber: string;
  /** When the Driver finished it, by the Worker's clock: an ISO 8601 moment in UTC. */
  doneAt: string;
  otherNotes: string | null;
  needsRepair: boolean;
  answers: InspectionAnswer[];
  /** The Truck problems it opened, one per Needs repair answer, in the same order. */
  problems: TruckProblem[];
}

/** A Driver's check-in on a day: his latest Inspection that day, its Truck and time. */
export interface CheckIn {
  driverId: string;
  driverName: string;
  truckId: string;
  truckNumber: string;
  inspectionId: string;
  doneAt: string;
  needsRepair: boolean;
}

/** Each Driver's check-in on a day (GET api/check-ins?date=), in the Drivers' order; one not checked in is left out. */
export interface CheckIns {
  date: string;
  checkIns: CheckIn[];
}

/**
 * Something wrong with a Truck, reported by a Driver with a note (GLOSSARY.md).
 * Open until Dave marks it fixed; kept forever after, with when and how.
 * A Truck with an open problem can still be checked in to and driven.
 */
export interface TruckProblem {
  id: string;
  truckId: string;
  truckNumber: string;
  /** The reporting Driver; always one for now (only Drivers report problems). */
  reportedByDriverId: string | null;
  reportedByName: string | null;
  /** When it was reported, by the Worker's clock: an ISO 8601 moment in UTC. */
  reportedAt: string;
  /** What is wrong, in the Driver's words. */
  text: string;
  /** The Inspection it came from (a Needs repair answer), if any. */
  inspectionId: string | null;
  /** When Dave marked it fixed (ISO 8601, UTC); null while open. */
  fixedAt: string | null;
  /** How it was fixed, if Dave said. */
  fixedNote: string | null;
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
