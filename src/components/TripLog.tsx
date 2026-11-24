import { NOT_A_HAUL, type Trip, type TripPlace } from '../../shared/trips';
import { easternTime } from '../../shared/days';
import { EmptyBox } from '@/components/States';
import { cn } from '@/lib/utils';

/** How each kind of Trip reads in the log; a Trip with no Assignment is for Dave to answer. */
const KIND: Record<string, { label: string; style: string }> = {
  load: { label: 'load', style: 'bg-primary text-primary-foreground' },
  empty: { label: 'empty', style: 'bg-muted text-muted-foreground' },
  // An At Trip: the label names its At, "at TIUNY".
  at: { label: 'at', style: 'bg-secondary text-secondary-foreground' },
  [NOT_A_HAUL]: { label: 'not a haul', style: 'bg-muted text-muted-foreground italic' },
  null: { label: 'for Dave', style: 'bg-warning/25 text-foreground' },
};

/**
 * The simulation's Trip log: every Trip the Truck made, as the Trip builder
 * has it at the clock's time, the drives to and from the shop included. Each
 * says whether it was a Load, an empty drive or an At Trip ("at TIUNY"), which Assignment it counts
 * on, and the matching rule that decided it. A Trip counts as soon as the
 * Truck arrives; visits to fences on the Not considered list never make one.
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
              const kind = KIND[String(trip.match.kind)];
              return (
                <tr key={trip.leftAt} className="border-t align-top">
                  <td className="px-2 py-1.5 tabular-nums">{easternTime(trip.leftAt)}</td>
                  <td className="px-2 py-1.5">
                    {placeName(trip.fromPlaceId, trip.fromCode)} → {placeName(trip.toPlaceId, trip.toCode)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{trip.miles}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold', kind.style)}>
                      {trip.match.atPlaceId ? `at ${placeName(trip.match.atPlaceId, '')}` : kind.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{(trip.match.assignmentId && assignmentLabels[trip.match.assignmentId]) || '–'}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{trip.match.reason}</td>
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
