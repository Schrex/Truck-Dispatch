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

/**
 * The lists Settings edits and the Board picks from, by their API route
 * (GET, POST api/<list>; PATCH api/<list>/<id>). Nothing is ever deleted.
 */
export interface Lists {
  drivers: Driver;
  trucks: Truck;
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
  note?: string | null;
}

/** One piece of work given to one Driver for one day, with its Driver's name resolved. */
export interface Assignment {
  id: string;
  date: string;
  driverId: string | null;
  driverName: string | null;
  truckId: string | null;
  truckNumber: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
