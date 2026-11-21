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

/**
 * Anywhere a Truck loads, dumps or parks. Its geofence code (for GPS later) is
 * not part of the API; onTruckMap says whether it has one, and is never saved.
 */
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
}
export type ListName = keyof Lists;

/**
 * What the page sends to add an entry (the display name is required; active
 * defaults to true) or to change one (only the fields to change). The order is
 * set for a whole list at once (PUT api/<list>/order), never per entry.
 */
export type EntryFields<L extends ListName> = Partial<Omit<Lists[L], 'id' | 'onTruckMap' | 'sortOrder'>>;

/** The lists Dave puts in his own order. */
export const ORDERED_LISTS = ['drivers', 'places', 'materials'] as const satisfies readonly ListName[];
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
  /** Whether it is Changed or Added since its day was Sent; null on a Draft day or when neither. */
  sinceSent: SinceSent;
}

/**
 * What an Assignment is since its day was Sent: Changed (altered after the
 * Send) or Added (made after it). The board marks it, and the Driver sees
 * "Changed by Dave" or "Added by Dave".
 */
export type SinceSent = 'changed' | 'added' | null;

/** A day's Assignments and when it was first Sent, null while it is a Draft (GET api/assignments?date=). */
export interface Day {
  assignments: Assignment[];
  sentAt: string | null;
}

/**
 * One day on the week strip: its state by the shared day rules (none, Draft,
 * Sent or Changed), how many of its Assignments are Unassigned, and the
 * Holiday on it, if any.
 */
export interface WeekDay {
  date: string;
  state: 'none' | 'draft' | 'sent' | 'changed';
  unassigned: number;
  holiday: string | null;
}

/** A week's seven days, Monday to Sunday (GET api/weeks/:monday). */
export interface Week {
  days: WeekDay[];
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
