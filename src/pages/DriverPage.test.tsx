// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
// The pages load lazily in the app (App.tsx); importing them here compiles them
// before the first test, so a cold run never waits on that inside a test.
import './DriverPage';
import { easternTime, weekDates } from '../../shared/days';
import { readFleetJson } from '../../shared/fleetExport';
import { buildTripDay } from '../../shared/trips';
import { truckLog, truckLogLanes } from '../../shared/truckLog';
import { REAL_DAY } from '@/simulate/realDay';
import type { CheckIn, DriverAssignment, DriverDay, DriverTruckLog, Inspection, NewInspection, TruckProblem } from '../../shared/types';
// The whole 16 Nov day cut at 10:15 and at 16:20, as Fleet would have exported it then.
import CUT_1015 from '../../shared/fixtures/fleet/2026-11-16-cut-1015.json?raw';
import CUT_1620 from '../../shared/fixtures/fleet/2026-11-16-cut-1620.json?raw';

/**
 * The API as a Driver's phone sees it: today in US Eastern is Thursday
 * 2026-11-19 (a test can move it on), two active Drivers and a removed one,
 * and each Driver's day as the Worker reads it, a Draft unless a test Assigns it.
 */
const THURSDAY = { today: '2026-11-19', tomorrow: '2026-11-20', nextWorkingDay: '2026-11-20' };
let businessDay = THURSDAY;
/** When Dave Assigned each card's Assignment, the day before. */
const ASSIGNED_AT = '2026-11-18T21:15:00.000Z';
const drivers = [
  { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', sortOrder: null, active: true },
  { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: 'trk-24', sortOrder: null, active: true },
  { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: null, sortOrder: null, active: false },
];
/** Each Driver's Assigned Assignments, by Driver and date. A day not here has none. */
let sentDays: Record<string, DriverAssignment[]> = {};
/** His Truck log on his day read, by Driver and date, as the Worker gives it today. A day not here has none. */
let truckLogs: Record<string, DriverTruckLog> = {};
/** Every Dismiss the phone sent, by id, and whether the Worker fails it. */
let dismissed: string[] = [];
let failDismiss = false;
let failDriverDays = false;
const read: string[] = [];

/** Active Trucks and a removed one. */
let trucks = [
  { id: 'trk-21', number: '21', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-27', number: '27', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-30', number: '30', hcssCode: null, hcssGuid: null, active: false },
];
/** A short checklist: two items to answer and an optional one. */
const checklist = [
  { id: 'insp-06', label: 'Tires / wheels', optional: false, sortOrder: 1, active: true },
  { id: 'insp-07', label: 'Lights', optional: false, sortOrder: 2, active: true },
  { id: 'insp-13', label: 'Horn', optional: true, sortOrder: 3, active: true },
];
/** Each Driver's check-in by date, as the Worker would answer it: his latest Inspection that day. */
let checkIns: Record<string, CheckIn[]> = {};
let failCheckIns = false;
/** Every Finish the phone sent, and how many to fail before one is saved. */
const finished: NewInspection[] = [];
let failFinishes = 0;
/** Every Truck problem, open or fixed, as GET api/truck-problems lists them, newest first. */
let problems: TruckProblem[] = [];
/** The query of each read of the Truck problems. */
const problemReads: string[] = [];
/** Every Report a problem the phone sent, and how many to fail before one is saved. */
const reports: unknown[] = [];
let failReports = 0;
/** The Worker's clock when a Finish is saved: 6:42 AM US Eastern. */
const DONE_AT = '2026-11-19T11:42:00.000Z';

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const path = url.pathname;
  if (path.endsWith('/api/today')) return answer(businessDay);
  if (path.endsWith('/api/check-ins')) {
    if (failCheckIns) return answer({ error: 'oops' }, 500);
    const date = url.searchParams.get('date')!;
    return answer({ date, checkIns: checkIns[date] ?? [] });
  }
  if (path.endsWith('/api/inspections') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as NewInspection;
    finished.push(body);
    if (failFinishes > 0) {
      failFinishes -= 1;
      return answer({ error: 'oops' }, 500);
    }
    const truck = trucks.find((t) => t.id === body.truckId)!;
    const driver = drivers.find((d) => d.id === body.driverId)!;
    const needsRepair = body.answers.some((a) => a.answer === 'repair');
    const inspection: Inspection = {
      id: body.id, date: businessDay.today, driverId: driver.id, driverName: driver.name, truckId: truck.id, truckNumber: truck.number,
      doneAt: DONE_AT, otherNotes: body.otherNotes ?? null, needsRepair,
      answers: body.answers.map((a, position) => ({ position, itemId: a.itemId, label: checklist.find((i) => i.id === a.itemId)!.label, answer: a.answer, repairNote: a.repairNote ?? null })),
      problems: body.answers
        .filter((a) => a.answer === 'repair')
        .map((a, n) => ({
          id: `tp-${body.id}-${n}`, truckId: truck.id, truckNumber: truck.number, reportedByDriverId: driver.id, reportedByName: driver.name,
          reportedAt: DONE_AT, text: a.repairNote!, inspectionId: body.id, fixedAt: null, fixedNote: null,
        })),
    };
    checkIns[businessDay.today] = [
      ...(checkIns[businessDay.today] ?? []).filter((c) => c.driverId !== driver.id),
      { driverId: driver.id, driverName: driver.name, truckId: truck.id, truckNumber: truck.number, inspectionId: body.id, doneAt: DONE_AT, needsRepair },
    ];
    return answer({ inspection }, 201);
  }
  if (path.endsWith('/api/truck-problems') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { driverId: string; truckId: string; text: string };
    reports.push(body);
    if (failReports > 0) {
      failReports -= 1;
      return answer({ error: 'oops' }, 500);
    }
    const truck = trucks.find((t) => t.id === body.truckId)!;
    const driver = drivers.find((d) => d.id === body.driverId)!;
    return answer({ problem: {
      id: `tp-${reports.length}`, truckId: truck.id, truckNumber: truck.number, reportedByDriverId: driver.id, reportedByName: driver.name,
      reportedAt: '2026-11-19T16:05:00.000Z', text: body.text, inspectionId: null, fixedAt: null, fixedNote: null,
    } }, 201);
  }
  if (path.endsWith('/api/truck-problems')) {
    problemReads.push(url.search);
    const truckId = url.searchParams.get('truckId');
    return answer({ problems: problems.filter((p) => (url.searchParams.get('open') !== '1' || !p.fixedAt) && (!truckId || p.truckId === truckId)) });
  }
  if (path.endsWith('/api/trucks')) return answer({ trucks: url.searchParams.get('include') ? trucks : trucks.filter((t) => t.active) });
  if (path.endsWith('/api/inspection-items')) return answer({ 'inspection-items': checklist });
  const next = /\/api\/drivers\/([^/]+)\/next-assigned$/.exec(path);
  if (next) {
    const dates = Object.entries(sentDays)
      .filter(([key, list]) => key.startsWith(`${next[1]} `) && list.some((a) => !a.cancelledAt))
      .map(([key]) => key.split(' ')[1])
      .filter((date) => date > businessDay.tomorrow)
      .sort();
    return answer({ date: dates[0] ?? null });
  }
  const dismissing = /\/api\/assignments\/([^/]+)\/dismiss$/.exec(path);
  if (dismissing && init?.method === 'POST') {
    dismissed.push(dismissing[1]);
    if (failDismiss) return answer({ error: 'oops' }, 500);
    // Off his day from now on, as the Worker reads it.
    for (const key of Object.keys(sentDays)) sentDays[key] = sentDays[key].filter((a) => a.id !== dismissing[1]);
    return new Response(null, { status: 204 });
  }
  const driverDay = /\/api\/drivers\/([^/]+)\/days\/([^/]+)$/.exec(path);
  if (driverDay) {
    read.push(`${driverDay[1]} ${driverDay[2]}`);
    if (failDriverDays) return answer({ error: 'oops' }, 500);
    const [, driverId, date] = driverDay;
    const log = truckLogs[`${driverId} ${date}`];
    const day: DriverDay = { date, assignments: sentDays[`${driverId} ${date}`] ?? [], ...(log && { truckLog: log }) };
    return answer(day);
  }
  if (path.endsWith('/api/drivers')) return answer({ drivers: url.searchParams.get('include') ? drivers : drivers.filter((d) => d.active) });
  for (const list of ['places', 'materials', 'foremen']) if (path.endsWith(`/api/${list}`)) return answer({ [list]: [] });
  const week = /\/api\/weeks\/([^/]+)$/.exec(path);
  if (week) return answer({ days: weekDates(week[1]).map((date) => ({ date, state: 'none', drafts: 0, holiday: null })) });
  if (path.endsWith('/api/assignments')) return answer({ assignments: [] });
  return answer({ error: 'not_found' }, 404);
});

/** One of a Driver's Assignments as the Worker answers it: Sample Driver A's, nothing marked, unless the test says. */
function card(fields: Partial<DriverAssignment>): DriverAssignment {
  return {
    id: crypto.randomUUID(), date: '2026-11-19', driverId: 'drv-a', driverName: 'Sample Driver A',
    truckId: null, truckNumber: null, fromPlaceId: null, fromPlaceName: null, toPlaceId: null, toPlaceName: null,
    materialId: null, materialName: null, foremanId: null, foremanName: null, note: null, position: 0,
    createdAt: '2026-11-18T20:00:00.000Z', updatedAt: '2026-11-18T20:00:00.000Z', changedAt: null, cancelledAt: null,
    assignedAt: ASSIGNED_AT, handedFromId: null, sinceSent: null, was: {}, ...fields,
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
  truckLogs = {};
  dismissed = [];
  failDismiss = false;
  failDriverDays = false;
  read.length = 0;
  trucks = trucks.map((t) => ({ ...t, active: t.id !== 'trk-30' }));
  checkIns = {};
  failCheckIns = false;
  finished.length = 0;
  failFinishes = 0;
  problems = [];
  problemReads.length = 0;
  reports.length = 0;
  failReports = 0;
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

  it('goes back to the Drivers with Change beside his name, so a shared phone can change hands', async () => {
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    await day('Today, Thu, Nov 19');
    expect(screen.queryByRole('button', { name: 'Not you?' })).toBeNull();
    // "← Hub" stays top left, as on every page; Change sits with his name.
    expect(screen.getByRole('link', { name: '← Hub' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change Driver' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change Driver' })).toBeNull();
    expect(screen.getByRole('link', { name: '← Hub' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver B' }));
    expect(await screen.findByText('Sample Driver B')).toBeTruthy();
    await waitFor(() => expect(read).toContain('drv-b 2026-11-19'));
  });

  it('still opens on the remembered Driver\'s day after going back to the Drivers without picking', async () => {
    const first = open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Driver' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sample Driver A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Driver' }));
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

  it('shows yesterday\'s Assigned Assignments, read from the Worker', async () => {
    sentDays['drv-a 2026-11-18'] = [card({ date: '2026-11-18', note: 'Wednesday haul' })];
    open('/');
    await day('Today, Thu, Nov 19');
    await pick('Yesterday');
    expect(within(await day('Yesterday, Wed, Nov 18')).getByText('Wednesday haul')).toBeTruthy();
    expect(read).toContain('drv-a 2026-11-18');
  });

  it('says a day with nothing Assigned to him is nothing from Dave yet, so it is not mistaken for a day off', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ note: 'Haul stone' })];
    open('/');
    expect(cardsIn(await day('Today, Thu, Nov 19'))).toHaveLength(1);
    await pick('Tomorrow');
    expect(within(await day('Tomorrow, Fri, Nov 20')).getByText('Nothing from Dave yet for Friday.')).toBeTruthy();
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

  it('marks one changed after it was Assigned "Changed by Dave", with what it was', async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ materialName: 'Sample Stone', sinceSent: 'changed', changedAt: '2026-11-19T12:00:00.000Z', truckNumber: null, was: { materialName: 'Cobblestone', truckNumber: '24' } }),
    ];
    open('/');
    const [changed] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(within(changed).getByText('Changed by Dave')).toBeTruthy();
    expect(within(changed).getByText('was Cobblestone')).toBeTruthy();
    expect(within(changed).getByText('Take your own Truck (was Truck 24)')).toBeTruthy();
  });

  it('shows the Foreman, and what he was when Dave changed him after Assigning it', async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ note: 'Haul stone', foremanId: 'frm-b', foremanName: 'Brody', sinceSent: 'changed', changedAt: '2026-11-19T12:00:00.000Z', was: { foremanName: 'Sample Foreman A' } }),
      card({ note: 'No foreman', position: 1 }),
    ];
    open('/');
    const [withForeman, without] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(within(withForeman).getByText('Foreman').nextSibling?.textContent).toBe('Brody');
    expect(within(withForeman).getByText('was Sample Foreman A')).toBeTruthy();
    expect(within(without).queryByText('Foreman')).toBeNull();
  });

  it('marks one Added (Assigned on its own day) "Added by Dave"', async () => {
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

  it('offers Dismiss only on a cancelled card, which clears it off his day', async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ id: 'a1', note: 'Haul stone', sinceSent: 'changed', cancelledAt: '2026-11-19T12:00:00.000Z' }),
      card({ id: 'a2', note: 'Fill the shop', position: 1 }),
    ];
    open('/');
    const [cancelled, other] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(within(other).queryByRole('button', { name: /Dismiss/ })).toBeNull();
    fireEvent.click(within(cancelled).getByRole('button', { name: /Dismiss/ }));
    await waitFor(() => expect(cardsIn(screen.getByRole('region', { name: /Today/ }))).toHaveLength(1));
    expect(dismissed).toEqual(['a1']);
  });

  it('says so when Dismiss fails, and keeps the card', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ id: 'a1', note: 'Haul stone', sinceSent: 'changed', cancelledAt: '2026-11-19T12:00:00.000Z' })];
    failDismiss = true;
    open('/');
    const [cancelled] = cardsIn(await day('Today, Thu, Nov 19'));
    fireEvent.click(within(cancelled).getByRole('button', { name: /Dismiss/ }));
    expect(await screen.findByText('Could not dismiss it. Try again.')).toBeTruthy();
    expect(cardsIn(screen.getByRole('region', { name: /Today/ }))).toHaveLength(1);
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
    // Each arrow names the day it goes to.
    expect(screen.getByRole('button', { name: 'Day before, Wed 18' }).textContent).toBe('Wed 18');
    fireEvent.click(screen.getByRole('button', { name: 'Day after, Fri 20' }));
    await day('Tomorrow, Fri, Nov 20');
    fireEvent.click(screen.getByRole('button', { name: /^Day after/ }));
    expect(await day('Sat, Nov 21')).toBeTruthy();
    const toggle = screen.getByRole('group', { name: 'Day' });
    expect(within(toggle).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Day after/ }));
    expect(within(await day('Sun, Nov 22')).getByText('Sunday haul')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Day before/ }));
    await day('Sat, Nov 21');
    await pick('Today');
    expect(await day('Today, Thu, Nov 19')).toBeTruthy();
  });

  it('points to Dave\'s next Assigned day beyond tomorrow, and takes him there', async () => {
    sentDays['drv-a 2026-11-23'] = [card({ date: '2026-11-23', note: 'Monday haul' })];
    open('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Next from Dave: Mon, Nov 23 →' }));
    expect(within(await day('Mon, Nov 23')).getByText('Monday haul')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Next from Dave/ })).toBeNull();
  });

  it('does not point anywhere when nothing beyond tomorrow is Assigned to him', async () => {
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

describe('checking in on Today', () => {
  beforeEach(() => {
    localStorage.setItem('truck-dispatch:view', 'driver');
    localStorage.setItem('truck-dispatch:driver', 'drv-a');
  });

  const checkInCard = () => screen.findByRole('region', { name: 'Check in' });
  const truckPicker = async () => within(await checkInCard()).getByRole('group', { name: 'Truck' });
  const pressed = (group: HTMLElement) => within(group).queryAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
  const item = (label: string) => within(screen.getByRole('region', { name: 'Check in' })).getByRole('group', { name: label });
  const tap = (label: string, answer: 'OK' | 'Needs repair' | 'N/A') => fireEvent.click(within(item(label)).getByRole('button', { name: answer }));
  const finish = () => within(screen.getByRole('region', { name: 'Check in' })).getByRole('button', { name: 'Finish' }) as HTMLButtonElement;
  const start = async () => {
    const button = within(await checkInCard()).getByRole('button', { name: 'Start Inspection' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByRole('group', { name: 'Lights' });
  };
  const LATER_CHECK_IN: CheckIn = { driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-21', truckNumber: '21', inspectionId: 'earlier', doneAt: '2026-11-19T11:05:00.000Z', needsRepair: false };

  it('shows the Check in card at the top of Today, and his Assignments still below it', async () => {
    sentDays['drv-a 2026-11-19'] = [card({ note: 'Haul stone' })];
    open('/');
    const checkIn = await checkInCard();
    const today = await day('Today, Thu, Nov 19');
    expect(await within(today).findByText('Haul stone')).toBeTruthy();
    expect(checkIn.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('pre-selects his usual Truck and offers every active Truck', async () => {
    open('/');
    const picker = await truckPicker();
    await waitFor(() => expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Truck 21', 'Truck 24', 'Truck 27']));
    expect(pressed(picker)).toEqual(['Truck 21']);
    fireEvent.click(within(picker).getByRole('button', { name: 'Truck 27' }));
    expect(pressed(picker)).toEqual(['Truck 27']);
  });

  it('pre-selects no Truck when his usual one was removed, or he has none', async () => {
    trucks = trucks.map((t) => (t.id === 'trk-21' ? { ...t, active: false } : t));
    open('/');
    const picker = await truckPicker();
    await waitFor(() => expect(within(picker).getAllByRole('button')).toHaveLength(2));
    expect(pressed(picker)).toEqual([]);
    expect((within(await checkInCard()).getByRole('button', { name: 'Start Inspection' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows Finish only once every item that is not optional is answered and every Needs repair has its note', async () => {
    open('/');
    await start();
    expect(within(item('Horn (optional)')).getAllByRole('button')).toHaveLength(3);
    expect(finish().disabled).toBe(true);
    tap('Tires / wheels', 'OK');
    expect(finish().disabled).toBe(true);
    tap('Lights', 'Needs repair');
    expect(finish().disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What needs repair: Lights' }), { target: { value: 'Left marker out' } });
    expect(finish().disabled).toBe(false);
    tap('Lights', 'N/A');
    expect(screen.queryByRole('textbox', { name: 'What needs repair: Lights' })).toBeNull();
    expect(finish().disabled).toBe(false);
  });

  it('sends the Inspection for today and then shows one line with the Truck and the time', async () => {
    open('/');
    const picker = await truckPicker();
    fireEvent.click(await within(picker).findByRole('button', { name: 'Truck 24' }));
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'Needs repair');
    fireEvent.change(screen.getByRole('textbox', { name: 'What needs repair: Lights' }), { target: { value: 'Left marker out' } });
    tap('Horn (optional)', 'N/A');
    fireEvent.change(screen.getByRole('textbox', { name: 'Other notes' }), { target: { value: 'Radio crackles' } });
    fireEvent.click(finish());

    const line = await screen.findByRole('region', { name: 'Checked in' });
    expect(line.textContent).toBe('Truck 24 · checked in 6:42 · Report a problem · Check in again');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();
    expect(finished).toEqual([{
      id: expect.stringMatching(/^[0-9a-f-]{36}$/), date: '2026-11-19', driverId: 'drv-a', truckId: 'trk-24', otherNotes: 'Radio crackles',
      answers: [
        { itemId: 'insp-06', answer: 'ok' },
        { itemId: 'insp-07', answer: 'repair', repairNote: 'Left marker out' },
        { itemId: 'insp-13', answer: 'na' },
      ],
    }]);
  });

  it('says so when Finish fails, keeps the answers, and retries with the same id', async () => {
    failFinishes = 1;
    open('/');
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    expect(await within(await checkInCard()).findByText('Could not finish the check-in. Your answers are kept: try Finish again.')).toBeTruthy();
    expect(item('Lights').querySelector('[aria-pressed="true"]')?.textContent).toBe('OK');
    fireEvent.click(finish());
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toContain('Truck 21 · checked in 6:42');
    expect(finished).toHaveLength(2);
    expect(finished[1].id).toBe(finished[0].id);
  });

  it('starts a fresh Inspection when he picks another Truck after starting, so a retry never saves the first Truck\'s', async () => {
    failFinishes = 1;
    open('/');
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    await within(await checkInCard()).findByText(/Could not finish the check-in/);

    fireEvent.click(within(await truckPicker()).getByRole('button', { name: 'Truck 24' }));
    expect(item('Lights').querySelector('[aria-pressed="true"]')).toBeNull();
    expect(within(await checkInCard()).queryByText(/Could not finish the check-in/)).toBeNull();
    expect(finish().disabled).toBe(true);
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toContain('Truck 24 · checked in 6:42');
    expect(finished.map((f) => f.truckId)).toEqual(['trk-21', 'trk-24']);
    expect(finished[1].id).not.toBe(finished[0].id);
  });

  it('still offers the Check in card when his check-in cannot be read, and says so', async () => {
    failCheckIns = true;
    open('/');
    expect(await screen.findByText('Could not load your check-in. It tries again when you come back to the page.')).toBeTruthy();
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toContain('Truck 21 · checked in 6:42');
    expect(screen.queryByText(/Could not load your check-in/)).toBeNull();
  });

  it('shows the line when he has already checked in, and Check in again starts a new one that then counts', async () => {
    checkIns['2026-11-19'] = [LATER_CHECK_IN];
    open('/');
    const line = await screen.findByRole('region', { name: 'Checked in' });
    expect(line.textContent).toBe('Truck 21 · checked in 6:05 · Report a problem · Check in again');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();

    fireEvent.click(within(line).getByRole('button', { name: 'Check in again' }));
    fireEvent.click(await within(await truckPicker()).findByRole('button', { name: 'Truck 27' }));
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toBe('Truck 27 · checked in 6:42 · Report a problem · Check in again');
    expect(finished[0].id).not.toBe('earlier');
  });

  it('lets Check in again be put away, back to the line', async () => {
    checkIns['2026-11-19'] = [LATER_CHECK_IN];
    open('/');
    fireEvent.click(within(await screen.findByRole('region', { name: 'Checked in' })).getByRole('button', { name: 'Check in again' }));
    fireEvent.click(within(await checkInCard()).getByRole('button', { name: 'Cancel' }));
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toBe('Truck 21 · checked in 6:05 · Report a problem · Check in again');
  });

  describe('Report a problem', () => {
    const line = () => screen.findByRole('region', { name: 'Checked in' });
    const note = () => screen.getByRole('textbox', { name: 'What is the problem?' }) as HTMLInputElement;
    const send = () => within(screen.getByRole('region', { name: 'Checked in' })).getByRole('button', { name: 'Send to Dave' }) as HTMLButtonElement;
    const reportOpen = async () => fireEvent.click(within(await line()).getByRole('button', { name: 'Report a problem' }));

    it('is offered only once he has checked in, not on the Check in card', async () => {
      open('/');
      await checkInCard();
      expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
    });

    it('needs a note, then reports it on the Truck of his latest check-in and says it was sent', async () => {
      checkIns['2026-11-19'] = [{ ...LATER_CHECK_IN, truckId: 'trk-24', truckNumber: '24' }];
      open('/');
      await reportOpen();
      expect(send().disabled).toBe(true);
      fireEvent.change(note(), { target: { value: '   ' } });
      expect(send().disabled).toBe(true);
      fireEvent.change(note(), { target: { value: '  Hydraulics leaking ' } });
      fireEvent.click(send());
      expect(await screen.findByText('Sent to Dave: Hydraulics leaking')).toBeTruthy();
      expect(reports).toEqual([{ driverId: 'drv-a', truckId: 'trk-24', text: 'Hydraulics leaking' }]);
      expect(screen.queryByRole('textbox', { name: 'What is the problem?' })).toBeNull();
      expect(within(await line()).getByRole('button', { name: 'Report a problem' })).toBeTruthy();
    });

    it('says so when the report fails and keeps the note to send again', async () => {
      checkIns['2026-11-19'] = [LATER_CHECK_IN];
      failReports = 1;
      open('/');
      await reportOpen();
      fireEvent.change(note(), { target: { value: 'Flat tire' } });
      fireEvent.click(send());
      expect(await screen.findByText('Could not send the problem. Your note is kept: try Send to Dave again.')).toBeTruthy();
      expect(note().value).toBe('Flat tire');
      fireEvent.click(send());
      expect(await screen.findByText('Sent to Dave: Flat tire')).toBeTruthy();
      expect(reports).toEqual([{ driverId: 'drv-a', truckId: 'trk-21', text: 'Flat tire' }, { driverId: 'drv-a', truckId: 'trk-21', text: 'Flat tire' }]);
    });

    it('can be put away without sending', async () => {
      checkIns['2026-11-19'] = [LATER_CHECK_IN];
      open('/');
      await reportOpen();
      fireEvent.click(within(await line()).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('textbox', { name: 'What is the problem?' })).toBeNull();
      expect((await line()).textContent).toBe('Truck 21 · checked in 6:05 · Report a problem · Check in again');
      expect(reports).toEqual([]);
    });

    it('goes on the Truck he checked in to again, not the earlier one', async () => {
      checkIns['2026-11-19'] = [LATER_CHECK_IN];
      open('/');
      fireEvent.click(within(await line()).getByRole('button', { name: 'Check in again' }));
      fireEvent.click(await within(await truckPicker()).findByRole('button', { name: 'Truck 27' }));
      await start();
      tap('Tires / wheels', 'OK');
      tap('Lights', 'OK');
      fireEvent.click(finish());
      await reportOpen();
      fireEvent.change(note(), { target: { value: 'Flat tire' } });
      fireEvent.click(send());
      await screen.findByText('Sent to Dave: Flat tire');
      expect(reports).toEqual([{ driverId: 'drv-a', truckId: 'trk-27', text: 'Flat tire' }]);
    });
  });

  it('offers no Check in on Yesterday, Tomorrow or any other day', async () => {
    open('/');
    await checkInCard();
    await pick('Yesterday');
    await day('Yesterday, Wed, Nov 18');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();
    await pick('Tomorrow');
    await day('Tomorrow, Fri, Nov 20');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Day after/ }));
    await day('Sat, Nov 21');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Checked in' })).toBeNull();
  });

  it('offers no Report a problem on other days, even once checked in today', async () => {
    checkIns['2026-11-19'] = [{ driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-21', truckNumber: '21', inspectionId: 'earlier', doneAt: '2026-11-19T11:05:00.000Z', needsRepair: false }];
    open('/');
    await screen.findByRole('button', { name: 'Report a problem' });
    await pick('Yesterday');
    await day('Yesterday, Wed, Nov 18');
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
    await pick('Tomorrow');
    await day('Tomorrow, Fri, Nov 20');
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
  });

  describe("the Truck's open problems", () => {
    // Today is Thursday 2026-11-19.
    const problem = (fields: Partial<TruckProblem>): TruckProblem => ({
      id: 'tp-1', truckId: 'trk-24', truckNumber: '24', reportedByDriverId: 'drv-b', reportedByName: 'Sample Driver B',
      reportedAt: '2026-11-19T11:05:00.000Z', text: 'Mud flap torn', inspectionId: 'ins-0', fixedAt: null, fixedNote: null, ...fields,
    });
    const listed = () => {
      const list = screen.queryByRole('list', { name: /^Open problems on Truck / });
      return list && within(list).getAllByRole('listitem').map((entry) => entry.textContent);
    };

    it('lists them at the top of the Inspection, before the items, with the note, the day and who reported it', async () => {
      problems = [
        problem({}),
        problem({ id: 'tp-2', text: 'Left marker out', reportedAt: '2026-11-17T12:00:00.000Z', reportedByName: 'Sample Driver A' }),
        problem({ id: 'tp-3', text: 'Cracked mirror', reportedAt: '2026-11-06T12:00:00.000Z' }),
        problem({ id: 'tp-4', truckId: 'trk-21', truckNumber: '21', text: 'Not this Truck' }),
      ];
      open('/');
      fireEvent.click(within(await truckPicker()).getByRole('button', { name: 'Truck 24' }));
      expect(listed()).toBeNull();
      await start();
      const list = await screen.findByRole('list', { name: 'Open problems on Truck 24' });
      expect(listed()).toEqual([
        'Mud flap torn · reported today by Sample Driver B',
        'Left marker out · reported Tue by Sample Driver A',
        'Cracked mirror · reported Fri, Nov 6 by Sample Driver B',
      ]);
      expect(list.compareDocumentPosition(item('Tires / wheels')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(problemReads).toEqual(['?open=1&truckId=trk-24']);
    });

    it('lists nothing for a Truck with none open, and follows the Truck when he picks another', async () => {
      problems = [problem({ fixedAt: '2026-11-19T12:00:00.000Z' }), problem({ id: 'tp-2', truckId: 'trk-27', truckNumber: '27', text: 'Horn weak' })];
      open('/');
      fireEvent.click(within(await truckPicker()).getByRole('button', { name: 'Truck 24' }));
      await start();
      await waitFor(() => expect(problemReads).toEqual(['?open=1&truckId=trk-24']));
      expect(listed()).toBeNull();
      fireEvent.click(within(await truckPicker()).getByRole('button', { name: 'Truck 27' }));
      await waitFor(() => expect(listed()).toEqual(['Horn weak · reported today by Sample Driver B']));
    });
  });
});

describe('the Trip part on a Driver card', () => {
  beforeEach(() => {
    localStorage.setItem('truck-dispatch:view', 'driver');
    localStorage.setItem('truck-dispatch:driver', 'drv-a');
  });
  const part = (fields: Partial<NonNullable<DriverAssignment['trips']>>): DriverAssignment['trips'] => ({
    loads: 0, tons: null, status: 'none', since: null, lastLoadAt: null, truckingHours: null, ...fields,
  });
  const haul = { materialName: 'Fill', fromPlaceName: 'Sample Site North', toPlaceName: 'Sample Plant' };
  /** Today's one card as his phone shows it: its text, and its HTML compared whole so "exactly as today" means byte for byte. */
  async function shown(fields: Partial<DriverAssignment>) {
    sentDays['drv-a 2026-11-19'] = [card({ id: 'one', ...haul, ...fields })];
    open('/');
    const [only] = cardsIn(await day('Today, Thu, Nov 19'));
    const seen = { html: only.outerHTML, text: only.textContent };
    cleanup();
    return seen;
  }

  it('shows its Loads and the time of the last one, and nothing of Now once he has moved on', async () => {
    const { text } = await shown({ trips: part({ loads: 4, status: 'done', since: '2026-11-16T13:24:26Z', lastLoadAt: '2026-11-16T16:25:10Z' }) });
    expect(text).toContain('4 Loads · last 11:25');
    expect(text).not.toMatch(/Now|Done/);
  });

  it('marks the one he is on now, and says 1 Load for one', async () => {
    const { text } = await shown({ trips: part({ loads: 1, status: 'now', since: '2026-11-16T13:24:26Z', lastLoadAt: '2026-11-16T13:40:00Z' }) });
    expect(text).toContain('Now');
    expect(text).toContain('1 Load · last 08:40');
  });

  it("shows each card's Loads from his day read, and Now on the one he is on", async () => {
    sentDays['drv-a 2026-11-19'] = [
      card({ id: 'a1', ...haul, trips: part({ loads: 4, status: 'done', since: '2026-11-16T13:24:26Z', lastLoadAt: '2026-11-16T16:25:10Z' }) }),
      card({ id: 'a2', ...haul, position: 1, trips: part({ loads: 2, status: 'now', since: '2026-11-16T16:30:00Z', lastLoadAt: '2026-11-16T18:54:00Z' }) }),
    ];
    open('/');
    const [a1, a2] = cardsIn(await day('Today, Thu, Nov 19'));
    expect(a1.textContent).toContain('4 Loads · last 11:25');
    expect(a1.textContent).not.toContain('Now');
    expect(a2.textContent).toContain('2 Loads · last 13:54');
    expect(a2.textContent).toContain('Now');
  });

  it('looks exactly as it does without a Trip part while it has no Trips yet', async () => {
    const without = await shown({});
    expect((await shown({ trips: part({}) })).html).toBe(without.html);
    expect(without.text).not.toMatch(/load|Now/);
  });
});

describe('his Truck log under Today', () => {
  const MONDAY = { today: '2026-11-16', tomorrow: '2026-11-17', nextWorkingDay: '2026-11-17' };
  /** When the cut was imported: five minutes after it was pulled. */
  const IMPORTED = { '10:15': '2026-11-16T15:20:00.000Z', '16:20': '2026-11-16T21:25:00.000Z' };
  const [, J25008, VILLAGER, WALWORTH] = REAL_DAY.places.map((p) => p.id);
  const A1 = card({ id: 'a1', date: '2026-11-16', fromPlaceName: 'J25008 Los Flamboyanes', toPlaceName: 'Villager', materialName: 'Fill' });
  const A2 = card({ id: 'a2', date: '2026-11-16', position: 1, fromPlaceName: 'Walworth Dolomite', toPlaceName: 'J25008 Los Flamboyanes', materialName: '1&2 stone' });

  /** Truck 55's stored Mon 16 Nov as the Worker builds it today, as of the Import of the cut pulled at `cut`. */
  function truckLogAsOf(cut: '10:15' | '16:20'): DriverTruckLog {
    const asOf = IMPORTED[cut];
    const visits = readFleetJson(JSON.parse(cut === '10:15' ? CUT_1015 : CUT_1620));
    const tripDay = buildTripDay({
      places: REAL_DAY.places, jobs: REAL_DAY.jobs, visits, now: asOf, dayOver: false,
      assignments: [
        { id: 'a1', label: 'A1', fromPlaceId: J25008, toPlaceId: VILLAGER, cancelledAt: null, changes: [] },
        { id: 'a2', label: 'A2', fromPlaceId: WALWORTH, toPlaceId: J25008, cancelledAt: null, changes: [] },
      ],
    });
    const labels = { a1: 'A1', a2: 'A2' };
    const { assignments, ...log } = truckLog({ tripDay, places: REAL_DAY.places, assignments: [A1, A2], labels });
    return {
      truckId: 'trk-55', truckNumber: '55', hcssCode: 'MCK-55-17', date: '2026-11-16', asOf, clock: easternTime(asOf), at: asOf, dayOver: false,
      places: REAL_DAY.places, tripDay, labels, assignments, truckLog: log, codesWithNoPlace: [], lanes: truckLogLanes(tripDay, log, null),
    };
  }

  beforeEach(() => {
    businessDay = MONDAY;
    localStorage.setItem('truck-dispatch:view', 'driver');
    localStorage.setItem('truck-dispatch:driver', 'drv-a');
    sentDays['drv-a 2026-11-16'] = [A1, A2];
  });

  /** The Truck log's header boxes: label → what is written in it. */
  const header = (log: HTMLElement) =>
    Object.fromEntries([...within(log).getByRole('group', { name: 'Truck log header' }).querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));

  it('shows the Truck log from his day read under the cards: 06:24 to 16:03, miles for a meter reading, A1 and A2, the J611 Unplanned work, the shop drives, as of the latest Import', async () => {
    truckLogs['drv-a 2026-11-16'] = truckLogAsOf('16:20');
    open('/');
    const today = await day('Today, Mon, Nov 16');
    const log = await within(today).findByRole('region', { name: 'Truck log' });
    expect(cardsIn(today).at(-1)!.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header(log)).toMatchObject({
      Truck: '55 (MCK-55-17)',
      'Start time': '06:24',
      'End time': '16:03',
      'Start miles': 'meter reading',
      'End miles': 'meter reading',
    });
    expect(within(log).getAllByRole('group', { name: /^Assignment \d/ })).toHaveLength(2);
    expect(within(log).getByRole('group', { name: 'Unplanned work' }).textContent).toContain('J611 Bishop Kearney');
    expect(within(log).getByRole('group', { name: 'To and from the shop' }).querySelectorAll('li')).toHaveLength(2);
    expect(within(log).queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(within(today).getByText('As of the Import at 16:25')).toBeTruthy();
  });

  it('shows what is known with only the 10:15 cut stored, and no end time', async () => {
    truckLogs['drv-a 2026-11-16'] = truckLogAsOf('10:15');
    open('/');
    const log = await within(await day('Today, Mon, Nov 16')).findByRole('region', { name: 'Truck log' });
    expect(header(log)).toMatchObject({ 'Start time': '06:24', 'End time': '' });
    expect(screen.getByText('As of the Import at 10:20')).toBeTruthy();
  });

  it('shows none when his day read has none', async () => {
    open('/');
    const today = await day('Today, Mon, Nov 16');
    await waitFor(() => expect(cardsIn(today)).toHaveLength(2));
    expect(within(today).queryByRole('region', { name: 'Truck log' })).toBeNull();
  });
});
