/** Shapes the API takes and returns, shared by the Worker and the page. */
import type { FleetExportRow } from './fleetExport';
import type { TripDay, TripPlace } from './trips';
import type { TruckLogBody } from './truckLog';

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
 * A geofence code the app knows (Settings, Geofences): from HCSS's Location
 * list, or brought by an Import. Unique, ignoring case. Turned to Not
 * considered, its visits are skipped before Trips are built, however long the
 * Truck stayed; turned back, they count again (GET, PATCH api/geofences).
 */
export interface Geofence {
  code: string;
  notConsidered: boolean;
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
   * (shared/trips.ts). Optional: the Truck log's read (GET
   * api/trucks/:id/days/:date), the day read (GET api/assignments) and the
   * Driver day read (GET api/drivers/:id/days/:date) send it only on
   * Assignments a stored Trip matched. The board block and Driver card look as
   * they always have without it.
   */
  trips?: AssignmentTripPart;
  /**
   * Made by Dave afterwards from Unplanned work ("Make an Assignment"):
   * Assigned, never Added, and its Driver gets no notice. Optional: only the
   * simulation makes these so far; absent means false.
   */
  fromTheTruck?: boolean;
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

/**
 * A day's Assignments (GET api/assignments?date=), and, on a day a Truck has
 * stored visits, each such Truck's Unplanned work and ties for the lanes.
 */
export interface Day {
  assignments: Assignment[];
  /** Each Truck with stored visits that day; left out when none has any. */
  trucks?: DayTruck[];
}

/**
 * A piece of Unplanned work as the lanes show it: in the lane of the Driver
 * at its time (the latest check-in to the Truck at or before it leaves), or,
 * with no check-in before it, in the "Driver not known · Truck 55" row.
 */
export interface StoredUnplanned {
  /** The Unplanned work's id: its first Trip's leftAt. */
  id: string;
  /** Where it went, in order: the Place's short name, else Fleet's geofence code. */
  places: string[];
  leftAt: string;
  arrivedAt: string;
  /** The Driver at its time; null when nobody had checked in to the Truck ("Who was driving?"). */
  driver: { id: string; name: string } | null;
}

/** A Trip two or more Assignments fit equally, as the lanes ask it: "Which Assignment?". Never Unplanned work. */
export interface StoredWhichAssignment {
  /** The Trip's leftAt. */
  id: string;
  from: string;
  to: string;
  /** The Assignments that fit it, by id, in Dave's order. */
  assignmentIds: string[];
}

/** A stored day's Unplanned work and ties, as the board's lanes and the Fleet imports page's Scheduler view show them. */
export interface DayLanes {
  unplanned: StoredUnplanned[];
  whichAssignment: StoredWhichAssignment[];
}

/** One Truck's Unplanned work and ties on the day read. */
export interface DayTruck extends DayLanes {
  truckId: string;
  truckNumber: string;
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
 * On today only, it also has his Truck log, when that Truck has stored visits.
 */
export interface DriverDay {
  date: string;
  assignments: DriverAssignment[];
  /**
   * Today's Truck log of the Truck he checked in to today, else his usual
   * Truck, as of the latest Import, as the Truck log route opens it. Left
   * out on any other day, and when that Truck has no stored visits today.
   */
  truckLog?: DriverTruckLog;
}

/** A Truck's stored day as a Driver reads it: with the Truck's HCSS code, for the Truck log's header. */
export interface DriverTruckLog extends TruckLogDay {
  hcssCode: string | null;
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
 * Something wrong with a Truck, reported by a Driver with a note.
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

export type FleetExportFormat = 'json' | 'xlsx';

/** What the Fleet imports page sends: the dropped file's name and format, and its rows read by shared/fleetExport.ts. */
export interface NewFleetImport {
  fileName: string;
  format: FleetExportFormat;
  rows: FleetExportRow[];
}

/** What an Import did to the stored visits, as "N new · N closed · N already stored". */
export interface ImportCounts {
  /** Visits it stored that were not stored before. */
  added: number;
  /** Stored visits that were open and that it closed. */
  closed: number;
  /** Visits it held that were stored already and that it did not close ("already stored"). */
  unchanged: number;
}

/** One US Eastern day an Import touched: the visits entered on it, counted as the Import's are. */
export interface FleetImportDay extends ImportCounts {
  /** YYYY-MM-DD. */
  date: string;
}

/**
 * A geofence code in an Import that no Place has and that is not on the Not
 * considered list: a Place to set up in Settings, or a code to not consider.
 */
export interface CodeWithNoPlace {
  code: string;
}

/**
 * One Import: a Fleet export Dave dropped on the Fleet
 * imports page, for one Truck, and what it did to the stored visits.
 */
export interface FleetImport extends ImportCounts {
  id: string;
  truckId: string;
  truckNumber: string;
  fileName: string;
  format: FleetExportFormat;
  /** The Worker's clock when it was imported (ISO 8601, UTC). */
  importedAt: string;
  /** The US Eastern days its visits were entered on, each with its own counts, in date order. */
  days: FleetImportDay[];
  /** Every geofence code in it that no Place has, by code; its visits are stored all the same. */
  codesWithNoPlace: CodeWithNoPlace[];
}

/** What Clear Fleet imports (DELETE api/fleet-imports) deleted: how many Imports, visits and Geofences. */
export interface ClearedImports {
  imports: number;
  visits: number;
  /** 0 unless the Geofences were cleared too. */
  geofences: number;
}

/**
 * A Truck's stored day (GET api/trucks/:id/days/:date): its stored visits and
 * the Assignments that name it, through the Trip builder and the shared Truck
 * log function, at one moment of the day.
 */
export interface TruckLogDay {
  truckId: string;
  truckNumber: string;
  /** YYYY-MM-DD, US Eastern. */
  date: string;
  /** When the latest Import covering this Truck's day was made (ISO 8601, UTC); null when none was. The day is never built later than this. */
  asOf: string | null;
  /** The clock the day opened at, "HH:MM" US Eastern: the one asked for, else the end of a past day, else the latest Import. */
  clock: string;
  /** The moment the day is built at (ISO 8601, UTC): the end of the clock's minute, no later than asOf. */
  at: string;
  /** The day is over: its date is before today and the clock is at its end, so the Truck stopped wherever it last stopped. */
  dayOver: boolean;
  /** Every Place, as the Trip builder takes them, to name where Trips went. */
  places: TripPlace[];
  /** The Trip builder's day: Trips, Unplanned work, ties and the Truck log's header (truckDay). */
  tripDay: TripDay;
  /** Each Assignment's label ("A1", in Dave's order) by id, discarded ones included, for the Trip log. */
  labels: Record<string, string>;
  /** The Assignments shown (Assigned, naming this Truck, not discarded), in Dave's order, on their route at `at`, each with its Trip part. */
  assignments: Assignment[];
  /** The Truck log's body (shared/truckLog.ts), one column per shown Assignment. */
  truckLog: TruckLogBody;
  /** Every geofence code in the day's stored visits that no active Place has, as an Import lists them. */
  codesWithNoPlace: CodeWithNoPlace[];
  /** The Unplanned work, each with the Driver at its time, and the ties, as the lanes show them (the same as the day read's). */
  lanes: DayLanes;
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
