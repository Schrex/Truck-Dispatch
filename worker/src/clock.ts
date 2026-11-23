import type { Env } from './app';
import { addDays, businessDateOf, nextWorkingDay } from '../../shared/days';

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
  const today = businessDateOf(now);
  return { now, today, tomorrow: addDays(today, 1), nextWorkingDay: nextWorkingDay(today) };
}
