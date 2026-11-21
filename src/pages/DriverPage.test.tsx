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
    await waitFor(() => expect(read).toEqual(expect.arrayContaining(['drv-b 2026-11-19', 'drv-b 2026-11-20'])));
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

  it('asks again with "Not you?", so a shared phone can change hands', async () => {
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not you?' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver B' }));
    expect(await screen.findByText('Sample Driver B')).toBeTruthy();
    await waitFor(() => expect(read).toContain('drv-b 2026-11-19'));
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

describe('a Driver\'s today and tomorrow', () => {
  beforeEach(() => {
    localStorage.setItem('truck-dispatch:view', 'driver');
    localStorage.setItem('truck-dispatch:driver', 'drv-a');
  });

  it('says a day Dave has not Sent is not sent yet, so it is not mistaken for a day off', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ note: 'Haul stone' })];
    open('/');
    expect(within(await day('Tomorrow, Fri, Nov 20')).getByText("Dave hasn't sent Friday yet.")).toBeTruthy();
    expect(cardsIn(await day('Today, Thu, Nov 19'))).toHaveLength(1);
  });

  it('says a Sent day with nothing for him has no Assignments for him', async () => {
    sentDays['drv-a 2026-11-20'] = [];
    open('/');
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

  it('reads both days again when the page regains focus, moving on to a new day', async () => {
    open('/');
    await day('Today, Thu, Nov 19');
    businessDay = { today: '2026-11-20', tomorrow: '2026-11-21', nextWorkingDay: '2026-11-23' };
    sentDays['drv-a 2026-11-21'] = [card({ date: '2026-11-21', note: 'Saturday haul' })];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await day('Today, Fri, Nov 20')).toBeTruthy();
    expect(within(await day('Tomorrow, Sat, Nov 21')).getByText('Saturday haul')).toBeTruthy();
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
