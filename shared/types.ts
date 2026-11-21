/** Shapes the API takes and returns, shared by the Worker and the page. */

export interface Driver {
  id: string;
  name: string;
  /** The usual Truck, filled in on a new Assignment when the Driver is picked. */
  defaultTruckId: string | null;
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

/** Anywhere a Truck loads, dumps or parks. Its geofence code (for GPS later) is not part of the API. */
export interface Place {
  id: string;
  shortName: string;
  fullName: string | null;
  kind: PlaceKind | null;
  jobId: string | null;
  active: boolean;
}

/** What a Load carries, e.g. 2" minus. */
export interface Material {
  id: string;
  name: string;
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
 * defaults to true) or to change one (only the fields to change).
 */
export type EntryFields<L extends ListName> = Partial<Omit<Lists[L], 'id'>>;

/** Today and tomorrow in US Eastern time (GET api/today). */
export interface BusinessDay {
  today: string;
  tomorrow: string;
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
  createdAt: string;
  updatedAt: string;
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
