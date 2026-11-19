// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { toast } from './components/ui/sonner';

/** The API as the page sees it: one seeded Driver, and orders that stay once added. */
let orders: Record<string, unknown>[] = [];
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/api/drivers')) return answer({ drivers: [{ id: 'drv-a', name: 'Sample Driver A' }] });
  if (init?.method === 'POST') {
    const order = { id: `o${orders.length + 1}`, driverName: 'Sample Driver A', createdAt: '2026-11-18T12:00:00Z', ...JSON.parse(String(init.body)) };
    orders.push(order);
    return answer({ order }, 201);
  }
  const date = new URL(url, 'https://td.example').searchParams.get('date');
  return answer({ orders: orders.filter((order) => order.workDate === date) });
});

const open = (address: string) => {
  window.history.pushState(null, '', address);
  return render(<App />);
};

beforeEach(() => {
  orders = [];
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
    open(`${prefix}/`);
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
  ])('gives the %s page the Hub header: a "← Hub" link, an uppercase Oswald title and a subtitle, with no bottom nav', (_page, address, title) => {
    open(`${prefix}${address}`);
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
  ])('shows a toast raised on the %s page', async (_page, address) => {
    open(`${prefix}${address}`);
    act(() => {
      toast.success('Saved the Assignment');
    });
    expect(await screen.findByText('Saved the Assignment')).toBeTruthy();
  });

  it('lists a day on the Board and adds an order to it', async () => {
    orders = [
      { id: 'o0', workDate: '2026-11-18', startTime: null, job: 'Sample Job 100', work: 'Haul stone', pickup: '', dropoff: '', driverId: 'drv-a', driverName: 'Sample Driver A', truckNumber: null, notes: '' },
    ];
    open(`${prefix}/?date=2026-11-18`);
    expect(await screen.findByText('Sample Job 100')).toBeTruthy();
    expect(screen.getByText('Wednesday, November 18, 2026')).toBeTruthy();
    expect(screen.getByText('1 order')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New Order' }));
    fireEvent.change(screen.getByLabelText('Job'), { target: { value: 'Sample Job 200' } });
    fireEvent.change(screen.getByLabelText('Work'), { target: { value: 'Haul topsoil' } });
    // The Driver picker's own form control: jsdom cannot open the listbox.
    fireEvent.change(document.querySelector('select')!, { target: { value: 'drv-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add order' }));

    expect(await screen.findByText('Sample Job 200')).toBeTruthy();
    expect(screen.getByText('2 orders')).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe(`${prefix}/?date=2026-11-18`);
  });

  it('keeps the Board\'s API calls under the same prefix as the page', async () => {
    open(`${prefix}/?date=2026-11-18`);
    await screen.findByText('No orders for this day');
    expect(api.mock.calls.map(([url]) => String(url)).sort()).toEqual([`${prefix}/api/drivers`, `${prefix}/api/orders?date=2026-11-18`]);
  });
});
