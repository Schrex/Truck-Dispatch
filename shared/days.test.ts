import { describe, expect, it } from 'vitest';
import {
  addDays,
  arrows,
  dayLabel,
  dayWord,
  holidayName,
  isCalendarDate,
  isWorkingDay,
  mondayOf,
  nextWorkingDay,
  previousWorkingDay,
  shortDate,
  dayState,
  unassignedOn,
  sinceSent,
  stateWord,
  weekDates,
  weekSpan,
} from './days';

describe('Working days', () => {
  it.each([
    ['a Monday', '2026-11-16'],
    ['a Wednesday', '2026-11-18'],
    ['a Friday', '2026-11-20'],
    ['the day after Thanksgiving', '2026-11-27'],
    ['Christmas Eve', '2026-12-24'],
  ])('counts %s as a Working day', (_day, date) => {
    expect(isWorkingDay(date)).toBe(true);
  });

  it.each([
    ['a Saturday', '2026-11-21'],
    ['a Sunday', '2026-11-22'],
  ])('does not count %s', (_day, date) => {
    expect(isWorkingDay(date)).toBe(false);
  });

  // Each Holiday in several years, its date worked out by rule.
  it.each([
    ["New Year's Day", '2026-01-01'],
    ["New Year's Day", '2027-01-01'],
    ["New Year's Day", '2030-01-01'],
    ['Memorial Day', '2025-05-26'],
    ['Memorial Day', '2026-05-25'],
    ['Memorial Day', '2027-05-31'],
    ['Independence Day', '2025-07-04'],
    ['Independence Day', '2028-07-04'],
    ['Labor Day', '2025-09-01'],
    ['Labor Day', '2026-09-07'],
    ['Labor Day', '2027-09-06'],
    ['Thanksgiving', '2025-11-27'],
    ['Thanksgiving', '2026-11-26'],
    ['Thanksgiving', '2027-11-25'],
    ['Thanksgiving', '2028-11-23'],
    ['Christmas', '2025-12-25'],
    ['Christmas', '2028-12-25'],
  ])('names %s on %s and does not count it as a Working day', (name, date) => {
    expect(holidayName(date)).toBe(name);
    expect(isWorkingDay(date)).toBe(false);
  });

  it.each([
    ['the Monday a week before Memorial Day', '2026-05-18'],
    ['the Thursday a week before Thanksgiving', '2026-11-19'],
    ['the last Monday of August', '2026-08-31'],
    ['the Thursday after Thanksgiving week', '2026-12-03'],
  ])('names no Holiday on %s', (_day, date) => {
    expect(holidayName(date)).toBeNull();
  });

  it('keeps a Holiday on its weekend day rather than moving it', () => {
    expect(holidayName('2027-12-25')).toBe('Christmas');
    expect(holidayName('2027-07-04')).toBe('Independence Day');
    expect(holidayName('2027-12-24')).toBeNull();
    expect(holidayName('2027-07-05')).toBeNull();
    expect(isWorkingDay('2027-12-24')).toBe(true);
    expect(isWorkingDay('2027-07-05')).toBe(true);
  });
});

describe('the next and previous Working day', () => {
  it.each([
    ['a Thursday', '2026-11-19', '2026-11-20'],
    ['a Friday, passing the weekend', '2026-11-20', '2026-11-23'],
    ['a Saturday', '2026-11-21', '2026-11-23'],
    ['the day before Thanksgiving, passing it', '2026-11-25', '2026-11-27'],
    ['the Friday before Memorial Day, passing the weekend and the Holiday', '2026-05-22', '2026-05-26'],
    ['the Friday before Labor Day', '2027-09-03', '2027-09-07'],
    ["New Year's Eve, passing New Year's Day and the weekend", '2026-12-31', '2027-01-04'],
  ])('after %s is the next one anyone works', (_day, date, next) => {
    expect(nextWorkingDay(date)).toBe(next);
  });

  it.each([
    ['a Tuesday', '2026-11-17', '2026-11-16'],
    ['a Monday, passing the weekend', '2026-11-23', '2026-11-20'],
    ['a Sunday', '2026-11-22', '2026-11-20'],
    ['the day after Thanksgiving, passing it', '2026-11-27', '2026-11-25'],
    ['the Tuesday after Memorial Day, passing the Holiday and the weekend', '2026-05-26', '2026-05-22'],
    ["the Monday after New Year's Day", '2027-01-04', '2026-12-31'],
  ])('before %s is the last one anyone worked', (_day, date, previous) => {
    expect(previousWorkingDay(date)).toBe(previous);
  });
});

describe('the word for a day', () => {
  // Today is Thursday, November 19, 2026.
  it.each([
    ['2026-11-19', 'Today'],
    ['2026-11-20', 'Tomorrow'],
    ['2026-11-18', 'Yesterday'],
    ['2026-11-21', 'This Saturday'],
    ['2026-11-22', 'This Sunday'],
    ['2026-11-16', 'This Monday'],
    ['2026-11-23', 'Next Monday'],
    ['2026-11-26', 'Next Thursday'],
    ['2026-11-29', 'Next Sunday'],
    ['2026-11-13', 'Last Friday'],
    ['2026-11-09', 'Last Monday'],
    ['2026-11-30', null],
    ['2026-11-08', null],
    ['2027-11-19', null],
  ])('on a Thursday calls %s %s', (date, word) => {
    expect(dayWord(date, '2026-11-19')).toBe(word);
  });

  it('on a Friday calls the Monday after the weekend Next Monday', () => {
    expect(dayWord('2026-11-23', '2026-11-20')).toBe('Next Monday');
    expect(dayWord('2026-11-21', '2026-11-20')).toBe('Tomorrow');
  });

  it('on a Monday calls the Friday before the weekend Last Friday and the day before Yesterday', () => {
    expect(dayWord('2026-11-20', '2026-11-23')).toBe('Last Friday');
    expect(dayWord('2026-11-22', '2026-11-23')).toBe('Yesterday');
    expect(dayWord('2026-11-21', '2026-11-23')).toBe('Last Saturday');
  });

  it('on a Sunday calls the next day Tomorrow and the rest of the coming week Next', () => {
    expect(dayWord('2026-11-23', '2026-11-22')).toBe('Tomorrow');
    expect(dayWord('2026-11-24', '2026-11-22')).toBe('Next Tuesday');
    expect(dayWord('2026-11-16', '2026-11-22')).toBe('This Monday');
  });

  it('works across a year boundary', () => {
    expect(dayWord('2027-01-01', '2026-12-31')).toBe('Tomorrow');
    expect(dayWord('2027-01-04', '2026-12-31')).toBe('Next Monday');
    expect(dayWord('2026-12-28', '2027-01-01')).toBe('This Monday');
  });
});

describe('short dates', () => {
  it.each([
    ['2026-11-23', 'Mon, Nov 23', 'Mon 23'],
    ['2026-11-16', 'Mon, Nov 16', 'Mon 16'],
    ['2026-11-26', 'Thu, Nov 26', 'Thu 26'],
    ['2027-01-01', 'Fri, Jan 1', 'Fri 1'],
    ['2026-02-28', 'Sat, Feb 28', 'Sat 28'],
  ])('writes %s as "%s" in the header and "%s" on an arrow', (date, header, arrow) => {
    expect(shortDate(date)).toBe(header);
    expect(dayLabel(date)).toBe(arrow);
  });
});

describe('the arrows', () => {
  it.each([
    ['a Wednesday', '2026-11-18', ['2026-11-17', 'Tue 17'], ['2026-11-19', 'Thu 19']],
    ['a Friday, the next arrow passing the weekend', '2026-11-20', ['2026-11-19', 'Thu 19'], ['2026-11-23', 'Mon 23']],
    ['a Monday, the previous arrow passing the weekend', '2026-11-23', ['2026-11-20', 'Fri 20'], ['2026-11-24', 'Tue 24']],
    ['a Saturday', '2026-11-21', ['2026-11-20', 'Fri 20'], ['2026-11-23', 'Mon 23']],
    ['the day before Thanksgiving', '2026-11-25', ['2026-11-24', 'Tue 24'], ['2026-11-27', 'Fri 27']],
    ['Thanksgiving itself', '2026-11-26', ['2026-11-25', 'Wed 25'], ['2026-11-27', 'Fri 27']],
    ['the Friday before Memorial Day', '2026-05-22', ['2026-05-21', 'Thu 21'], ['2026-05-26', 'Tue 26']],
  ])('on %s go to the Working days either side and name them', (_day, date, previous, next) => {
    expect(arrows(date)).toEqual({
      previous: { date: previous[0], label: previous[1] },
      next: { date: next[0], label: next[1] },
    });
  });
});

describe('weeks', () => {
  it.each([
    ['2026-11-16', '2026-11-16'],
    ['2026-11-19', '2026-11-16'],
    ['2026-11-22', '2026-11-16'],
    ['2026-11-23', '2026-11-23'],
    ['2027-01-01', '2026-12-28'],
  ])('starts the week of %s on Monday %s', (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });

  it('runs Monday to Sunday, across a month and a year', () => {
    expect(weekDates('2026-12-28')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });

  it.each([
    ['2026-11-16', 'Nov 16 to Nov 22'],
    ['2026-11-30', 'Nov 30 to Dec 6'],
    ['2026-12-28', 'Dec 28 to Jan 3'],
  ])('names the week of Monday %s on its pager as "%s"', (monday, span) => {
    expect(weekSpan(monday)).toBe(span);
  });
});

describe('dates', () => {
  it.each(['2026-11-19', '2028-02-29', '2026-12-31'])('accepts %s as a calendar date', (date) => {
    expect(isCalendarDate(date)).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-5', '20261119', '', 'tomorrow', null, 20261119])(
    'refuses %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it.each([
    ['2026-11-19', 1, '2026-11-20'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-03-07', 2, '2026-03-09'],
  ])('counts %s plus %i days as %s, across months, years and daylight saving', (date, days, result) => {
    expect(addDays(date, days)).toBe(result);
  });
});

describe('Changed and Added', () => {
  const SENT = '2026-11-20T21:15:00.000Z';
  const before = '2026-11-20T19:00:00.000Z';
  const after = '2026-11-20T22:00:00.000Z';

  it('marks nothing on a Draft day, whatever has changed', () => {
    expect(sinceSent({ createdAt: before, changedAt: after }, null)).toBeNull();
  });

  it('marks nothing that was added and last changed before the Send', () => {
    expect(sinceSent({ createdAt: before, changedAt: null }, SENT)).toBeNull();
    expect(sinceSent({ createdAt: before, changedAt: before }, SENT)).toBeNull();
  });

  it('calls one changed after the Send Changed', () => {
    expect(sinceSent({ createdAt: before, changedAt: after }, SENT)).toBe('changed');
  });

  it('calls one added after the Send Added, even once it is changed too', () => {
    expect(sinceSent({ createdAt: after, changedAt: null }, SENT)).toBe('added');
    expect(sinceSent({ createdAt: after, changedAt: '2026-11-20T23:00:00.000Z' }, SENT)).toBe('added');
  });

  it('does not count a change in the same moment as the Send as after it', () => {
    expect(sinceSent({ createdAt: before, changedAt: SENT }, SENT)).toBeNull();
  });
});

describe('day states', () => {
  const SENT = '2026-11-20T21:15:00.000Z';
  const planned = (driverId: string | null, createdAt = '2026-11-20T19:00:00.000Z', changedAt: string | null = null) => ({
    driverId,
    createdAt,
    changedAt,
    cancelledAt: null as string | null,
  });
  const cancelled = (driverId: string | null) => ({ ...planned(driverId, undefined, '2026-11-20T22:00:00.000Z'), cancelledAt: '2026-11-20T22:00:00.000Z' });

  it('is none for a day with no Assignments that was never Sent', () => {
    expect(dayState([], null)).toEqual({ state: 'none' });
  });

  it('is Draft, with the count Unassigned, for a planned day not Sent yet', () => {
    expect(dayState([planned('drv-a'), planned(null), planned(null)], null)).toEqual({ state: 'draft', unassigned: 2 });
    expect(dayState([planned('drv-a')], null)).toEqual({ state: 'draft', unassigned: 0 });
  });

  it('is Sent when nothing is Changed or Added since the Send', () => {
    expect(dayState([planned('drv-a'), planned(null)], SENT)).toEqual({ state: 'sent' });
  });

  it('is not none for a day whose only Assignments are cancelled: they are still on it', () => {
    expect(dayState([cancelled('drv-a')], SENT)).toEqual({ state: 'changed' });
    expect(dayState([cancelled(null)], null)).toEqual({ state: 'draft', unassigned: 0 });
  });

  it('does not count a cancelled Assignment Unassigned: it is off the day', () => {
    expect(dayState([planned(null), cancelled(null)], null)).toEqual({ state: 'draft', unassigned: 1 });
    expect(unassignedOn([planned(null), cancelled(null), planned('drv-a')])).toBe(1);
  });

  it('is Changed once one Assignment is Changed or Added since the Send', () => {
    expect(dayState([planned('drv-a'), planned('drv-b', undefined, '2026-11-20T22:00:00.000Z')], SENT)).toEqual({ state: 'changed' });
    expect(dayState([planned('drv-a'), planned(null, '2026-11-20T22:00:00.000Z')], SENT)).toEqual({ state: 'changed' });
  });
});

describe('a day state on its week strip tile', () => {
  it.each([
    [{ state: 'none' } as const, '–'],
    [{ state: 'draft', unassigned: 0 } as const, 'Not sent'],
    [{ state: 'draft', unassigned: 1 } as const, '1 unassigned'],
    [{ state: 'draft', unassigned: 2 } as const, '2 unassigned'],
    [{ state: 'sent' } as const, 'Sent'],
    [{ state: 'changed' } as const, 'Changed'],
  ])('reads %o as "%s"', (state, word) => {
    expect(stateWord(state)).toBe(word);
  });
});
