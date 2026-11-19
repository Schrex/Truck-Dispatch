/** Shapes the API takes and returns, shared by the Worker and the page. */

export interface Driver {
  id: string;
  name: string;
}

/** What the New Order form sends. */
export interface NewOrder {
  workDate: string;
  startTime?: string | null;
  job: string;
  work: string;
  pickup?: string;
  dropoff?: string;
  driverId: string;
  truckNumber?: string | null;
  notes?: string;
}

export interface Order {
  id: string;
  workDate: string;
  startTime: string | null;
  job: string;
  work: string;
  pickup: string;
  dropoff: string;
  driverId: string;
  driverName: string;
  truckNumber: string | null;
  notes: string;
  createdAt: string;
}
