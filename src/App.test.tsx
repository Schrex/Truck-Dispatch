// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { toast } from './components/ui/sonner';

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
    // Only the fields sent change; a real change of Driver goes last in his lane.
    const index = assignments.findIndex((a) => a.id === one[1]);
    const before = assignments[index];
    const fields = resolve({ ...before, ...JSON.parse(String(init.body)) } as Parameters<typeof resolve>[0]);
    const sameLane = (before.driverId ?? null) === fields.driverId;
    assignments[index] = {
      ...before,
      ...fields,
      position: sameLane ? before.position : lastInLane(fields.date, fields.driverId),
      updatedAt: '2026-11-19T21:00:00.000Z',
      changedAt: '2026-11-19T21:00:00.000Z',
    };
    return answer({ assignment: assignments[index] });
  }
  if (one && init?.method === 'DELETE') {
    assignments = assignments.filter((a) => a.id !== one[1]);
    return new Response(null, { status: 204 });
  }
  if (failLoads) return answer({ error: 'oops' }, 500);
  // In each lane's order (the page groups the lanes itself).
  const day = assignments.filter((a) => a.date === url.searchParams.get('date'));
  return answer({ assignments: day.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)) });
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

  it('steps by Working day with arrows that name their day, jumps to any day, and the address follows the day on screen', async () => {
    assignments = [
      { id: 'a0', date: '2026-11-23', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Monday work', createdAt: '', updatedAt: '' },
      { id: 'a1', date: '2027-01-04', driverId: null, driverName: null, note: 'New year work', createdAt: '', updatedAt: '' },
    ];
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

    fireEvent.change(screen.getByLabelText('Jump to'), { target: { value: '2027-01-04' } });
    expect(await screen.findByText('New year work')).toBeTruthy();
    expect(address()).toBe(`${prefix}/?date=2027-01-04`);
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

    const jumpTo = screen.getByLabelText('Jump to');
    jumpTo.focus();
    fireEvent.keyDown(jumpTo, { key: 'ArrowRight' });
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
    expect(api.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      `${prefix}/api/assignments?date=2026-11-20`,
      `${prefix}/api/drivers?include=inactive`,
      `${prefix}/api/foremen?include=inactive`,
      `${prefix}/api/materials?include=inactive`,
      `${prefix}/api/places?include=inactive`,
      `${prefix}/api/today`,
      `${prefix}/api/trucks?include=inactive`,
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
        'Then · Sample Plant → Sample Site North (Sample Foreman A) · 2" minus · Truck 21 (his own)',
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

describe('changing the plan', () => {
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone',
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', ...fields,
  });
  const edit = async (line: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${line}` }));
    return screen.getByRole('dialog', { name: 'Edit Assignment' });
  };
  const pickDriver = async (dialog: HTMLElement, id: string) => {
    // The Driver picker's own form control: jsdom cannot open the listbox.
    await waitFor(() => expect(dialog.querySelector(`select option[value="${id}"]`)).toBeTruthy());
    fireEvent.change(dialog.querySelector('select')!, { target: { value: id } });
  };

  const findLane = (driver: string) => screen.findByRole('article', { name: driver });

  it('opens an Assignment in the same dialog, filled in, and saves an edit onto the Board', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-20');
    expect((within(dialog).getByLabelText(/Note/) as HTMLTextAreaElement).value).toBe('Haul stone');
    expect((dialog.querySelector('select') as HTMLSelectElement).value).toBe('drv-a');

    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Haul topsoil' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await within(await findLane('Sample Driver A')).findByText('Haul topsoil')).toBeTruthy();
    expect(screen.queryByText('Haul stone')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears a field that was set', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: '' } });
    await pickDriver(dialog, 'none');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await within(await findLane('Unassigned')).findByText('No details yet')).toBeTruthy();
  });

  it('moves the block to the end of the other Driver\'s lane when the Driver changes', async () => {
    assignments = [planned({ position: 0 }), planned({ id: 'a2', driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Topsoil run', position: 0 })];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    await pickDriver(dialog, 'drv-b');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await within(await findLane('Sample Driver B')).findByText('Haul stone')).toBeTruthy();
    // The Assignment names no Truck, so it shows his own.
    expect(blocks('Sample Driver B')).toEqual(['First · Topsoil run · Truck 24 (his own)', 'Then · Haul stone · Truck 24 (his own)']);
    expect(within(lane('Sample Driver A')).getByText('Nothing planned yet')).toBeTruthy();
  });

  it('sends only the fields that changed, so a change made elsewhere to another field stays', async () => {
    assignments = [planned({ truckId: 'trk-21', truckNumber: '21' })];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone · Truck 21');
    // Meanwhile, on another device, the Truck is changed.
    assignments[0] = { ...assignments[0], truckId: 'trk-24', truckNumber: '24' };
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Haul topsoil' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await within(await findLane('Sample Driver A')).findByText('Haul topsoil')).toBeTruthy();
    expect(sent).toEqual([{ note: 'Haul topsoil' }]);
    expect(blocks('Sample Driver A')).toEqual(['First · Haul topsoil · Truck 24']);
  });

  it('sends nothing when nothing changed, and closes', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('keeps the Assignment on its day: the date cannot be changed', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    const date = within(dialog).getByLabelText('Date') as HTMLInputElement;
    expect(date.value).toBe('2026-11-20');
    expect(date.disabled).toBe(true);
  });

  it('deletes an Assignment after a second click to confirm, and it leaves the Board', async () => {
    assignments = [planned(), planned({ id: 'a2', note: 'Topsoil run' })];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(assignments).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));

    expect(await screen.findByText('Assignment deleted')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Haul stone')).toBeNull());
    expect(within(lane('Sample Driver A')).getByText('Topsoil run')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a message when a change is refused for a past day, and keeps the dialog open', async () => {
    assignments = [planned({ date: '2026-11-19' })];
    open('/?date=2026-11-19');
    const dialog = await edit('Haul stone');
    api.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'past_day', message: 'This Assignment is on a day before today, which is read-only.' }), { status: 409 }),
    );
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Haul topsoil' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await within(dialog).findByText('This Assignment is on a day before today, which is read-only.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a past day read-only: no add, edit or delete controls', async () => {
    assignments = [planned({ date: '2026-11-18' }), planned({ id: 'a2', date: '2026-11-18', driverId: null, driverName: null, note: 'Unplanned' })];
    open('/?date=2026-11-18');
    expect(await within(await findLane('Sample Driver A')).findByText('Haul stone')).toBeTruthy();
    expect(within(lane('Unassigned')).getByText('Unplanned')).toBeTruthy();
    // Wait for the Worker's today, so the read-only view is not just the moment before it arrives.
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith('/api/today'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /Add Assignment|^Add an Assignment|^Edit |Delete/ })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it('shows today with its add and edit controls', async () => {
    assignments = [planned({ date: '2026-11-19' })];
    open('/?date=2026-11-19');
    expect(await screen.findByRole('button', { name: 'Edit Haul stone' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add an Assignment for Sample Driver A' })).toBeTruthy();
  });
});

describe('the Truck', () => {
  /** A picker's own form control (jsdom cannot open the listbox), once its list has loaded. */
  const picker = async (dialog: HTMLElement, name: 'driverId' | 'truckId') => {
    await waitFor(() => expect(dialog.querySelectorAll(`select[name="${name}"] option`).length).toBeGreaterThan(1));
    return dialog.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  };
  const choices = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

  it('leaves inactive Drivers out of the Driver picker', async () => {
    assignments = [{ id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', createdAt: '', updatedAt: '' }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    expect(choices(await picker(dialog, 'driverId'))).toEqual(['No Driver', 'Sample Driver A', 'Sample Driver B']);
  });

  it('shows no Truck on the board for His own when the Driver has no usual Truck', async () => {
    assignments = [{ id: 'a0', date: '2026-11-20', driverId: 'drv-x', driverName: 'Sample Driver X', note: 'Haul stone', createdAt: '', updatedAt: '' }];
    open('/?date=2026-11-20');
    expect(await within(await screen.findByRole('article', { name: 'Sample Driver X' })).findByText('Haul stone')).toBeTruthy();
    expect(within(lane('Sample Driver X')).getByRole('listitem').textContent).toBe('First · Haul stone');
  });

  it('keeps the Truck an existing Assignment names, and can set it back to His own', async () => {
    assignments = [{ id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-24', truckNumber: '24', note: 'Haul stone', createdAt: '', updatedAt: '' }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone · Truck 24' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    const truck = await picker(dialog, 'truckId');
    expect(truck.value).toBe('trk-24');
    fireEvent.change(truck, { target: { value: 'none' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([{ truckId: null }]);
    expect(within(lane('Sample Driver A')).getByRole('listitem').textContent).toBe('First · Haul stone · Truck 21 (his own)');
  });

  it('keeps a Driver and Truck made inactive since, by name, when something else is edited', async () => {
    assignments = [{
      id: 'a0', date: '2026-11-20', driverId: 'drv-x', driverName: 'Sample Driver X', truckId: 'trk-99', truckNumber: '99',
      note: 'Haul stone', createdAt: '', updatedAt: '',
    }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone · Truck 99' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    const driver = await picker(dialog, 'driverId');
    const truck = await picker(dialog, 'truckId');
    expect(driver.value).toBe('drv-x');
    expect(choices(driver)).toContain('Sample Driver X (inactive)');
    expect(truck.value).toBe('trk-99');
    expect(choices(truck)).toContain('99 (inactive)');

    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Haul topsoil' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([{ note: 'Haul topsoil' }]);
    expect(within(lane('Sample Driver X')).getByRole('listitem').textContent).toBe('First · Haul topsoil · Truck 99');
  });
});

describe('From and To Places', () => {
  type Picker = 'fromPlaceId' | 'toPlaceId';
  /** A picker's own form control (jsdom cannot open the listbox), once its list has loaded. */
  const picker = async (dialog: HTMLElement, name: Picker) => {
    await waitFor(() => expect(dialog.querySelectorAll(`select[name="${name}"] option`).length).toBeGreaterThan(1));
    return dialog.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  };
  const choices = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

  it('keeps a Place made inactive since, by name, when something else is edited', async () => {
    assignments = [{
      id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', truckId: null, truckNumber: null,
      fromPlaceId: 'plc-x', fromPlaceName: 'Sample Old Pit', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North',
      note: 'Haul stone', createdAt: '', updatedAt: '',
    }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sample Old Pit → Sample Site North · Haul stone' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    const from = await picker(dialog, 'fromPlaceId');
    expect(from.value).toBe('plc-x');
    expect(choices(from)).toContain('Sample Old Pit (inactive)');
    expect(choices(await picker(dialog, 'toPlaceId'))).not.toContain('Sample Old Pit (inactive)');

    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Haul topsoil' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([{ note: 'Haul topsoil' }]);
    expect(within(lane('Sample Driver A')).getByRole('listitem').textContent).toBe('First · Sample Old Pit → Sample Site North · Haul topsoil · Truck 21 (his own)');
  });

  it('are carried by Duplicate to', async () => {
    assignments = [{
      id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', truckId: null, truckNumber: null,
      fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North',
      note: null, createdAt: '', updatedAt: '',
    }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sample Plant → Sample Site North' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    const duplicateTo = within(dialog).getByLabelText('Duplicate to').closest('div')!.querySelector('select')!;
    await waitFor(() => expect(duplicateTo.querySelector('option[value="drv-b"]')).toBeTruthy());
    fireEvent.change(duplicateTo, { target: { value: 'drv-b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByText('Duplicated to Sample Driver B')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-b', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' })]);
  });
});

describe('the Material and Foreman', () => {
  const picker = async (dialog: HTMLElement, name: 'materialId' | 'foremanId') => {
    await waitFor(() => expect(dialog.querySelectorAll(`select[name="${name}"] option`).length).toBeGreaterThan(1));
    return dialog.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  };
  const choices = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

  it('keep a Material and Foreman made inactive since, by name, when something else is edited', async () => {
    assignments = [{
      id: 'a0', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', truckId: null, truckNumber: null,
      materialId: 'mat-old', materialName: 'Sample Old Fill', foremanId: 'frm-x', foremanName: 'Sample Foreman X',
      note: null, createdAt: '', updatedAt: '',
    }];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sample Old Fill · Foreman Sample Foreman X' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    const material = await picker(dialog, 'materialId');
    const foreman = await picker(dialog, 'foremanId');
    expect(material.value).toBe('mat-old');
    expect(choices(material)).toContain('Sample Old Fill (inactive)');
    expect(foreman.value).toBe('frm-x');
    expect(choices(foreman)).toContain('Sample Foreman X (inactive)');

    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Two loads' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([{ note: 'Two loads' }]);
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

describe('Duplicate to…', () => {
  const planned = (fields: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone',
    createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z', ...fields,
  });

  it('adds a second Assignment with the same fields, note included, for the chosen Driver on the same day', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Haul stone' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Assignment' });
    // The picker's own form control: jsdom cannot open the listbox.
    const picker = within(dialog).getByLabelText('Duplicate to').closest('div')!.querySelector('select')!;
    await waitFor(() => expect(picker.querySelector('option[value="drv-b"]')).toBeTruthy());
    expect(picker.querySelector('option[value="drv-a"]')).toBeNull();
    fireEvent.change(picker, { target: { value: 'drv-b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await screen.findByText('Duplicated to Sample Driver B')).toBeTruthy();
    expect(await within(await screen.findByRole('article', { name: 'Sample Driver B' })).findByText('Haul stone')).toBeTruthy();
    expect(within(lane('Sample Driver A')).getByText('Haul stone')).toBeTruthy();
    expect(assignments).toHaveLength(2);
    expect(assignments[1]).toMatchObject({ date: '2026-11-20', driverId: 'drv-b', note: 'Haul stone' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is not offered on a past day', async () => {
    assignments = [planned({ date: '2026-11-18' })];
    open('/?date=2026-11-18');
    await screen.findByText('Haul stone');
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith('/api/today'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /Edit |Duplicate/ })).toBeNull();
    expect(screen.queryByText(/Duplicate to/)).toBeNull();
  });
});
