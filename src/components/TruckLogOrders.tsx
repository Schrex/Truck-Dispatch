import type { ReactNode } from 'react';
import { easternTime } from '../../shared/trips';

/** One Assignment as a column of the paper log (its "Order"), ready to write in. */
export interface TruckLogOrder {
  id: string;
  /** "J25008 Los Flamboyanes"; null when neither Place belongs to a Job. */
  job: string | null;
  pickUp: string | null;
  dropOff: string | null;
  material: string | null;
  loads: number;
  /** Null until it has a Trip. */
  truckingHours: number | null;
}

/** A Trip no Assignment explains, as Dave reads it. */
export interface TripForDave {
  leftAt: string;
  arrivedAt: string;
  /** Where from and to: the Place's short name, else Fleet's geofence code. */
  from: string;
  to: string;
}

/**
 * The Truck log's body, below its header: one column per Assignment in Dave's
 * order, like the paper's Order 1 to 5, then the Trips no Assignment
 * explains, for Dave to answer next morning (shown, not answerable). Tons are
 * never typed: they come from the Loads' Tickets (phase 4), so the box is
 * blank and says so.
 */
export function TruckLogOrders({ orders, tripsForDave }: { orders: TruckLogOrder[]; tripsForDave: TripForDave[] }) {
  return (
    <div className="space-y-4 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {orders.map((order, i) => {
          const rows: [string, ReactNode][] = [
            ['Job', order.job ?? ''],
            ['Pick-up', order.pickUp ?? ''],
            ['Drop-off', order.dropOff ?? ''],
            ['Material', order.material ?? ''],
            ['# of loads', String(order.loads)],
            ['# of tons', <span className="text-xs italic text-muted-foreground">from Tickets</span>],
            ['Trucking hours', order.truckingHours === null ? '' : order.truckingHours.toFixed(2)],
          ];
          return (
            <div key={order.id} className="rounded-md border">
              <h3 className="border-b px-3 py-1 text-xs font-semibold uppercase tracking-wide">Order {i + 1}</h3>
              <dl role="group" aria-label={`Order ${i + 1}`} className="divide-y">
                {rows.map(([label, value]) => (
                  <div key={label} className="px-3 py-1.5">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="min-h-6 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <div role="group" aria-label="Trips with no Assignment" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trips with no Assignment</h3>
        {tripsForDave.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tripsForDave.map((trip) => (
              <li key={trip.leftAt}>
                {easternTime(trip.leftAt)}–{easternTime(trip.arrivedAt)} · {trip.from} → {trip.to}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
