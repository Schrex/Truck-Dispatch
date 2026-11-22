// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { weekDates } from '../../shared/days';
import type { DriverAssignment, DriverDay } from '../../shared/types';

/**
 * The API as a Driver's phone sees it: today in US Eastern is Thursday
 * 2026-11-19 (a test can move it on), two active Drivers and a removed one,
 * and each Driver's day as the Worker reads it, a Draft unless a test Sends it.
 */
const THURSDAY = { today: '2026-11-19', tomorrow: '2026-11-20', nextWorkingDay: '2026-11-20' };
let businessDay = THURSDAY;
const SENT_AT = '2026-11-18T21:15:00.000Z';
const drivers = [
  { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', sortOrder: null, active: true },
  { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: 'trk-24', sortOrder: null, active: true },
  { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: null, sortOrder: null, active: false },
];
/** Each Driver's Sent days, by Driver and date: his Assignments on it. A day not here is a Draft. */
let sentDays: Record<string, DriverAssignment[]> = {};
let failDriverDays = false;
const read: string[] = [];

const api = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const path = url.pathname;
  if (path.endsWith('/api/today')) return answer(businessDay);
  const next = /\/api\/drivers\/([^/]+)\/next-sent$/.exec(path);
  if (next) {
    const dates = Object.entries(sentDays)
      .filter(([key, list]) => key.startsWith(`${next[1]} `) && list.some((a) => !a.cancelledAt))
      .map(([key]) => key.split(' ')[1])
      .filter((date) => date > businessDay.tomorrow)
      .sort();
    return answer({ date: dates[0] ?? null });
  }
  const driverDay = /\/api\/drivers\/([^/]+)\/days\/([^/]+)$/.exec(path);
  if (driverDay) {
    read.push(`${driverDay[1]} ${driverDay[2]}`);
    if (failDriverDays) return answer({ error: 'oops' }, 500);
    const [, driverId, date] = driverDay;
    const assignments = sentDays[`${driverId} ${date}`];
    const day: DriverDay = assignments ? { date, state: 'sent', sentAt: SENT_AT, assignments } : { date, state: 'draft' };
    return answer(day);
  }
  if (path.endsWith('/api/drivers')) return answer({ drivers: url.searchParams.get('include') ? drivers : drivers.filter((d) => d.active) });
  for (const list of ['trucks', 'places', 'materials', 'foremen']) if (path.endsWith(`/api/${list}`)) return answer({ [list]: [] });
  const week = /\/api\/weeks\/([^/]+)$/.exec(path);
  if (week) return answer({ days: weekDates(week[1]).map((date) => ({ date, state: 'none', unassigned: 0, holiday: null })) });
  if (path.endsWith('/api/assignments')) return answer({ assignments: [], sentAt: null });
  return answer({ error: 'not_found' }, 404);
});

/** One of a Driver's Assignments as the Worker answers it: Sample Driver A's, nothing marked, unless the test says. */
function card(fields: Partial<DriverAssignment>): DriverAssignment {
  return {
    id: crypto.randomUUID(), date: '2026-11-19', driverId: 'drv-a', driverName: 'Sample Driver A',
    truckId: null, truckNumber: null, fromPlaceId: null, fromPlaceName: null, toPlaceId: null, toPlaceName: null,
    materialId: null, materialName: null, foremanId: null, foremanName: null, note: null, position: 0,
    createdAt: '2026-11-18T20:00:00.000Z', updatedAt: '2026-11-18T20:00:00.000Z', changedAt: null, cancelledAt: null,
    sinceSent: null, was: {}, ...fields,
  };
}

function open(address = '/') {
  window.history.pushState({}, '', address);
  return render(<App />);
}

const day = (name: string) => screen.findByRole('region', { name });
const cardsIn = (region: HTMLElement) => within(region).queryAllByRole('article');
/** Taps Yesterday, Today or Tomorrow on the day toggle. */
const pick = async (word: string) => fireEvent.click(within(await screen.findByRole('group', { name: 'Day' })).getByRole('button', { name: word }));

beforeEach(() => {
  businessDay = THURSDAY;
  sentDays = {};
  failDriverDays = false;
  read.length = 0;
  localStorage.clear();
  vi.stubGlobal('fetch', api);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('choosing the Driver view', () => {
  it('asks "Who are you?" with the active Drivers as large buttons, then shows his day', async () => {
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeTruthy();
    const choices = screen.getAllByRole('button', { name: /^Sample Driver/ }).map((b) => b.textContent);
    expect(choices).toEqual(['Sample Driver A', 'Sample Driver B']);
    fireEvent.click(screen.getByRole('button', { name: 'Sample Driver B' }));
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
    expect(screen.getByText('Sample Driver B')).toBeTruthy();
    await waitFor(() => expect(read).toContain('drv-b 2026-11-19'));
  });

  it('remembers the Driver and the view on this device, so the page opens on his day', async () => {
    const first = open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    await day('Today, Thu, Nov 19');
    first.unmount();

    open('/');
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
    expect(screen.getByText('Sample Driver A')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Who are you?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Driver' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('goes back to the Drivers with "← Drivers", so a shared phone can change hands', async () => {
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    await day('Today, Thu, Nov 19');
    expect(screen.queryByRole('button', { name: 'Not you?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '← Drivers' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '← Drivers' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver B' }));
    expect(await screen.findByText('Sample Driver B')).toBeTruthy();
    await waitFor(() => expect(read).toContain('drv-b 2026-11-19'));
  });

  it('still opens on the remembered Driver\'s day after going back to the Drivers without picking', async () => {
    const first = open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    fireEvent.click(await screen.findByRole('button', { name: '← Drivers' }));
    await screen.findByRole('heading', { name: 'Who are you?' });
    first.unmount();

    open('/');
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
    expect(screen.getByText('Sample Driver A')).toBeTruthy();
  });

  it('switches back to the Scheduler from the same toggle, and remembers that too', async () => {
    const first = open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Scheduler' }));
    expect(await screen.findByRole('heading', { name: 'Dispatch' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.getByRole('button', { name: 'Scheduler' }).getAttribute('aria-pressed')).toBe('true');
    first.unmount();

    open('/');
    await screen.findByRole('button', { name: 'Scheduler' });
    expect(screen.queryByRole('region', { name: /^Today/ })).toBeNull();
  });
});

describe('a Driver\'s yesterday, today and tomorrow', () => {
  beforeEach(() => {
    localStorage.setItem('truck-dispatch:view', 'driver');
    localStorage.setItem('truck-dispatch:driver', 'drv-a');
  });

  it('opens on Today and offers only Yesterday, Today and Tomorrow, one day at a time', async () => {
    open('/');
    const toggle = await screen.findByRole('group', { name: 'Day' });
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yesterday', 'Today', 'Tomorrow']);
    expect(within(toggle).getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /^Tomorrow/ })).toBeNull();
  });

  it('shows yesterday\'s Sent Assignments, read from the Worker', async () => {
    sentDays['drv-a 2026-11-18'] = [card({ date: '2026-11-18', note: 'Wednesday haul' })];
    open('/');
    await day('Today, Thu, Nov 19');
    await pick('Yesterday');
    expect(within(await day('Yesterday, Wed, Nov 18')).getByText('Wednesday haul')).toBeTruthy();
    expect(read).toContain('drv-a 2026-11-18');
  });

  it('says a day Dave has not Sent is not sent yet, so it is not mistaken for a day off', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ note: 'Haul stone' })];
    open('/');
    expect(cardsIn(await day('Today, Thu, Nov 19'))).toHaveLength(1);
    await pick('Tomorrow');
    expect(within(await day('Tomorrow, Fri, Nov 20')).getByText("Dave hasn't sent Friday yet.")).toBeTruthy();
  });

  it('says a Sent day with nothing for him has no Assignments for him', async () => {
    sentDays['drv-a 2026-11-20'] = [];
    open('/');
    await pick('Tomorrow');
    expect(within(await day('Tomorrow, Fri, Nov 20')).getByText('Nothing for you on Friday.')).toBeTruthy();
  });

  it('shows each Assignment as a card in Dave\'s order, with Material, Pick up, Drop off, the note and a named Truck', async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ materialName: 'Sample Stone', fromPlaceName: 'Sample Plant', toPlaceName: 'Sample Site North', note: 'Two loads', truckId: 'trk-24', truckNumber: '24' }),
      card({ materialName: 'Sample Dirt', position: 1 }),
    ];
    open('/');
    const [first, second] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(first.textContent).toContain('Sample Stone');
    expect(within(first).getByText('Pick up').nextSibling?.textContent).toBe('Sample Plant');
    expect(within(first).getByText('Drop off').nextSibling?.textContent).toBe('Sample Site North');
    expect(within(first).getByText('Two loads')).toBeTruthy();
    expect(within(first).getByText('Take Truck 24 for this one')).toBeTruthy();
    expect(second.textContent).toContain('Sample Dirt');
    expect(within(second).queryByText(/Take Truck/)).toBeNull();
  });

  it('marks one changed after the Send "Changed by Dave", with what it was', async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ materialName: 'Sample Stone', sinceSent: 'changed', changedAt: '2026-11-19T12:00:00.000Z', truckNumber: null, was: { materialName: 'Cobblestone', truckNumber: '24' } }),
    ];
    open('/');
    const [changed] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(within(changed).getByText('Changed by Dave')).toBeTruthy();
    expect(within(changed).getByText('was Cobblestone')).toBeTruthy();
    expect(within(changed).getByText('Take your own Truck (was Truck 24)')).toBeTruthy();
  });

  it('marks one added after the Send "Added by Dave"', async () => {
    sentDays['drv-a 2026-11-20'] = [card({ date: '2026-11-20', note: 'Fill the shop', sinceSent: 'added' })];
    open('/');
    await pick('Tomorrow');
    const [added] = cardsIn(await day('Tomorrow, Fri, Nov 20'));
    expect(within(added).getByText('Added by Dave')).toBeTruthy();
  });

  it('strikes a cancelled one through, marked "Cancelled by Dave" rather than Changed', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ note: 'Haul stone', sinceSent: 'changed', cancelledAt: '2026-11-19T12:00:00.000Z' })];
    open('/');
    const [cancelled] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(within(cancelled).getByText('Cancelled by Dave')).toBeTruthy();
    expect(within(cancelled).queryByText('Changed by Dave')).toBeNull();
    expect(within(cancelled).getByText('Haul stone').closest('.line-through')).toBeTruthy();
  });

  it('reads Today again when the page regains focus, moving on to a new day', async () => {
    open('/');
    await day('Today, Thu, Nov 19');
    businessDay = { today: '2026-11-20', tomorrow: '2026-11-21', nextWorkingDay: '2026-11-23' };
    sentDays['drv-a 2026-11-20'] = [card({ date: '2026-11-20', note: 'Friday haul' })];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(within(await day('Today, Fri, Nov 20')).getByText('Friday haul')).toBeTruthy();
  });

  it('keeps a picked day on regaining focus, reading Dave\'s latest changes to it', async () => {
    open('/');
    await pick('Tomorrow');
    await day('Tomorrow, Fri, Nov 20');
    sentDays['drv-a 2026-11-20'] = [card({ date: '2026-11-20', note: 'Added since' })];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(within(await day('Tomorrow, Fri, Nov 20')).getByText('Added since')).toBeTruthy();
  });

  it('steps one calendar day at a time with ‹ ›, weekends included, titling other days by their date', async () => {
    sentDays['drv-a 2026-11-22'] = [card({ date: '2026-11-22', note: 'Sunday haul' })];
    open('/');
    await day('Today, Thu, Nov 19');
    fireEvent.click(screen.getByRole('button', { name: 'Day after' }));
    await day('Tomorrow, Fri, Nov 20');
    fireEvent.click(screen.getByRole('button', { name: 'Day after' }));
    expect(await day('Sat, Nov 21')).toBeTruthy();
    const toggle = screen.getByRole('group', { name: 'Day' });
    expect(within(toggle).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Day after' }));
    expect(within(await day('Sun, Nov 22')).getByText('Sunday haul')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Day before' }));
    await day('Sat, Nov 21');
    await pick('Today');
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
  });

  it('points to Dave\'s next Sent day beyond tomorrow, and takes him there', async () => {
    sentDays['drv-a 2026-11-23'] = [card({ date: '2026-11-23', note: 'Monday haul' })];
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Next from Dave: Mon, Nov 23 →' }));
    expect(within(await day('Mon, Nov 23')).getByText('Monday haul')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Next from Dave/ })).toBeNull();
  });

  it('does not point anywhere when nothing beyond tomorrow is Sent for him', async () => {
    sentDays['drv-a 2026-11-20'] = [card({ date: '2026-11-20', note: 'Friday haul' })];
    sentDays['drv-b 2026-11-23'] = [card({ date: '2026-11-23', driverId: 'drv-b' })];
    open('/');
    await day('Today, Thu, Nov 19');
    await waitFor(() => expect(read).toContain('drv-a 2026-11-19'));
    expect(screen.queryByRole('button', { name: /^Next from Dave/ })).toBeNull();
  });

  it('says so when his day cannot load', async () => {
    failDriverDays = true;
    open('/');
    expect(within(await day('Today, Thu, Nov 19')).getByText('Could not load this day. It tries again when you come back to the page.')).toBeTruthy();
  });

  it('asks again when the remembered Driver has been removed', async () => {
    localStorage.setItem('truck-dispatch:driver', 'drv-x');
    open('/');
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeTruthy();
  });
});
