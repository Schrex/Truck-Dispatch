import { format, parseISO } from 'date-fns';

/** Today in the viewer's time zone, as YYYY-MM-DD. */
export function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** 2026-11-18 → Wednesday, November 18, 2026 */
export function formatDate(iso: string): string {
  return format(parseISO(iso), 'EEEE, MMMM d, yyyy');
}

/** 07:30 → 7:30 AM */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
