// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { weekDates } from '../../shared/days';
import type { CheckIn, DriverAssignment, DriverDay, Inspection, NewInspection } from '../../shared/types';

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
/** Every Finish the phone sent, and how many to fail before one is saved. */
const finished: NewInspection[] = [];
let failFinishes = 0;
/** The Worker's clock when a Finish is saved: 6:42 AM US Eastern. */
const DONE_AT = '2026-11-19T11:42:00.000Z';

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const path = url.pathname;
  if (path.endsWith('/api/today')) return answer(businessDay);
  if (path.endsWith('/api/check-ins')) {
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
    };
    checkIns[businessDay.today] = [
      ...(checkIns[businessDay.today] ?? []).filter((c) => c.driverId !== driver.id),
      { driverId: driver.id, driverName: driver.name, truckId: truck.id, truckNumber: truck.number, inspectionId: body.id, doneAt: DONE_AT, needsRepair },
    ];
    return answer({ inspection }, 201);
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
  const driverDay = /\/api\/drivers\/([^/]+)\/days\/([^/]+)$/.exec(path);
  if (driverDay) {
    read.push(`${driverDay[1]} ${driverDay[2]}`);
    if (failDriverDays) return answer({ error: 'oops' }, 500);
    const [, driverId, date] = driverDay;
    const day: DriverDay = { date, assignments: sentDays[`${driverId} ${date}`] ?? [] };
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
  failDriverDays = false;
  read.length = 0;
  trucks = trucks.map((t) => ({ ...t, active: t.id !== 'trk-30' }));
  checkIns = {};
  finished.length = 0;
  failFinishes = 0;
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
    expect(line.textContent).toBe('Truck 24 · checked in 6:42 · Check in again');
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

  it('shows the line when he has already checked in, and Check in again starts a new one that then counts', async () => {
    checkIns['2026-11-19'] = [LATER_CHECK_IN];
    open('/');
    const line = await screen.findByRole('region', { name: 'Checked in' });
    expect(line.textContent).toBe('Truck 21 · checked in 6:05 · Check in again');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();

    fireEvent.click(within(line).getByRole('button', { name: 'Check in again' }));
    fireEvent.click(await within(await truckPicker()).findByRole('button', { name: 'Truck 27' }));
    await start();
    tap('Tires / wheels', 'OK');
    tap('Lights', 'OK');
    fireEvent.click(finish());
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toBe('Truck 27 · checked in 6:42 · Check in again');
    expect(finished[0].id).not.toBe('earlier');
  });

  it('lets Check in again be put away, back to the line', async () => {
    checkIns['2026-11-19'] = [LATER_CHECK_IN];
    open('/');
    fireEvent.click(within(await screen.findByRole('region', { name: 'Checked in' })).getByRole('button', { name: 'Check in again' }));
    fireEvent.click(within(await checkInCard()).getByRole('button', { name: 'Cancel' }));
    expect((await screen.findByRole('region', { name: 'Checked in' })).textContent).toBe('Truck 21 · checked in 6:05 · Check in again');
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
    fireEvent.click(screen.getByRole('button', { name: 'Day after' }));
    await day('Sat, Nov 21');
    expect(screen.queryByRole('region', { name: 'Check in' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Checked in' })).toBeNull();
  });
});
