import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { NewOrder, Order } from '../../shared/types';

const { env } = localD1();
const get = (path: string) => handle(new Request(`https://td.example${path}`), env());
const post = (path: string, body: unknown) =>
  handle(
    new Request(`https://td.example${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env(),
  );

const order: NewOrder = {
  workDate: '2026-11-18',
  startTime: '07:30',
  job: 'Sample Job 100',
  work: 'Haul #57 stone',
  pickup: 'Sample Quarry',
  dropoff: 'Sample Job site',
  driverId: 'drv-a',
  truckNumber: 'T-101',
};

describe.each([
  ['standalone at the root', ''],
  ['under the Hub prefix', '/truck-dispatch'],
])('%s', (_name, prefix) => {
  it('lists the seeded drivers', async () => {
    const { drivers } = (await (await get(`${prefix}/api/drivers`)).json()) as { drivers: { name: string }[] };
    expect(drivers.map((d) => d.name)).toEqual(['Sample Driver A', 'Sample Driver B', 'Sample Driver C']);
  });

  it('adds an order and lists it on its day', async () => {
    const created = await post(`${prefix}/api/orders`, order);
    expect(created.status).toBe(201);
    const { orders } = (await (await get(`${prefix}/api/orders?date=2026-11-18`)).json()) as { orders: Order[] };
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ job: 'Sample Job 100', driverName: 'Sample Driver A', truckNumber: 'T-101', startTime: '07:30' });
  });

  // The page files answer any address that is not a file with the page itself
  // (wrangler.jsonc: single-page-application), so the Worker only has to ask
  // for the address without the prefix.
  it.each([
    ['Board', '/'],
    ['Board on a given day', '/?date=2026-11-18'],
    ['Settings', '/settings'],
  ])('serves the %s page on a direct load', async (_page, address) => {
    const response = await get(`${prefix}${address}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`asset ${address}`);
  });

  it('serves page files with the prefix removed', async () => {
    expect(await (await get(`${prefix}/assets/app.js`)).text()).toBe('asset /assets/app.js');
  });
});

describe('orders', () => {
  it('starts with an empty board', async () => {
    const { orders } = (await (await get('/api/orders?date=2026-11-18')).json()) as { orders: Order[] };
    expect(orders).toEqual([]);
  });

  it('accepts an order without a truck or start time', async () => {
    const response = await post('/api/orders', { ...order, truckNumber: '', startTime: '' });
    expect(response.status).toBe(201);
    const { order: saved } = (await response.json()) as { order: Order };
    expect(saved.truckNumber).toBeNull();
    expect(saved.startTime).toBeNull();
  });

  it('lists a day by start time, untimed orders last, and leaves other days out', async () => {
    await post('/api/orders', { ...order, job: 'Late', startTime: '13:00' });
    await post('/api/orders', { ...order, job: 'Untimed', startTime: null });
    await post('/api/orders', { ...order, job: 'Early', startTime: '06:00' });
    await post('/api/orders', { ...order, job: 'Other day', workDate: '2026-11-19' });
    const { orders } = (await (await get('/api/orders?date=2026-11-18')).json()) as { orders: Order[] };
    expect(orders.map((o) => o.job)).toEqual(['Early', 'Late', 'Untimed']);
  });

  it('says which fields are missing', async () => {
    const response = await post('/api/orders', { workDate: '2026-11-18' });
    expect(response.status).toBe(400);
    const { fields } = (await response.json()) as { fields: Record<string, string> };
    expect(Object.keys(fields).sort()).toEqual(['driverId', 'job', 'work']);
  });

  it('refuses a driver that does not exist', async () => {
    const response = await post('/api/orders', { ...order, driverId: 'nobody' });
    expect(response.status).toBe(400);
  });

  it('refuses a bad date or time', async () => {
    expect((await post('/api/orders', { ...order, workDate: '18-11-2026' })).status).toBe(400);
    expect((await post('/api/orders', { ...order, startTime: '25:00' })).status).toBe(400);
    expect((await get('/api/orders')).status).toBe(400);
  });

  it('refuses a body that is not JSON', async () => {
    const response = await handle(new Request('https://td.example/api/orders', { method: 'POST', body: 'x' }), env());
    expect(response.status).toBe(415);
  });
});

describe('API', () => {
  it('refuses writes to read-only routes', async () => {
    expect((await post('/api/drivers', {})).status).toBe(405);
  });

  it('reports the environment and deployed commit', async () => {
    const response = await handle(new Request('https://td.example/api/health'), env({ COMMIT_SHA: 'abc123' }));
    expect(await response.json()).toEqual({ ok: true, environment: 'test', commit: 'abc123' });
  });
});

describe('prefix', () => {
  it('redirects /truck-dispatch to /truck-dispatch/ so relative API calls stay under it', async () => {
    const response = await get('/truck-dispatch?date=2026-11-18');
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://td.example/truck-dispatch/?date=2026-11-18');
  });

  it('keeps asset redirects under the prefix', async () => {
    const e = env();
    e.ASSETS = { fetch: async () => new Response(null, { status: 307, headers: { Location: '/' } }) } as unknown as Fetcher;
    const response = await handle(new Request('https://td.example/truck-dispatch/index.html'), e);
    expect(response.headers.get('Location')).toBe('/truck-dispatch/');
  });
});
