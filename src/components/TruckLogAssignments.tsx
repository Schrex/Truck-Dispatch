import type { ReactNode } from 'react';
import { EmptyBox } from '@/components/States';
import { easternTime } from '../../shared/days';
import type { TruckLogColumn, TruckLogTrip } from '../../shared/trips';

/** What an unverified column says where only Dave can answer. */
const forDave = <span className="text-sm italic text-warning-foreground">Unknown · Dave decides</span>;

/**
 * The Truck log's body, below its header: one column per Assignment in Dave's
 * order, like the paper's Orders 1 to 5, then one column per extra job no
 * Assignment explains, marked unverified: whether it was a Load and of what,
 * Dave decides (shown, not answerable yet). Then the drives to and from the
 * shop: leaving in the morning, getting back at the end of the day. Tons are
 * never typed: they come from the Loads' Tickets (phase 4), so until then the
 * box is blank and says so.
 */
export function TruckLogAssignments({ columns, shopTrips }: { columns: TruckLogColumn[]; shopTrips: TruckLogTrip[] }) {
  return (
    <div className="space-y-4 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {columns.map((column, i) => {
          const name = `Assignment ${i + 1}${column.unverified ? ' · unverified' : ''}`;
          const rows: [string, ReactNode][] = [
            ['Job', column.job ?? ''],
            ['Pick up', column.pickUp ?? ''],
            ['Drop off', column.dropOff ?? ''],
            ['Material', column.unverified ? forDave : (column.material ?? '')],
            ['# of loads', column.loads === null ? forDave : String(column.loads)],
            ['# of tons', column.tons === null ? <span className="text-xs italic text-muted-foreground">from Tickets</span> : column.tons.toFixed(2)],
            ['Trucking hours', column.truckingHours === null ? '' : column.truckingHours.toFixed(2)],
          ];
          return (
            <div key={column.id} className={column.unverified ? 'rounded-md border border-warning bg-warning/10' : 'rounded-md border'}>
              <h3 className="border-b px-3 py-1 text-xs font-semibold uppercase tracking-wide">{name}</h3>
              <dl role="group" aria-label={name} className="divide-y">
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
      <div role="group" aria-label="To and from the shop" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To and from the shop</h3>
        {shopTrips.length === 0 ? (
          <EmptyBox>None yet</EmptyBox>
        ) : (
          <ul className="space-y-1 text-sm">
            {shopTrips.map((trip) => (
              <li key={trip.leftAt}>
                {easternTime(trip.leftAt)}–{easternTime(trip.arrivedAt)} · {trip.from} → {trip.to} · {trip.miles} mi · empty
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
