// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { toast } from './components/ui/sonner';
import { dayState, draftsOn, holidayName, sinceSent, weekDates, type DayTimes } from '../shared/days';

/**
 * The API as the page sees it: today in US Eastern is Thursday 2026-11-19,
 * so tomorrow and the next Working day are 2026-11-20 (a test can move today), two
 * seeded Drivers with usual Trucks, an inactive Driver and Truck, and
 * Assignments that stay once added.
 */
let assignments: Record<string, unknown>[] = [];
const THURSDAY = { today: '2026-11-19', tomorrow: '2026-11-20', nextWorkingDay: '2026-11-20' };
let businessDay = THURSDAY;
let failLoads = false;
let failSaves = false;
let refuse: Record<string, string> | null = null;
let copyRefusal: { status: number; body: unknown } | null = null;
let failLists = false;
/** What Assign answers instead of Assigning, when a test says so. */
let assignRefusal: { status: number; body: unknown } | null = null;
/** When the week strip's read fails. */
let failWeeks = false;
/** Each Driver's check-in on today, as GET api/check-ins answers it (his latest Inspection). */
let checkIns: Record<string, unknown>[] = [];
/** Every Truck problem, open or fixed, as GET api/truck-problems lists them (?open=1 leaves out fixed ones). */
let problems: Record<string, unknown>[] = [];
/** The query of each read of the Truck problems. */
const problemReads: string[] = [];
/** When an Assignment set up by a test was Assigned: 4:15 PM Eastern on Thursday 2026-11-19, before its day. */
const ASSIGNED_AT = '2026-11-19T21:15:00.000Z';
/** When the Worker records an Assign the page makes: 5:45 PM Eastern on Thursday 2026-11-19. */
const NOW = '2026-11-19T22:45:00.000Z';
const drivers = [
  { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', active: true },
  { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: 'trk-24', active: true },
  { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: null, active: false },
];
const trucks = [
  { id: 'trk-21', number: '21', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-99', number: '99', hcssCode: null, hcssGuid: null, active: false },
];
const places = [
  { id: 'plc-plant', shortName: 'Sample Plant', fullName: null, kind: 'plant', jobId: null, active: true },
  { id: 'plc-north', shortName: 'Sample Site North', fullName: null, kind: 'job_site', jobId: 'job-n', active: true },
  { id: 'plc-x', shortName: 'Sample Old Pit', fullName: null, kind: null, jobId: null, active: false },
];
const materials = [
  { id: 'mat-minus', name: '2" minus', active: true },
  { id: 'mat-dirt', name: 'Sample Dirt', active: true },
  { id: 'mat-old', name: 'Sample Old Fill', active: false },
];
const foremen = [
  { id: 'frm-a', name: 'Sample Foreman A', active: true },
  { id: 'frm-x', name: 'Sample Foreman X', active: false },
];
/** The saved fields of an Assignment, with the names of its Driver, Truck, Places, Material and Foreman resolved. */
const resolve = (body: {
  date: string;
  driverId?: string | null;
  truckId?: string | null;
  fromPlaceId?: string | null;
  toPlaceId?: string | null;
  materialId?: string | null;
  foremanId?: string | null;
  note?: string | null;
  fromPlaceName?: string | null;
  toPlaceName?: string | null;
  materialName?: string | null;
}) => {
  const driver = drivers.find((d) => d.id === body.driverId);
  const truck = trucks.find((t) => t.id === body.truckId);
  // A typed name links the entry with that name, ignoring case, or a new one, as the Worker does.
  const named = <T extends { id: string }>(entries: T[], name: (entry: T) => string, typed: string | null | undefined, kind: string) =>
    typed ? (entries.find((e) => name(e).toLowerCase() === typed.toLowerCase()) ?? ({ id: `new-${kind}-${typed}`, [kind === 'place' ? 'shortName' : 'name']: typed } as unknown as T)) : undefined;
  const from = named(places, (p) => p.shortName, body.fromPlaceName, 'place') ?? places.find((p) => p.id === body.fromPlaceId);
  const to = named(places, (p) => p.shortName, body.toPlaceName, 'place') ?? places.find((p) => p.id === body.toPlaceId);
  const material = named(materials, (m) => m.name, body.materialName, 'material') ?? materials.find((m) => m.id === body.materialId);
  const foreman = foremen.find((f) => f.id === body.foremanId);
  return {
    date: body.date,
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    truckId: truck?.id ?? null,
    truckNumber: truck?.number ?? null,
    fromPlaceId: from?.id ?? null,
    fromPlaceName: from?.shortName ?? null,
    toPlaceId: to?.id ?? null,
    toPlaceName: to?.shortName ?? null,
    materialId: material?.id ?? null,
    materialName: material?.name ?? null,
    foremanId: foreman?.id ?? null,
    foremanName: foreman?.name ?? null,
    note: body.note || null,
  };
};
/** Where the Worker puts an Assignment that joins a lane: after the last one already in it. */
const lastInLane = (date: unknown, driverId: unknown) =>
  Math.max(-1, ...assignments.filter((a) => a.date === date && (a.driverId ?? null) === (driverId ?? null)).map((a) => Number(a.position ?? 0))) + 1;
/**
 * An Assignment as the Worker answers it: a Draft unless it was Assigned, and
 * marked Changed or Added by the shared day rules.
 */
const marked = (a: Record<string, unknown>) => {
  const full = { cancelledAt: null, assignedAt: null, handedFromId: null, changedAt: null, ...a } as unknown as Record<string, unknown> & DayTimes;
  return { ...full, sinceSent: sinceSent(full) };
};
/** The latest day before `date` with an Assignment that is not cancelled: the one Start from copies. */
const latestBefore = (date: string) =>
  assignments
    .filter((a) => String(a.date) < date && !a.cancelledAt)
    .map((a) => String(a.date))
    .sort()
    .at(-1) ?? null;
const sent: unknown[] = [];
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/api/today')) return answer(businessDay);
  if (failLists && /\/api\/(drivers|trucks|places|materials|foremen)$/.test(url.pathname)) return answer({ error: 'oops' }, 500);
  if (url.pathname.endsWith('/api/drivers')) return answer({ drivers });
  if (url.pathname.endsWith('/api/trucks')) return answer({ trucks });
  if (url.pathname.endsWith('/api/places')) return answer({ places });
  if (url.pathname.endsWith('/api/materials')) return answer({ materials });
  if (url.pathname.endsWith('/api/foremen')) return answer({ foremen });
  if (url.pathname.endsWith('/api/check-ins')) {
    sent.push({ checkIns: url.searchParams.get('date') });
    return answer({ date: url.searchParams.get('date'), checkIns });
  }
  if (url.pathname.endsWith('/api/truck-problems')) {
    problemReads.push(url.search);
    const truckId = url.searchParams.get('truckId');
    return answer({
      problems: problems.filter((p) => (url.searchParams.get('open') !== '1' || !p.fixedAt) && (!truckId || p.truckId === truckId)),
    });
  }
  const week = /\/api\/weeks\/([^/]+)$/.exec(url.pathname);
  if (week) {
    if (failWeeks) return answer({ error: 'oops' }, 500);
    // Each day's state by the shared day rules, as the Worker reads it.
    const days = weekDates(week[1]).map((date) => {
      const planned = assignments.filter((a) => a.date === date).map(marked);
      return { date, state: dayState(planned).state, drafts: draftsOn(planned), holiday: holidayName(date) };
    });
    return answer({ days });
  }
  const startingFrom = /\/api\/days\/([^/]+)\/start-from$/.exec(url.pathname);
  const copyingTo = /\/api\/days\/([^/]+)\/copy-to$/.exec(url.pathname);
  if (startingFrom && !init?.method) return answer({ from: latestBefore(startingFrom[1]) });
  if ((startingFrom || copyingTo) && init?.method === 'POST') {
    // Copies a day that is not cancelled onto an empty one, notes dropped, as the Worker does.
    const to = startingFrom ? startingFrom[1] : JSON.parse(String(init.body)).to;
    const from = startingFrom ? latestBefore(to) : copyingTo![1];
    sent.push(startingFrom ? { startFrom: to } : { copy: from, to });
    if (copyRefusal) return answer(copyRefusal.body, copyRefusal.status);
    if (assignments.some((a) => a.date === to)) return answer({ error: 'day_planned', message: 'That day already has Assignments, so nothing was copied onto it.' }, 409);
    const copies = assignments
      .filter((a) => a.date === from && !a.cancelledAt)
      .map((a, i) => ({ ...a, id: `c${assignments.length + i + 1}`, date: to, note: null, createdAt: '2026-11-19T22:00:00.000Z', updatedAt: '2026-11-19T22:00:00.000Z', changedAt: null, assignedAt: null, handedFromId: null }));
    assignments.push(...copies);
    return answer({ from, to, assignments: copies.map(marked) }, 201);
  }
  if (init?.body) sent.push(JSON.parse(String(init.body)));
  const puttingBack = /\/api\/assignments\/([^/]+)\/put-back$/.exec(url.pathname);
  if (puttingBack && init?.method === 'POST') {
    if (failSaves) return answer({ error: 'oops' }, 500);
    const back = assignments.find((a) => a.id === puttingBack[1])!;
    if (back.cancelledAt) Object.assign(back, { cancelledAt: null, updatedAt: '2026-11-19T22:30:00.000Z', changedAt: '2026-11-19T22:30:00.000Z' });
    return answer({ assignment: marked(back) });
  }
  const assigning = /\/api\/assignments\/([^/]+)\/assign$/.exec(url.pathname);
  if (assigning && init?.method === 'POST') {
    sent.push({ assign: assigning[1] });
    if (assignRefusal) return answer(assignRefusal.body, assignRefusal.status);
    // Gives it to its Driver, keeping the first time if it was Assigned already, as the Worker does.
    const given = assignments.find((a) => a.id === assigning[1])!;
    if (!given.driverId) return answer({ error: 'unassigned', message: 'This Assignment has no Driver yet. Give it a Driver, then Assign it.' }, 409);
    given.assignedAt ??= NOW;
    return answer({ assignment: marked(given) });
  }
  const moving = /\/api\/assignments\/([^/]+)\/move$/.exec(url.pathname);
  if (moving && init?.method === 'POST') {
    if (failSaves) return answer({ error: 'oops' }, 500);
    // Swaps it with its neighbour and numbers the lane again; only the one moved is changed.
    const moved = assignments.find((a) => a.id === moving[1])!;
    const inLane = assignments
      .filter((a) => a.date === moved.date && (a.driverId ?? null) === (moved.driverId ?? null))
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    const from = inLane.indexOf(moved);
    const to = from + (JSON.parse(String(init.body)).direction === 'earlier' ? -1 : 1);
    [inLane[from], inLane[to]] = [inLane[to], inLane[from]];
    inLane.forEach((a, position) => (a.position = position));
    Object.assign(moved, { updatedAt: '2026-11-19T21:00:00.000Z', changedAt: '2026-11-19T21:00:00.000Z' });
    return answer({ assignments: inLane.map(marked) });
  }
  if (init?.method === 'POST') {
    if (failSaves) return answer({ error: 'oops' }, 500);
    if (refuse) return answer({ error: 'invalid', fields: refuse }, 400);
    const fields = resolve(JSON.parse(String(init.body)));
    const assignment = {
      id: `a${assignments.length + 1}`,
      ...fields,
      position: lastInLane(fields.date, fields.driverId),
      createdAt: '2026-11-19T20:00:00.000Z',
      updatedAt: '2026-11-19T20:00:00.000Z',
      changedAt: null,
    };
    assignments.push(assignment);
    return answer({ assignment }, 201);
  }
  const one = /\/api\/assignments\/([^/]+)$/.exec(url.pathname);
  if (one && init?.method === 'PATCH') {
    if (failSaves) return answer({ error: 'oops' }, 500);
    // Only the fields sent change; a real change of Driver goes last in his lane.
    const index = assignments.findIndex((a) => a.id === one[1]);
    const before = assignments[index];
    // The names it had are answers, not typed names: only a name the change sends is typed.
    const { fromPlaceName: _from, toPlaceName: _to, materialName: _material, ...ids } = before;
    const fields = resolve({ ...ids, ...JSON.parse(String(init.body)) } as Parameters<typeof resolve>[0]);
    const sameLane = (before.driverId ?? null) === fields.driverId;
    // Once it is Assigned a new Driver cancels it for the first one and adds a copy, last in the new lane:
    // Assigned at once to a Driver (handed over, so Added), a Draft in Unassigned.
    if (!sameLane && before.assignedAt) {
      Object.assign(before, { cancelledAt: '2026-11-19T22:00:00.000Z', updatedAt: '2026-11-19T22:00:00.000Z', changedAt: '2026-11-19T22:00:00.000Z' });
      const copy = {
        ...fields,
        id: `a${assignments.length + 1}`,
        position: lastInLane(fields.date, fields.driverId),
        createdAt: '2026-11-19T22:00:00.000Z',
        updatedAt: '2026-11-19T22:00:00.000Z',
        changedAt: null,
        cancelledAt: null,
        assignedAt: fields.driverId ? '2026-11-19T22:00:00.000Z' : null,
        handedFromId: fields.driverId ? before.id : null,
      };
      assignments.push(copy);
      return answer({ assignment: marked(copy), cancelled: marked(before) });
    }
    assignments[index] = {
      ...before,
      ...fields,
      position: sameLane ? before.position : lastInLane(fields.date, fields.driverId),
      updatedAt: '2026-11-19T21:00:00.000Z',
      changedAt: '2026-11-19T21:00:00.000Z',
    };
    return answer({ assignment: marked(assignments[index]) });
  }
  if (one && init?.method === 'DELETE') {
    sent.push({ delete: one[1] });
    if (failSaves) return answer({ error: 'oops' }, 500);
    // ✕ cancels an Assigned one, keeping it; it deletes a Draft.
    const off = assignments.find((a) => a.id === one[1])!;
    if (off.assignedAt) {
      off.cancelledAt ??= '2026-11-19T22:00:00.000Z';
      Object.assign(off, { updatedAt: off.cancelledAt, changedAt: off.cancelledAt });
      return answer({ assignment: marked(off) });
    }
    assignments = assignments.filter((a) => a.id !== one[1]);
    return new Response(null, { status: 204 });
  }
  if (failLoads) return answer({ error: 'oops' }, 500);
  // In each lane's order (the page groups the lanes itself), marked Changed or Added by the shared day rules, as the Worker does.
  const date = url.searchParams.get('date') ?? '';
  const day = assignments
    .filter((a) => a.date === date)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map(marked);
  return answer({ assignments: day });
});

const open = (address: string) => {
  window.history.pushState(null, '', address);
  return render(<App />);
};
const address = () => window.location.pathname + window.location.search;
const subtitle = () => screen.getByRole('heading', { level: 1 }).nextElementSibling?.textContent;
const lane = (driver: string) => screen.getByRole('article', { name: driver });
/** A lane's blocks as they read, in order: the block itself (its edit button on a day that can be changed), without its Assign. */
const blocks = (driver: string) =>
  within(lane(driver))
    .queryAllByRole('listitem')
    .map((block) => (within(block).queryByRole('button', { name: /^Edit / }) ?? block).textContent);

beforeEach(() => {
  assignments = [];
  businessDay = THURSDAY;
  sent.length = 0;
  failLoads = false;
  failSaves = false;
  refuse = null;
  copyRefusal = null;
  failLists = false;
  assignRefusal = null;
  failWeeks = false;
  checkIns = [];
  problems = [];
  problemReads.length = 0;
  api.mockClear();
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  ['standalone at the root', ''],
  ['under the Hub prefix', '/truck-dispatch'],
])('%s', (_name, prefix) => {
  it('shows Settings when its address is loaded directly', async () => {
    open(`${prefix}/settings`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });

  it('links the Board to Settings and back, at their own addresses', async () => {
    open(`${prefix}/?date=2026-11-20`);
    expect(screen.getByRole('heading', { level: 1, name: 'Dispatch' })).toBeTruthy();

    const toSettings = screen.getByRole('link', { name: 'Settings' });
    expect(toSettings.getAttribute('href')).toBe(`${prefix}/settings`);
    fireEvent.click(toSettings);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(window.location.pathname).toBe(`${prefix}/settings`);

    const toBoard = screen.getByRole('link', { name: 'Board' });
    expect(toBoard.getAttribute('href')).toBe(`${prefix}/`);
    fireEvent.click(toBoard);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dispatch' })).toBeTruthy();
    expect(window.location.pathname).toBe(`${prefix}/`);
  });

  it.each([
    ['Board', '/', 'Dispatch'],
    ['Settings', '/settings', 'Settings'],
  ])('gives the %s page the Hub header: a "← Hub" link, an uppercase Oswald title and a subtitle, with no bottom nav', (_page, path, title) => {
    open(`${prefix}${path}`);
    expect(screen.getByRole('link', { name: '← Hub' }).getAttribute('href')).toBe('/');
    const heading = screen.getByRole('heading', { level: 1, name: title });
    expect(heading.className).toContain('font-display');
    expect(heading.className).toContain('uppercase');
    expect(heading.nextElementSibling?.textContent).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it.each([
    ['Board', '/'],
    ['Settings', '/settings'],
  ])('shows a toast raised on the %s page', async (_page, path) => {
    open(`${prefix}${path}`);
    act(() => {
      toast.success('Saved the Assignment');
    });
    expect(await screen.findByText('Saved the Assignment')).toBeTruthy();
  });

  it('opens the Board on the next Working day in US Eastern time when the address names no day, and puts that day in the address', async () => {
    open(`${prefix}/`);
    await waitFor(() => expect(subtitle()).toBe('Fri, Nov 20 · Tomorrow'));
    expect(address()).toBe(`${prefix}/?date=2026-11-20`);
    expect(await screen.findByText(/^Nothing planned for /)).toBeTruthy();
  });

  it('opens on the Monday when today is a Friday', async () => {
    businessDay = { today: '2026-11-20', tomorrow: '2026-11-21', nextWorkingDay: '2026-11-23' };
    open(`${prefix}/`);
    await waitFor(() => expect(subtitle()).toBe('Mon, Nov 23 · Next Monday'));
    expect(address()).toBe(`${prefix}/?date=2026-11-23`);
  });

  it('opens the Board on the day the address names, with its short date and word as the subtitle', async () => {
    assignments = [{ id: 'a0', date: '2026-11-18', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', createdAt: '', updatedAt: '' }];
    open(`${prefix}/?date=2026-11-18`);
    expect(await screen.findByText('Haul stone')).toBeTruthy();
    expect(subtitle()).toBe('Wed, Nov 18 · Yesterday');
    expect(address()).toBe(`${prefix}/?date=2026-11-18`);
  });

  it('names a Holiday in the subtitle', async () => {
    open(`${prefix}/?date=2026-11-26`);
    await waitFor(() => expect(subtitle()).toBe('Thu, Nov 26 · Next Thursday · Thanksgiving'));
  });

  it('steps by Working day with arrows that name their day, and the address follows the day on screen', async () => {
    assignments = [{ id: 'a0', date: '2026-11-23', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Monday work', createdAt: '', updatedAt: '' }];
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText(/^Nothing planned for /);

    fireEvent.click(screen.getByRole('button', { name: 'Next Working day, Mon 23' }));
    expect(await screen.findByText('Monday work')).toBeTruthy();
    expect(subtitle()).toBe('Mon, Nov 23 · Next Monday');
    expect(address()).toBe(`${prefix}/?date=2026-11-23`);

    fireEvent.click(screen.getByRole('button', { name: 'Previous Working day, Fri 20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous Working day, Thu 19' }));
    await waitFor(() => expect(subtitle()).toBe('Thu, Nov 19 · Today'));
    expect(address()).toBe(`${prefix}/?date=2026-11-19`);
  });

  it('skips a Holiday with the arrows', async () => {
    open(`${prefix}/?date=2026-11-25`);
    fireEvent.click(await screen.findByRole('button', { name: 'Next Working day, Fri 27' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-27`));
    fireEvent.click(screen.getByRole('button', { name: 'Previous Working day, Wed 25' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-25`));
  });

  it('steps by Working day with the left and right arrow keys when no field has the focus', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText(/^Nothing planned for /);

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-23`));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-20`));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-19`));
  });

  it('leaves the arrow keys to a field that has the focus', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText(/^Nothing planned for /);

    fireEvent.click(await within(lane('Unassigned')).findByRole('button', { name: 'Add an Assignment for Unassigned' }));
    fireEvent.click(screen.getByRole('button', { name: /Note or other truck/ }));
    const note = screen.getByLabelText('Note');
    note.focus();
    fireEvent.keyDown(note, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(address()).toBe(`${prefix}/?date=2026-11-20`);
  });

  it('offers Back to the next Working day only when the board is on another day', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText(/^Nothing planned for /);
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next Working day, Mon 23' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-23`));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Fri, Nov 20' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-20`));
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
  });

  it('adds an Assignment with only the day from the Unassigned lane\'s +, confirms it, and shows it there', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText(/^Nothing planned for /);

    fireEvent.click(await within(lane('Unassigned')).findByRole('button', { name: 'Add an Assignment for Unassigned' }));
    fireEvent.click(within(lane('Unassigned')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(await within(lane('Unassigned')).findByText('No details yet')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ date: '2026-11-20', driverId: null })]);
    expect(api.mock.calls.some(([url, init]) => init?.method === 'POST' && String(url) === `${prefix}/api/assignments`)).toBe(true);
    expect(address()).toBe(`${prefix}/?date=2026-11-20`);
  });

  it('keeps the Board\'s API calls under the same prefix as the page', async () => {
    open(`${prefix}/`);
    await screen.findByText(/^Nothing planned for /);
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).includes('/api/weeks/'))).toBe(true));
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).includes('/start-from'))).toBe(true));
    expect([...new Set(api.mock.calls.map(([url]) => String(url)))].sort()).toEqual([
      `${prefix}/api/assignments?date=2026-11-20`,
      `${prefix}/api/days/2026-11-20/start-from`,
      `${prefix}/api/drivers?include=inactive`,
      `${prefix}/api/foremen?include=inactive`,
      `${prefix}/api/materials?include=inactive`,
      `${prefix}/api/places?include=inactive`,
      `${prefix}/api/today`,
      `${prefix}/api/truck-problems?open=1`,
      `${prefix}/api/trucks?include=inactive`,
      `${prefix}/api/weeks/2026-11-16`,
    ]);
  });
});

describe('Board', () => {
  it('says so when a day cannot be loaded, rather than showing it as empty', async () => {
    failLoads = true;
    open('/?date=2026-11-20');
    expect(await screen.findByText('Could not load the Assignments for this day.')).toBeTruthy();
    expect(screen.queryByText(/^Nothing planned for /)).toBeNull();
  });

  it('says so when the lists to pick from cannot be loaded, and still shows the day', async () => {
    failLists = true;
    assignments = [{ id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone' }];
    open('/?date=2026-11-20');
    expect(await screen.findByText('Could not load the Drivers, Trucks, Places, Materials and Foremen to pick from. Reload the page to try again.')).toBeTruthy();
    expect(within(lane('Sample Driver A')).getByText('Haul stone')).toBeTruthy();
  });
});

describe('the lanes', () => {
  const at = (fields: Record<string, unknown>) => ({ date: '2026-11-20', driverId: null, driverName: null, createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', ...fields });
  const a = { driverId: 'drv-a', driverName: 'Sample Driver A' };
  const lanes = () => screen.getAllByRole('article').map((lane) => within(lane).getByRole('heading').textContent);

  it('shows a lane for each active Driver with his usual Truck, and Unassigned last, each saying "Nothing planned yet" on an empty day', async () => {
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    await waitFor(() => expect(lanes()).toEqual(['Sample Driver A', 'Sample Driver B', 'Unassigned']));
    expect(within(lane('Sample Driver A')).getByText('Truck 21')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByText('Truck 24')).toBeTruthy();
    for (const driver of ['Sample Driver A', 'Sample Driver B', 'Unassigned']) expect(within(lane(driver)).getByText('Nothing planned yet')).toBeTruthy();
  });

  it('shows a removed Driver\'s lane, marked removed, only on a day he has Assignments', async () => {
    assignments = [at({ id: 'a1', driverId: 'drv-x', driverName: 'Sample Driver X', note: 'Haul stone' })];
    open('/?date=2026-11-20');
    await waitFor(() => expect(lanes()).toEqual(['Sample Driver A', 'Sample Driver B', 'Sample Driver X', 'Unassigned']));
    expect(within(lane('Sample Driver X')).getByText('Removed')).toBeTruthy();
    expect(blocks('Sample Driver X')).toEqual(['First · Draft · Haul stone']);

    fireEvent.click(screen.getByRole('button', { name: 'Next Working day, Mon 23' }));
    await screen.findByText(/^Nothing planned for /);
    expect(lanes()).toEqual(['Sample Driver A', 'Sample Driver B', 'Unassigned']);
  });

  it('shows a lane\'s blocks in the order Dave set, marked First and Then, reading From → To or the note', async () => {
    assignments = [
      at({ id: 'a1', ...a, note: 'Move the excavator', position: 1 }),
      at({ id: 'a2', ...a, fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North', position: 0 }),
      at({ id: 'a3', note: 'Who takes this?', position: 0 }),
    ];
    open('/?date=2026-11-20');
    expect(await screen.findByText('Move the excavator')).toBeTruthy();
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Sample Plant → Sample Site North · Truck 21 (his own)', 'Then · Draft · Move the excavator · Truck 21 (his own)']);
    expect(blocks('Unassigned')).toEqual(['First · Draft · Who takes this?']);
    expect(within(lane('Sample Driver B')).getByText('Nothing planned yet')).toBeTruthy();
  });

});

describe('the composer', () => {
  /** Opens the composer with the + on a lane, once the lists it offers have loaded. */
  const compose = async (driver: string) => {
    const add = await within(await screen.findByRole('article', { name: driver })).findByRole('button', { name: `Add an Assignment for ${driver}` });
    fireEvent.click(add);
    const composer = within(lane(driver)).getByRole('form', { name: `New Assignment for ${driver}` });
    await within(composer).findAllByRole('button', { name: 'Sample Plant' });
    return composer;
  };
  /** The chips of a row as they read. */
  const chips = (composer: HTMLElement, row: string) => within(within(composer).getByRole('group', { name: row })).getAllByRole('button').map((chip) => chip.textContent);
  /** The chips of a row that are picked. */
  const pressed = (composer: HTMLElement, row: string) =>
    within(within(composer).getByRole('group', { name: row })).queryAllByRole('button', { pressed: true }).map((chip) => chip.textContent);
  const tap = (composer: HTMLElement, row: string, chip: string) =>
    fireEvent.click(within(within(composer).getByRole('group', { name: row })).getByRole('button', { name: chip }));
  const type = (composer: HTMLElement, row: string, name: string) => {
    tap(composer, row, 'Or type it');
    fireEvent.change(within(composer).getByRole('textbox', { name: `${row}, typed` }), { target: { value: name } });
  };
  const preview = (composer: HTMLElement) => within(composer).getByRole('status').textContent;
  const save = (composer: HTMLElement) => fireEvent.click(within(composer).getByRole('button', { name: 'Save' }));
  const day = async () => {
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
  };

  it('has a + on every lane, Unassigned included, and opens one composer at a time, under that Driver', async () => {
    await day();
    for (const driver of ['Sample Driver A', 'Sample Driver B', 'Unassigned']) {
      expect(await within(lane(driver)).findByRole('button', { name: `Add an Assignment for ${driver}` })).toBeTruthy();
    }
    await compose('Sample Driver A');
    await compose('Sample Driver B');
    expect(screen.getAllByRole('form')).toHaveLength(1);
    expect(within(lane('Sample Driver A')).queryByRole('form')).toBeNull();
  });

  it('offers Places and Materials as chips in the order of their lists, active ones only, each with "Or type it"', async () => {
    await day();
    const composer = await compose('Sample Driver A');
    expect(chips(composer, 'Pick up')).toEqual(['Sample Plant', 'Sample Site North', 'Or type it']);
    expect(chips(composer, 'Drop off')).toEqual(['Sample Plant', 'Sample Site North', 'Or type it']);
    expect(chips(composer, 'Hauling what?')).toEqual(['2" minus', 'Sample Dirt', 'Or type it']);
    expect(chips(composer, 'Foreman')).toEqual(['Sample Foreman A']);
  });

  it('offers the chips in Dave\'s own order of Places and Materials as the lists give it, not by name', async () => {
    places.reverse();
    materials.reverse();
    try {
      await day();
      const composer = await compose('Sample Driver A');
      expect(chips(composer, 'Pick up')).toEqual(['Sample Site North', 'Sample Plant', 'Or type it']);
      expect(chips(composer, 'Hauling what?')).toEqual(['Sample Dirt', '2" minus', 'Or type it']);
    } finally {
      places.reverse();
      materials.reverse();
    }
  });

  it("adds an Assignment from a Driver's lane with chips, previewed as a sentence, last in his lane", async () => {
    assignments = [{ id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', position: 0, createdAt: '', updatedAt: '' }];
    open('/?date=2026-11-20');
    const composer = await compose('Sample Driver A');
    expect(preview(composer)).toBe('Sample Driver A: just the day so far');
    tap(composer, 'Pick up', 'Sample Plant');
    tap(composer, 'Drop off', 'Sample Site North');
    tap(composer, 'Hauling what?', '2" minus');
    tap(composer, 'Foreman', 'Sample Foreman A');
    expect(preview(composer)).toBe('Sample Driver A hauls 2" minus from Sample Plant to Sample Site North (Sample Foreman A)');
    save(composer);

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([
      { date: '2026-11-20', driverId: 'drv-a', truckId: null, fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-minus', foremanId: 'frm-a', note: null },
    ]);
    await waitFor(() =>
      expect(blocks('Sample Driver A')).toEqual([
        'First · Draft · Haul stone · Truck 21 (his own)',
        'Then · Draft · Sample Plant → Sample Site North (Sample Foreman A) · 2" minus · Truck 21 (his own)',
      ]),
    );
  });

  it('adds an Assignment to Unassigned with typed names, saved by name', async () => {
    await day();
    const composer = await compose('Unassigned');
    type(composer, 'Pick up', 'Sample New Pit');
    tap(composer, 'Drop off', 'Sample Site North');
    type(composer, 'Hauling what?', 'sample dirt');
    expect(preview(composer)).toBe('Someone hauls sample dirt from Sample New Pit to Sample Site North');
    save(composer);

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([
      { date: '2026-11-20', driverId: null, truckId: null, fromPlaceName: 'Sample New Pit', toPlaceId: 'plc-north', materialName: 'sample dirt', foremanId: null, note: null },
    ]);
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · Draft · Sample New Pit → Sample Site North · Sample Dirt']));
  });

  it('drops a typed name when a chip is picked instead, and leaves a row blank when its picked chip is tapped again', async () => {
    await day();
    const composer = await compose('Unassigned');
    type(composer, 'Pick up', 'Sample New Pit');
    tap(composer, 'Pick up', 'Sample Plant');
    expect(within(composer).queryByRole('textbox', { name: 'Pick up, typed' })).toBeNull();
    expect(pressed(composer, 'Pick up')).toEqual(['Sample Plant']);
    tap(composer, 'Hauling what?', 'Sample Dirt');
    tap(composer, 'Hauling what?', 'Sample Dirt');
    expect(pressed(composer, 'Hauling what?')).toEqual([]);
    save(composer);
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-plant', materialId: null })]);
    expect(sent[0]).not.toHaveProperty('fromPlaceName');
  });

  it('saves with only the day, onto the Unassigned lane', async () => {
    await day();
    save(await compose('Unassigned'));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · Draft · No details yet']));
  });

  it('lets the same Place be both Pick up and Drop off', async () => {
    await day();
    const composer = await compose('Sample Driver B');
    tap(composer, 'Pick up', 'Sample Plant');
    tap(composer, 'Drop off', 'Sample Plant');
    save(composer);
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-plant', toPlaceId: 'plc-plant' })]);
  });

  it('keeps the Truck on "His own" unless "Note or other truck" names one, and takes a note', async () => {
    await day();
    const composer = await compose('Sample Driver B');
    expect(within(composer).queryByRole('group', { name: 'Truck' })).toBeNull();
    fireEvent.click(within(composer).getByRole('button', { name: 'Note or other truck' }));
    expect(chips(composer, 'Truck')).toEqual(['His own', '21', '24']);
    expect(pressed(composer, 'Truck')).toEqual(['His own']);
    tap(composer, 'Truck', '21');
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Note' }), { target: { value: 'Back by noon' } });
    expect(preview(composer)).toBe('Sample Driver B hauls in Truck 21 · Back by noon');
    save(composer);

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-b', truckId: 'trk-21', note: 'Back by noon' })]);
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Draft · Back by noon · Truck 21']));
    expect(within(lane('Sample Driver B')).getByText('Truck 21', { selector: 'li span' }).className).not.toContain('text-muted-foreground');
  });

  it('saves His own as no Truck, and the board shows his usual Truck in grey', async () => {
    await day();
    save(await compose('Sample Driver B'));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-b', truckId: null })]);
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Draft · No details yet · Truck 24 (his own)']));
    expect(within(lane('Sample Driver B')).getByText('Truck 24', { selector: 'li span' }).className).toContain('text-muted-foreground');
  });

  it('folds after a save, and remembers the Places and Material for the next +, until it is closed', async () => {
    await day();
    let composer = await compose('Sample Driver A');
    tap(composer, 'Pick up', 'Sample Plant');
    type(composer, 'Drop off', 'Sample New Site');
    tap(composer, 'Hauling what?', 'Sample Dirt');
    fireEvent.click(within(composer).getByRole('button', { name: 'Note or other truck' }));
    tap(composer, 'Truck', '24');
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Note' }), { target: { value: 'Two loads' } });
    save(composer);
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());

    composer = await compose('Sample Driver B');
    expect(pressed(composer, 'Pick up')).toEqual(['Sample Plant']);
    expect((within(composer).getByRole('textbox', { name: 'Drop off, typed' }) as HTMLInputElement).value).toBe('Sample New Site');
    expect(pressed(composer, 'Hauling what?')).toEqual(['Sample Dirt']);
    expect(preview(composer)).toBe('Sample Driver B hauls Sample Dirt from Sample Plant to Sample New Site');
    save(composer);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ date: '2026-11-20', driverId: 'drv-b', truckId: null, fromPlaceId: 'plc-plant', toPlaceName: 'Sample New Site', materialId: 'mat-dirt', foremanId: null, note: null });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());

    composer = await compose('Sample Driver B');
    fireEvent.click(within(lane('Sample Driver B')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('form')).toBeNull();
    composer = await compose('Sample Driver A');
    expect(pressed(composer, 'Pick up')).toEqual([]);
    expect(within(composer).queryByRole('textbox', { name: 'Drop off, typed' })).toBeNull();
    expect(pressed(composer, 'Hauling what?')).toEqual([]);
  });

  it('keeps what was typed and says so when a save fails', async () => {
    failSaves = true;
    await day();
    const composer = await compose('Sample Driver A');
    type(composer, 'Pick up', 'Sample New Pit');
    save(composer);
    expect(await within(composer).findByText('Could not save the Assignment. Try again.')).toBeTruthy();
    expect((within(composer).getByRole('textbox', { name: 'Pick up, typed' }) as HTMLInputElement).value).toBe('Sample New Pit');
    expect(blocks('Sample Driver A')).toEqual([]);
  });

  it("shows a refused field's message on its row and keeps the composer open", async () => {
    refuse = { fromPlaceName: 'Keep it to 100 characters or fewer.' };
    await day();
    const composer = await compose('Sample Driver A');
    type(composer, 'Pick up', 'Sample New Pit');
    save(composer);
    const message = await within(composer).findByText('Keep it to 100 characters or fewer.');
    expect(within(within(composer).getByRole('group', { name: 'Pick up' })).getByText('Keep it to 100 characters or fewer.')).toBe(message);
  });

  describe('the usual Foreman', () => {
    // A second job site whose usual Foreman is Sample Foreman B; Sample Site North has none.
    const south = { id: 'plc-south', shortName: 'Sample Site South', fullName: null, kind: 'job_site', jobId: null, usualForemanId: 'frm-b', active: true };
    const brody = { id: 'frm-b', name: 'Sample Foreman B', active: true };
    beforeEach(() => {
      places.push(south);
      foremen.push(brody);
    });
    afterEach(() => {
      places.splice(places.indexOf(south), 1);
      foremen.splice(foremen.indexOf(brody), 1);
    });

    it("fills in the drop-off's usual Foreman when it is a job site", async () => {
      await day();
      const composer = await compose('Sample Driver A');
      tap(composer, 'Pick up', 'Sample Plant');
      tap(composer, 'Drop off', 'Sample Site South');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman B']);
      expect(preview(composer)).toBe('Sample Driver A hauls from Sample Plant to Sample Site South (Sample Foreman B)');
      save(composer);
      expect(await screen.findByText('Assignment saved')).toBeTruthy();
      expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-plant', toPlaceId: 'plc-south', foremanId: 'frm-b' })]);
    });

    it("fills in the pick-up's usual Foreman when the drop-off is not a job site", async () => {
      await day();
      const composer = await compose('Sample Driver A');
      tap(composer, 'Pick up', 'Sample Site South');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman B']);
      tap(composer, 'Drop off', 'Sample Plant');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman B']);
      expect(preview(composer)).toBe('Sample Driver A hauls from Sample Site South (Sample Foreman B) to Sample Plant');
    });

    it("takes the drop-off's job site over the pick-up's, even when it has no usual Foreman", async () => {
      await day();
      const composer = await compose('Sample Driver A');
      tap(composer, 'Pick up', 'Sample Site South');
      tap(composer, 'Drop off', 'Sample Site North');
      expect(pressed(composer, 'Foreman')).toEqual([]);
    });

    it('fills it in for a job site typed by its name', async () => {
      await day();
      const composer = await compose('Unassigned');
      type(composer, 'Drop off', 'sample site south');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman B']);
    });

    it('lets Dave change or clear it, and keeps his pick when the Places change', async () => {
      await day();
      const composer = await compose('Sample Driver A');
      tap(composer, 'Drop off', 'Sample Site South');
      tap(composer, 'Foreman', 'Sample Foreman A');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman A']);
      tap(composer, 'Drop off', 'Sample Plant');
      tap(composer, 'Drop off', 'Sample Site South');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman A']);
      tap(composer, 'Foreman', 'Sample Foreman A');
      expect(pressed(composer, 'Foreman')).toEqual([]);
      save(composer);
      expect(await screen.findByText('Assignment saved')).toBeTruthy();
      expect(sent).toEqual([expect.objectContaining({ toPlaceId: 'plc-south', foremanId: null })]);
    });

    it("fills it in again for the next Driver, after Dave changed it for the last one", async () => {
      await day();
      let composer = await compose('Sample Driver A');
      tap(composer, 'Drop off', 'Sample Site South');
      tap(composer, 'Foreman', 'Sample Foreman A');
      save(composer);
      expect(await screen.findByText('Assignment saved')).toBeTruthy();
      composer = await compose('Sample Driver B');
      expect(pressed(composer, 'Foreman')).toEqual(['Sample Foreman B']);
    });

    it('leaves out a usual Foreman who has been removed since', async () => {
      brody.active = false;
      try {
        await day();
        const composer = await compose('Sample Driver A');
        tap(composer, 'Drop off', 'Sample Site South');
        save(composer);
        expect(await screen.findByText('Assignment saved')).toBeTruthy();
        expect(sent).toEqual([expect.objectContaining({ toPlaceId: 'plc-south', foremanId: null })]);
      } finally {
        brody.active = true;
      }
    });
  });

  it('is the only way to add: there is no Add Assignment dialog, and a past day has no +', async () => {
    await day();
    expect(screen.queryByRole('button', { name: 'Add Assignment' })).toBeNull();
    cleanup();
    open('/?date=2026-11-18');
    await screen.findByText(/read-only/i);
    expect(screen.queryByRole('button', { name: /^Add an Assignment/ })).toBeNull();
  });
});

describe('opening an Assignment', () => {
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', position: 0,
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', changedAt: null, ...fields,
  });
  /** Taps a block by what it says, and answers its open sentence of chips, once the lists it offers have loaded. */
  const openBlock = async (words: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${words}` }));
    const opened = screen.getByRole('region', { name: 'Open Assignment' });
    await waitFor(() => expect(within(opened).getByRole('button', { name: /^Driver:/ }).hasAttribute('disabled')).toBe(false));
    return opened;
  };
  /** The sentence's chips as they read: each part and its value. */
  const sentenceOf = (opened: HTMLElement) =>
    within(opened).getAllByRole('button', { name: /^(Driver|Material|From|To|Truck|Foreman):/ }).map((chip) => chip.getAttribute('aria-label'));
  /** Taps a part of the sentence, and answers the row of choices it offers. */
  const tapPart = (opened: HTMLElement, part: string) => {
    fireEvent.click(within(opened).getByRole('button', { name: new RegExp(`^${part}:`) }));
    return within(opened).getByRole('group', { name: part });
  };
  const choicesIn = (row: HTMLElement) => within(row).getAllByRole('button').map((choice) => choice.textContent);
  const pick = (opened: HTMLElement, part: string, choice: string) => fireEvent.click(within(tapPart(opened, part)).getByRole('button', { name: choice }));
  const findLane = (driver: string) => screen.findByRole('article', { name: driver });

  it('opens a tapped block in its lane as a sentence of chips with its note, and closes it when tapped again', async () => {
    assignments = [planned({ fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', materialId: 'mat-minus', materialName: '2" minus' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Sample Plant · 2" minus · Haul stone · Draft');
    expect(within(lane('Sample Driver A')).getByRole('region', { name: 'Open Assignment' })).toBe(opened);
    expect(sentenceOf(opened)).toEqual([
      'Driver: Sample Driver A', 'Material: 2" minus', 'From: Sample Plant', 'To: no Place', 'Truck: His own', 'Foreman: no Foreman',
    ]);
    expect((within(opened).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('Haul stone');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Sample Plant · 2" minus · Haul stone · Draft' }));
    expect(screen.queryByRole('region', { name: 'Open Assignment' })).toBeNull();
  });

  it('keeps one Assignment open at a time', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil haul' })];
    open('/?date=2026-11-20');
    await openBlock('Haul stone · Draft');
    await openBlock('Topsoil haul · Draft');
    expect(screen.getAllByRole('region', { name: 'Open Assignment' })).toHaveLength(1);
    expect(within(lane('Sample Driver B')).getByRole('region', { name: 'Open Assignment' })).toBeTruthy();
  });

  it('offers each part\'s list, active entries only, with "Leave blank", Unassigned for the Driver and His own for the Truck', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    expect(choicesIn(tapPart(opened, 'Driver'))).toEqual(['Sample Driver A', 'Sample Driver B', 'Unassigned']);
    expect(choicesIn(tapPart(opened, 'Material'))).toEqual(['2" minus', 'Sample Dirt', 'Leave blank', 'Or type it']);
    expect(choicesIn(tapPart(opened, 'From'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank', 'Or type it']);
    expect(choicesIn(tapPart(opened, 'To'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank', 'Or type it']);
    expect(choicesIn(tapPart(opened, 'Truck'))).toEqual(['His own', '21', '24']);
    expect(choicesIn(tapPart(opened, 'Foreman'))).toEqual(['Sample Foreman A', 'Leave blank']);
    // One row of choices at a time.
    expect(within(opened).getAllByRole('group')).toHaveLength(1);
  });

  it('still offers, and shows, an entry made inactive since that the Assignment uses', async () => {
    assignments = [planned({ driverId: 'drv-x', driverName: 'Sample Driver X', truckId: 'trk-99', truckNumber: '99', fromPlaceId: 'plc-x', fromPlaceName: 'Sample Old Pit' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Sample Old Pit · Haul stone · Truck 99 · Draft');
    expect(sentenceOf(opened).slice(0, 5)).toEqual(['Driver: Sample Driver X', 'Material: no Material', 'From: Sample Old Pit', 'To: no Place', 'Truck: 99']);
    expect(choicesIn(tapPart(opened, 'From'))).toEqual(['Sample Plant', 'Sample Site North', 'Sample Old Pit (removed)', 'Leave blank', 'Or type it']);
    expect(choicesIn(tapPart(opened, 'To'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank', 'Or type it']);
  });

  it('saves a chip on its own, sending only that field, and the block shows it', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    pick(opened, 'Material', 'Sample Dirt');
    await waitFor(() => expect(sentenceOf(opened)[1]).toBe('Material: Sample Dirt'));
    expect(sent).toEqual([{ materialId: 'mat-dirt' }]);
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Sample Dirt · Truck 21 (his own)']);
    expect(within(opened).queryByRole('group')).toBeNull();
  });

  it('types a From, To or Material not in the list with "Or type it", saved by name on Enter or on leaving the box', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    fireEvent.click(within(tapPart(opened, 'From')).getByRole('button', { name: 'Or type it' }));
    const from = within(opened).getByRole('textbox', { name: 'From, typed' });
    fireEvent.change(from, { target: { value: ' Sample Pit ' } });
    fireEvent.keyDown(from, { key: 'Enter' });
    await waitFor(() => expect(sentenceOf(opened)[2]).toBe('From: Sample Pit'));
    expect(within(opened).queryByRole('group')).toBeNull();

    fireEvent.click(within(tapPart(opened, 'Material')).getByRole('button', { name: 'Or type it' }));
    const material = within(opened).getByRole('textbox', { name: 'Material, typed' });
    fireEvent.change(material, { target: { value: 'sample dirt' } });
    fireEvent.blur(material);
    await waitFor(() => expect(sentenceOf(opened)[1]).toBe('Material: Sample Dirt'));

    // Left blank, nothing is saved.
    fireEvent.click(within(tapPart(opened, 'To')).getByRole('button', { name: 'Or type it' }));
    fireEvent.blur(within(opened).getByRole('textbox', { name: 'To, typed' }));
    expect(sent).toEqual([{ fromPlaceName: 'Sample Pit' }, { materialName: 'sample dirt' }]);
  });

  it('clears a part with "Leave blank", and sets the Truck back to His own', async () => {
    assignments = [planned({ materialId: 'mat-minus', materialName: '2" minus', truckId: 'trk-24', truckNumber: '24' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · 2" minus · Truck 24 · Draft');
    pick(opened, 'Material', 'Leave blank');
    await waitFor(() => expect(sentenceOf(opened)[1]).toBe('Material: no Material'));
    pick(opened, 'Truck', 'His own');
    await waitFor(() => expect(sentenceOf(opened)[4]).toBe('Truck: His own'));
    expect(sent).toEqual([{ materialId: null }, { truckId: null }]);
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Truck 21 (his own)']);
  });

  it('saves the note on its own when Dave leaves it', async () => {
    assignments = [planned({ materialId: 'mat-minus', materialName: '2" minus' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · 2" minus · Draft');
    const note = within(opened).getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: 'Haul topsoil' } });
    fireEvent.blur(note);
    expect(await within(lane('Sample Driver A')).findByText('Haul topsoil')).toBeTruthy();
    expect(sent).toEqual([{ note: 'Haul topsoil' }]);
    // Leaving it again unchanged sends nothing more.
    fireEvent.blur(note);
    expect(sent).toHaveLength(1);
  });

  it('says so when a chip cannot be saved, and keeps showing the value it had', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    failSaves = true;
    pick(opened, 'Material', 'Sample Dirt');
    expect(await within(opened).findByText('Could not save the Material. Try again.')).toBeTruthy();
    expect(sentenceOf(opened)[1]).toBe('Material: no Material');
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Truck 21 (his own)']);
  });

  it('shows the Worker\'s message when a change is refused, e.g. for a day that is now past', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    api.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'past_day', message: 'This Assignment is on a day before today, which is read-only.' }), { status: 409 }),
    );
    pick(opened, 'Foreman', 'Sample Foreman A');
    expect(await within(opened).findByText('This Assignment is on a day before today, which is read-only.')).toBeTruthy();
    expect(sentenceOf(opened)[5]).toBe('Foreman: no Foreman');
  });

  it('moves it to the end of another Driver\'s lane when the Driver changes, still open', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil haul' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    pick(opened, 'Driver', 'Sample Driver B');
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Draft · Topsoil haul · Truck 24 (his own)', 'Then · Draft · Haul stone · Truck 24 (his own)']));
    expect(sent).toEqual([{ driverId: 'drv-b' }]);
    expect(within(lane('Sample Driver A')).getByText('Nothing planned yet')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByRole('region', { name: 'Open Assignment' })).toBeTruthy();
  });

  it('moves it to the end of the Unassigned lane when it is taken off its Driver', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: null, driverName: null, note: 'Who takes this?' })];
    open('/?date=2026-11-20');
    pick(await openBlock('Haul stone · Draft'), 'Driver', 'Unassigned');
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · Draft · Who takes this?', 'Then · Draft · Haul stone']));
    expect(sent).toEqual([{ driverId: null }]);
  });

  describe('Do this first and Do this later', () => {
    const three = () => [
      planned({ id: 'a1', note: 'Haul stone', position: 0 }),
      planned({ id: 'a2', note: 'Topsoil haul', position: 1 }),
      planned({ id: 'a3', note: 'Fill the shop', position: 2 }),
    ];
    const lineup = () => blocks('Sample Driver A').map((block) => block?.replace(/ · Truck 21 \(his own\)$/, ''));

    it('moves it one place earlier or later in its lane, and it stays open', async () => {
      assignments = three();
      open('/?date=2026-11-20');
      const opened = await openBlock('Topsoil haul · Draft');
      fireEvent.click(within(opened).getByRole('button', { name: 'Do this first' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Draft · Topsoil haul', 'Then · Draft · Haul stone', 'Then · Draft · Fill the shop']));
      fireEvent.click(within(screen.getByRole('region', { name: 'Open Assignment' })).getByRole('button', { name: 'Do this later' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Draft · Haul stone', 'Then · Draft · Topsoil haul', 'Then · Draft · Fill the shop']));
      expect(sent).toEqual([{ direction: 'earlier' }, { direction: 'later' }]);
    });

    it('hides "Do this first" on the first in the lane and "Do this later" on the last, and both when it is alone', async () => {
      assignments = [...three(), planned({ id: 'a4', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Alone' })];
      open('/?date=2026-11-20');
      const moves = (opened: HTMLElement) => within(opened).queryAllByRole('button', { name: /^Do this/ }).map((b) => b.textContent);
      expect(moves(await openBlock('Haul stone · Draft'))).toEqual(['Do this later']);
      expect(moves(await openBlock('Topsoil haul · Draft'))).toEqual(['Do this first', 'Do this later']);
      expect(moves(await openBlock('Fill the shop · Draft'))).toEqual(['Do this first']);
      expect(moves(await openBlock('Alone · Draft'))).toEqual([]);
    });

    it('marks only the one moved Changed once they are Assigned', async () => {
      assignments = three().map((a) => ({ ...a, assignedAt: '2026-11-19T20:30:00.000Z' }));
      open('/?date=2026-11-20');
      fireEvent.click(within(await openBlock('Fill the shop')).getByRole('button', { name: 'Do this first' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Haul stone', 'Then · Changed · Fill the shop', 'Then · Topsoil haul']));
    });

    it('says so when a move fails, and keeps the order', async () => {
      assignments = three();
      open('/?date=2026-11-20');
      const opened = await openBlock('Topsoil haul · Draft');
      failSaves = true;
      fireEvent.click(within(opened).getByRole('button', { name: 'Do this first' }));
      expect(await within(opened).findByText('Could not move the Assignment. Try again.')).toBeTruthy();
      expect(lineup()).toEqual(['First · Draft · Haul stone', 'Then · Draft · Topsoil haul', 'Then · Draft · Fill the shop']);
    });
  });

  describe('✕ and Put back', () => {
    const ASSIGNED = { assignedAt: ASSIGNED_AT };
    /** A block's frame: the button that opens it. */
    const frameOf = (words: string) => screen.getByRole('button', { name: `Edit ${words}` });

    it('deletes a Draft with ✕, leaving nothing behind', async () => {
      assignments = [planned()];
      open('/?date=2026-11-20');
      fireEvent.click(within(await openBlock('Haul stone · Draft')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(within(lane('Sample Driver A')).getByText('Nothing planned yet')).toBeTruthy());
      expect(sent).toEqual([{ delete: 'a1' }]);
      expect(screen.queryByRole('region', { name: 'Open Assignment' })).toBeNull();
      expect(await screen.findByText(/^Nothing planned for /)).toBeTruthy();
    });

    it('cancels an Assigned one with ✕: it stays in its place, struck through, greyed and marked Cancelled', async () => {
      assignments = [planned(ASSIGNED), planned({ id: 'a2', note: 'Topsoil haul', position: 1, ...ASSIGNED })];
      open('/?date=2026-11-20');
      fireEvent.click(within(await openBlock('Haul stone')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(blocks('Sample Driver A')).toEqual([
        'Cancelled · Haul stone · Truck 21 (his own)',
        'First · Topsoil haul · Truck 21 (his own)',
      ]));
      expect(sent).toEqual([{ delete: 'a1' }]);
      // Off the day, so not counted.
      expect(screen.getByText('1 Assignment')).toBeTruthy();
      expect(frameOf('Haul stone · Cancelled').className).toMatch(/line-through/);
      expect(frameOf('Haul stone · Cancelled').className).toMatch(/opacity/);
    });

    it('opens a cancelled Assignment only to Put back, which restores it, marked Changed', async () => {
      assignments = [planned({ cancelledAt: '2026-11-19T22:00:00.000Z', changedAt: '2026-11-19T22:00:00.000Z', ...ASSIGNED })];
      open('/?date=2026-11-20');
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone · Cancelled' }));
      const opened = screen.getByRole('region', { name: 'Open Assignment' });
      expect(within(opened).queryByRole('button', { name: /^(Driver|Material|From|To|Truck|Foreman):/ })).toBeNull();
      expect(within(opened).queryByRole('textbox', { name: 'Note' })).toBeNull();
      expect(within(opened).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Put back', 'Close']);
      expect(within(opened).getByText(/cancelled/i)).toBeTruthy();

      fireEvent.click(within(opened).getByRole('button', { name: 'Put back' }));
      await waitFor(() => expect(blocks('Sample Driver A')).toEqual(['First · Changed · Haul stone · Truck 21 (his own)']));
      expect(sent).toEqual([]);
      expect(api.mock.calls.some(([url, init]) => String(url).endsWith('/api/assignments/a1/put-back') && init?.method === 'POST')).toBe(true);
      // Put back, it opens as any other, with its chips.
      const reopened = screen.getByRole('region', { name: 'Open Assignment' });
      expect(within(reopened).getByRole('button', { name: 'Driver: Sample Driver A' })).toBeTruthy();
    });

    it('cancels an Assigned one for the first Driver and adds it, Assigned, last in the other Driver\'s lane, still open there', async () => {
      assignments = [planned(ASSIGNED), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil haul', ...ASSIGNED })];
      open('/?date=2026-11-20');
      pick(await openBlock('Haul stone'), 'Driver', 'Sample Driver B');
      await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Topsoil haul · Truck 24 (his own)', 'Then · Added · Haul stone · Truck 24 (his own)']));
      expect(blocks('Sample Driver A')).toEqual(['Cancelled · Haul stone · Truck 21 (his own)']);
      expect(within(lane('Sample Driver B')).getByRole('region', { name: 'Open Assignment' })).toBeTruthy();
    });

    it('says so when ✕ fails, and keeps the Assignment', async () => {
      assignments = [planned()];
      open('/?date=2026-11-20');
      const opened = await openBlock('Haul stone · Draft');
      failSaves = true;
      fireEvent.click(within(opened).getByRole('button', { name: 'Delete' }));
      expect(await within(opened).findByText('Could not delete the Assignment. Try again.')).toBeTruthy();
      expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Truck 21 (his own)']);
    });

    it('says so when Put back fails, and keeps it cancelled', async () => {
      assignments = [planned({ cancelledAt: '2026-11-19T22:00:00.000Z', changedAt: '2026-11-19T22:00:00.000Z', ...ASSIGNED })];
      open('/?date=2026-11-20');
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone · Cancelled' }));
      const opened = screen.getByRole('region', { name: 'Open Assignment' });
      failSaves = true;
      fireEvent.click(within(opened).getByRole('button', { name: 'Put back' }));
      expect(await within(opened).findByText('Could not put the Assignment back. Try again.')).toBeTruthy();
      expect(blocks('Sample Driver A')).toEqual(['Cancelled · Haul stone · Truck 21 (his own)']);
    });
  });

  it('has no dialog and no Duplicate: the Assignment is changed where it sits', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · Draft');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(opened).queryByText(/Duplicate/)).toBeNull();
    expect(within(opened).queryByRole('textbox', { name: 'Date' })).toBeNull();
  });

  it('shows a past day read-only: no add or edit controls', async () => {
    assignments = [planned({ date: '2026-11-18' }), planned({ id: 'a2', date: '2026-11-18', driverId: null, driverName: null, note: 'Unplanned' })];
    open('/?date=2026-11-18');
    expect(await within(await findLane('Sample Driver A')).findByText('Haul stone')).toBeTruthy();
    expect(within(lane('Unassigned')).getByText('Unplanned')).toBeTruthy();
    // Wait for the Worker's today, so the read-only view is not just the moment before it arrives.
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith('/api/today'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /^Add an Assignment|^Edit / })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it('shows today with its add and edit controls', async () => {
    assignments = [planned({ date: '2026-11-19' })];
    open('/?date=2026-11-19');
    expect(await screen.findByRole('button', { name: 'Edit Haul stone · Draft' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add an Assignment for Sample Driver A' })).toBeTruthy();
  });

  it('shows no Truck on the board for His own when the Driver has no usual Truck', async () => {
    assignments = [planned({ driverId: 'drv-x', driverName: 'Sample Driver X' })];
    open('/?date=2026-11-20');
    expect(await within(await findLane('Sample Driver X')).findByText('Haul stone')).toBeTruthy();
    expect(blocks('Sample Driver X')).toEqual(['First · Draft · Haul stone']);
  });
});

describe('starting a day from another', () => {
  // The page's today is Thursday 2026-11-19; the next Working day is Friday 2026-11-20.
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-19', driverId: 'drv-a', driverName: 'Sample Driver A', materialId: 'mat-dirt', materialName: 'Sample Dirt',
    note: 'Haul stone', position: 0, createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', changedAt: null, ...fields,
  });
  const startButton = () => screen.queryByRole('button', { name: /^Start from/ });
  const copyButton = () => screen.queryByRole('button', { name: /^Copy to/ });
  const nothingPlanned = () => screen.findByText(/^Nothing planned for /);

  it('says nothing is planned on an empty day, offers Start from the latest earlier day with Assignments, and copies it in one tap', async () => {
    assignments = [
      planned({ id: 'a1', date: '2026-11-17', note: 'Older day' }),
      planned({ id: 'a2' }),
      planned({ id: 'a3', driverId: 'drv-b', driverName: 'Sample Driver B', materialId: 'mat-minus', materialName: '2" minus' }),
    ];
    open('/?date=2026-11-23');
    expect((await nothingPlanned()).textContent).toBe('Nothing planned for Mon, Nov 23');

    fireEvent.click(await screen.findByRole('button', { name: 'Start from Thu, Nov 19' }));

    expect(await within(await screen.findByRole('article', { name: 'Sample Driver B' })).findByText(/2" minus/)).toBeTruthy();
    expect(blocks('Sample Driver A')).toEqual([expect.stringContaining('Sample Dirt')]);
    expect(sent).toEqual([{ startFrom: '2026-11-23' }]);
    expect(screen.queryByText('Haul stone')).toBeNull();
    expect(screen.queryByText(/^Nothing planned for /)).toBeNull();
    expect(startButton()).toBeNull();
    expect(await screen.findByText('Started Mon, Nov 23 from Thu, Nov 19: 2 Assignments')).toBeTruthy();
  });

  it('saves nothing just for looking at an empty day', async () => {
    assignments = [planned()];
    open('/?date=2026-11-23');
    await screen.findByRole('button', { name: 'Start from Thu, Nov 19' });
    expect(sent).toEqual([]);
    expect(api.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
  });

  it('offers no Start from when no earlier day has Assignments', async () => {
    assignments = [planned({ date: '2026-11-24' })];
    open('/?date=2026-11-23');
    await nothingPlanned();
    await act(async () => {});
    expect(startButton()).toBeNull();
    expect(screen.getByText(/Use \+ on a lane to plan the day/)).toBeTruthy();
  });

  it('offers neither on a day that has Assignments, even if all are cancelled', async () => {
    assignments = [planned(), planned({ id: 'a2', date: '2026-11-23', cancelledAt: '2026-11-19T22:00:00.000Z', assignedAt: ASSIGNED_AT })];
    open('/?date=2026-11-23');
    expect(await within(await screen.findByRole('article', { name: 'Sample Driver A' })).findByText(/Sample Dirt/)).toBeTruthy();
    expect(screen.queryByText(/^Nothing planned for /)).toBeNull();
    expect(startButton()).toBeNull();
    expect(copyButton()).toBeNull();
  });

  it('offers no Start from on an empty day before today, which is read-only', async () => {
    assignments = [planned({ date: '2026-11-16' })];
    open('/?date=2026-11-18');
    expect((await nothingPlanned()).textContent).toBe('Nothing planned for Wed, Nov 18');
    await act(async () => {});
    expect(startButton()).toBeNull();
    expect(copyButton()).toBeNull();
  });

  it('offers Copy to the next Working day on a past day while that day is empty, and shows the copy there', async () => {
    assignments = [planned({ date: '2026-11-17' })];
    open('/?date=2026-11-17');

    fireEvent.click(await screen.findByRole('button', { name: 'Copy to Fri, Nov 20' }));

    await waitFor(() => expect(address()).toBe('/?date=2026-11-20'));
    expect(sent).toEqual([{ copy: '2026-11-17', to: '2026-11-20' }]);
    expect(await within(await screen.findByRole('article', { name: 'Sample Driver A' })).findByText(/Sample Dirt/)).toBeTruthy();
    expect(screen.queryByText('Haul stone')).toBeNull();
    expect(await screen.findByText('Copied Tue, Nov 17 to Fri, Nov 20: 1 Assignment')).toBeTruthy();
  });

  it('offers no Copy to once the next Working day has Assignments', async () => {
    assignments = [planned({ date: '2026-11-17' }), planned({ id: 'a2', date: '2026-11-20', note: 'Already planned' })];
    open('/?date=2026-11-17');
    await screen.findByText('Haul stone');
    await act(async () => {});
    expect(copyButton()).toBeNull();
  });

  it('offers no Copy to on a past day whose Assignments are all cancelled, nor on today or a later day', async () => {
    assignments = [planned({ date: '2026-11-17', cancelledAt: '2026-11-17T22:00:00.000Z', assignedAt: '2026-11-16T21:15:00.000Z' }), planned({ id: 'a2' })];
    open('/?date=2026-11-17');
    await screen.findByText('Haul stone');
    await act(async () => {});
    expect(copyButton()).toBeNull();
    cleanup();
    open('/?date=2026-11-19');
    await screen.findByText('Haul stone');
    await act(async () => {});
    expect(copyButton()).toBeNull();
  });

  it.each([
    ['a refusal', { status: 409, body: { error: 'day_planned', message: 'That day already has Assignments, so nothing was copied onto it.' } }, 'That day already has Assignments, so nothing was copied onto it.'],
    ['a refused field', { status: 400, body: { error: 'invalid', fields: { date: 'Days before today are read-only. Pick today or a later day.' } } }, 'Days before today are read-only. Pick today or a later day.'],
    ['a failure', { status: 500, body: { error: 'oops' } }, 'Could not start this day'],
  ])('shows the Worker\'s message for %s on Start from, and reads the day again', async (_what, refusal, message) => {
    assignments = [planned()];
    copyRefusal = refusal;
    open('/?date=2026-11-23');
    fireEvent.click(await screen.findByRole('button', { name: 'Start from Thu, Nov 19' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('shows the Worker\'s message when Copy to is refused, and stays on the day', async () => {
    assignments = [planned({ date: '2026-11-17' })];
    copyRefusal = { status: 500, body: { error: 'oops' } };
    open('/?date=2026-11-17');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to Fri, Nov 20' }));
    expect(await screen.findByText('Could not copy this day')).toBeTruthy();
    expect(address()).toBe('/?date=2026-11-17');
  });
});

describe('assigning', () => {
  // The page's today is Thursday 2026-11-19; Friday 2026-11-20 is planned.
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', position: 0,
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', changedAt: null, ...fields,
  });
  const assignButtons = () => screen.queryAllByRole('button', { name: /^Assign / }).map((button) => button.getAttribute('aria-label'));
  const tile = (day: string) => within(screen.getByRole('navigation', { name: 'Week' })).getByRole('button', { name: new RegExp(`^${day}\\b`) });

  it('shows a Draft with a Driver with a dashed outline, a Draft tag and Assign on its block, and an Assigned one as before', async () => {
    assignments = [planned(), planned({ id: 'a2', note: 'Topsoil haul', position: 1, assignedAt: ASSIGNED_AT })];
    open('/?date=2026-11-20');
    await waitFor(() => expect(assignButtons()).toEqual(['Assign Haul stone']));
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Truck 21 (his own)', 'Then · Topsoil haul · Truck 21 (his own)']);
    expect(screen.getByRole('button', { name: 'Edit Haul stone · Draft' }).className).toMatch(/border-dashed/);
    expect(screen.getByRole('button', { name: 'Edit Topsoil haul' }).className).not.toMatch(/border-dashed/);
  });

  it('Assigns it with one tap on its block: it loses its Draft look and the week strip says Assigned', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · 1 draft'));
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Haul stone' }));
    await waitFor(() => expect(blocks('Sample Driver A')).toEqual(['First · Haul stone · Truck 21 (his own)']));
    expect(sent).toEqual([{ assign: 'a1' }]);
    expect(assignButtons()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · Assigned'));
  });

  it('marks one Assigned on its own day Added', async () => {
    assignments = [planned({ date: '2026-11-19' })];
    open('/?date=2026-11-19');
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Haul stone' }));
    await waitFor(() => expect(blocks('Sample Driver A')).toEqual(['First · Added · Haul stone · Truck 21 (his own)']));
  });

  it('offers no Assign on an Unassigned Draft, and the Unassigned lane says to pick a Driver', async () => {
    assignments = [planned({ driverId: null, driverName: null, note: 'Unplanned' })];
    open('/?date=2026-11-20');
    expect(await within(await screen.findByRole('article', { name: 'Unassigned' })).findByText('Pick a Driver to Assign')).toBeTruthy();
    expect(blocks('Unassigned')).toEqual(['First · Draft · Unplanned']);
    expect(assignButtons()).toEqual([]);
  });

  it('offers no Assign on a day before today', async () => {
    assignments = [planned({ date: '2026-11-18' })];
    open('/?date=2026-11-18');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith('/api/today'))).toBe(true));
    await act(async () => {});
    expect(assignButtons()).toEqual([]);
    expect(within(lane('Sample Driver A')).getByRole('listitem').textContent).toBe('First · Draft · Haul stone · Truck 21 (his own)');
  });

  it('names ✕ by the Assignment: Delete on a Draft, Cancel on an Assigned one', async () => {
    assignments = [planned(), planned({ id: 'a2', note: 'Topsoil haul', position: 1, assignedAt: ASSIGNED_AT })];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone · Draft' }));
    expect(within(screen.getByRole('region', { name: 'Open Assignment' })).getByRole('button', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Topsoil haul' }));
    expect(within(screen.getByRole('region', { name: 'Open Assignment' })).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('has no Send and no day-level line about Drivers not seeing the day', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    await screen.findByRole('button', { name: 'Assign Haul stone' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByText(/until you Send/)).toBeNull();
    expect(screen.queryByRole('status', { name: 'Day state' })).toBeNull();
  });

  it.each([
    ['a refusal', { status: 409, body: { error: 'past_day', message: 'This day is before today, so it is read-only.' } }, 'This day is before today, so it is read-only.'],
    ['a failure', { status: 500, body: { error: 'oops' } }, 'Could not Assign it. Try again.'],
  ])('shows the Worker\'s message for %s, and it stays a Draft', async (_what, refusal, message) => {
    assignRefusal = refusal;
    assignments = [planned()];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Haul stone' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(blocks('Sample Driver A')).toEqual(['First · Draft · Haul stone · Truck 21 (his own)']);
    expect(assignButtons()).toEqual(['Assign Haul stone']);
  });
});

describe('the week strip', () => {
  // The page's today is Thursday 2026-11-19, so tomorrow is Friday 2026-11-20; that week runs Monday 2026-11-16 to Sunday 2026-11-22.
  const planned = (date: string, fields: Record<string, unknown> = {}) => ({
    id: `a${assignments.length}`, date, driverId: 'drv-a', driverName: 'Sample Driver A', note: `Work on ${date}`, position: assignments.length,
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', changedAt: null, ...fields,
  });
  const strip = () => screen.getByRole('navigation', { name: 'Week' });
  /** Each tile as it reads, Monday to Sunday: its day, its word, a Holiday's name and the day's state. */
  const tiles = () => within(strip()).getAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/ }).map((tile) => tile.getAttribute('aria-label'));
  const tile = (day: string) => within(strip()).getByRole('button', { name: new RegExp(`^${day}\\b`) });
  const pager = () => within(strip()).getByRole('status', { name: 'Week shown' }).textContent;
  const regainFocus = () => act(() => void window.dispatchEvent(new Event('focus')));

  it('shows a tile for each day of the week with Today, Tomorrow and each day\'s state', async () => {
    assignments = [planned('2026-11-17', { changedAt: '2026-11-19T22:00:00.000Z', assignedAt: ASSIGNED_AT })];
    assignments.push(planned('2026-11-18', { assignedAt: ASSIGNED_AT }));
    assignments.push(planned('2026-11-19', { driverId: null, driverName: null }));
    assignments.push(planned('2026-11-19', { driverId: null, driverName: null }));
    assignments.push(planned('2026-11-19'));
    assignments.push(planned('2026-11-20'));
    open('/?date=2026-11-20');
    await waitFor(() =>
      expect(tiles()).toEqual([
        'Mon 16 · –',
        'Tue 17 · Changed',
        'Wed 18 · Assigned',
        'Thu 19 · Today · 3 drafts',
        'Fri 20 · Tomorrow · 1 draft',
        'Sat 21 · –',
        'Sun 22 · –',
      ]),
    );
  });

  it('fills the chosen day\'s tile and outlines today\'s', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-pressed')).toBe('true'));
    expect(tile('Thu 19').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Thu 19').getAttribute('aria-current')).toBe('date');
    expect(tile('Fri 20').getAttribute('aria-current')).toBeNull();
  });

  it('names a Holiday on its tile, with its state once something is planned', async () => {
    open('/?date=2026-11-25');
    await waitFor(() => expect(tile('Thu 26').getAttribute('aria-label')).toBe('Thu 26 · Thanksgiving'));
    assignments = [planned('2026-11-26')];
    regainFocus();
    await waitFor(() => expect(tile('Thu 26').getAttribute('aria-label')).toBe('Thu 26 · Thanksgiving · 1 draft'));
  });

  it('shows a day when its tile is tapped', async () => {
    assignments = [planned('2026-11-22', { note: 'Sunday work' })];
    open('/?date=2026-11-20');
    fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Week' })).findByRole('button', { name: /^Sun 22/ }));
    expect(await screen.findByText('Sunday work')).toBeTruthy();
    expect(address()).toBe('/?date=2026-11-22');
  });

  it('pages a week at a time, keeping the weekday', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(pager()).toBe('Nov 16 to Nov 22'));
    fireEvent.click(within(strip()).getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(address()).toBe('/?date=2026-11-27'));
    expect(pager()).toBe('Nov 23 to Nov 29');
    expect(tile('Fri 27').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(strip()).getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(address()).toBe('/?date=2026-11-20'));
    fireEvent.click(within(strip()).getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(address()).toBe('/?date=2026-11-13'));
    expect(pager()).toBe('Nov 9 to Nov 15');
  });

  it('updates after an add and after Assign', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · –'));

    fireEvent.click(await within(lane('Sample Driver A')).findByRole('button', { name: 'Add an Assignment for Sample Driver A' }));
    fireEvent.click(within(lane('Sample Driver A')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · 1 draft'));

    fireEvent.click(within(lane('Sample Driver A')).getByRole('button', { name: /^Assign / }));
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · Assigned'));
  });

  it('updates when the page regains the focus, for what changed elsewhere', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Mon 16').getAttribute('aria-label')).toBe('Mon 16 · –'));
    assignments = [planned('2026-11-16')];
    regainFocus();
    await waitFor(() => expect(tile('Mon 16').getAttribute('aria-label')).toBe('Mon 16 · 1 draft'));
  });

  it('still shows its days, without states, when the week cannot be read, and says so', async () => {
    failWeeks = true;
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    await waitFor(() => expect(tiles()).toEqual(['Mon 16', 'Tue 17', 'Wed 18', 'Thu 19 · Today', 'Fri 20 · Tomorrow', 'Sat 21', 'Sun 22']));
    expect(await screen.findByText('Could not load the state of each day this week. It tries again after a change or when you come back to the page.')).toBeTruthy();
    // The board stays usable: a tile still shows its day.
    fireEvent.click(tile('Mon 16'));
    expect(address()).toBe('/?date=2026-11-16');

    failWeeks = false;
    regainFocus();
    await waitFor(() => expect(screen.queryByText(/^Could not load the state of each day/)).toBeNull());
  });

  it('replaces Jump to', async () => {
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    expect(screen.queryByLabelText('Jump to')).toBeNull();
  });
});

describe("each Driver's check-in on the Board", () => {
  // The page's today is Thursday 2026-11-19; 11:42 UTC is 6:42 AM Eastern.
  const checkIn = (fields: Record<string, unknown> = {}) => ({
    driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-24', truckNumber: '24', inspectionId: 'ins-1',
    doneAt: '2026-11-19T11:42:00.000Z', needsRepair: false, ...fields,
  });
  const about = (driver: string) => lane(driver).querySelector('[data-lane-about]')?.textContent;

  it('shows the Truck a Driver checked in to and when, in place of his usual Truck, on today', async () => {
    checkIns = [checkIn()];
    open('/?date=2026-11-19');
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 24 · checked in 6:42'));
  });

  it('adds "needs repair" when that Inspection had a Needs repair item', async () => {
    checkIns = [checkIn({ needsRepair: true })];
    open('/?date=2026-11-19');
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 24 · checked in 6:42 · needs repair'));
  });

  it('says "Not checked in" for a Driver who has not checked in today', async () => {
    checkIns = [checkIn()];
    open('/?date=2026-11-19');
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 24 · checked in 6:42'));
    expect(about('Sample Driver B')).toBe('Not checked in');
    expect(about('Unassigned')).toBeUndefined();
  });

  it('shows the same Truck on both lanes when two Drivers checked in to it', async () => {
    checkIns = [checkIn(), checkIn({ driverId: 'drv-b', driverName: 'Sample Driver B', inspectionId: 'ins-2', doneAt: '2026-11-19T11:50:00.000Z' })];
    open('/?date=2026-11-19');
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 24 · checked in 6:42'));
    expect(about('Sample Driver B')).toBe('Truck 24 · checked in 6:50');
  });

  it('leaves the lanes as they are on any day but today, and does not read check-ins', async () => {
    checkIns = [checkIn()];
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 21'));
    expect(about('Sample Driver B')).toBe('Truck 24');
    expect(sent).not.toContainEqual({ checkIns: expect.anything() });
  });

  it('reads the check-ins again when the page regains the focus', async () => {
    open('/?date=2026-11-19');
    await waitFor(() => expect(about('Sample Driver A')).toBe('Not checked in'));
    checkIns = [checkIn({ needsRepair: true })];
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(about('Sample Driver A')).toBe('Truck 24 · checked in 6:42 · needs repair'));
  });
});

describe('open Truck problems on the Board', () => {
  // The page's today is Thursday 2026-11-19. Sample Driver A's usual Truck is 21, Sample Driver B's is 24.
  const problem = (fields: Record<string, unknown> = {}) => ({
    id: 'tp-1', truckId: 'trk-21', truckNumber: '21', reportedByDriverId: 'drv-b', reportedByName: 'Sample Driver B',
    reportedAt: '2026-11-18T11:42:00.000Z', text: 'Mud flap torn', inspectionId: 'ins-0', fixedAt: null, fixedNote: null, ...fields,
  });
  const checkIn = (fields: Record<string, unknown> = {}) => ({
    driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-24', truckNumber: '24', inspectionId: 'ins-1',
    doneAt: '2026-11-19T11:42:00.000Z', needsRepair: false, ...fields,
  });
  const mark = (driver: string) => within(lane(driver)).queryByRole('button', { name: /^Open problems on Truck / });
  const findMark = async (driver: string, truck: string) =>
    within(await screen.findByRole('article', { name: driver })).findByRole('button', { name: `Open problems on Truck ${truck}` });

  it('marks the lane of a Driver who has not checked in when his usual Truck has an open problem, and tapping it says what they are', async () => {
    problems = [problem(), problem({ id: 'tp-2', text: 'Left marker out', reportedAt: '2026-11-17T11:42:00.000Z' })];
    open('/?date=2026-11-19');
    const red = await findMark('Sample Driver A', '21');
    expect(red.getAttribute('title')).toBe('Mud flap torn\nLeft marker out');
    expect(mark('Sample Driver B')).toBeNull();
    expect(within(lane('Sample Driver A')).queryByRole('list', { name: 'Open problems on Truck 21' })).toBeNull();

    fireEvent.click(red);
    const list = within(lane('Sample Driver A')).getByRole('list', { name: 'Open problems on Truck 21' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Mud flap torn', 'Left marker out']);
  });

  it('follows the Truck he checked in to, once he has', async () => {
    problems = [problem({ truckId: 'trk-24', truckNumber: '24' })];
    checkIns = [checkIn()];
    open('/?date=2026-11-19');
    expect(await findMark('Sample Driver A', '24')).toBeTruthy();
    // Sample Driver B has not checked in, and 24 is his usual Truck.
    expect(mark('Sample Driver B')?.getAttribute('aria-label')).toBe('Open problems on Truck 24');
  });

  it('leaves no mark for a problem on his usual Truck once he checked in to another', async () => {
    problems = [problem()];
    checkIns = [checkIn()];
    open('/?date=2026-11-19');
    await waitFor(() => expect(lane('Sample Driver A').querySelector('[data-lane-about]')?.textContent).toBe('Truck 24 · checked in 6:42'));
    await waitFor(() => expect(problemReads).toContain('?open=1'));
    expect(mark('Sample Driver A')).toBeNull();
  });

  it('shows no lane mark on any day but today', async () => {
    problems = [problem()];
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    await waitFor(() => expect(problemReads).toContain('?open=1'));
    expect(mark('Sample Driver A')).toBeNull();
  });

  it('takes the mark away once the problems are fixed, when the page regains the focus', async () => {
    problems = [problem()];
    open('/?date=2026-11-19');
    expect(await findMark('Sample Driver A', '21')).toBeTruthy();
    problems = [problem({ fixedAt: '2026-11-19T13:00:00.000Z' })];
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mark('Sample Driver A')).toBeNull());
  });

  it('marks a Truck chip in the composer red while its Truck has an open problem, on a day after today too', async () => {
    problems = [problem(), problem({ id: 'tp-2', text: 'Left marker out' })];
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    fireEvent.click(await within(lane('Sample Driver B')).findByRole('button', { name: 'Add an Assignment for Sample Driver B' }));
    await waitFor(() => expect(problemReads).toContain('?open=1'));
    fireEvent.click(within(lane('Sample Driver B')).getByRole('button', { name: 'Note or other truck' }));
    const truckRow = within(lane('Sample Driver B')).getByRole('group', { name: 'Truck' });
    const chip = (name: RegExp) => within(truckRow).getByRole('button', { name });
    const red = within(await waitFor(() => chip(/^21/))).getByRole('img', { name: 'open problems' });
    expect(red.getAttribute('title')).toBe('Mud flap torn\nLeft marker out');
    expect(within(chip(/^24/)).queryByRole('img')).toBeNull();
    expect(within(chip(/^His own/)).queryByRole('img')).toBeNull();
  });

  it('marks the His own chip red when the lane\'s Driver\'s usual Truck has an open problem, on any day', async () => {
    problems = [problem()];
    open('/?date=2026-11-20');
    await screen.findByText(/^Nothing planned for /);
    // Sample Driver A's usual Truck is 21.
    fireEvent.click(await within(lane('Sample Driver A')).findByRole('button', { name: 'Add an Assignment for Sample Driver A' }));
    await waitFor(() => expect(problemReads).toContain('?open=1'));
    fireEvent.click(within(lane('Sample Driver A')).getByRole('button', { name: 'Note or other truck' }));
    const truckRow = within(lane('Sample Driver A')).getByRole('group', { name: 'Truck' });
    const hisOwn = await waitFor(() => within(truckRow).getByRole('button', { name: /^His own/ }));
    expect(within(hisOwn).getByRole('img', { name: 'open problems' }).getAttribute('title')).toBe('Mud flap torn');
  });
});
