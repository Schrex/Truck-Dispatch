import type { Assignment, DriverAssignment } from '../../shared/types';
import { shortDate } from '../../shared/days';
import { DriverCard } from '@/components/DriverCard';

/** One Driver's phone in the Driver view: his name and his Assignments that day, in Dave's order. */
export type DriverPhone = { driverId: string; driverName: string; assignments: Assignment[] };

/**
 * The Driver view: each Driver's Today as his phone shows it, on the real
 * Driver cards, each with the Trip part the Trip builder works out at the
 * clock's time. It knows nothing of what Dave changed after Assigning, so no
 * card says what a field was. The Simulation shows Randy's phone; the Fleet
 * imports page one for each Driver on the stored day.
 */
export function DriverView({ date, phones }: { date: string; phones: DriverPhone[] }) {
  return (
    <section aria-label="Driver view" className="space-y-3">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Driver view</h2>
      {phones.map((phone) => {
        const cards: DriverAssignment[] = phone.assignments.map((assignment) => ({ ...assignment, was: {} }));
        return (
          <div key={phone.driverId} className="max-w-md space-y-3 rounded-2xl border bg-background p-4">
            <p className="text-sm text-muted-foreground">
              {phone.driverName} · Today, {shortDate(date)}
            </p>
            {cards.map((assignment) => (
              <DriverCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
