import type { ReactNode } from 'react';
import type { Truck } from '../../shared/types';
import { easternTime, type TruckDay } from '../../shared/trips';

/** "Mon 16 Nov 2026" for "2026-11-16", as the paper log's date. */
function paperDate(date: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(
    new Date(`${date}T12:00:00Z`),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

/** Odometer as the paper has it: one decimal, "258,050.6". */
const miles = (n: number | null) => (n === null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function driverText(day: TruckDay): string {
  if (day.driver) return day.driver.name;
  return day.driverCandidates.length > 1 ? 'Who was driving?' : '';
}

/**
 * The Truck log: the paper Daily Truck Log for one Truck and day, filled in
 * from the Trip builder's Truck day. This is its header (Truck, date, start
 * and end time, start and end miles, Driver, Total hours); a box stays blank
 * until what goes in it is known. The Assignment columns and the Trips no
 * Assignment explains go in `children`, below the header.
 */
export function TruckLog({ truck, date, truckDay, children }: { truck: Truck; date: string; truckDay: TruckDay; children?: ReactNode }) {
  const boxes: [string, string][] = [
    ['Truck', truck.hcssCode ? `${truck.number} (${truck.hcssCode})` : truck.number],
    ['Date', paperDate(date)],
    ['Start time', truckDay.startAt ? easternTime(truckDay.startAt) : ''],
    ['End time', truckDay.endAt ? easternTime(truckDay.endAt) : ''],
    ['Start miles', miles(truckDay.startMiles)],
    ['End miles', miles(truckDay.endMiles)],
    ['Driver', driverText(truckDay)],
    ['Total hours', truckDay.totalHours === null ? '' : truckDay.totalHours.toFixed(2)],
  ];
  return (
    <section aria-label="Truck log" className="space-y-3">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Truck log</h2>
      <div className="rounded-md border bg-background">
        <dl role="group" aria-label="Truck log header" className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {boxes.map(([label, value]) => (
            <div key={label} className="bg-background px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className={`min-h-6 font-medium ${value === 'Who was driving?' ? 'text-destructive' : ''}`}>{value}</dd>
            </div>
          ))}
        </dl>
        {children}
      </div>
    </section>
  );
}
