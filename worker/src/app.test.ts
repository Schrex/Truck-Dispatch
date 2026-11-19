import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { Assignment } from '../../shared/types';

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

describe.each([
  ['standalone at the root', ''],
  ['under the Hub prefix', '/truck-dispatch'],
])('%s', (_name, prefix) => {
  it('lists the seeded drivers', async () => {
    const { drivers } = (await (await get(`${prefix}/api/drivers`)).json()) as { drivers: { name: string }[] };
    expect(drivers.map((d) => d.name)).toEqual(['Sample Driver A', 'Sample Driver B', 'Sample Driver C']);
  });

  it('adds, changes and reads a list', async () => {
    const added = await post(`${prefix}/api/trucks`, { number: '30' });
    expect(added.status).toBe(201);
    const { truck } = (await added.json()) as { truck: { id: string } };
    const changed = await handle(
      new Request(`https://td.example${prefix}/api/trucks/${truck.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) }),
      env(),
    );
    expect(changed.status).toBe(200);
    const { trucks } = (await (await get(`${prefix}/api/trucks?include=inactive`)).json()) as { trucks: { number: string; active: boolean }[] };
    expect(trucks).toContainEqual(expect.objectContaining({ number: '30', active: false }));
  });

  it('saves an Assignment with only a date and reads it back on its day', async () => {
    const created = await post(`${prefix}/api/assignments`, { date: '2026-11-20' });
    expect(created.status).toBe(201);
    const { assignment } = (await created.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ date: '2026-11-20', driverId: null, driverName: null, note: null });

    const day = await get(`${prefix}/api/assignments?date=2026-11-20`);
    expect(day.status).toBe(200);
    expect(await day.json()).toEqual({ assignments: [assignment] });
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

const day = async (date: string) => ((await (await get(`/api/assignments?date=${date}`)).json()) as { assignments: Assignment[] }).assignments;
const add = async (body: unknown) => ((await (await post('/api/assignments', body)).json()) as { assignment: Assignment }).assignment;
const refusal = async (response: Response) => {
  expect(response.status).toBe(400);
  return ((await response.json()) as { fields: Record<string, string> }).fields;
};

describe('Assignments', () => {
  it('start with an empty day', async () => {
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('save a Driver and a note, and both come back when the day is read', async () => {
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-b', note: '  Move the excavator to the shop  ' });
    expect(created.status).toBe(201);
    expect(await day('2026-11-20')).toEqual([
      expect.objectContaining({ driverId: 'drv-b', driverName: 'Sample Driver B', note: 'Move the excavator to the shop' }),
    ]);
  });

  it('record when they were created and updated, from the clock in the environment', async () => {
    const response = await handle(
      new Request('https://td.example/api/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-11-20' }) }),
      env({ NOW: '2026-11-19T20:00:00.000Z' }),
    );
    const { assignment } = (await response.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T20:00:00.000Z' });
  });

  it('give each Assignment its own id', async () => {
    const first = await add({ date: '2026-11-20' });
    const second = await add({ date: '2026-11-20' });
    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it('ignore fields they do not know', async () => {
    const response = await post('/api/assignments', { date: '2026-11-20', startTime: '07:30', job: 'Sample Job' });
    expect(response.status).toBe(201);
    expect(Object.keys(((await response.json()) as { assignment: object }).assignment).sort()).toEqual(
      ['createdAt', 'date', 'driverId', 'driverName', 'id', 'note', 'truckId', 'truckNumber', 'updatedAt'],
    );
  });

  it.each([
    ['missing', undefined],
    ['written another way', '20-11-2026'],
    ['not on the calendar', '2026-02-30'],
    ['not text', 20261120],
  ])('refuse a date that is %s, with a message on the date', async (_why, date) => {
    const fields = await refusal(await post('/api/assignments', { date }));
    expect(Object.keys(fields)).toEqual(['date']);
    expect(fields.date).toBeTruthy();
  });

  it('refuse a Driver that does not exist, with a message on the Driver', async () => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', driverId: 'nobody' }));
    expect(Object.keys(fields)).toEqual(['driverId']);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('refuse an over-long note, with a message on the note', async () => {
    expect((await post('/api/assignments', { date: '2026-11-20', note: 'x'.repeat(1000) })).status).toBe(201);
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', note: 'x'.repeat(1001) }));
    expect(Object.keys(fields)).toEqual(['note']);
  });

  it('report every wrong field at once', async () => {
    const fields = await refusal(await post('/api/assignments', { date: 'soon', driverId: 'nobody', note: 'x'.repeat(1001) }));
    expect(Object.keys(fields).sort()).toEqual(['date', 'driverId', 'note']);
  });

  it('refuse a body that is not JSON', async () => {
    const response = await handle(new Request('https://td.example/api/assignments', { method: 'POST', body: 'x' }), env());
    expect(response.status).toBe(415);
  });

  it('read a day by Driver name, then in the order they were added, with no Driver last, and leave other days out', async () => {
    await add({ date: '2026-11-20', note: 'unassigned first' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'B first' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'A first' });
    await add({ date: '2026-11-21', driverId: 'drv-a', note: 'other day' });
    await add({ date: '2026-11-19', driverId: 'drv-a', note: 'day before' });
    await add({ date: '2026-11-20', note: 'unassigned second' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'A second' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'B second' });
    expect((await day('2026-11-20')).map((a) => a.note)).toEqual([
      'A first', 'A second', 'B first', 'B second', 'unassigned first', 'unassigned second',
    ]);
  });

  it('keep the order they were added in even when the clock stands still', async () => {
    const at = (note: string) =>
      handle(
        new Request('https://td.example/api/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-11-20', driverId: 'drv-a', note }) }),
        env({ NOW: '2026-11-19T20:00:00.000Z' }),
      );
    for (const note of ['one', 'two', 'three', 'four']) await at(note);
    expect((await day('2026-11-20')).map((a) => a.note)).toEqual(['one', 'two', 'three', 'four']);
  });

  it.each(['', '?date=', '?date=2026-02-30'])('refuse to read a day without a real date (%s)', async (search) => {
    const fields = await refusal(await get(`/api/assignments${search}`));
    expect(Object.keys(fields)).toEqual(['date']);
  });
});

const send = (method: string, path: string, body: unknown) =>
  handle(
    new Request(`https://td.example${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    env(),
  );
type Entry = { id: string; active: boolean } & Record<string, unknown>;
const list = async (path: string) => {
  const response = await get(path);
  expect(response.status).toBe(200);
  return Object.values((await response.json()) as Record<string, Entry[]>)[0];
};

// Every list behaves the same way; each is named by its display field.
describe.each([
  { route: 'drivers', one: 'driver', name: 'name', seeded: 'drv-a', seededName: 'Sample Driver A', fresh: 'Sample Driver D' },
  { route: 'trucks', one: 'truck', name: 'number', seeded: 'trk-21', seededName: '21', fresh: '30' },
])('the $route list', ({ route, one, name, seeded, seededName, fresh }) => {
  const names = async (search = '') => (await list(`/api/${route}${search}`)).map((e) => e[name]);
  const change = (id: string, body: unknown) => send('PATCH', `/api/${route}/${id}`, body);

  it('adds an entry, active, and lists it', async () => {
    const response = await post(`/api/${route}`, { [name]: `  ${fresh}  ` });
    expect(response.status).toBe(201);
    const added = ((await response.json()) as Record<string, Entry>)[one];
    expect(added).toMatchObject({ [name]: fresh, active: true });
    expect(await names()).toContain(fresh);
  });

  it('renames an entry', async () => {
    const response = await change(seeded, { [name]: fresh });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Record<string, Entry>)[one]).toMatchObject({ id: seeded, [name]: fresh });
    expect(await names()).toContain(fresh);
    expect(await names()).not.toContain(seededName);
  });

  it('refuses a name already used in the list, ignoring case, with a message on that field', async () => {
    const taken = seededName.toUpperCase() === seededName ? ` ${seededName} ` : seededName.toLowerCase();
    const added = await refusal(await post(`/api/${route}`, { [name]: taken }));
    expect(Object.keys(added)).toEqual([name]);
    await post(`/api/${route}`, { [name]: fresh });
    const renamed = await refusal(await change(seeded, { [name]: fresh.toLowerCase() }));
    expect(Object.keys(renamed)).toEqual([name]);
  });

  it('lets an entry keep its own name in another case', async () => {
    expect((await change(seeded, { [name]: seededName.toLowerCase() })).status).toBe(200);
  });

  it('refuses an empty name, with a message on that field', async () => {
    expect(Object.keys(await refusal(await post(`/api/${route}`, { [name]: '  ' })))).toEqual([name]);
    expect(Object.keys(await refusal(await post(`/api/${route}`, {})))).toEqual([name]);
    expect(Object.keys(await refusal(await change(seeded, { [name]: '' })))).toEqual([name]);
  });

  it('leaves inactive entries out of the default read, returns them when asked, and makes them active again', async () => {
    const off = await change(seeded, { active: false });
    expect(((await off.json()) as Record<string, Entry>)[one]).toMatchObject({ id: seeded, active: false });
    expect(await names()).not.toContain(seededName);
    expect((await list(`/api/${route}?include=inactive`)).find((e) => e.id === seeded)).toMatchObject({ [name]: seededName, active: false });

    await change(seeded, { active: true });
    expect(await names()).toContain(seededName);
  });

  it('refuses an active that is not true or false', async () => {
    expect(Object.keys(await refusal(await change(seeded, { active: 'no' })))).toEqual(['active']);
  });

  it('has no way to delete an entry', async () => {
    expect((await send('DELETE', `/api/${route}/${seeded}`, {})).status).toBe(405);
    expect((await send('DELETE', `/api/${route}`, {})).status).toBe(405);
    expect(await names('?include=inactive')).toContain(seededName);
  });

  it('answers 404 when changing an entry that does not exist', async () => {
    expect((await change('nobody', { [name]: fresh })).status).toBe(404);
  });
});

describe('Trucks', () => {
  it('save an HCSS code and HCSS id, and clear them', async () => {
    const response = await post('/api/trucks', { number: '30', hcssCode: ' T30 ', hcssGuid: '7f1c' });
    const { truck } = (await response.json()) as { truck: Entry };
    expect(truck).toMatchObject({ number: '30', hcssCode: 'T30', hcssGuid: '7f1c', active: true });

    const cleared = await send('PATCH', `/api/trucks/${truck.id}`, { hcssCode: '', hcssGuid: null });
    expect(((await cleared.json()) as { truck: Entry }).truck).toMatchObject({ number: '30', hcssCode: null, hcssGuid: null });
  });


  it('list the seeded Trucks by number, with their HCSS code and id', async () => {
    const response = await get('/api/trucks');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      trucks: [
        { id: 'trk-21', number: '21', hcssCode: 'SAMPLE-21', hcssGuid: null, active: true },
        { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
        { id: 'trk-27', number: '27', hcssCode: null, hcssGuid: null, active: true },
      ],
    });
  });
});

describe('Drivers', () => {
  it('come with their usual Truck', async () => {
    expect((await list('/api/drivers')).map((d) => [d.name, d.defaultTruckId])).toEqual([
      ['Sample Driver A', 'trk-21'],
      ['Sample Driver B', 'trk-24'],
      ['Sample Driver C', null],
    ]);
  });

  it('save a usual Truck when added, and change or clear it', async () => {
    const { driver } = (await (await post('/api/drivers', { name: 'Sample Driver D', defaultTruckId: 'trk-27' })).json()) as { driver: Entry };
    expect(driver).toMatchObject({ name: 'Sample Driver D', defaultTruckId: 'trk-27', active: true });
    const moved = await send('PATCH', `/api/drivers/${driver.id}`, { defaultTruckId: 'trk-24' });
    expect(((await moved.json()) as { driver: Entry }).driver.defaultTruckId).toBe('trk-24');
    const cleared = await send('PATCH', `/api/drivers/${driver.id}`, { defaultTruckId: null });
    expect(((await cleared.json()) as { driver: Entry }).driver).toMatchObject({ name: 'Sample Driver D', defaultTruckId: null });
  });

  it('refuse a usual Truck that does not exist, with a message on it', async () => {
    const fields = await refusal(await post('/api/drivers', { name: 'Sample Driver D', defaultTruckId: 'nothing' }));
    expect(Object.keys(fields)).toEqual(['defaultTruckId']);
  });

  it('accept an inactive Truck as their usual Truck', async () => {
    await send('PATCH', '/api/trucks/trk-27', { active: false });
    expect((await send('PATCH', '/api/drivers/drv-c', { defaultTruckId: 'trk-27' })).status).toBe(200);
  });
});

describe('Assignments and the lists', () => {
  it('save a Truck and return its number alongside its id; with none it comes back empty', async () => {
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-24' });
    expect(created.status).toBe(201);
    await add({ date: '2026-11-20', driverId: 'drv-b' });
    expect((await day('2026-11-20')).map((a) => [a.truckId, a.truckNumber])).toEqual([['trk-24', '24'], [null, null]]);
  });

  it('refuse a Truck that does not exist, with a message on the Truck', async () => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', truckId: 'nothing' }));
    expect(Object.keys(fields)).toEqual(['truckId']);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('show the new name after a Driver or Truck is renamed', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21' });
    await send('PATCH', '/api/drivers/drv-a', { name: 'Sample Driver Z' });
    await send('PATCH', '/api/trucks/trk-21', { number: '121' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ driverName: 'Sample Driver Z', truckNumber: '121' })]);
  });

  it('still show the name of a Driver or Truck made inactive afterwards, and accept them on a save', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21' });
    await send('PATCH', '/api/drivers/drv-a', { active: false });
    await send('PATCH', '/api/trucks/trk-21', { active: false });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ driverName: 'Sample Driver A', truckNumber: '21' })]);

    expect((await post('/api/assignments', { date: '2026-11-21', driverId: 'drv-a', truckId: 'trk-21' })).status).toBe(201);
  });
});

describe('orders', () => {
  it.each([
    ['read', () => get('/api/orders?date=2026-11-20')],
    ['added', () => post('/api/orders', { workDate: '2026-11-20', job: 'x', work: 'x', driverId: 'drv-a' })],
  ])('can no longer be %s', async (_what, call) => {
    expect((await call()).status).toBe(404);
  });
});

describe('the business day', () => {
  // Today and tomorrow are the dates in US Eastern time, from the clock in the environment.
  it.each([
    ['in the afternoon', '2026-11-19T20:00:00Z', '2026-11-19', '2026-11-20'],
    ['late evening in Eastern, already the next day in UTC', '2026-11-20T03:30:00Z', '2026-11-19', '2026-11-20'],
    ['just after midnight in Eastern', '2026-11-20T05:01:00Z', '2026-11-20', '2026-11-21'],
    ['in summer time', '2026-07-01T03:30:00Z', '2026-06-30', '2026-07-01'],
    ['at the end of a year', '2026-12-31T23:00:00Z', '2026-12-31', '2027-01-01'],
  ])('knows today and tomorrow %s', async (_when, now, today, tomorrow) => {
    const response = await handle(new Request('https://td.example/api/today'), env({ NOW: now }));
    expect(await response.json()).toEqual({ today, tomorrow });
  });
});

describe('API', () => {
  it('refuses writes to read-only routes', async () => {
    expect((await post('/api/health', {})).status).toBe(405);
    expect((await post('/api/today', {})).status).toBe(405);
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
