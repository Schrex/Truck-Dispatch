import type { ReactNode } from 'react';
import { easternTime } from '../../shared/days';
import type { TruckLogColumn, UnexplainedTrip } from '../../shared/trips';

/**
 * The Truck log's body, below its header: one column per Assignment in Dave's
 * order, like the paper's Orders 1 to 5, then the Trips no Assignment
 * explains, for Dave to answer next morning (shown, not answerable). Tons are
 * never typed: they come from the Loads' Tickets (phase 4), so until then the
 * box is blank and says so.
 */
export function TruckLogAssignments({ columns, unexplained }: { columns: TruckLogColumn[]; unexplained: UnexplainedTrip[] }) {
  return (
    <div className="space-y-4 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {columns.map((column, i) => {
          const rows: [string, ReactNode][] = [
            ['Job', column.job ?? ''],
            ['Pick up', column.pickUp ?? ''],
            ['Drop off', column.dropOff ?? ''],
            ['Material', column.material ?? ''],
            ['# of loads', String(column.loads)],
            ['# of tons', column.tons === null ? <span className="text-xs italic text-muted-foreground">from Tickets</span> : column.tons.toFixed(2)],
            ['Trucking hours', column.truckingHours === null ? '' : column.truckingHours.toFixed(2)],
          ];
          return (
            <div key={column.id} className="rounded-md border">
              <h3 className="border-b px-3 py-1 text-xs font-semibold uppercase tracking-wide">Assignment {i + 1}</h3>
              <dl role="group" aria-label={`Assignment ${i + 1}`} className="divide-y">
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
        {unexplained.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {unexplained.map((trip) => (
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
