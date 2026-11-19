/** Shapes the API takes and returns, shared by the Worker and the page. */

export interface Driver {
  id: string;
  name: string;
}

/** Today and tomorrow in US Eastern time (GET api/today). */
export interface BusinessDay {
  today: string;
  tomorrow: string;
}

/** What the page sends to add an Assignment. Only the date is required. */
export interface NewAssignment {
  date: string;
  driverId?: string | null;
  note?: string | null;
}

/** One piece of work given to one Driver for one day, with its Driver's name resolved. */
export interface Assignment {
  id: string;
  date: string;
  driverId: string | null;
  driverName: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A refusal: each field that is wrong, with a plain message. */
export interface FieldErrorsBody {
  error: 'invalid';
  fields: Record<string, string>;
}
