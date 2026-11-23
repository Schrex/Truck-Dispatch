import type { Trip, TripPlace } from '../../shared/trips';
import { easternTime } from '../../shared/days';
import { EmptyBox } from '@/components/States';
import { cn } from '@/lib/utils';

/** How each kind of Trip reads in the log; a Trip with no Assignment is for Dave to answer. */
const KIND: Record<string, { label: string; style: string }> = {
  load: { label: 'load', style: 'bg-primary text-primary-foreground' },
  empty: { label: 'empty', style: 'bg-muted text-muted-foreground' },
  null: { label: 'for Dave', style: 'bg-warning/25 text-foreground' },
  waiting: { label: 'waiting', style: 'border text-muted-foreground' },
};

/**
 * The simulation's Trip log: every Trip the Truck made, as the Trip builder
 * has it at the clock's time, the drives to and from the shop included. Each
 * says whether it was a Load or an empty drive, which Assignment it counts
 * on, and the matching rule that decided it. A Trip still "waiting" is not
 * written yet: the visit it reaches could still turn out to be a drive-through.
 */
export function TripLog({
  trips,
  places,
  assignmentLabels,
}: {
  trips: Trip[];
  places: TripPlace[];
  /** Each Assignment's label ("A1") by its id. */
  assignmentLabels: Record<string, string>;
}) {
  const placeName = (id: string | null, code: string) => places.find((p) => p.id === id)?.name ?? code;
  return (
    <section aria-label="Trip log" className="space-y-3">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Trip log</h2>
      <p className="text-sm text-muted-foreground">
        The Truck’s movements from HCSS Fleet, as Trips between Places. Why is the matching rule that decided it.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full text-sm" aria-label="Trips">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5">Left</th>
              <th className="px-2">From → To</th>
              <th className="px-2">Miles</th>
              <th className="px-2">Kind</th>
              <th className="px-2">Assignment</th>
              <th className="px-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => {
              const kind = KIND[trip.written ? String(trip.match.kind) : 'waiting'];
              return (
                <tr key={trip.leftAt} className={cn('border-t align-top', !trip.written && 'text-muted-foreground')}>
                  <td className="px-2 py-1.5 tabular-nums">{easternTime(trip.leftAt)}</td>
                  <td className="px-2 py-1.5">
                    {placeName(trip.fromPlaceId, trip.fromCode)} → {placeName(trip.toPlaceId, trip.toCode)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{trip.miles}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold', kind.style)}>{kind.label}</span>
                  </td>
                  <td className="px-2 py-1.5">{(trip.written && trip.match.assignmentId && assignmentLabels[trip.match.assignmentId]) || '–'}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{trip.written ? trip.match.reason : 'Not written yet'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trips.length === 0 && <EmptyBox>No Trips yet at this time.</EmptyBox>}
    </section>
  );
}
