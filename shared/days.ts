/**
 * Day rules shared by the Worker and the page, following the Daily Schedule's
 * day navigation. A date is a calendar day written YYYY-MM-DD with no time of
 * day; which day is today always comes from the Worker's clock (US Eastern),
 * so every rule that depends on it takes `today` as an argument.
 *
 * Plain date arithmetic on UTC midnights, no date library, so the same code
 * runs in the Worker and in the browser whatever the viewer's time zone.
 */

/** A real day on the calendar written YYYY-MM-DD (2026-02-30 is not). Checks what a request or an address gives. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parts(value);
  return dateOf(y, m, d) === value;
}

/** A date's year, month (1 to 12) and day as numbers. */
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** A date from its year, month (1 to 12) and day, overflowing into the next month or year as the calendar does. */
function dateOf(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** 0 for Sunday to 6 for Saturday, as the calendar's own week is numbered. */
function weekday(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 2026-12-31 + 1 → 2027-01-01. Plain calendar arithmetic; a negative count goes back. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return dateOf(y, m, d + days);
}

/** The nth (1 = first) given weekday of a month, e.g. the fourth Thursday of November. */
function nthWeekday(year: number, month: number, day: number, n: number): string {
  const first = dateOf(year, month, 1);
  return addDays(first, ((day - weekday(first) + 7) % 7) + 7 * (n - 1));
}

/** The last given weekday of a month, e.g. the last Monday of May. */
function lastWeekday(year: number, month: number, day: number): string {
  const last = dateOf(year, month + 1, 0);
  return addDays(last, -((weekday(last) - day + 7) % 7));
}

const MONDAY = 1;
const THURSDAY = 4;

/**
 * The six Holidays in a year, by rule, the same as the Daily Schedule's. A
 * Holiday on a weekend stays there: no weekday off is given in its place.
 */
function holidays(year: number): Record<string, string> {
  return {
    [dateOf(year, 1, 1)]: "New Year's Day",
    [lastWeekday(year, 5, MONDAY)]: 'Memorial Day',
    [dateOf(year, 7, 4)]: 'Independence Day',
    [nthWeekday(year, 9, MONDAY, 1)]: 'Labor Day',
    [nthWeekday(year, 11, THURSDAY, 4)]: 'Thanksgiving',
    [dateOf(year, 12, 25)]: 'Christmas',
  };
}

/** The Holiday on a date ("Thanksgiving"), or null on any other day. */
export function holidayName(date: string): string | null {
  return holidays(parts(date)[0])[date] ?? null;
}

/** A weekday that is not a Holiday. Weekends and Holidays can still be planned; they are only skipped by the arrows. */
export function isWorkingDay(date: string): boolean {
  const day = weekday(date);
  return day !== 0 && day !== 6 && holidayName(date) === null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday a date's week starts on; weeks run Monday to Sunday, as on the week strip. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Whole days from one date to another (negative when `to` is earlier). */
function daysFrom(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * The word for a date relative to today: Today, Tomorrow and Yesterday first;
 * otherwise "This", "Last" or "Next" and the weekday, by whether the date is in
 * today's week, the week before or the week after (weeks run Monday to
 * Sunday). Further away there is no word, and null says so.
 */
export function dayWord(date: string, today: string): string | null {
  const days = daysFrom(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const weeks = daysFrom(mondayOf(today), mondayOf(date)) / 7;
  const name = WEEKDAYS[weekday(date)];
  if (weeks === 0) return `This ${name}`;
  if (weeks === -1) return `Last ${name}`;
  if (weeks === 1) return `Next ${name}`;
  return null;
}

/** "Mon, Nov 23": the date in the header, with no year, as on the Daily Schedule. */
export function shortDate(date: string): string {
  const [, m, d] = parts(date);
  return `${WEEKDAYS[weekday(date)].slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

/** "Mon 16": a day named on an arrow (and, later, on its week strip tile). */
export function dayLabel(date: string): string {
  return `${WEEKDAYS[weekday(date)].slice(0, 3)} ${parts(date)[2]}`;
}

/** Where an arrow goes and the name it shows. */
export interface ArrowTarget {
  date: string;
  label: string;
}

/** The arrows either side of a day: each goes to the Working day before or after it, skipping weekends and Holidays, and names it. */
export function arrows(date: string): { previous: ArrowTarget; next: ArrowTarget } {
  const previous = previousWorkingDay(date);
  const next = nextWorkingDay(date);
  return { previous: { date: previous, label: dayLabel(previous) }, next: { date: next, label: dayLabel(next) } };
}

/** The first Working day after a date, passing weekends and Holidays: after a Friday, the Monday. */
export function nextWorkingDay(date: string): string {
  let day = addDays(date, 1);
  while (!isWorkingDay(day)) day = addDays(day, 1);
  return day;
}

/** The last Working day before a date, passing weekends and Holidays: before a Monday, the Friday. */
export function previousWorkingDay(date: string): string {
  let day = addDays(date, -1);
  while (!isWorkingDay(day)) day = addDays(day, -1);
  return day;
}
