import type { ReactNode } from 'react';
import { FROM_THE_TRUCK, MARK_PILL } from '@/components/AssignmentBlock';
import { EmptyBox } from '@/components/States';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { easternTime } from '../../shared/days';
import type { TruckLogColumn, TruckLogTrip, TruckLogUnplanned, TruckLogWhichAssignment } from '../../shared/trips';

/** "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h": no direction, as the Truck cannot tell one. */
export function unplannedLine(work: TruckLogUnplanned): string {
  const out = work.tripsLeftAt[0];
  const back = work.tripsLeftAt.length > 1 ? work.tripsLeftAt.at(-1)! : null;
  const times = `out ${easternTime(out)}${back ? `, back ${easternTime(back)}` : ''}`;
  return `${work.places.join(' ⇄ ')} · ${times} · ${work.truckingHours.toFixed(2)} h`;
}

/**
 * The Truck log's body, below its header: one column per Assignment in Dave's
 * order, like the paper's Orders 1 to 5, then an amber box per piece of
 * Unplanned work, with its Places and times only, for Dave to answer (with
 * onAnswer, its Answer button opens the answer), and the Trips two
 * Assignments fit equally, each asked "Which Assignment? A2 or A3" (shown
 * only: answering one is not built yet). An Assignment Dave made from
 * Unplanned work is an ordinary column, marked From the Truck. Then the drives to and from the shop: leaving in the
 * morning, getting back at the end of the day. Tons are never typed: they come
 * from the Loads' Tickets (phase 4), so until then the box is blank and says so.
 */
export function TruckLogAssignments({
  columns,
  unplanned,
  whichAssignment = [],
  shopTrips,
  onAnswer,
}: {
  columns: TruckLogColumn[];
  unplanned: TruckLogUnplanned[];
  /** The ties: planned work Dave picks the Assignment of. */
  whichAssignment?: TruckLogWhichAssignment[];
  shopTrips: TruckLogTrip[];
  /** Dave taps Answer on a piece of Unplanned work (by its id). */
  onAnswer?: (unplannedId: string) => void;
}) {
  return (
    <div className="space-y-4 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {columns.map((column, i) => {
          const name = `Assignment ${i + 1}${column.fromTheTruck ? ` · ${FROM_THE_TRUCK.word}` : ''}`;
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
              <h3 className="flex items-center gap-2 border-b px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Assignment {i + 1}
                {column.fromTheTruck && (
                  <span className={cn(MARK_PILL, FROM_THE_TRUCK.className, 'normal-case tracking-normal')}>{FROM_THE_TRUCK.word}</span>
                )}
              </h3>
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
        {unplanned.map((work, i) => {
          const name = unplanned.length > 1 ? `Unplanned work ${i + 1}` : 'Unplanned work';
          return (
            <div key={work.id} role="group" aria-label={name} className="rounded-md border border-warning bg-warning/10">
              <h3 className="border-b border-warning px-3 py-1 text-xs font-semibold uppercase tracking-wide">Unplanned work</h3>
              <p className="px-3 py-1.5 font-medium">{unplannedLine(work)}</p>
              {onAnswer && (
                <div className="flex justify-end px-3 pb-3">
                  <Button type="button" variant="outline" size="lg" onClick={() => onAnswer(work.id)}>
                    Answer
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {whichAssignment.length > 0 && (
          <div role="group" aria-label="Which Assignment?" className="rounded-md border border-warning bg-warning/10">
            <h3 className="border-b border-warning px-3 py-1 text-xs font-semibold uppercase tracking-wide">Which Assignment?</h3>
            <ul className="space-y-1 px-3 py-1.5 text-sm font-medium">
              {whichAssignment.map((q) => (
                <li key={q.id}>
                  Which Assignment? {q.candidates.join(' or ')} · {easternTime(q.id)} {q.from} → {q.to}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div role="group" aria-label="To and from the shop" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To and from the shop</h3>
        {shopTrips.length === 0 ? (
          <EmptyBox>None yet</EmptyBox>
        ) : (
          <ul className="space-y-1 text-sm">
            {shopTrips.map((trip) => (
              <li key={trip.leftAt}>
                {easternTime(trip.leftAt)}–{easternTime(trip.arrivedAt)} · {trip.from} → {trip.to}{trip.miles === null ? '' : ` · ${trip.miles} mi`} · empty
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
