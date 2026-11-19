// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { toast } from './components/ui/sonner';

/**
 * The API as the page sees it: tomorrow in US Eastern is 2026-11-20, two
 * seeded Drivers, and Assignments that stay once added.
 */
let assignments: Record<string, unknown>[] = [];
let failLoads = false;
let failSaves = false;
let refuse: Record<string, string> | null = null;
const drivers = [
  { id: 'drv-a', name: 'Sample Driver A' },
  { id: 'drv-b', name: 'Sample Driver B' },
];
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/api/today')) return answer({ today: '2026-11-19', tomorrow: '2026-11-20' });
  if (url.pathname.endsWith('/api/drivers')) return answer({ drivers });
  if (init?.method === 'POST') {
    if (failSaves) return answer({ error: 'oops' }, 500);
    if (refuse) return answer({ error: 'invalid', fields: refuse }, 400);
    const body = JSON.parse(String(init.body));
    const driver = drivers.find((d) => d.id === body.driverId);
    const assignment = {
      id: `a${assignments.length + 1}`,
      date: body.date,
      driverId: driver?.id ?? null,
      driverName: driver?.name ?? null,
      note: body.note || null,
      createdAt: '2026-11-19T20:00:00.000Z',
      updatedAt: '2026-11-19T20:00:00.000Z',
    };
    assignments.push(assignment);
    return answer({ assignment }, 201);
  }
  if (failLoads) return answer({ error: 'oops' }, 500);
  return answer({ assignments: assignments.filter((a) => a.date === url.searchParams.get('date')) });
});

const open = (address: string) => {
  window.history.pushState(null, '', address);
  return render(<App />);
};
const address = () => window.location.pathname + window.location.search;
const subtitle = () => screen.getByRole('heading', { level: 1 }).nextElementSibling?.textContent;
const card = (driver: string) => screen.getByRole('article', { name: driver });

beforeEach(() => {
  assignments = [];
  failLoads = false;
  failSaves = false;
  refuse = null;
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

  it('opens the Board on tomorrow in US Eastern time when the address names no day, and puts that day in the address', async () => {
    open(`${prefix}/`);
    await waitFor(() => expect(subtitle()).toBe('Friday, November 20, 2026'));
    expect(address()).toBe(`${prefix}/?date=2026-11-20`);
    expect(await screen.findByText('No Assignments for this day')).toBeTruthy();
  });

  it('opens the Board on the day the address names, with that date as the subtitle', async () => {
    assignments = [{ id: 'a0', date: '2026-11-18', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', createdAt: '', updatedAt: '' }];
    open(`${prefix}/?date=2026-11-18`);
    expect(await screen.findByText('Haul stone')).toBeTruthy();
    expect(subtitle()).toBe('Wednesday, November 18, 2026');
    expect(address()).toBe(`${prefix}/?date=2026-11-18`);
  });

  it('moves one day with ‹ and ›, jumps to any day, and the address follows the day on screen', async () => {
    assignments = [
      { id: 'a0', date: '2026-11-21', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Saturday work', createdAt: '', updatedAt: '' },
      { id: 'a1', date: '2027-01-04', driverId: null, driverName: null, note: 'New year work', createdAt: '', updatedAt: '' },
    ];
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByText('Saturday work')).toBeTruthy();
    expect(subtitle()).toBe('Saturday, November 21, 2026');
    expect(address()).toBe(`${prefix}/?date=2026-11-21`);

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() => expect(subtitle()).toBe('Thursday, November 19, 2026'));
    expect(address()).toBe(`${prefix}/?date=2026-11-19`);

    fireEvent.change(screen.getByLabelText('Jump to'), { target: { value: '2027-01-04' } });
    expect(await screen.findByText('New year work')).toBeTruthy();
    expect(address()).toBe(`${prefix}/?date=2027-01-04`);
  });

  it('adds an Assignment with only a date, confirms it, and shows it on the "Unassigned" card', async () => {
    open(`${prefix}/?date=2026-11-20`);
    await screen.findByText('No Assignments for this day');

    fireEvent.click(screen.getByRole('button', { name: 'Add Assignment' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-11-20');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Assignment' }));

    expect(await screen.findByText('Assignment saved')).toBeTruthy();
    expect(within(card('Unassigned')).getByText('No details yet')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(address()).toBe(`${prefix}/?date=2026-11-20`);
  });

  it('keeps the Board\'s API calls under the same prefix as the page', async () => {
    open(`${prefix}/`);
    await screen.findByText('No Assignments for this day');
    expect(api.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      `${prefix}/api/assignments?date=2026-11-20`,
      `${prefix}/api/drivers`,
      `${prefix}/api/today`,
    ]);
  });
});

describe('Board', () => {
  it('adds an Assignment with a Driver and a note onto that Driver\'s card', async () => {
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
    expect(within(card('Sample Driver B')).getByText('Move the excavator')).toBeTruthy();
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
});
