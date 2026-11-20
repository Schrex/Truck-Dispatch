import { addDays, format, isValid, parseISO } from 'date-fns';

// Dates are calendar days written YYYY-MM-DD. Which day is "today" comes from
// the Worker (api/today, US Eastern time), not from the viewer's clock.

/** A real day on the calendar written YYYY-MM-DD (2026-02-30 is not). */
export function isDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISO(value);
  return isValid(date) && format(date, 'yyyy-MM-dd') === value;
}

/** 2026-11-20 + 1 → 2026-11-21 */
export function shiftDate(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd');
}

/** 2026-11-18 → Wednesday, November 18, 2026 */
export function formatDate(iso: string): string {
  return format(parseISO(iso), 'EEEE, MMMM d, yyyy');
}
