// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { toast } from './components/ui/sonner';
import { dayState, holidayName, sinceSent, weekDates } from '../shared/days';

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
/** When each Sent day was first Sent, as the Worker's day_sends keeps it. */
let daySends: Record<string, string> = {};
let sendRefusal: { status: number; body: unknown } | null = null;
/** When the week strip's read fails. */
let failWeeks = false;
/** When the Worker records a Send: 4:15 PM Eastern on Thursday 2026-11-19. */
const SENT_AT = '2026-11-19T21:15:00.000Z';
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
/** An Assignment as the Worker answers it: marked Changed or Added since its day was Sent, by the shared day rules. */
const marked = (a: Record<string, unknown>) => ({
  ...a,
  sinceSent: sinceSent({ createdAt: String(a.createdAt), changedAt: (a.changedAt as string | null) ?? null }, daySends[String(a.date)] ?? null),
});
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
  const week = /\/api\/weeks\/([^/]+)$/.exec(url.pathname);
  if (week) {
    if (failWeeks) return answer({ error: 'oops' }, 500);
    // Each day's state by the shared day rules, as the Worker reads it.
    const days = weekDates(week[1]).map((date) => {
      const planned = assignments
        .filter((a) => a.date === date)
        .map((a) => ({ driverId: (a.driverId as string | null) ?? null, createdAt: String(a.createdAt), changedAt: (a.changedAt as string | null) ?? null }));
      const unassigned = planned.filter((a) => a.driverId === null).length;
      return { date, state: dayState(planned, daySends[date] ?? null).state, unassigned, holiday: holidayName(date) };
    });
    return answer({ days });
  }
  const sending = /\/api\/days\/([^/]+)\/send$/.exec(url.pathname);
  if (sending && init?.method === 'POST') {
    sent.push({ send: sending[1] });
    if (sendRefusal) return answer(sendRefusal.body, sendRefusal.status);
    daySends[sending[1]] ??= SENT_AT;
    return answer({ date: sending[1], sentAt: daySends[sending[1]] });
  }
  if (url.pathname.endsWith('/api/assignments/copy')) {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    if (copyRefusal) return answer(copyRefusal.body, copyRefusal.status);
    // The Worker copies from its own today, whatever the page sends.
    const { to } = body;
    const copies = assignments
      .filter((a) => a.date === '2026-11-19')
      .map((a, i) => ({ ...a, id: `c${assignments.length + i + 1}`, date: to, note: null }));
    assignments.push(...copies);
    return answer({ assignments: copies }, 201);
  }
  if (init?.body) sent.push(JSON.parse(String(init.body)));
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
  return answer({ assignments: day, sentAt: daySends[date] ?? null });
});

const open = (address: string) => {
  window.history.pushState(null, '', address);
  return render(<App />);
};
const address = () => window.location.pathname + window.location.search;
const subtitle = () => screen.getByRole('heading', { level: 1 }).nextElementSibling?.textContent;
const lane = (driver: string) => screen.getByRole('article', { name: driver });
/** A lane's blocks as they read, in order. */
const blocks = (driver: string) => within(lane(driver)).queryAllByRole('listitem').map((block) => block.textContent);

beforeEach(() => {
  assignments = [];
  businessDay = THURSDAY;
  sent.length = 0;
  failLoads = false;
  failSaves = false;
  refuse = null;
  copyRefusal = null;
  failLists = false;
  daySends = {};
  sendRefusal = null;
  failWeeks = false;
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
    expect(await screen.findByText('No Assignments for this day')).toBeTruthy();
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
    await screen.findByText('No Assignments for this day');

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
    await screen.findByText('No Assignments for this day');

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-23`));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-20`));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-19`));
  });

  it('leaves the arrow keys to a field that has the focus', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText('No Assignments for this day');

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
    await screen.findByText('No Assignments for this day');
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next Working day, Mon 23' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-23`));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Fri, Nov 20' }));
    await waitFor(() => expect(address()).toBe(`${prefix}/?date=2026-11-20`));
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
  });

  it('adds an Assignment with only the day from the Unassigned lane\'s +, confirms it, and shows it there', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText('No Assignments for this day');

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
    await screen.findByText('No Assignments for this day');
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).includes('/api/weeks/'))).toBe(true));
    expect([...new Set(api.mock.calls.map(([url]) => String(url)))].sort()).toEqual([
      `${prefix}/api/assignments?date=2026-11-20`,
      `${prefix}/api/drivers?include=inactive`,
      `${prefix}/api/foremen?include=inactive`,
      `${prefix}/api/materials?include=inactive`,
      `${prefix}/api/places?include=inactive`,
      `${prefix}/api/today`,
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
    expect(screen.queryByText('No Assignments for this day')).toBeNull();
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
    await screen.findByText('No Assignments for this day');
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
    expect(blocks('Sample Driver X')).toEqual(['First · Haul stone']);

    fireEvent.click(screen.getByRole('button', { name: 'Next Working day, Mon 23' }));
    await screen.findByText('No Assignments for this day');
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
    expect(blocks('Sample Driver A')).toEqual(['First · Sample Plant → Sample Site North · Truck 21 (his own)', 'Then · Move the excavator · Truck 21 (his own)']);
    expect(blocks('Unassigned')).toEqual(['First · Who takes this?']);
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
    await screen.findByText('No Assignments for this day');
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
        'First · Haul stone · Truck 21 (his own)',
        'Then · Sample Plant → Sample Site North · 2" minus · Foreman Sample Foreman A · Truck 21 (his own)',
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
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · Sample New Pit → Sample Site North · Sample Dirt']));
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
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · No details yet']));
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
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Back by noon · Truck 21']));
    expect(within(lane('Sample Driver B')).getByText('Truck 21', { selector: 'li span' }).className).not.toContain('text-muted-foreground');
  });

  it('saves His own as no Truck, and the board shows his usual Truck in grey', async () => {
    await day();
    save(await compose('Sample Driver B'));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-b', truckId: null })]);
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · No details yet · Truck 24 (his own)']));
    expect(within(lane('Sample Driver B')).getByText('Truck 24', { selector: 'li span' }).className).toContain('text-muted-foreground');
  });

  it('remembers the Places and Material after a save, for the next Driver, until it is closed', async () => {
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

    composer = await compose('Sample Driver B');
    expect(pressed(composer, 'Pick up')).toEqual(['Sample Plant']);
    expect((within(composer).getByRole('textbox', { name: 'Drop off, typed' }) as HTMLInputElement).value).toBe('Sample New Site');
    expect(pressed(composer, 'Hauling what?')).toEqual(['Sample Dirt']);
    expect(preview(composer)).toBe('Sample Driver B hauls Sample Dirt from Sample Plant to Sample New Site');
    save(composer);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ date: '2026-11-20', driverId: 'drv-b', truckId: null, fromPlaceId: 'plc-plant', toPlaceName: 'Sample New Site', materialId: 'mat-dirt', foremanId: null, note: null });

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
    const opened = await openBlock('Sample Plant · 2" minus · Haul stone');
    expect(within(lane('Sample Driver A')).getByRole('region', { name: 'Open Assignment' })).toBe(opened);
    expect(sentenceOf(opened)).toEqual([
      'Driver: Sample Driver A', 'Material: 2" minus', 'From: Sample Plant', 'To: no Place', 'Truck: His own', 'Foreman: no Foreman',
    ]);
    expect((within(opened).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('Haul stone');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Sample Plant · 2" minus · Haul stone' }));
    expect(screen.queryByRole('region', { name: 'Open Assignment' })).toBeNull();
  });

  it('keeps one Assignment open at a time', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil run' })];
    open('/?date=2026-11-20');
    await openBlock('Haul stone');
    await openBlock('Topsoil run');
    expect(screen.getAllByRole('region', { name: 'Open Assignment' })).toHaveLength(1);
    expect(within(lane('Sample Driver B')).getByRole('region', { name: 'Open Assignment' })).toBeTruthy();
  });

  it('offers each part\'s list, active entries only, with "Leave blank", Unassigned for the Driver and His own for the Truck', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone');
    expect(choicesIn(tapPart(opened, 'Driver'))).toEqual(['Sample Driver A', 'Sample Driver B', 'Unassigned']);
    expect(choicesIn(tapPart(opened, 'Material'))).toEqual(['2" minus', 'Sample Dirt', 'Leave blank']);
    expect(choicesIn(tapPart(opened, 'From'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank']);
    expect(choicesIn(tapPart(opened, 'To'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank']);
    expect(choicesIn(tapPart(opened, 'Truck'))).toEqual(['His own', '21', '24']);
    expect(choicesIn(tapPart(opened, 'Foreman'))).toEqual(['Sample Foreman A', 'Leave blank']);
    // One row of choices at a time.
    expect(within(opened).getAllByRole('group')).toHaveLength(1);
  });

  it('still offers, and shows, an entry made inactive since that the Assignment uses', async () => {
    assignments = [planned({ driverId: 'drv-x', driverName: 'Sample Driver X', truckId: 'trk-99', truckNumber: '99', fromPlaceId: 'plc-x', fromPlaceName: 'Sample Old Pit' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Sample Old Pit · Haul stone · Truck 99');
    expect(sentenceOf(opened).slice(0, 5)).toEqual(['Driver: Sample Driver X', 'Material: no Material', 'From: Sample Old Pit', 'To: no Place', 'Truck: 99']);
    expect(choicesIn(tapPart(opened, 'From'))).toEqual(['Sample Plant', 'Sample Site North', 'Sample Old Pit (removed)', 'Leave blank']);
    expect(choicesIn(tapPart(opened, 'To'))).toEqual(['Sample Plant', 'Sample Site North', 'Leave blank']);
  });

  it('saves a chip on its own, sending only that field, and the block shows it', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone');
    pick(opened, 'Material', 'Sample Dirt');
    await waitFor(() => expect(sentenceOf(opened)[1]).toBe('Material: Sample Dirt'));
    expect(sent).toEqual([{ materialId: 'mat-dirt' }]);
    expect(blocks('Sample Driver A')).toEqual(['First · Haul stone · Sample Dirt · Truck 21 (his own)']);
    expect(within(opened).queryByRole('group')).toBeNull();
  });

  it('clears a part with "Leave blank", and sets the Truck back to His own', async () => {
    assignments = [planned({ materialId: 'mat-minus', materialName: '2" minus', truckId: 'trk-24', truckNumber: '24' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · 2" minus · Truck 24');
    pick(opened, 'Material', 'Leave blank');
    await waitFor(() => expect(sentenceOf(opened)[1]).toBe('Material: no Material'));
    pick(opened, 'Truck', 'His own');
    await waitFor(() => expect(sentenceOf(opened)[4]).toBe('Truck: His own'));
    expect(sent).toEqual([{ materialId: null }, { truckId: null }]);
    expect(blocks('Sample Driver A')).toEqual(['First · Haul stone · Truck 21 (his own)']);
  });

  it('saves the note on its own when Dave leaves it', async () => {
    assignments = [planned({ materialId: 'mat-minus', materialName: '2" minus' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone · 2" minus');
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
    const opened = await openBlock('Haul stone');
    failSaves = true;
    pick(opened, 'Material', 'Sample Dirt');
    expect(await within(opened).findByText('Could not save the Material. Try again.')).toBeTruthy();
    expect(sentenceOf(opened)[1]).toBe('Material: no Material');
    expect(blocks('Sample Driver A')).toEqual(['First · Haul stone · Truck 21 (his own)']);
  });

  it('shows the Worker\'s message when a change is refused, e.g. for a day that is now past', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone');
    api.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'past_day', message: 'This Assignment is on a day before today, which is read-only.' }), { status: 409 }),
    );
    pick(opened, 'Foreman', 'Sample Foreman A');
    expect(await within(opened).findByText('This Assignment is on a day before today, which is read-only.')).toBeTruthy();
    expect(sentenceOf(opened)[5]).toBe('Foreman: no Foreman');
  });

  it('moves it to the end of another Driver\'s lane when the Driver changes, still open', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil run' })];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone');
    pick(opened, 'Driver', 'Sample Driver B');
    await waitFor(() => expect(blocks('Sample Driver B')).toEqual(['First · Topsoil run · Truck 24 (his own)', 'Then · Haul stone · Truck 24 (his own)']));
    expect(sent).toEqual([{ driverId: 'drv-b' }]);
    expect(within(lane('Sample Driver A')).getByText('Nothing planned yet')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByRole('region', { name: 'Open Assignment' })).toBeTruthy();
  });

  it('moves it to the end of the Unassigned lane when it is taken off its Driver', async () => {
    assignments = [planned(), planned({ id: 'a2', driverId: null, driverName: null, note: 'Who takes this?' })];
    open('/?date=2026-11-20');
    pick(await openBlock('Haul stone'), 'Driver', 'Unassigned');
    await waitFor(() => expect(blocks('Unassigned')).toEqual(['First · Who takes this?', 'Then · Haul stone']));
    expect(sent).toEqual([{ driverId: null }]);
  });

  describe('Do this first and Do this later', () => {
    const three = () => [
      planned({ id: 'a1', note: 'Haul stone', position: 0 }),
      planned({ id: 'a2', note: 'Topsoil run', position: 1 }),
      planned({ id: 'a3', note: 'Fill the shop', position: 2 }),
    ];
    const lineup = () => blocks('Sample Driver A').map((block) => block?.replace(/ · Truck 21 \(his own\)$/, ''));

    it('moves it one place earlier or later in its lane, and it stays open', async () => {
      assignments = three();
      open('/?date=2026-11-20');
      const opened = await openBlock('Topsoil run');
      fireEvent.click(within(opened).getByRole('button', { name: 'Do this first' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Topsoil run', 'Then · Haul stone', 'Then · Fill the shop']));
      fireEvent.click(within(screen.getByRole('region', { name: 'Open Assignment' })).getByRole('button', { name: 'Do this later' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Haul stone', 'Then · Topsoil run', 'Then · Fill the shop']));
      expect(sent).toEqual([{ direction: 'earlier' }, { direction: 'later' }]);
    });

    it('hides "Do this first" on the first in the lane and "Do this later" on the last, and both when it is alone', async () => {
      assignments = [...three(), planned({ id: 'a4', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Alone' })];
      open('/?date=2026-11-20');
      const moves = (opened: HTMLElement) => within(opened).queryAllByRole('button', { name: /^Do this/ }).map((b) => b.textContent);
      expect(moves(await openBlock('Haul stone'))).toEqual(['Do this later']);
      expect(moves(await openBlock('Topsoil run'))).toEqual(['Do this first', 'Do this later']);
      expect(moves(await openBlock('Fill the shop'))).toEqual(['Do this first']);
      expect(moves(await openBlock('Alone'))).toEqual([]);
    });

    it('marks only the one moved Changed on a Sent day', async () => {
      assignments = three();
      daySends = { '2026-11-20': '2026-11-19T20:30:00.000Z' };
      open('/?date=2026-11-20');
      fireEvent.click(within(await openBlock('Fill the shop')).getByRole('button', { name: 'Do this first' }));
      await waitFor(() => expect(lineup()).toEqual(['First · Haul stone', 'Then · Changed · Fill the shop', 'Then · Topsoil run']));
    });

    it('says so when a move fails, and keeps the order', async () => {
      assignments = three();
      open('/?date=2026-11-20');
      const opened = await openBlock('Topsoil run');
      failSaves = true;
      fireEvent.click(within(opened).getByRole('button', { name: 'Do this first' }));
      expect(await within(opened).findByText('Could not move the Assignment. Try again.')).toBeTruthy();
      expect(lineup()).toEqual(['First · Haul stone', 'Then · Topsoil run', 'Then · Fill the shop']);
    });
  });

  it('has no dialog and no Duplicate: the Assignment is changed where it sits', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const opened = await openBlock('Haul stone');
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
    expect(await screen.findByRole('button', { name: 'Edit Haul stone' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add an Assignment for Sample Driver A' })).toBeTruthy();
  });

  it('shows no Truck on the board for His own when the Driver has no usual Truck', async () => {
    assignments = [planned({ driverId: 'drv-x', driverName: 'Sample Driver X' })];
    open('/?date=2026-11-20');
    expect(await within(await findLane('Sample Driver X')).findByText('Haul stone')).toBeTruthy();
    expect(within(lane('Sample Driver X')).getByRole('listitem').textContent).toBe('First · Haul stone');
  });
});

describe('Copy today', () => {
  // The page's today is 2026-11-19.
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-19', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone',
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', ...fields,
  });
  const todayKnown = async () => {
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith('/api/today'))).toBe(true));
    await act(async () => {});
  };

  it.each([
    ['tomorrow', '2026-11-20', true],
    ['a later day', '2026-12-02', true],
    ['today', '2026-11-19', false],
    ['a past day', '2026-11-18', false],
  ])('on %s is shown: %s', async (_day, date, shown) => {
    open(`/?date=${date}`);
    await todayKnown();
    expect(screen.queryByRole('button', { name: 'Copy today' }) != null).toBe(shown);
  });

  it('copies today\'s Assignments onto the day on screen, without notes, and keeps what was there', async () => {
    assignments = [planned(), planned({ id: 'a2', date: '2026-11-21', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Already planned' })];
    open('/?date=2026-11-21');
    await screen.findByText('Already planned');

    fireEvent.click(screen.getByRole('button', { name: 'Copy today' }));

    expect(await screen.findByText('Copied 1 Assignment from today')).toBeTruthy();
    // The Worker decides which day is today; the page names only the target day.
    expect(sent).toEqual([{ to: '2026-11-21' }]);
    expect(await within(await screen.findByRole('article', { name: 'Sample Driver A' })).findByText('No details yet')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByText('Already planned')).toBeTruthy();
    expect(screen.queryByText('Haul stone')).toBeNull();
  });

  it('says there is nothing to copy when today has no Assignments', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy today' }));
    expect(await screen.findByText('Today has no Assignments to copy')).toBeTruthy();
    expect(screen.getByText('No Assignments for this day')).toBeTruthy();
  });

  it.each([
    ['a refused field', { status: 400, body: { error: 'invalid', fields: { to: 'Days before today are read-only. Pick today or a later day.' } } }, 'Days before today are read-only. Pick today or a later day.'],
    ['a refusal', { status: 409, body: { error: 'past_day', message: 'Today has moved on.' } }, 'Today has moved on.'],
    ['a failure', { status: 500, body: { error: 'oops' } }, 'Could not copy today'],
  ])('shows the Worker\'s message for %s', async (_what, refusal, message) => {
    copyRefusal = refusal;
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy today' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe('sending a day', () => {
  // The page's today is Thursday 2026-11-19; Friday 2026-11-20 is planned at 3:00 PM Eastern.
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', position: 0,
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', changedAt: null, ...fields,
  });
  const dayState = () => screen.getByRole('status', { name: 'Day state' }).textContent;
  const sendButton = () => screen.queryByRole('button', { name: 'Send' });

  it('shows a planned day as a Draft with when it was last saved, and Sends it with one tap', async () => {
    assignments = [planned(), planned({ id: 'a2', note: 'Topsoil run', updatedAt: '2026-11-19T21:12:00.000Z' })];
    open('/?date=2026-11-20');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(dayState()).toBe('Draft · not sent yet · saved 4:12 PM'));

    fireEvent.click(sendButton()!);

    await waitFor(() => expect(dayState()).toBe('Sent Thu, Nov 19 · 4:15 PM'));
    expect(sent).toEqual([{ send: '2026-11-20' }]);
    expect(sendButton()).toBeNull();
  });

  it('offers no Send yet on a day with nothing planned', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    await waitFor(() => expect(dayState()).toBe('Draft · not sent yet'));
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a Sent day with its sent time and no Send button', async () => {
    assignments = [planned()];
    daySends = { '2026-11-20': SENT_AT };
    open('/?date=2026-11-20');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(dayState()).toBe('Sent Thu, Nov 19 · 4:15 PM'));
    expect(sendButton()).toBeNull();
  });

  it('says the day is Changed since Sent and marks the blocks Changed and Added', async () => {
    assignments = [
      planned({ changedAt: '2026-11-19T22:00:00.000Z' }),
      planned({ id: 'a2', note: 'Topsoil run', position: 1, createdAt: '2026-11-19T22:30:00.000Z' }),
      planned({ id: 'a3', note: 'Fill the shop', position: 2 }),
    ];
    daySends = { '2026-11-20': SENT_AT };
    open('/?date=2026-11-20');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(dayState()).toBe('Changed since Sent'));
    expect(blocks('Sample Driver A')).toEqual([
      'First · Changed · Haul stone · Truck 21 (his own)',
      'Then · Added · Topsoil run · Truck 21 (his own)',
      'Then · Fill the shop · Truck 21 (his own)',
    ]);
  });

  it('marks a block Changed once Dave changes it on a Sent day', async () => {
    assignments = [planned()];
    daySends = { '2026-11-20': '2026-11-19T20:30:00.000Z' };
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone' }));
    const note = within(screen.getByRole('region', { name: 'Open Assignment' })).getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: 'Haul dirt' } });
    fireEvent.blur(note);
    expect(await screen.findByRole('button', { name: 'Edit Haul dirt · Changed' })).toBeTruthy();
    expect(dayState()).toBe('Changed since Sent');
  });

  it('offers no Send on a day before today, but still says its state', async () => {
    assignments = [planned({ date: '2026-11-18' })];
    open('/?date=2026-11-18');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(dayState()).toBe('Draft · not sent yet · saved 3:00 PM'));
    expect(sendButton()).toBeNull();
  });

  it.each([
    ['a refusal', { status: 409, body: { error: 'nothing_to_send', message: 'This day has no Assignments to Send. Plan the day first.' } }, 'This day has no Assignments to Send. Plan the day first.'],
    ['a refused date', { status: 400, body: { error: 'invalid', fields: { date: 'Days before today are read-only, so they cannot be Sent.' } } }, 'Days before today are read-only, so they cannot be Sent.'],
    ['a failure', { status: 500, body: { error: 'oops' } }, 'Could not Send this day'],
  ])('shows the Worker\'s message for %s, and the day stays a Draft', async (_what, refusal, message) => {
    sendRefusal = refusal;
    assignments = [planned()];
    open('/?date=2026-11-20');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton()!);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(dayState()).toBe('Draft · not sent yet · saved 3:00 PM');
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
    assignments = [planned('2026-11-17', { changedAt: '2026-11-19T22:00:00.000Z' })];
    assignments.push(planned('2026-11-18'));
    assignments.push(planned('2026-11-19', { driverId: null, driverName: null }));
    assignments.push(planned('2026-11-19', { driverId: null, driverName: null }));
    assignments.push(planned('2026-11-19'));
    assignments.push(planned('2026-11-20'));
    daySends = { '2026-11-17': SENT_AT, '2026-11-18': SENT_AT };
    open('/?date=2026-11-20');
    await waitFor(() =>
      expect(tiles()).toEqual([
        'Mon 16 · –',
        'Tue 17 · Changed',
        'Wed 18 · Sent',
        'Thu 19 · Today · 2 unassigned',
        'Fri 20 · Tomorrow · Not sent',
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
    await waitFor(() => expect(tile('Thu 26').getAttribute('aria-label')).toBe('Thu 26 · Thanksgiving · Not sent'));
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

  it('updates after an add and after Send', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · –'));

    fireEvent.click(await within(lane('Unassigned')).findByRole('button', { name: 'Add an Assignment for Unassigned' }));
    fireEvent.click(within(lane('Unassigned')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · 1 unassigned'));

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(tile('Fri 20').getAttribute('aria-label')).toBe('Fri 20 · Tomorrow · Sent'));
  });

  it('updates when the page regains the focus, for what changed elsewhere', async () => {
    open('/?date=2026-11-20');
    await waitFor(() => expect(tile('Mon 16').getAttribute('aria-label')).toBe('Mon 16 · –'));
    assignments = [planned('2026-11-16')];
    regainFocus();
    await waitFor(() => expect(tile('Mon 16').getAttribute('aria-label')).toBe('Mon 16 · Not sent'));
  });

  it('still shows its days, without states, when the week cannot be read', async () => {
    failWeeks = true;
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    await waitFor(() => expect(tiles()).toEqual(['Mon 16', 'Tue 17', 'Wed 18', 'Thu 19 · Today', 'Fri 20 · Tomorrow', 'Sat 21', 'Sun 22']));
  });

  it('replaces Jump to', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    expect(screen.queryByLabelText('Jump to')).toBeNull();
  });
});
