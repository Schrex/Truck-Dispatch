import type { Assignment, DriverAssignment } from '../../shared/types';
import { shortDate } from '../../shared/days';
import { DriverCard } from '@/components/DriverCard';

/**
 * The simulation's Driver view: the Driver's Today as his phone shows it, on
 * the real Driver cards, each with the Trip part the Trip builder works out at
 * the clock's time. The simulation knows nothing of what Dave changed after
 * Assigning, so no card says what a field was.
 */
export function DriverView({ driverName, date, assignments }: { driverName: string; date: string; assignments: Assignment[] }) {
  const cards: DriverAssignment[] = assignments.map((assignment) => ({ ...assignment, was: {} }));
  return (
    <section aria-label="Driver view" className="space-y-3">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Driver view</h2>
      <div className="max-w-md space-y-3 rounded-2xl border bg-background p-4">
        <p className="text-sm text-muted-foreground">{driverName} · Today, {shortDate(date)}</p>
        {cards.map((assignment) => (
          <DriverCard key={assignment.id} assignment={assignment} />
        ))}
      </div>
    </section>
  );
}
