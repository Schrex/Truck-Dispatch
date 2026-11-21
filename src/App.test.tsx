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
}) => {
  const driver = drivers.find((d) => d.id === body.driverId);
  const truck = trucks.find((t) => t.id === body.truckId);
  const from = places.find((p) => p.id === body.fromPlaceId);
  const to = places.find((p) => p.id === body.toPlaceId);
  const material = materials.find((m) => m.id === body.materialId);
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
    };
    assignments.push(assignment);
    return answer({ assignment }, 201);
  }
  const one = /\/api\/assignments\/([^/]+)$/.exec(url.pathname);
  if (one && init?.method === 'PUT') {
    const index = assignments.findIndex((a) => a.id === one[1]);
    const fields = resolve(JSON.parse(String(init.body)));
    const before = assignments[index];
    const sameLane = before.date === fields.date && (before.driverId ?? null) === fields.driverId;
    assignments[index] = {
      ...before,
      ...fields,
      position: sameLane ? before.position : lastInLane(fields.date, fields.driverId),
      updatedAt: '2026-11-19T21:00:00.000Z',
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

  it('adds an Assignment with only a date, confirms it, and shows it on the "Unassigned" lane', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-20');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(within(lane('Unassigned')).getByText('No details yet')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
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
  it('adds an Assignment with a Driver and a note onto that Driver\'s lane', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    // The Driver picker's own form control: jsdom cannot open the listbox.
    await waitFor(() => expect(dialog.querySelector('select option[value="drv-b"]')).toBeTruthy());
    fireEvent.change(dialog.querySelector('select')!, { target: { value: 'drv-b' } });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Move the excavator' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByText('Move the excavator')).toBeTruthy();
  });

  it('goes to the day an Assignment was saved for when it is not the day on screen', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-23' } });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Monday work' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Monday work')).toBeTruthy();
    expect(address()).toBe('/?date=2026-11-23');
  });

  it('shows the message for a refused field next to that field and keeps the dialog open', async () => {
    refuse = { note: 'Keep the note to 1000 characters or fewer.' };
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Assignment' }));

    const message = await screen.findByText('Keep the note to 1000 characters or fewer.');
    expect(message.closest('div')?.querySelector('textarea')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a message when a save fails, and keeps the dialog open', async () => {
    failSaves = true;
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Could not save the Assignment')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

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
    expect(blocks('Sample Driver A')).toEqual(['First · Sample Plant → Sample Site North', 'Then · Move the excavator']);
    expect(blocks('Unassigned')).toEqual(['First · Who takes this?']);
    expect(within(lane('Sample Driver B')).getByText('Nothing planned yet')).toBeTruthy();
  });

  it('adds a new Assignment last in its lane', async () => {
    assignments = [at({ id: 'a1', ...a, note: 'Haul stone', position: 0 })];
    open('/?date=2026-11-20');
    await screen.findByText('Haul stone');
    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('select option[value="drv-a"]')).toBeTruthy());
    fireEvent.change(dialog.querySelector('select')!, { target: { value: 'drv-a' } });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Topsoil run' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await within(await screen.findByRole('article', { name: 'Sample Driver A' })).findByText('Topsoil run')).toBeTruthy();
    expect(blocks('Sample Driver A')).toEqual(['First · Haul stone', 'Then · Topsoil run · Truck 21']);
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
    // Picking a Driver still fills in his usual Truck.
    expect(blocks('Sample Driver B')).toEqual(['First · Topsoil run', 'Then · Haul stone · Truck 24']);
    expect(within(lane('Sample Driver A')).getByText('Nothing planned yet')).toBeTruthy();
  });

  it('moves it to the other day when the date changes, and shows that day', async () => {
    assignments = [planned()];
    open('/?date=2026-11-20');
    const dialog = await edit('Haul stone');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-23' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    await waitFor(() => expect(address()).toBe('/?date=2026-11-23'));
    expect(await within(await findLane('Sample Driver A')).findByText('Haul stone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous Working day, Fri 20' }));
    expect(await screen.findByText('No Assignments for this day')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /Add Assignment|^Edit |Delete/ })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it('shows today with its add and edit controls', async () => {
    assignments = [planned({ date: '2026-11-19' })];
    open('/?date=2026-11-19');
    expect(await screen.findByRole('button', { name: 'Edit Haul stone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Assignment' })).toBeTruthy();
  });
});

describe('the Truck', () => {
  /** A picker's own form control (jsdom cannot open the listbox), once its list has loaded. */
  const picker = async (dialog: HTMLElement, name: 'driverId' | 'truckId') => {
    await waitFor(() => expect(dialog.querySelectorAll(`select[name="${name}"] option`).length).toBeGreaterThan(1));
    return dialog.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  };
  const choices = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);
  const addDialog = async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    return screen.getByRole('dialog');
  };

  it('has a picker with an empty choice, listing active Trucks only', async () => {
    const dialog = await addDialog();
    const truck = await picker(dialog, 'truckId');
    expect(truck.value).toBe('none');
    expect(choices(truck)).toEqual(['No Truck', '21', '24']);
  });

  it('leaves inactive Drivers out of the Driver picker', async () => {
    const dialog = await addDialog();
    expect(choices(await picker(dialog, 'driverId'))).toEqual(['No Driver', 'Sample Driver A', 'Sample Driver B']);
  });

  it("is filled with the Driver's usual Truck when a Driver is picked and the Truck is empty, and shows on the line", async () => {
    const dialog = await addDialog();
    fireEvent.change(await picker(dialog, 'driverId'), { target: { value: 'drv-b' } });
    expect((await picker(dialog, 'truckId')).value).toBe('trk-24');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(within(lane('Sample Driver B')).getByRole('listitem').textContent).toBe('First · Truck 24');
  });

  it('is left alone when already chosen and a Driver is picked', async () => {
    const dialog = await addDialog();
    fireEvent.change(await picker(dialog, 'truckId'), { target: { value: 'trk-21' } });
    fireEvent.change(await picker(dialog, 'driverId'), { target: { value: 'drv-b' } });
    expect((await picker(dialog, 'truckId')).value).toBe('trk-21');
  });

  it('can be changed from the usual Truck, or cleared', async () => {
    const dialog = await addDialog();
    fireEvent.change(await picker(dialog, 'driverId'), { target: { value: 'drv-a' } });
    fireEvent.change(await picker(dialog, 'truckId'), { target: { value: 'none' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-a', truckId: null })]);
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
    expect(sent).toEqual([expect.objectContaining({ driverId: 'drv-x', truckId: 'trk-99', note: 'Haul topsoil' })]);
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
  const addDialog = async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    return screen.getByRole('dialog');
  };
  const pick = async (dialog: HTMLElement, name: Picker | 'driverId', value: string) => {
    await waitFor(() => expect(dialog.querySelector(`select[name="${name}"] option[value="${value}"]`)).toBeTruthy());
    fireEvent.change(dialog.querySelector(`select[name="${name}"]`)!, { target: { value } });
  };

  it.each([
    ['From Place', 'fromPlaceId'],
    ['To Place', 'toPlaceId'],
  ] as const)('the %s picker has an empty choice and lists active Places by short name', async (label, name) => {
    const dialog = await addDialog();
    expect(within(dialog).getByLabelText(label)).toBeTruthy();
    const select = await picker(dialog, name);
    expect(select.value).toBe('none');
    expect(choices(select)).toEqual([label === 'From Place' ? 'No From Place' : 'No To Place', 'Sample Plant', 'Sample Site North']);
  });

  it('saves both, and the line reads From → To', async () => {
    const dialog = await addDialog();
    await pick(dialog, 'driverId', 'drv-a');
    await pick(dialog, 'fromPlaceId', 'plc-plant');
    await pick(dialog, 'toPlaceId', 'plc-north');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' })]);
    expect(within(lane('Sample Driver A')).getByRole('listitem').textContent).toBe('First · Sample Plant → Sample Site North · Truck 21');
  });

  it('saves only a To Place, and the line shows it with no arrow', async () => {
    const dialog = await addDialog();
    await pick(dialog, 'toPlaceId', 'plc-north');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(within(lane('Unassigned')).getByRole('listitem').textContent).toBe('First · Sample Site North');
  });

  it('lets the same Place be both From and To', async () => {
    const dialog = await addDialog();
    await pick(dialog, 'fromPlaceId', 'plc-plant');
    await pick(dialog, 'toPlaceId', 'plc-plant');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-plant', toPlaceId: 'plc-plant' })]);
  });

  it('shows the message for an unknown Place next to that picker', async () => {
    refuse = { toPlaceId: 'Pick a Place from the list.' };
    const dialog = await addDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    const message = await within(dialog).findByText('Pick a Place from the list.');
    expect(message.closest('div')?.querySelector('select[name="toPlaceId"]')).toBeTruthy();
  });

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
    expect(sent).toEqual([expect.objectContaining({ fromPlaceId: 'plc-x', toPlaceId: 'plc-north', note: 'Haul topsoil' })]);
    expect(within(lane('Sample Driver A')).getByRole('listitem').textContent).toBe('First · Sample Old Pit → Sample Site North · Haul topsoil');
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

  it('have pickers with an empty choice, listing active entries only, and show on the line once saved', async () => {
    open('/?date=2026-11-20');
    await screen.findByText('No Assignments for this day');
    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    const material = await picker(dialog, 'materialId');
    const foreman = await picker(dialog, 'foremanId');
    expect([material.value, foreman.value]).toEqual(['none', 'none']);
    expect(choices(material)).toEqual(['No Material', '2" minus', 'Sample Dirt']);
    expect(choices(foreman)).toEqual(['No Foreman', 'Sample Foreman A']);

    fireEvent.change(material, { target: { value: 'mat-minus' } });
    fireEvent.change(foreman, { target: { value: 'frm-a' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));
    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(sent).toEqual([expect.objectContaining({ materialId: 'mat-minus', foremanId: 'frm-a' })]);
    expect(within(lane('Unassigned')).getByRole('listitem').textContent).toBe('First · 2" minus · Foreman Sample Foreman A');
  });

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
    expect(sent).toEqual([expect.objectContaining({ materialId: 'mat-old', foremanId: 'frm-x', note: 'Two loads' })]);
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
