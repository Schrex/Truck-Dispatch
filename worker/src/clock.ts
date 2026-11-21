import type { Env } from './app';
import { addDays, nextWorkingDay } from '../../shared/days';

/** The business runs on US Eastern time: "today" there decides tomorrow's board and which days are past. */
const BUSINESS_TIME_ZONE = 'America/New_York';

const businessDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface Clock {
  /** The current moment. */
  now: Date;
  /** Today's date in US Eastern time, YYYY-MM-DD. */
  today: string;
  /** The day after today, YYYY-MM-DD. */
  tomorrow: string;
  /** The first Working day after today (on a Friday, the Monday): the day the board opens on. */
  nextWorkingDay: string;
}

/**
 * The current time as the Worker's logic sees it. It comes from the
 * environment: `NOW` (an ISO 8601 moment) fixes it, as the tests do; unset, as
 * when deployed, or set to something that is not a moment, it is the real clock.
 */
export function clock(env: Pick<Env, 'NOW'>): Clock {
  const fixed = env.NOW ? new Date(env.NOW) : null;
  const now = fixed && !Number.isNaN(fixed.getTime()) ? fixed : new Date();
  const today = businessDate.format(now);
  return { now, today, tomorrow: addDays(today, 1), nextWorkingDay: nextWorkingDay(today) };
}
