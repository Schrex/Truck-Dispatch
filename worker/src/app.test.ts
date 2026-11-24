import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { Assignment, DriverDay } from '../../shared/types';

const d1 = localD1();
/** The tests' clock: 2026-11-19 in the afternoon, US Eastern, unless a test sets its own. */
const env: typeof d1.env = (vars = {}) => d1.env({ NOW: '2026-11-19T20:00:00.000Z', ...vars });
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
    ['Driver view', '/driver'],
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
      ['assignedAt', 'cancelledAt', 'changedAt', 'createdAt', 'date', 'driverId', 'driverName', 'foremanId', 'foremanName', 'fromPlaceId', 'fromPlaceName', 'handedFromId', 'id', 'materialId', 'materialName', 'note', 'position', 'sinceSent', 'toPlaceId', 'toPlaceName', 'truckId', 'truckNumber', 'updatedAt'],
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

const send = (method: string, path: string, body?: unknown, vars: Parameters<typeof env>[0] = {}) =>
  handle(
    new Request(`https://td.example${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    env(vars),
  );
/** Changes only the fields given; the rest stay as they are. */
const change = (id: string, body: unknown, vars = {}) => send('PATCH', `/api/assignments/${id}`, body, vars);
const remove = (id: string, vars = {}) => send('DELETE', `/api/assignments/${id}`, undefined, vars);
/** Assign: gives the Assignment to its Driver, who sees it from then on. */
const assign = (id: string, vars = {}) => send('POST', `/api/assignments/${id}/assign`, undefined, vars);

type Entry = { id: string; active: boolean } & Record<string, unknown>;
const list = async (path: string) => {
  const response = await get(path);
  expect(response.status).toBe(200);
  return Object.values((await response.json()) as Record<string, Entry[]>)[0];
};

/**
 * The tests' D1, except that another request (`other`) runs just before the
 * first write to `table`, run alone or in a batch: after this request has
 * checked, before it writes.
 */
const racedBy = (table: string, other: () => Promise<unknown>): D1Database => {
  const db = d1.database();
  const writes = new RegExp(`^\\s*(INSERT INTO|UPDATE) ${table}\\b`);
  let raced = false;
  const race = async () => {
    if (raced) return;
    raced = true;
    await other();
  };
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = db.prepare(sql);
    if (raced || !writes.test(sql)) return statement;
    const bind = (...values: unknown[]) => {
      const bound = statement.bind(...values);
      return Object.assign(Object.create(bound) as D1PreparedStatement, {
        run: async () => {
          await race();
          return bound.run();
        },
        racing: true,
      });
    };
    return Object.assign(Object.create(statement) as D1PreparedStatement, { bind });
  };
  const batch = async (statements: D1PreparedStatement[]) => {
    if (statements.some((statement) => (statement as { racing?: boolean }).racing)) await race();
    return db.batch(statements);
  };
  return new Proxy(db, { get: (target, key) => (key === 'prepare' ? prepare : key === 'batch' ? batch : Reflect.get(target, key, target)) });
};

// Every list behaves the same way; each is named by its display field.
describe.each([
  { route: 'drivers', one: 'driver', name: 'name', seeded: 'drv-a', seededName: 'Sample Driver A', fresh: 'Sample Driver D' },
  { route: 'trucks', one: 'truck', name: 'number', seeded: 'trk-21', seededName: '21', fresh: '30' },
  { route: 'jobs', one: 'job', name: 'name', seeded: 'job-n', seededName: 'Sample Job North', fresh: 'Sample Job East' },
  { route: 'places', one: 'place', name: 'shortName', seeded: 'plc-plant', seededName: 'Sample Plant', fresh: 'Sample Pit' },
  { route: 'materials', one: 'material', name: 'name', seeded: 'mat-minus', seededName: '2" minus', fresh: 'Sample Fill' },
  { route: 'foremen', one: 'foreman', name: 'name', seeded: 'frm-a', seededName: 'Sample Foreman A', fresh: 'Sample Foreman D' },
  { route: 'inspection-items', table: 'inspection_items', one: 'inspectionItem', name: 'label', seeded: 'insp-07', seededName: 'Lights', fresh: 'Horn' },
  // Nothing is seeded for Customers, so the test puts one in first.
  { route: 'customers', one: 'customer', name: 'name', seeded: 'cus-a', seededName: 'Sample Customer A', fresh: 'Sample Customer D', setup: "INSERT INTO customers (id, name) VALUES ('cus-a', 'Sample Customer A')" },
])('the $route list', ({ route, table = route, one, name, seeded, seededName, fresh, setup }) => {
  const names = async (search = '') => (await list(`/api/${route}${search}`)).map((e) => e[name]);
  const change = (id: string, body: unknown) => send('PATCH', `/api/${route}/${id}`, body);
  beforeEach(async () => {
    if (setup) await d1.database().prepare(setup).run();
  });

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

  it('refuses a name another request saved after the check, with the same message, rather than failing', async () => {
    const { [name]: taken } = await refusal(await post(`/api/${route}`, { [name]: seededName }));
    const added = await send('POST', `/api/${route}`, { [name]: fresh }, { DB: racedBy(table, () => post(`/api/${route}`, { [name]: fresh })) });
    expect(await refusal(added)).toEqual({ [name]: taken });
    const other = `${fresh} 2`;
    const renamed = await send('PATCH', `/api/${route}/${seeded}`, { [name]: other }, { DB: racedBy(table, () => post(`/api/${route}`, { [name]: other })) });
    expect(await refusal(renamed)).toEqual({ [name]: taken });
    expect(await names()).toContain(seededName);
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

describe('adding a removed entry again', () => {
  const remove = (path: string) => send('PATCH', path, { active: false });

  it('brings the removed Truck back, keeping what it had unless the add sends it', async () => {
    const { truck } = (await (await post('/api/trucks', { number: '30', hcssCode: 'T30', hcssGuid: 'guid-30' })).json()) as { truck: { id: string } };
    await remove(`/api/trucks/${truck.id}`);

    const again = await post('/api/trucks', { number: '30', hcssCode: 'T30-NEW' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ truck: { id: truck.id, number: '30', hcssCode: 'T30-NEW', hcssGuid: 'guid-30', active: true }, broughtBack: true });
    const { trucks } = (await (await get('/api/trucks')).json()) as { trucks: { number: string }[] };
    expect(trucks.filter((t) => t.number === '30')).toHaveLength(1);
  });

  it('finds it ignoring case, takes the name as written now, and puts it last in an ordered list', async () => {
    await remove('/api/drivers/drv-a');
    const again = await post('/api/drivers', { name: 'SAMPLE DRIVER A' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ driver: { id: 'drv-a', name: 'SAMPLE DRIVER A', active: true }, broughtBack: true });
    const { drivers } = (await (await get('/api/drivers')).json()) as { drivers: { id: string }[] };
    expect(drivers.map((d) => d.id)).toEqual(['drv-b', 'drv-c', 'drv-a']);
  });

  it('still refuses the name of an entry in use, and a rename to a removed entry\'s name', async () => {
    expect(await refusal(await post('/api/trucks', { number: '21' }))).toEqual({ number: 'There is already a Truck with this number.' });
    await remove('/api/trucks/trk-21');
    expect(await refusal(await send('PATCH', '/api/trucks/trk-24', { number: '21' }))).toEqual({ number: 'There is already a Truck with this number.' });
  });

  it('brings nothing back when another field of the add is refused', async () => {
    await remove('/api/drivers/drv-a');
    expect(await refusal(await post('/api/drivers', { name: 'Sample Driver A', defaultTruckId: 'trk-nothing' }))).toEqual({ defaultTruckId: 'Pick a Truck from the list.' });
    const { drivers } = (await (await get('/api/drivers')).json()) as { drivers: { id: string }[] };
    expect(drivers.map((d) => d.id)).not.toContain('drv-a');
  });
});

describe('Customers', () => {
  const customer = async (response: Response) => ((await response.json()) as { customer: Entry }).customer;
  const addCustomer = (body: unknown) => post('/api/customers', body);

  it('start as an empty list: none are seeded', async () => {
    expect(await list('/api/customers?include=inactive')).toEqual([]);
  });

  it('are added with a name alone, with no usual Place and no order', async () => {
    const response = await addCustomer({ name: ' Sample Customer Jaus ' });
    expect(response.status).toBe(201);
    expect(await customer(response)).toEqual({ id: expect.any(String), name: 'Sample Customer Jaus', usualPlaceId: null, active: true });
  });

  it('save a usual Place, and change or clear it', async () => {
    const added = await customer(await addCustomer({ name: 'Sample Customer Jaus', usualPlaceId: 'plc-north' }));
    expect(added).toMatchObject({ usualPlaceId: 'plc-north' });
    expect(await customer(await send('PATCH', `/api/customers/${added.id}`, { usualPlaceId: 'plc-plant' }))).toMatchObject({ usualPlaceId: 'plc-plant' });
    expect(await customer(await send('PATCH', `/api/customers/${added.id}`, { usualPlaceId: null }))).toMatchObject({ name: 'Sample Customer Jaus', usualPlaceId: null });
    expect(await list('/api/customers')).toEqual([expect.objectContaining({ id: added.id, usualPlaceId: null })]);
  });

  it('refuse a usual Place that does not exist or was removed, with a message on it', async () => {
    expect(await refusal(await addCustomer({ name: 'Sample Customer Jaus', usualPlaceId: 'nowhere' }))).toEqual({ usualPlaceId: 'Pick a Place from the list.' });
    await send('PATCH', '/api/places/plc-yard', { active: false });
    expect(await refusal(await addCustomer({ name: 'Sample Customer Jaus', usualPlaceId: 'plc-yard' }))).toEqual({
      usualPlaceId: 'This Place was removed. Bring it back in Places, or pick another.',
    });
    expect(await list('/api/customers?include=inactive')).toEqual([]);
  });

  it('keep a usual Place removed later, and their other fields still save', async () => {
    const added = await customer(await addCustomer({ name: 'Sample Customer Jaus', usualPlaceId: 'plc-yard' }));
    await send('PATCH', '/api/places/plc-yard', { active: false });
    expect(await customer(await send('PATCH', `/api/customers/${added.id}`, { name: 'Sample Customer Jaus 2' }))).toMatchObject({ usualPlaceId: 'plc-yard' });
  });

  it('come back when a removed one is added again, keeping its usual Place unless the add sends one', async () => {
    const added = await customer(await addCustomer({ name: 'Sample Customer Jaus', usualPlaceId: 'plc-north' }));
    await send('PATCH', `/api/customers/${added.id}`, { active: false });
    const again = await addCustomer({ name: 'sample customer jaus' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ customer: { id: added.id, name: 'sample customer jaus', usualPlaceId: 'plc-north', active: true }, broughtBack: true });
  });

  it('cannot be put in order', async () => {
    expect((await send('PUT', '/api/customers/order', { order: [] })).status).toBe(405);
  });
});

describe('one name across Foremen and Customers', () => {
  const addCustomer = async (name: string) => ((await (await post('/api/customers', { name })).json()) as { customer: Entry }).customer;

  it('refuses a Customer named as a Foreman, in use or removed, ignoring case, with the reason on the name', async () => {
    expect(await refusal(await post('/api/customers', { name: 'sample foreman a' }))).toEqual({ name: 'Sample Foreman A is a Foreman already.' });
    await send('PATCH', '/api/foremen/frm-b', { active: false });
    expect(await refusal(await post('/api/customers', { name: 'SAMPLE FOREMAN B' }))).toEqual({ name: 'Sample Foreman B is a Foreman already.' });
    expect(await list('/api/customers?include=inactive')).toEqual([]);
  });

  it('refuses renaming a Customer to a Foreman\'s name', async () => {
    const jaus = await addCustomer('Sample Customer Jaus');
    expect(await refusal(await send('PATCH', `/api/customers/${jaus.id}`, { name: 'Sample Foreman C' }))).toEqual({ name: 'Sample Foreman C is a Foreman already.' });
  });

  it('refuses a Foreman named as a Customer, in use or removed, ignoring case, when added or renamed', async () => {
    const jaus = await addCustomer('Sample Customer Jaus');
    expect(await refusal(await post('/api/foremen', { name: 'sample customer jaus' }))).toEqual({ name: 'Sample Customer Jaus is a Customer already.' });
    await send('PATCH', `/api/customers/${jaus.id}`, { active: false });
    expect(await refusal(await send('PATCH', '/api/foremen/frm-a', { name: 'Sample Customer Jaus' }))).toEqual({ name: 'Sample Customer Jaus is a Customer already.' });
    expect((await list('/api/foremen')).map((f) => f.name)).toEqual(['Sample Foreman A', 'Sample Foreman B', 'Sample Foreman C']);
  });

  it('still brings back a removed Foreman by his own name', async () => {
    await send('PATCH', '/api/foremen/frm-a', { active: false });
    const again = await post('/api/foremen', { name: 'Sample Foreman A' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ foreman: { id: 'frm-a', active: true }, broughtBack: true });
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

  it('refuse an HCSS code another active Truck has, ignoring case, with a message on the HCSS code', async () => {
    const taken = { hcssCode: 'This HCSS code is on Truck 21 already. Clear it there first.' };
    expect(await refusal(await post('/api/trucks', { number: '30', hcssCode: 'sample-21' }))).toEqual(taken);
    expect(await refusal(await send('PATCH', '/api/trucks/trk-24', { hcssCode: ' SAMPLE-21 ' }))).toEqual(taken);
    // The Truck that has it can save it again.
    expect((await send('PATCH', '/api/trucks/trk-21', { hcssCode: 'SAMPLE-21' })).status).toBe(200);
  });

  it('accept an HCSS code held only by a removed Truck, and refuse to bring that Truck back while another has it', async () => {
    await send('PATCH', '/api/trucks/trk-21', { active: false });
    expect((await send('PATCH', '/api/trucks/trk-24', { hcssCode: 'SAMPLE-21' })).status).toBe(200);
    expect(await refusal(await send('PATCH', '/api/trucks/trk-21', { active: true }))).toEqual({
      hcssCode: 'This HCSS code is on Truck 24 already. Clear it there first.',
    });
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

  it('keep a usual Truck cleared in Settings when the seed runs again, as on every deploy', async () => {
    await send('PATCH', '/api/drivers/drv-a', { defaultTruckId: null });
    await send('PATCH', '/api/drivers/drv-b', { defaultTruckId: null });
    await d1.reseed();
    expect((await list('/api/drivers')).map((d) => [d.name, d.defaultTruckId])).toEqual([
      ['Sample Driver A', null],
      ['Sample Driver B', null],
      ['Sample Driver C', null],
    ]);
  });

  it('accept an inactive Truck as their usual Truck', async () => {
    await send('PATCH', '/api/trucks/trk-27', { active: false });
    expect((await send('PATCH', '/api/drivers/drv-c', { defaultTruckId: 'trk-27' })).status).toBe(200);
  });
});

describe('a Driver\'s later days', () => {
  const laterDays = async (id: string) => {
    const response = await get(`/api/drivers/${id}/later-days`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { laterDays: number }).laterDays;
  };

  it('are none for a Driver with nothing planned', async () => {
    expect(await laterDays('drv-a')).toBe(0);
  });

  it('count each day after today with one of his Assignments once, leaving out today, past days and other Drivers', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-a' });
    await add({ date: '2026-11-20', driverId: 'drv-a' });
    await add({ date: '2026-11-23', driverId: 'drv-a' });
    await add({ date: '2026-11-19', driverId: 'drv-a' });
    await add({ date: '2026-11-24', driverId: 'drv-b' });
    await add({ date: '2026-11-24' });
    await send('POST', '/api/assignments', { date: '2026-11-18', driverId: 'drv-a' }, { NOW: '2026-11-18T15:00:00.000Z' });
    expect(await laterDays('drv-a')).toBe(2);
  });

  it('answer 404 for a Driver that does not exist, and only to a read', async () => {
    expect((await get('/api/drivers/nobody/later-days')).status).toBe(404);
    expect((await send('POST', '/api/drivers/drv-a/later-days', {})).status).toBe(405);
  });
});

describe('a Driver\'s next Assigned day', () => {
  const nextAssigned = async (id: string) => {
    const response = await get(`/api/drivers/${id}/next-assigned`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { date: string | null }).date;
  };
  const assigned = async (body: object) => {
    const { id } = await add(body);
    await assign(id);
    return id;
  };

  it('is none when nothing after tomorrow is Assigned to him', async () => {
    await add({ date: '2026-11-23', driverId: 'drv-a' });
    expect(await nextAssigned('drv-a')).toBeNull();
  });

  it('is the first day after tomorrow with one of his Assigned Assignments, weekends included, skipping tomorrow, other Drivers and his Drafts', async () => {
    await assigned({ date: '2026-11-20', driverId: 'drv-a' });
    await assigned({ date: '2026-11-21', driverId: 'drv-b' });
    const sunday = await add({ date: '2026-11-22', driverId: 'drv-a' });
    await assigned({ date: '2026-11-23', driverId: 'drv-a' });
    await add({ date: '2026-11-23', driverId: 'drv-a' });
    await assigned({ date: '2026-11-24', driverId: 'drv-a' });
    expect(await nextAssigned('drv-a')).toBe('2026-11-23');
    await assign(sunday.id);
    expect(await nextAssigned('drv-a')).toBe('2026-11-22');
  });

  it('leaves out a day where his only Assigned Assignment is cancelled', async () => {
    const monday = await assigned({ date: '2026-11-23', driverId: 'drv-a' });
    await remove(monday);
    expect(await nextAssigned('drv-a')).toBeNull();
  });

  it('answers 404 for a Driver that does not exist, and only to a read; the old route is gone', async () => {
    expect((await get('/api/drivers/nobody/next-assigned')).status).toBe(404);
    expect((await send('POST', '/api/drivers/drv-a/next-assigned', {})).status).toBe(405);
    expect((await get('/api/drivers/drv-a/next-sent')).status).toBe(404);
  });
});

describe('Jobs', () => {
  it('list the seeded Jobs by name, with their job number', async () => {
    expect(await list('/api/jobs')).toEqual([
      { id: 'job-n', name: 'Sample Job North', jobNumber: 'S-1001', active: true },
      { id: 'job-s', name: 'Sample Job South', jobNumber: null, active: true },
    ]);
  });

  it('save a job number when added, and change or clear it', async () => {
    const { job } = (await (await post('/api/jobs', { name: 'Sample Job East', jobNumber: ' S-1003 ' })).json()) as { job: Entry };
    expect(job).toMatchObject({ name: 'Sample Job East', jobNumber: 'S-1003', active: true });
    const cleared = await send('PATCH', `/api/jobs/${job.id}`, { jobNumber: '' });
    expect(((await cleared.json()) as { job: Entry }).job).toMatchObject({ name: 'Sample Job East', jobNumber: null });
  });
});

describe('Places', () => {
  it('list the seeded Places by short name, with full name, kind, Job, geofence code and whether each is on the truck map', async () => {
    const places = await list('/api/places');
    expect(places.map((p) => p.shortName)).toEqual(['Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Yard']);
    expect(places[2]).toEqual({ id: 'plc-north', shortName: 'Sample Site North', fullName: 'Sample Job North site', kind: 'job_site', jobId: 'job-n', usualForemanId: null, geofenceCode: null, onTruckMap: false, sortOrder: null, active: true });
    expect(places.map((p) => [p.geofenceCode, p.onTruckMap])).toEqual([['SAMPLE-PLANT', true], [null, false], [null, false], [null, false]]);
  });

  it('are not on the truck map when added without a geofence code, and onTruckMap sent is ignored', async () => {
    const { place } = (await (await post('/api/places', { shortName: 'Sample Pit', onTruckMap: true })).json()) as { place: Entry };
    expect(place).toMatchObject({ geofenceCode: null, onTruckMap: false });
    const changed = await send('PATCH', `/api/places/${place.id}`, { onTruckMap: true });
    expect(((await changed.json()) as { place: Entry }).place.onTruckMap).toBe(false);
  });

  it('save a geofence code trimmed, which puts the Place on the truck map, and clearing it takes the Place off', async () => {
    const added = await post('/api/places', { shortName: 'Sample Pit', geofenceCode: '  J1001 North ' });
    expect(added.status).toBe(201);
    const { place } = (await added.json()) as { place: Entry };
    expect(place).toMatchObject({ geofenceCode: 'J1001 North', onTruckMap: true });
    expect((await list('/api/places')).find((p) => p.id === place.id)).toMatchObject({ geofenceCode: 'J1001 North', onTruckMap: true });

    const cleared = await send('PATCH', `/api/places/${place.id}`, { geofenceCode: '  ' });
    expect(((await cleared.json()) as { place: Entry }).place).toMatchObject({ geofenceCode: null, onTruckMap: false });
  });

  it('refuse a geofence code another active Place has, ignoring case, with a message on the geofence code', async () => {
    const taken = { geofenceCode: 'This geofence code is on Sample Plant already. Clear it there first.' };
    expect(await refusal(await post('/api/places', { shortName: 'Sample Pit', geofenceCode: 'sample-plant' }))).toEqual(taken);
    expect(await refusal(await send('PATCH', '/api/places/plc-yard', { geofenceCode: ' SAMPLE-PLANT ' }))).toEqual(taken);
    // The Place that has it can save it again.
    expect((await send('PATCH', '/api/places/plc-plant', { geofenceCode: 'SAMPLE-PLANT', fullName: 'Plant' })).status).toBe(200);
  });

  it('accept a geofence code held only by a removed Place', async () => {
    await send('PATCH', '/api/places/plc-plant', { active: false });
    const moved = await send('PATCH', '/api/places/plc-yard', { geofenceCode: 'SAMPLE-PLANT' });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { place: Entry }).place).toMatchObject({ geofenceCode: 'SAMPLE-PLANT', onTruckMap: true });
  });

  it('refuse to bring back a removed Place whose geofence code an active Place now has', async () => {
    await send('PATCH', '/api/places/plc-plant', { active: false });
    await send('PATCH', '/api/places/plc-yard', { geofenceCode: 'SAMPLE-PLANT' });
    expect(await refusal(await send('PATCH', '/api/places/plc-plant', { active: true }))).toEqual({
      geofenceCode: 'This geofence code is on Sample Yard already. Clear it there first.',
    });
    // Brought back with its code cleared, it is fine.
    expect((await send('PATCH', '/api/places/plc-plant', { active: true, geofenceCode: null })).status).toBe(200);
  });

  it('save a short name alone, or with a full name, kind and Job, and clear them', async () => {
    const bare = ((await (await post('/api/places', { shortName: 'Sample Pit' })).json()) as { place: Entry }).place;
    expect(bare).toMatchObject({ shortName: 'Sample Pit', fullName: null, kind: null, jobId: null, active: true });

    const full = await post('/api/places', { shortName: 'Sample Site South', fullName: 'Sample Job South site', kind: 'job_site', jobId: 'job-s' });
    expect(full.status).toBe(201);
    const { place } = (await full.json()) as { place: Entry };
    expect(place).toMatchObject({ shortName: 'Sample Site South', fullName: 'Sample Job South site', kind: 'job_site', jobId: 'job-s' });

    const cleared = await send('PATCH', `/api/places/${place.id}`, { fullName: '', kind: null, jobId: null });
    expect(((await cleared.json()) as { place: Entry }).place).toMatchObject({ fullName: null, kind: null, jobId: null });
  });

  it.each(['plant', 'job_site', 'shop', 'yard'])('accept the kind %s', async (kind) => {
    expect((await send('PATCH', '/api/places/plc-yard', { kind })).status).toBe(200);
  });

  it.each(['quarry', 'Plant', 'job site', 3])('refuse the kind %s, with a message on the kind', async (kind) => {
    expect(Object.keys(await refusal(await post('/api/places', { shortName: 'Sample Pit', kind })))).toEqual(['kind']);
    expect(Object.keys(await refusal(await send('PATCH', '/api/places/plc-yard', { kind })))).toEqual(['kind']);
  });

  it('refuse a Job that does not exist, with a message on the Job, and accept an inactive one', async () => {
    expect(Object.keys(await refusal(await post('/api/places', { shortName: 'Sample Pit', jobId: 'nothing' })))).toEqual(['jobId']);
    await send('PATCH', '/api/jobs/job-s', { active: false });
    expect((await send('PATCH', '/api/places/plc-yard', { jobId: 'job-s' })).status).toBe(200);
  });
});

describe('a job site\'s usual Foreman', () => {
  const place = async (response: Response) => ((await response.json()) as { place: Entry }).place;

  it('is saved on a job site, read back with the Place, and cleared', async () => {
    const set = await send('PATCH', '/api/places/plc-north', { usualForemanId: 'frm-b' });
    expect(set.status).toBe(200);
    expect(await place(set)).toMatchObject({ id: 'plc-north', usualForemanId: 'frm-b' });
    expect(await list('/api/places')).toContainEqual(expect.objectContaining({ id: 'plc-north', usualForemanId: 'frm-b' }));
    expect(await place(await send('PATCH', '/api/places/plc-north', { usualForemanId: null }))).toMatchObject({ usualForemanId: null });
  });

  it('is saved on a new job site with its kind', async () => {
    const added = await post('/api/places', { shortName: 'Sample Site South', kind: 'job_site', usualForemanId: 'frm-c' });
    expect(added.status).toBe(201);
    expect(await place(added)).toMatchObject({ kind: 'job_site', usualForemanId: 'frm-c' });
  });

  it('is refused on a Place that is not a job site, with a message on the usual Foreman', async () => {
    expect(await refusal(await send('PATCH', '/api/places/plc-plant', { usualForemanId: 'frm-a' }))).toEqual({ usualForemanId: 'Only a job site can have a usual Foreman.' });
    expect(Object.keys(await refusal(await post('/api/places', { shortName: 'Sample Pit', usualForemanId: 'frm-a' })))).toEqual(['usualForemanId']);
    expect(Object.keys(await refusal(await post('/api/places', { shortName: 'Sample Pit', kind: 'plant', usualForemanId: 'frm-a' })))).toEqual(['usualForemanId']);
  });

  it('is refused when the Foreman does not exist or was removed, with a message on the usual Foreman', async () => {
    expect(await refusal(await send('PATCH', '/api/places/plc-north', { usualForemanId: 'nobody' }))).toEqual({ usualForemanId: 'Pick a Foreman from the list.' });
    await send('PATCH', '/api/foremen/frm-c', { active: false });
    expect(Object.keys(await refusal(await send('PATCH', '/api/places/plc-north', { usualForemanId: 'frm-c' })))).toEqual(['usualForemanId']);
    expect((await list('/api/places')).find((p) => p.id === 'plc-north')).toMatchObject({ usualForemanId: null });
  });

  it('is dropped when the Place stops being a job site, and not given back when it is one again', async () => {
    await send('PATCH', '/api/places/plc-north', { usualForemanId: 'frm-b' });
    expect(await place(await send('PATCH', '/api/places/plc-north', { kind: 'plant' }))).toMatchObject({ kind: 'plant', usualForemanId: null });
    expect(await place(await send('PATCH', '/api/places/plc-north', { kind: 'job_site' }))).toMatchObject({ usualForemanId: null });
  });

  it('stays when its Foreman is removed later, and the Place\'s other fields still save', async () => {
    await send('PATCH', '/api/places/plc-north', { usualForemanId: 'frm-b' });
    await send('PATCH', '/api/foremen/frm-b', { active: false });
    expect(await place(await send('PATCH', '/api/places/plc-north', { fullName: 'Sample North' }))).toMatchObject({ usualForemanId: 'frm-b' });
  });

  it('never changes the Foreman of an Assignment already planned there', async () => {
    const planned = await add({ date: '2026-11-20', toPlaceId: 'plc-north', foremanId: 'frm-a' });
    await send('PATCH', '/api/places/plc-north', { usualForemanId: 'frm-b' });
    expect((await day('2026-11-20')).find((a) => a.id === planned.id)).toMatchObject({ foremanId: 'frm-a', foremanName: 'Sample Foreman A' });
  });
});

describe('an Assignment\'s Driver, Truck, Places, Material and Foreman', () => {
  const fields = {
    driverId: 'Pick a Driver from the list.',
    truckId: 'Pick a Truck from the list.',
    fromPlaceId: 'Pick a Place from the list.',
    toPlaceId: 'Pick a Place from the list.',
    materialId: 'Pick a Material from the list.',
    foremanId: 'Pick a Foreman from the list.',
  };
  const every = (value: unknown) => Object.fromEntries(Object.keys(fields).map((key) => [key, value]));

  it('are each refused, with its own message, when not text or not in its list, on add and on change', async () => {
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...every(7) }))).toEqual(fields);
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...every('nothing') }))).toEqual(fields);
    const { assignment } = (await (await post('/api/assignments', { date: '2026-11-20' })).json()) as { assignment: Assignment };
    expect(await refusal(await change(assignment.id, { date: '2026-11-20', ...every('nothing') }))).toEqual(fields);
  });

  it('are each saved on add and on change, kept when left out, and cleared when empty', async () => {
    const chosen = { driverId: 'drv-a', truckId: 'trk-21', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-minus', foremanId: 'frm-a' };
    const added = (await (await post('/api/assignments', { date: '2026-11-20', ...chosen })).json()) as { assignment: Assignment };
    expect(added.assignment).toMatchObject(chosen);
    const changed = { driverId: 'drv-b', truckId: 'trk-24', fromPlaceId: 'plc-shop', toPlaceId: 'plc-yard', materialId: 'mat-dirt', foremanId: 'frm-b' };
    const moved = (await (await change(added.assignment.id, { date: '2026-11-20', ...changed })).json()) as { assignment: Assignment };
    expect(moved.assignment).toMatchObject(changed);
    const kept = (await (await change(added.assignment.id, { note: 'Only the note' })).json()) as { assignment: Assignment };
    expect(kept.assignment).toMatchObject(changed);
    const cleared = (await (await change(added.assignment.id, every(null))).json()) as { assignment: Assignment };
    expect(cleared.assignment).toMatchObject(every(null));
    await change(added.assignment.id, changed);
    const blanked = (await (await change(added.assignment.id, every(''))).json()) as { assignment: Assignment };
    expect(blanked.assignment).toMatchObject(every(null));
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

  it('keep, change and clear the Truck when changed, and save again with a Driver and Truck made inactive since', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21' });
    await send('PATCH', '/api/drivers/drv-a', { active: false });
    await send('PATCH', '/api/trucks/trk-21', { active: false });
    const kept = await change(id, { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21', note: 'Only the note changed' });
    expect(kept.status).toBe(200);
    expect(((await kept.json()) as { assignment: Assignment }).assignment).toMatchObject({ driverName: 'Sample Driver A', truckId: 'trk-21', truckNumber: '21' });

    await change(id, { date: '2026-11-20', truckId: 'trk-24' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ truckId: 'trk-24', truckNumber: '24' })]);
    await change(id, { date: '2026-11-20', truckId: null });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ truckId: null, truckNumber: null })]);
  });

  it('refuse an unknown Truck on a change, with a message on the Truck', async () => {
    const { id } = await add({ date: '2026-11-20' });
    expect(Object.keys(await refusal(await change(id, { date: '2026-11-20', truckId: 'nothing' })))).toEqual(['truckId']);
  });
});

describe('Materials and Foremen', () => {
  it('list the seeded entries by name', async () => {
    expect(await list('/api/materials')).toEqual([
      { id: 'mat-minus', name: '2" minus', sortOrder: null, active: true },
      { id: 'mat-dirt', name: 'Sample Dirt', sortOrder: null, active: true },
      { id: 'mat-stone', name: 'Sample Stone', sortOrder: null, active: true },
    ]);
    expect((await list('/api/foremen')).map((f) => f.name)).toEqual(['Sample Foreman A', 'Sample Foreman B', 'Sample Foreman C']);
  });
});

/** The paper Daily Truck Log & Inspection's items, in its order: the checklist's starting items. */
const PAPER_CHECKLIST = [
  'Dump box clean',
  'Air leaks / brake pressure',
  'Truck paperwork',
  'Mud flaps',
  'Fire ext / triangles',
  'Tires / wheels',
  'Lights',
  'Coolant',
  'Engine oil',
  'Fueled up',
  'Air tank (drain)',
  'Suspension',
];

describe('the Inspection checklist', () => {
  it('starts with the paper form\'s 12 items, in its order, none optional', async () => {
    const items = await list('/api/inspection-items');
    expect(items.map((i) => i.label)).toEqual(PAPER_CHECKLIST);
    expect(items.map((i) => i.sortOrder)).toEqual(PAPER_CHECKLIST.map((_, i) => i + 1));
    expect(items.every((i) => i.optional === false && i.active === true)).toBe(true);
  });

  it('marks an item optional and back, and adds one optional or not', async () => {
    const marked = await send('PATCH', '/api/inspection-items/insp-12', { optional: true });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as { inspectionItem: Entry }).inspectionItem).toMatchObject({ id: 'insp-12', optional: true });
    await send('PATCH', '/api/inspection-items/insp-12', { optional: false });
    const optional = await post('/api/inspection-items', { label: 'Horn', optional: true });
    const plain = await post('/api/inspection-items', { label: 'Wipers' });
    expect(((await optional.json()) as { inspectionItem: Entry }).inspectionItem).toMatchObject({ label: 'Horn', optional: true });
    expect(((await plain.json()) as { inspectionItem: Entry }).inspectionItem).toMatchObject({ label: 'Wipers', optional: false });
    expect((await list('/api/inspection-items')).filter((i) => i.optional).map((i) => i.label)).toEqual(['Horn']);
  });

  it('refuses an optional that is not true or false, with a message on it', async () => {
    expect(Object.keys(await refusal(await send('PATCH', '/api/inspection-items/insp-12', { optional: 'yes' })))).toEqual(['optional']);
    expect(Object.keys(await refusal(await send('PATCH', '/api/inspection-items/insp-12', { optional: null })))).toEqual(['optional']);
    expect(Object.keys(await refusal(await post('/api/inspection-items', { label: 'Horn', optional: 1 })))).toEqual(['optional']);
  });

  it('is put in Dave\'s order with the whole-list route', async () => {
    const ids = PAPER_CHECKLIST.map((_, i) => `insp-${String(i + 1).padStart(2, '0')}`);
    const response = await reorder('inspection-items', [...ids].reverse());
    expect(response.status).toBe(200);
    expect((await list('/api/inspection-items')).map((i) => i.label)).toEqual([...PAPER_CHECKLIST].reverse());
  });

  it('puts a new item, or one brought back, last', async () => {
    const added = await post('/api/inspection-items', { label: 'Horn' });
    expect(((await added.json()) as { inspectionItem: Entry }).inspectionItem).toMatchObject({ sortOrder: 13 });
    await send('PATCH', '/api/inspection-items/insp-01', { active: false });
    expect((await list('/api/inspection-items')).map((i) => i.label)).toEqual([...PAPER_CHECKLIST.slice(1), 'Horn']);
    await send('PATCH', '/api/inspection-items/insp-01', { active: true });
    expect((await list('/api/inspection-items')).map((i) => i.label)).toEqual([...PAPER_CHECKLIST.slice(1), 'Horn', 'Dump box clean']);
  });

  it('keeps Dave\'s renames, order, optional items and removals when the seed runs again, and adds no duplicates', async () => {
    await send('PATCH', '/api/inspection-items/insp-07', { label: 'Lights / signals', optional: true });
    await send('PATCH', '/api/inspection-items/insp-12', { active: false });
    await reorder('inspection-items', ['insp-02', 'insp-01']);
    const before = await list('/api/inspection-items?include=inactive');
    await d1.reseed();
    expect(await list('/api/inspection-items?include=inactive')).toEqual(before);
    expect(before).toHaveLength(12);
    expect(before.find((i) => i.id === 'insp-07')).toMatchObject({ label: 'Lights / signals', optional: true });
  });
});

/** Puts a list in Dave's own order: the ids given, first to last; any left out have no order. */
const reorder = (route: string, order: unknown) => send('PUT', `/api/${route}/order`, { order });

// Drivers, Places and Materials each have an order Dave sets in Settings.
describe.each([
  { route: 'drivers', one: 'driver', name: 'name', ids: ['drv-a', 'drv-b', 'drv-c'], names: ['Sample Driver A', 'Sample Driver B', 'Sample Driver C'], fresh: 'Sample Driver D' },
  { route: 'places', one: 'place', name: 'shortName', ids: ['plc-plant', 'plc-shop', 'plc-north', 'plc-yard'], names: ['Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Yard'], fresh: 'Sample Pit' },
  { route: 'materials', one: 'material', name: 'name', ids: ['mat-minus', 'mat-dirt', 'mat-stone'], names: ['2" minus', 'Sample Dirt', 'Sample Stone'], fresh: 'Sample Fill' },
])('Dave\'s own order of the $route', ({ route, one, name, ids, names, fresh }) => {
  const read = async (search = '') => (await list(`/api/${route}${search}`)).map((e) => e[name]);
  const [first, second, third] = ids;
  const reversed = [...names].reverse();

  it('is none at first: every entry comes without an order, by name', async () => {
    const entries = await list(`/api/${route}`);
    expect(entries.map((e) => e[name])).toEqual(names);
    expect(entries.map((e) => e.sortOrder)).toEqual(names.map(() => null));
  });

  it('is set for the whole list in one request, and the list answers in it, first to last', async () => {
    const response = await reorder(route, [...ids].reverse());
    expect(response.status).toBe(200);
    const answered = ((await response.json()) as Record<string, Entry[]>)[route];
    expect(answered.map((e) => e[name])).toEqual(reversed);
    expect(answered.map((e) => e.sortOrder)).toEqual(names.map((_, i) => i + 1));
    expect(await read()).toEqual(reversed);
    expect(await read('?include=inactive')).toEqual(reversed);
  });

  it('puts entries left out of it after the ordered ones, by name', async () => {
    await reorder(route, [third, first]);
    expect(await read()).toEqual([names[2], names[0], ...names.slice(1).filter((n) => n !== names[2])]);
    expect((await list(`/api/${route}`)).find((e) => e.id === second)?.sortOrder).toBeNull();
  });

  it('can name a removed entry, which stays out of the default read', async () => {
    await send('PATCH', `/api/${route}/${third}`, { active: false });
    await reorder(route, [third, second, first]);
    expect(await read()).toEqual([names[1], names[0], ...names.slice(3)]);
    expect(await read('?include=inactive')).toEqual([names[2], names[1], names[0], ...names.slice(3)]);
  });

  it('puts a new entry last', async () => {
    await reorder(route, [...ids].reverse());
    const added = await post(`/api/${route}`, { [name]: fresh });
    expect(((await added.json()) as Record<string, Entry>)[one]).toMatchObject({ sortOrder: names.length + 1 });
    expect(await read()).toEqual([...reversed, fresh]);
  });

  it('puts a new entry last even in a list never put in order, and two new ones in the order they were added', async () => {
    await post(`/api/${route}`, { [name]: `Zed ${fresh}` });
    await post(`/api/${route}`, { [name]: `A ${fresh}` });
    expect(await read()).toEqual([...names, `Zed ${fresh}`, `A ${fresh}`]);
    expect(await read('?include=inactive')).toEqual([...names, `Zed ${fresh}`, `A ${fresh}`]);
  });

  it('puts an entry brought back last even in a list never put in order', async () => {
    await send('PATCH', `/api/${route}/${first}`, { active: false });
    await send('PATCH', `/api/${route}/${first}`, { active: true });
    expect(await read()).toEqual([...names.slice(1), names[0]]);
  });

  it('puts an entry brought back last, whatever its place before it was removed', async () => {
    await reorder(route, ids);
    await send('PATCH', `/api/${route}/${first}`, { active: false });
    const back = await send('PATCH', `/api/${route}/${first}`, { active: true });
    expect(((await back.json()) as Record<string, Entry>)[one]).toMatchObject({ active: true, sortOrder: names.length + 1 });
    expect(await read()).toEqual([...names.slice(1), names[0]]);
  });

  it('keeps an entry\'s place when it is changed without being brought back', async () => {
    await reorder(route, [...ids].reverse());
    await send('PATCH', `/api/${route}/${first}`, { active: true });
    await send('PATCH', `/api/${route}/${third}`, { [name]: `${names[2]} 2` });
    expect(await read()).toEqual([...reversed.slice(0, -3), `${names[2]} 2`, names[1], names[0]]);
  });

  it.each([
    ['not a list', () => 'drv-a'],
    ['not a list of ids', () => [1, 2]],
    ['naming an entry that is not in the list', () => ['nobody']],
    ['naming an entry twice', () => [first, first]],
  ])('is refused when %s, with a message on the order, and the list keeps its order', async (_case, order) => {
    await reorder(route, ids);
    expect(Object.keys(await refusal(await reorder(route, order())))).toEqual(['order']);
    expect(await read()).toEqual(names);
  });

  it('is set only by a PUT of the whole list', async () => {
    expect((await send('PATCH', `/api/${route}/order`, { order: ids })).status).toBe(405);
    expect((await send('GET', `/api/${route}/order`)).status).toBe(405);
  });
});

describe('the lists Dave does not order', () => {
  it.each(['trucks', 'jobs', 'foremen', 'customers'])('have no order: the %s cannot be reordered and come by name', async (route) => {
    expect((await send('PUT', `/api/${route}/order`, { order: [] })).status).toBe(405);
    expect((await list(`/api/${route}`)).every((e) => !('sortOrder' in e))).toBe(true);
  });
});

describe('the Not considered list', () => {
  it('is gone: Geofences replace it (api/geofences)', async () => {
    expect((await get('/api/not-considered')).status).toBe(404);
    expect((await post('/api/not-considered', { code: 'GAS STATION' })).status).toBe(404);
  });
});

describe('Dave\'s own order and the board', () => {
  it('reads a day\'s lanes in the order of the Drivers, Unassigned last', async () => {
    await add({ date: '2026-11-20', note: 'Who takes this?' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-c', note: 'Topsoil haul' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Move the excavator' });
    await reorder('drivers', ['drv-c', 'drv-a']);
    expect((await day('2026-11-20')).map((a) => a.note)).toEqual(['Topsoil haul', 'Haul stone', 'Move the excavator', 'Who takes this?']);
  });

  it('puts a Place or Material typed new in the composer last in its list', async () => {
    await reorder('places', ['plc-yard', 'plc-plant', 'plc-shop', 'plc-north']);
    await reorder('materials', ['mat-stone', 'mat-dirt', 'mat-minus']);
    await add({ date: '2026-11-20', fromPlaceName: 'Sample Pit', materialName: 'Sample Fill' });
    expect((await list('/api/places')).map((p) => p.shortName)).toEqual(['Sample Yard', 'Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Pit']);
    expect((await list('/api/materials')).map((m) => m.name)).toEqual(['Sample Stone', 'Sample Dirt', '2" minus', 'Sample Fill']);
  });

  it('puts Places and Materials typed new last even in lists never put in order, in the order they were added', async () => {
    await add({ date: '2026-11-20', fromPlaceName: 'Zed Pit', toPlaceName: 'A Pit', materialName: 'Zed Fill' });
    await add({ date: '2026-11-20', materialName: 'A Fill' });
    expect((await list('/api/places')).map((p) => p.shortName)).toEqual(['Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Yard', 'Zed Pit', 'A Pit']);
    expect((await list('/api/materials')).map((m) => m.name)).toEqual(['2" minus', 'Sample Dirt', 'Sample Stone', 'Zed Fill', 'A Fill']);
  });

  it('puts a removed Material brought back by typing its name last in a list never put in order', async () => {
    await send('PATCH', '/api/materials/mat-minus', { active: false });
    await add({ date: '2026-11-20', materialName: '2" MINUS' });
    expect((await list('/api/materials')).map((m) => m.name)).toEqual(['Sample Dirt', 'Sample Stone', '2" minus']);
  });

  it('puts a removed Place or Material brought back by typing its name last in its list', async () => {
    await reorder('places', ['plc-yard', 'plc-plant', 'plc-shop', 'plc-north']);
    await reorder('materials', ['mat-stone', 'mat-dirt', 'mat-minus']);
    await send('PATCH', '/api/places/plc-yard', { active: false });
    await send('PATCH', '/api/materials/mat-stone', { active: false });
    await add({ date: '2026-11-20', toPlaceName: 'sample yard', materialName: 'sample stone' });
    expect((await list('/api/places')).map((p) => p.shortName)).toEqual(['Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Yard']);
    expect((await list('/api/materials')).map((m) => m.name)).toEqual(['Sample Dirt', '2" minus', 'Sample Stone']);
  });
});

describe('Assignments with a Material and a Foreman', () => {
  it('save them and return their names alongside their ids; with none they come back empty', async () => {
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', materialId: 'mat-minus', foremanId: 'frm-a' });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { assignment: Assignment }).assignment).toMatchObject({
      materialId: 'mat-minus', materialName: '2" minus', foremanId: 'frm-a', foremanName: 'Sample Foreman A',
    });
    await add({ date: '2026-11-20', driverId: 'drv-b' });
    expect((await day('2026-11-20')).map((a) => [a.materialName, a.foremanName])).toEqual([['2" minus', 'Sample Foreman A'], [null, null]]);
  });

  it('refuse an unknown Material or Foreman, with a message on each field', async () => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', materialId: 'nothing', foremanId: 'nobody' }));
    expect(Object.keys(fields).sort()).toEqual(['foremanId', 'materialId']);
    expect(await day('2026-11-20')).toEqual([]);
    const { id } = await add({ date: '2026-11-20' });
    expect(Object.keys(await refusal(await change(id, { date: '2026-11-20', materialId: 7, foremanId: 'nobody' }))).sort()).toEqual(['foremanId', 'materialId']);
  });

  it('show the new names after a rename, and keep, change and clear them when changed', async () => {
    const { id } = await add({ date: '2026-11-20', materialId: 'mat-minus', foremanId: 'frm-a' });
    await send('PATCH', '/api/materials/mat-minus', { name: 'Sample Minus' });
    await send('PATCH', '/api/foremen/frm-a', { name: 'Sample Foreman Z' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ materialName: 'Sample Minus', foremanName: 'Sample Foreman Z' })]);

    await change(id, { date: '2026-11-20', materialId: 'mat-dirt', foremanId: 'frm-b' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ materialName: 'Sample Dirt', foremanName: 'Sample Foreman B' })]);
    await change(id, { date: '2026-11-20', materialId: null, foremanId: '' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ materialId: null, materialName: null, foremanId: null, foremanName: null })]);
  });

  it('still show a Material and Foreman made inactive afterwards, and accept them on a save', async () => {
    const { id } = await add({ date: '2026-11-20', materialId: 'mat-minus', foremanId: 'frm-a' });
    await send('PATCH', '/api/materials/mat-minus', { active: false });
    await send('PATCH', '/api/foremen/frm-a', { active: false });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ materialName: '2" minus', foremanName: 'Sample Foreman A' })]);
    const kept = await change(id, { date: '2026-11-20', materialId: 'mat-minus', foremanId: 'frm-a', note: 'Only the note changed' });
    expect(kept.status).toBe(200);
    expect((await post('/api/assignments', { date: '2026-11-21', materialId: 'mat-minus', foremanId: 'frm-a' })).status).toBe(201);
  });
});


describe('Assignments and Places', () => {
  it('save a From and To Place and return their short names alongside their ids; with none they come back empty', async () => {
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' });
    expect(created.status).toBe(201);
    await add({ date: '2026-11-20', driverId: 'drv-b' });
    expect((await day('2026-11-20')).map((a) => [a.fromPlaceId, a.fromPlaceName, a.toPlaceId, a.toPlaceName])).toEqual([
      ['plc-plant', 'Sample Plant', 'plc-north', 'Sample Site North'],
      [null, null, null, null],
    ]);
  });

  it('save only one of From and To', async () => {
    expect(await add({ date: '2026-11-20', toPlaceId: 'plc-shop' })).toMatchObject({ fromPlaceId: null, fromPlaceName: null, toPlaceId: 'plc-shop', toPlaceName: 'Sample Shop' });
  });

  it('accept the same Place as both From and To', async () => {
    expect(await add({ date: '2026-11-20', fromPlaceId: 'plc-yard', toPlaceId: 'plc-yard' })).toMatchObject({ fromPlaceName: 'Sample Yard', toPlaceName: 'Sample Yard' });
  });

  it.each(['fromPlaceId', 'toPlaceId'])('refuse an unknown Place as %s, with a message on that field, adding or changing', async (field) => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', [field]: 'nowhere' }));
    expect(Object.keys(fields)).toEqual([field]);
    expect(fields[field]).toBeTruthy();
    expect(await day('2026-11-20')).toEqual([]);
    const { id } = await add({ date: '2026-11-20' });
    expect(Object.keys(await refusal(await change(id, { date: '2026-11-20', [field]: 'nowhere' })))).toEqual([field]);
    expect(Object.keys(await refusal(await post('/api/assignments', { date: '2026-11-20', [field]: 7 })))).toEqual([field]);
  });

  it('show the new short name after a Place is renamed', async () => {
    await add({ date: '2026-11-20', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' });
    await send('PATCH', '/api/places/plc-plant', { shortName: 'Sample Plant 2' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ fromPlaceName: 'Sample Plant 2', toPlaceName: 'Sample Site North' })]);
  });

  it('keep, change and clear the Places when changed, and save again with a Place made inactive since', async () => {
    const { id } = await add({ date: '2026-11-20', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' });
    await send('PATCH', '/api/places/plc-plant', { active: false });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ fromPlaceName: 'Sample Plant' })]);
    const kept = await change(id, { date: '2026-11-20', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', note: 'Only the note' });
    expect(kept.status).toBe(200);
    expect(((await kept.json()) as { assignment: Assignment }).assignment).toMatchObject({ fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north' });

    await change(id, { fromPlaceId: 'plc-yard' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ fromPlaceId: 'plc-yard', fromPlaceName: 'Sample Yard', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North' })]);
  });
});

describe('one Assignment for several Drivers', () => {
  it('makes one for each Driver, the same but for the Driver, last in his lane', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Already his' });
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', alsoDriverIds: ['drv-b'], fromPlaceName: 'Sample New Pit', note: 'Haul stone' });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { assignment: Assignment; assignments: Assignment[] };
    expect(body.assignments.map((a) => [a.driverId, a.fromPlaceName, a.note, a.position, a.assignedAt])).toEqual([
      ['drv-a', 'Sample New Pit', 'Haul stone', 0, null],
      ['drv-b', 'Sample New Pit', 'Haul stone', 1, null],
    ]);
    expect(body.assignment).toEqual(body.assignments[0]);
    expect(body.assignments[0].fromPlaceId).toBe(body.assignments[1].fromPlaceId);
    expect(body.assignments[0].id).not.toBe(body.assignments[1].id);
    expect(await day('2026-11-20')).toHaveLength(3);
  });

  it('saves none when one of the Drivers was removed', async () => {
    await send('PATCH', '/api/drivers/drv-c', { active: false });
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', alsoDriverIds: ['drv-b', 'drv-c'] }));
    expect(fields).toEqual({ alsoDriverIds: 'One of these Drivers was removed. Pick the Drivers again.' });
    expect(await day('2026-11-20')).toEqual([]);
  });

  it.each([
    ['a Driver named twice', { driverId: 'drv-a', alsoDriverIds: ['drv-b', 'drv-b'] }, 'Pick each Driver once.'],
    ['the first Driver named again', { driverId: 'drv-a', alsoDriverIds: ['drv-a'] }, 'Pick each Driver once.'],
    ['others with no first Driver', { alsoDriverIds: ['drv-b'] }, 'Pick each Driver once.'],
    ['something that is not a list of Drivers', { driverId: 'drv-a', alsoDriverIds: 'drv-b' }, 'Pick the Drivers from the list.'],
    ['a Driver that does not exist', { driverId: 'drv-a', alsoDriverIds: ['drv-nobody'] }, 'One of these Drivers was removed. Pick the Drivers again.'],
  ])('refuses %s', async (_what, body, message) => {
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...body }))).toEqual({ alsoDriverIds: message });
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('adds just the one when no others are named', async () => {
    const created = await post('/api/assignments', { date: '2026-11-20', driverId: 'drv-a', alsoDriverIds: [] });
    expect(((await created.json()) as { assignments: Assignment[] }).assignments).toHaveLength(1);
  });
});

describe('changing an Assignment', () => {
  it('saves the fields sent and the day shows the change', async () => {
    const { id } = await add({ date: '2026-11-20', note: 'Haul stone' });
    const response = await change(id, { driverId: 'drv-a', note: 'Haul topsoil' });
    expect(response.status).toBe(200);
    const { assignment } = (await response.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ id, date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul topsoil' });
    expect(await day('2026-11-20')).toEqual([assignment]);
  });

  it('leaves every field it is not sent as it was, so two changes to different fields both stay', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21', materialId: 'mat-minus', note: 'Haul stone' });
    await change(id, { truckId: 'trk-24' });
    await change(id, { note: 'Two loads' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, driverId: 'drv-a', truckId: 'trk-24', materialId: 'mat-minus', note: 'Two loads' })]);
  });

  it('clears a field sent empty', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await change(id, { driverId: null, note: '' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, driverId: null, driverName: null, note: null })]);
  });

  it('moves it to another Driver', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a' });
    await change(id, { driverId: 'drv-b' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, driverId: 'drv-b', driverName: 'Sample Driver B' })]);
  });

  it('refuses a change of day, and leaves the Assignment as it was', async () => {
    const added = await add({ date: '2026-11-20', note: 'Haul stone' });
    const response = await change(added.id, { date: '2026-11-23', note: 'Monday instead' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'day_fixed', message: 'An Assignment stays on its day. Add a new one on the other day instead.' });
    expect(await day('2026-11-20')).toEqual([added]);
    expect(await day('2026-11-23')).toEqual([]);
  });

  it('accepts its own day sent again', async () => {
    const { id } = await add({ date: '2026-11-20' });
    expect((await change(id, { date: '2026-11-20', note: 'Same day' })).status).toBe(200);
  });

  it('records when it was changed, from the clock, and keeps the created time', async () => {
    const added = await add({ date: '2026-11-20' });
    expect(added.changedAt).toBeNull();
    const response = await change(added.id, { note: 'Later' }, { NOW: '2026-11-19T22:15:00.000Z' });
    const { assignment } = (await response.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T22:15:00.000Z', changedAt: '2026-11-19T22:15:00.000Z' });
  });

  it('changes nothing, not even the changed time, when every field sent is as it was', async () => {
    const added = await add({ date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21', fromPlaceId: 'plc-plant', note: 'Haul stone' });
    const later = { NOW: '2026-11-19T22:15:00.000Z' };
    const same = await change(added.id, { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21', fromPlaceName: 'sample plant', toPlaceId: '', note: ' Haul stone ' }, later);
    expect(same.status).toBe(200);
    expect(((await same.json()) as { assignment: Assignment }).assignment).toEqual(added);
    const nothing = await change(added.id, {}, later);
    expect(((await nothing.json()) as { assignment: Assignment }).assignment).toEqual(added);
  });

  it('refuses wrong fields as adding does, and leaves the Assignment as it was', async () => {
    const { id } = await add({ date: '2026-11-20', note: 'Haul stone' });
    const fields = await refusal(await change(id, { driverId: 'nobody', truckId: 7, note: 'x'.repeat(1001) }));
    expect(Object.keys(fields).sort()).toEqual(['driverId', 'note', 'truckId']);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, note: 'Haul stone' })]);
  });

  it('answers not found for an Assignment that does not exist', async () => {
    expect((await change('nothing', { note: 'x' })).status).toBe(404);
  });

  it('can no longer be replaced whole', async () => {
    const { id } = await add({ date: '2026-11-20' });
    const response = await send('PUT', `/api/assignments/${id}`, { date: '2026-11-20' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('PATCH, DELETE');
  });
});

describe('the order of Assignments in a lane', () => {
  const lanes = async (date: string) => (await day(date)).map((a) => `${a.driverName ?? 'Unassigned'}: ${a.note}`);

  it('puts a new Assignment last in its lane and answers its position', async () => {
    const first = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const second = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil haul' });
    const other = await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Move the excavator' });
    expect([first.position, second.position, other.position]).toEqual([0, 1, 0]);
  });

  it('counts the Unassigned Assignments as one lane, and each day on its own', async () => {
    const unassigned = [await add({ date: '2026-11-20', note: 'Who takes this?' }), await add({ date: '2026-11-20', note: 'And this?' })];
    const nextDay = await add({ date: '2026-11-23', note: 'Monday' });
    expect(unassigned.map((a) => a.position)).toEqual([0, 1]);
    expect(nextDay.position).toBe(0);
  });

  it('reads a day by lane (Drivers, Unassigned last), then position, with the position in each', async () => {
    await add({ date: '2026-11-20', note: 'Who takes this?' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil haul' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Two loads' });
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone', 'Sample Driver A: Two loads', 'Sample Driver B: Topsoil haul', 'Unassigned: Who takes this?']);
    expect((await day('2026-11-20')).map((a) => a.position)).toEqual([0, 1, 0, 0]);
  });

  it('orders Assignments saved before they had a position (all at 0) by when they were added, and puts a new one after them', async () => {
    for (const note of ['one', 'two', 'three']) await add({ date: '2026-11-20', driverId: 'drv-a', note });
    // As the migration left every existing Assignment.
    await d1.database().prepare('UPDATE assignments SET position = 0').run();
    const added = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'four' });
    expect(added.position).toBe(1);
    expect(await lanes('2026-11-20')).toEqual(['one', 'two', 'three', 'four'].map((n) => `Sample Driver A: ${n}`));
  });

  it('puts an Assignment given to another Driver last in his lane', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil haul' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Fill the shop' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const response = await change(moved.id, { date: '2026-11-20', driverId: 'drv-b', note: 'Haul stone' });
    expect(((await response.json()) as { assignment: Assignment }).assignment.position).toBe(2);
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver B: Topsoil haul', 'Sample Driver B: Fill the shop', 'Sample Driver B: Haul stone']);
  });

  it('puts an Assignment taken off its Driver last in the Unassigned lane', async () => {
    await add({ date: '2026-11-20', note: 'Who takes this?' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await change(moved.id, { date: '2026-11-20', driverId: null, note: 'Haul stone' });
    expect(await lanes('2026-11-20')).toEqual(['Unassigned: Who takes this?', 'Unassigned: Haul stone']);
  });

  it('keeps an Assignment in its place when a change leaves its Driver as it was', async () => {
    const first = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil haul' });
    await change(first.id, { date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone, two loads' });
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone, two loads', 'Sample Driver A: Topsoil haul']);
  });

  it('leaves the order and the changed time alone when the same Driver is sent again', async () => {
    const first = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil haul' });
    const response = await change(first.id, { driverId: 'drv-a' }, { NOW: '2026-11-19T22:15:00.000Z' });
    expect(((await response.json()) as { assignment: Assignment }).assignment).toEqual(first);
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone', 'Sample Driver A: Topsoil haul']);
  });

  it('records a change on the Assignment that moved lanes, not on the ones it moved past', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil haul' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Two loads' });
    await change(moved.id, { driverId: 'drv-b' });
    const changed = Object.fromEntries((await day('2026-11-20')).map((a) => [a.note, a.changedAt !== null]));
    expect(changed).toEqual({ 'Topsoil haul': false, 'Haul stone': true, 'Fill the shop': false, 'Two loads': false });
  });
});

describe('moving an Assignment one place in its lane', () => {
  const move = (id: string, direction: unknown, vars = {}) => send('POST', `/api/assignments/${id}/move`, { direction }, vars);
  const lane = async (date: string, driver: string) =>
    (await day(date)).filter((a) => (a.driverName ?? 'Unassigned') === driver).map((a) => a.note);
  /** Sample Driver A's day of three, and one for Sample Driver B. */
  const threeForA = async () => {
    const [stone, topsoil, shop] = [
      await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' }),
      await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil haul' }),
      await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' }),
    ];
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Move the excavator' });
    return { stone, topsoil, shop };
  };

  it('"Do this first" swaps it with the one before it, and answers the lane in its new order', async () => {
    const { shop } = await threeForA();
    const response = await move(shop.id, 'earlier');
    expect(response.status).toBe(200);
    const { assignments } = (await response.json()) as { assignments: Assignment[] };
    expect(assignments.map((a) => [a.note, a.position])).toEqual([['Haul stone', 0], ['Fill the shop', 1], ['Topsoil haul', 2]]);
    expect(await lane('2026-11-20', 'Sample Driver A')).toEqual(['Haul stone', 'Fill the shop', 'Topsoil haul']);
    expect(await lane('2026-11-20', 'Sample Driver B')).toEqual(['Move the excavator']);
  });

  it('"Do this later" swaps it with the one after it', async () => {
    const { stone } = await threeForA();
    await move(stone.id, 'later');
    expect(await lane('2026-11-20', 'Sample Driver A')).toEqual(['Topsoil haul', 'Haul stone', 'Fill the shop']);
  });

  it('records the change on the one moved, not on the neighbour that shifted', async () => {
    const { stone, topsoil, shop } = await threeForA();
    await move(topsoil.id, 'earlier', { NOW: '2026-11-19T22:15:00.000Z' });
    const after = Object.fromEntries((await day('2026-11-20')).map((a) => [a.id, a]));
    expect(after[topsoil.id].changedAt).toBe('2026-11-19T22:15:00.000Z');
    expect(after[topsoil.id].updatedAt).toBe('2026-11-19T22:15:00.000Z');
    expect(after[stone.id]).toMatchObject({ changedAt: null, updatedAt: stone.updatedAt });
    expect(after[shop.id]).toMatchObject({ changedAt: null, updatedAt: shop.updatedAt });
  });

  it('moves in the Unassigned lane too', async () => {
    await add({ date: '2026-11-20', note: 'Who takes this?' });
    const second = await add({ date: '2026-11-20', note: 'And this?' });
    await move(second.id, 'earlier');
    expect(await lane('2026-11-20', 'Unassigned')).toEqual(['And this?', 'Who takes this?']);
  });

  it('moves one place among Assignments saved before they had a position (all at 0), in the order they were added', async () => {
    for (const note of ['one', 'two', 'three']) await add({ date: '2026-11-20', driverId: 'drv-a', note });
    await d1.database().prepare('UPDATE assignments SET position = 0').run();
    const three = (await day('2026-11-20')).find((a) => a.note === 'three')!;
    await move(three.id, 'earlier');
    expect(await lane('2026-11-20', 'Sample Driver A')).toEqual(['one', 'three', 'two']);
    expect((await day('2026-11-20')).map((a) => a.position)).toEqual([0, 1, 2]);
  });

  it.each([
    ['first', 'earlier', 'stone'],
    ['last', 'later', 'shop'],
  ] as const)('refuses to move the %s one past the end of its lane, and changes nothing', async (_end, direction, which) => {
    const planned = await threeForA();
    const before = await day('2026-11-20');
    const response = await move(planned[which].id, direction);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'lane_end', message: expect.any(String) });
    expect(await day('2026-11-20')).toEqual(before);
  });

  /** Sample Driver A's lane, all Assigned, with the middle one cancelled: [Haul stone, cancelled Topsoil haul, Fill the shop]. */
  const assignedWithMiddleCancelled = async () => {
    const planned = await threeForA();
    for (const { id } of Object.values(planned)) await assign(id, { NOW: '2026-11-19T21:15:00.000Z' });
    await send('DELETE', `/api/assignments/${planned.topsoil.id}`, undefined, { NOW: '2026-11-19T21:30:00.000Z' });
    return planned;
  };

  it('steps over a cancelled Assignment: "Do this first" swaps with the nearest one that is not cancelled', async () => {
    const { shop } = await assignedWithMiddleCancelled();
    expect((await move(shop.id, 'earlier')).status).toBe(200);
    const after = (await day('2026-11-20')).filter((a) => a.driverId === 'drv-a');
    expect(after.filter((a) => !a.cancelledAt).map((a) => a.note)).toEqual(['Fill the shop', 'Haul stone']);
    expect(after.map((a) => a.note)).toEqual(['Fill the shop', 'Topsoil haul', 'Haul stone']);
  });

  it('steps over a cancelled Assignment: "Do this later" swaps with the nearest one that is not cancelled', async () => {
    const { stone } = await assignedWithMiddleCancelled();
    expect((await move(stone.id, 'later')).status).toBe(200);
    expect(await lane('2026-11-20', 'Sample Driver A')).toEqual(['Fill the shop', 'Topsoil haul', 'Haul stone']);
  });

  it('counts only Assignments that are not cancelled when deciding a lane end', async () => {
    const { stone, topsoil, shop } = await threeForA();
    for (const { id } of [stone, topsoil, shop]) await assign(id, { NOW: '2026-11-19T21:15:00.000Z' });
    await send('DELETE', `/api/assignments/${stone.id}`, undefined, { NOW: '2026-11-19T21:30:00.000Z' });
    await send('DELETE', `/api/assignments/${shop.id}`, undefined, { NOW: '2026-11-19T21:30:00.000Z' });
    for (const direction of ['earlier', 'later']) {
      const response = await move(topsoil.id, direction);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'lane_end' });
    }
  });

  it('refuses a direction other than earlier or later, with a message on it', async () => {
    const { stone } = await threeForA();
    expect(await refusal(await move(stone.id, 'sideways'))).toEqual({ direction: 'Move it earlier or later.' });
  });

  it('refuses moving one on a past day', async () => {
    await send('POST', '/api/assignments', { date: '2026-11-18', note: 'one' }, { NOW: '2026-11-18T15:00:00.000Z' });
    const past = (
      (await (await send('POST', '/api/assignments', { date: '2026-11-18', note: 'two' }, { NOW: '2026-11-18T15:00:00.000Z' })).json()) as {
        assignment: Assignment;
      }
    ).assignment;
    const response = await move(past.id, 'earlier');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'past_day' });
    expect((await day('2026-11-18')).map((a) => a.note)).toEqual(['one', 'two']);
  });

  it('answers not found for an Assignment that does not exist, and only to a POST', async () => {
    expect((await move('nothing', 'earlier')).status).toBe(404);
    const { stone } = await threeForA();
    const response = await send('GET', `/api/assignments/${stone.id}/move`);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

describe('deleting an Assignment', () => {
  it('removes it from its day', async () => {
    const kept = await add({ date: '2026-11-20', note: 'keep' });
    const { id } = await add({ date: '2026-11-20', note: 'delete' });
    expect((await remove(id)).status).toBe(204);
    expect(await day('2026-11-20')).toEqual([kept]);
  });

  it('answers not found for an Assignment that does not exist, or no longer does', async () => {
    const { id } = await add({ date: '2026-11-20' });
    await remove(id);
    expect((await remove(id)).status).toBe(404);
    expect((await remove('nothing')).status).toBe(404);
  });
});

describe('Assigning an Assignment', () => {
  // Today is Thursday 2026-11-19; Dave plans Friday 2026-11-20 and Assigns its work at 4:15 PM Eastern.
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const addAt = async (body: unknown, vars: Parameters<typeof env>[0]) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const assigned = async (body: object) => {
    const added = await addAt(body, PLANNED);
    await assign(added.id, ASSIGNED);
    return added;
  };
  const marks = async (date: string) => Object.fromEntries((await day(date)).map((a) => [a.note, a.sinceSent]));
  /** The earlier fields kept for an Assignment, oldest first, as the Driver view reads them. */
  const earlier = async (id: string) =>
    (
      await d1.database().prepare('SELECT changed_at AS changedAt, before FROM assignment_changes WHERE assignment_id = ? ORDER BY changed_at').bind(id).all<{ changedAt: string; before: string }>()
    ).results.map((row) => ({ changedAt: row.changedAt, before: JSON.parse(row.before) }));
  const refused = async (response: Response, error: string) => {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error, message: expect.any(String) });
  };

  it('starts every Assignment as a Draft, with no Assigned time, nothing marked and nothing handed over', async () => {
    const draft = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    expect(draft).toMatchObject({ assignedAt: null, handedFromId: null, sinceSent: null });
  });

  it('records when Dave Assigned it and answers it, leaving the day\'s other Assignments Drafts', async () => {
    const stone = await addAt({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' }, PLANNED);
    await addAt({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' }, PLANNED);
    const response = await assign(stone.id, ASSIGNED);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assignment: { ...stone, assignedAt: ASSIGNED.NOW, updatedAt: ASSIGNED.NOW } });
    expect((await day('2026-11-20')).map((a) => [a.note, a.assignedAt, a.sinceSent])).toEqual([
      ['Haul stone', ASSIGNED.NOW, null],
      ['Fill the shop', null, null],
    ]);
  });

  it('answers one already Assigned as it is, keeping its first Assigned time', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const again = await assign(stone.id, LATER);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { assignment: Assignment }).assignment).toMatchObject({ assignedAt: ASSIGNED.NOW, updatedAt: ASSIGNED.NOW });
  });

  it('refuses an Unassigned one, which stays a Draft until it has a Driver', async () => {
    const open = await add({ date: '2026-11-20', note: 'Haul stone' });
    await refused(await assign(open.id), 'unassigned');
    expect((await day('2026-11-20'))[0].assignedAt).toBeNull();
    await change(open.id, { driverId: 'drv-b' });
    expect((await assign(open.id)).status).toBe(200);
  });

  it('refuses one whose Driver was removed, since no one would see it', async () => {
    const stone = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await send('PATCH', '/api/drivers/drv-a', { active: false });
    await refused(await assign(stone.id), 'driver_removed');
    expect((await day('2026-11-20'))[0].assignedAt).toBeNull();
    await send('PATCH', '/api/drivers/drv-a', { active: true });
    expect((await assign(stone.id)).status).toBe(200);
  });

  it('refuses a cancelled one until it is put back', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await remove(stone.id, LATER);
    await refused(await assign(stone.id, LATER), 'cancelled');
  });

  it('refuses one on a day before today', async () => {
    const past = (
      (await (await send('POST', '/api/assignments', { date: '2026-11-18', driverId: 'drv-a' }, { NOW: '2026-11-18T15:00:00.000Z' })).json()) as {
        assignment: Assignment;
      }
    ).assignment;
    await refused(await assign(past.id), 'past_day');
    expect((await day('2026-11-18'))[0].assignedAt).toBeNull();
  });

  it('answers not found for an Assignment that does not exist, and only Assigns with POST', async () => {
    expect((await assign('nothing')).status).toBe(404);
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a' });
    const reading = await send('GET', `/api/assignments/${id}/assign`);
    expect(reading.status).toBe(405);
    expect(reading.headers.get('Allow')).toBe('POST');
  });

  it('marks one Assigned on its own day Added, also in the answer that Assigns it', async () => {
    const today = await add({ date: '2026-11-19', driverId: 'drv-a', note: 'Two more loads' });
    const response = await assign(today.id);
    expect(((await response.json()) as { assignment: Assignment }).assignment.sinceSent).toBe('added');
    await change(today.id, { note: 'Three more loads' }, LATER);
    expect(await marks('2026-11-19')).toEqual({ 'Three more loads': 'added' });
  });

  it('marks one changed after it was Assigned Changed, and leaves Drafts and the rest alone', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const draft = await addAt({ date: '2026-11-20', driverId: 'drv-b', note: 'Haul dirt' }, PLANNED);
    await change(stone.id, { materialId: 'mat-stone' }, LATER);
    await change(draft.id, { materialId: 'mat-dirt' }, LATER);
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': 'changed', 'Fill the shop': null, 'Haul dirt': null });
  });

  it('does not mark what changed before it was Assigned', async () => {
    const stone = await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await change(stone.id, { driverId: 'drv-a' }, { NOW: '2026-11-19T20:30:00.000Z' });
    await assign(stone.id, ASSIGNED);
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': null });
  });

  it('keeps an Assignment\'s fields as they were before each change after it was Assigned', async () => {
    const stone = await assigned(
      { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-stone', foremanId: 'frm-a', note: 'Haul stone' },
    );
    await change(stone.id, { materialId: 'mat-dirt', note: 'Haul dirt' }, LATER);
    await change(stone.id, { toPlaceName: 'Sample New Pit' }, { NOW: '2026-11-19T23:00:00.000Z' });
    expect(await earlier(stone.id)).toEqual([
      {
        changedAt: LATER.NOW,
        before: {
          driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-24', truckNumber: '24',
          fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North',
          materialId: 'mat-stone', materialName: 'Sample Stone', foremanId: 'frm-a', foremanName: 'Sample Foreman A',
          note: 'Haul stone', position: 0, cancelledAt: null,
        },
      },
      {
        changedAt: '2026-11-19T23:00:00.000Z',
        before: expect.objectContaining({ toPlaceId: 'plc-north', toPlaceName: 'Sample Site North', materialName: 'Sample Dirt', note: 'Haul dirt' }),
      },
    ]);
  });

  it('keeps nothing for changes to a Draft, or for a change that changes nothing', async () => {
    const stone = await addAt({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone', materialId: 'mat-stone' }, PLANNED);
    await change(stone.id, { note: 'Haul stone, two loads' }, PLANNED);
    await assign(stone.id, ASSIGNED);
    await change(stone.id, { note: 'Haul stone, two loads', materialId: 'mat-stone' }, LATER);
    expect(await earlier(stone.id)).toEqual([]);
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone, two loads': null });
  });

  it('marks the Assigned one moved one place Changed and keeps its earlier place, but not the neighbour it passed', async () => {
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const shop = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    await send('POST', `/api/assignments/${shop.id}/move`, { direction: 'earlier' }, LATER);
    expect(await marks('2026-11-20')).toEqual({ 'Fill the shop': 'changed', 'Haul stone': null });
    expect(await earlier(shop.id)).toEqual([{ changedAt: LATER.NOW, before: expect.objectContaining({ note: 'Fill the shop', position: 1 }) }]);
    const stone = (await day('2026-11-20')).find((a) => a.note === 'Haul stone')!;
    expect(await earlier(stone.id)).toEqual([]);
  });

  it('keeps nothing for a move of a Draft', async () => {
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const shop = await addAt({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' }, PLANNED);
    await send('POST', `/api/assignments/${shop.id}/move`, { direction: 'earlier' }, LATER);
    expect(await earlier(shop.id)).toEqual([]);
    expect(await marks('2026-11-20')).toEqual({ 'Fill the shop': null, 'Haul stone': null });
  });

  it('no longer Sends a whole day: the old route is gone', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-a' });
    const response = await send('POST', '/api/days/2026-11-20/send');
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'gone', message: expect.any(String) });
    expect((await day('2026-11-20'))[0].assignedAt).toBeNull();
  });
});

describe('✕ and Put back', () => {
  // Today is Thursday 2026-11-19; Dave plans Friday 2026-11-20, Assigns work at 4:15 PM Eastern, then takes work off it.
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const BACK = { NOW: '2026-11-19T22:30:00.000Z' };
  const plan = async (body: Record<string, unknown>, vars = PLANNED) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const assigned = async (body: Record<string, unknown>) => {
    const added = await plan(body);
    await assign(added.id, ASSIGNED);
    return added;
  };
  const cancel = (id: string, vars = LATER) => send('DELETE', `/api/assignments/${id}`, undefined, vars);
  const putBack = (id: string, vars = BACK) => send('POST', `/api/assignments/${id}/put-back`, undefined, vars);
  const answered = async (response: Response) => ((await response.json()) as { assignment: Assignment }).assignment;
  const earlier = async (id: string) =>
    (
      await d1.database().prepare('SELECT changed_at AS changedAt, before FROM assignment_changes WHERE assignment_id = ? ORDER BY changed_at').bind(id).all<{ changedAt: string; before: string }>()
    ).results.map((row) => ({ changedAt: row.changedAt, before: JSON.parse(row.before) }));

  it('deletes a Draft, leaving nothing behind, even beside Assigned work on its day', async () => {
    const stone = await plan({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const shop = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    expect((await cancel(stone.id)).status).toBe(204);
    expect((await day('2026-11-20')).map((a) => a.id)).toEqual([shop.id]);
    expect(await earlier(stone.id)).toEqual([]);
  });

  it('cancels an Assigned one instead: it stays in its place, cancelled and Changed', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const shop = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const response = await cancel(stone.id);
    expect(response.status).toBe(200);
    expect(await answered(response)).toMatchObject({ id: stone.id, cancelledAt: LATER.NOW, changedAt: LATER.NOW, sinceSent: 'changed', position: 0 });
    expect((await day('2026-11-20')).map((a) => [a.note, a.cancelledAt, a.sinceSent])).toEqual([
      ['Haul stone', LATER.NOW, 'changed'],
      ['Fill the shop', null, null],
    ]);
    expect(shop.cancelledAt).toBeNull();
  });

  it('changes nothing when a cancelled Assignment is cancelled again', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await cancel(stone.id);
    const again = await cancel(stone.id, BACK);
    expect(again.status).toBe(200);
    expect(await answered(again)).toMatchObject({ cancelledAt: LATER.NOW, changedAt: LATER.NOW });
  });

  it('puts a cancelled Assignment back: no longer cancelled, still Assigned and Changed, changed time from the clock', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await cancel(stone.id);
    const response = await putBack(stone.id);
    expect(response.status).toBe(200);
    expect(await answered(response)).toMatchObject({ id: stone.id, cancelledAt: null, changedAt: BACK.NOW, assignedAt: ASSIGNED.NOW, sinceSent: 'changed', position: 0 });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id: stone.id, cancelledAt: null })]);
  });

  it('changes nothing when Put back is tapped on one that is not cancelled', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const response = await putBack(stone.id);
    expect(response.status).toBe(200);
    expect(await answered(response)).toMatchObject({ cancelledAt: null, changedAt: null, sinceSent: null });
    expect(await earlier(stone.id)).toEqual([]);
  });

  it('keeps the fields as they were before the cancel and before the Put back, for the Driver view', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await cancel(stone.id);
    await putBack(stone.id);
    expect(await earlier(stone.id)).toEqual([
      { changedAt: LATER.NOW, before: expect.objectContaining({ driverName: 'Sample Driver A', note: 'Haul stone', cancelledAt: null }) },
      { changedAt: BACK.NOW, before: expect.objectContaining({ note: 'Haul stone', cancelledAt: LATER.NOW }) },
    ]);
  });

  it('refuses changing or moving a cancelled Assignment until it is put back', async () => {
    const stone = await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await plan({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    await cancel(stone.id);
    const changing = await change(stone.id, { note: 'Haul dirt' }, BACK);
    expect(changing.status).toBe(409);
    expect(await changing.json()).toEqual({ error: 'cancelled', message: 'This Assignment is cancelled. Put it back first to change it.' });
    expect((await send('POST', `/api/assignments/${stone.id}/move`, { direction: 'later' }, BACK)).status).toBe(409);
    expect(await day('2026-11-20')).toEqual([
      expect.objectContaining({ note: 'Haul stone', position: 0, changedAt: LATER.NOW }),
      expect.objectContaining({ note: 'Fill the shop', position: 1 }),
    ]);
  });

  it('answers not found for an Assignment that does not exist, and Put back only to a POST', async () => {
    expect((await putBack('nothing')).status).toBe(404);
    const { id } = await plan({ date: '2026-11-20' });
    const other = await send('GET', `/api/assignments/${id}/put-back`);
    expect(other.status).toBe(405);
    expect(other.headers.get('Allow')).toBe('POST');
  });
});

describe('Discard and Dismiss', () => {
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const CLEARED = { NOW: '2026-11-19T22:30:00.000Z' };
  const cancelled = async (note: string) => {
    const { assignment } = (await (await send('POST', '/api/assignments', { date: '2026-11-20', driverId: 'drv-a', note }, PLANNED)).json()) as { assignment: Assignment };
    await assign(assignment.id, ASSIGNED);
    await send('DELETE', `/api/assignments/${assignment.id}`, undefined, LATER);
    return assignment;
  };
  const driverNotes = async () =>
    ((await (await send('GET', '/api/drivers/drv-a/days/2026-11-20')).json()) as DriverDay).assignments.map((a) => a.note);
  const boardNotes = async () => (await day('2026-11-20')).map((a) => a.note);

  it('discards a cancelled one from the Board only: the Driver still sees it cancelled', async () => {
    const stone = await cancelled('Haul stone');
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const response = await send('POST', `/api/assignments/${stone.id}/discard`, undefined, CLEARED);
    expect(response.status).toBe(204);
    expect(await boardNotes()).toEqual(['Fill the shop']);
    expect(await driverNotes()).toEqual(['Haul stone']);
  });

  it('dismisses a cancelled one from the Driver view only: the Board still lists it', async () => {
    const stone = await cancelled('Haul stone');
    expect((await send('POST', `/api/assignments/${stone.id}/dismiss`, undefined, CLEARED)).status).toBe(204);
    expect(await driverNotes()).toEqual([]);
    expect(await boardNotes()).toEqual(['Haul stone']);
  });

  it('refuses to clear away one that is not cancelled, and answers not found and POST only', async () => {
    const { assignment } = (await (await send('POST', '/api/assignments', { date: '2026-11-20', note: 'Haul stone' }, PLANNED)).json()) as { assignment: Assignment };
    const refused = await send('POST', `/api/assignments/${assignment.id}/discard`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'not_cancelled', message: 'Only a cancelled Assignment can be discarded.' });
    expect((await send('POST', '/api/assignments/nothing/dismiss')).status).toBe(404);
    const other = await send('GET', `/api/assignments/${assignment.id}/discard`);
    expect(other.status).toBe(405);
    expect(other.headers.get('Allow')).toBe('POST');
    expect(await boardNotes()).toEqual(['Haul stone']);
  });

  it('works on a day before today too, since it changes nothing the Driver reads', async () => {
    const stone = await cancelled('Haul stone');
    const nextWeek = { NOW: '2026-11-25T15:00:00.000Z' };
    expect((await send('POST', `/api/assignments/${stone.id}/discard`, undefined, nextWeek)).status).toBe(204);
    expect((await send('POST', `/api/assignments/${stone.id}/dismiss`, undefined, nextWeek)).status).toBe(204);
  });

  it('leaves a discarded one out of the week strip and of the check that a day is empty', async () => {
    const stone = await cancelled('Haul stone');
    await send('POST', `/api/assignments/${stone.id}/discard`, undefined, CLEARED);
    const week = (await (await send('GET', '/api/weeks/2026-11-16')).json()) as { days: { date: string; drafts: number; state: string }[] };
    expect(week.days.find((d) => d.date === '2026-11-20')).toEqual(expect.objectContaining({ drafts: 0, state: 'none' }));
    // An earlier day to start from, so only the empty-day check could refuse it.
    await send('POST', '/api/assignments', { date: '2026-11-19', driverId: 'drv-b', note: 'Haul dirt' }, PLANNED);
    const copied = await send('POST', '/api/days/2026-11-20/start-from', undefined, CLEARED);
    expect(copied.status).toBe(201);
    expect(await boardNotes()).toEqual([null]);
  });
});

describe('giving an Assigned Assignment to another Driver', () => {
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const plan = async (body: Record<string, unknown>, vars = PLANNED) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const assigned = async (body: Record<string, unknown>) => {
    const added = await plan(body);
    return ((await (await assign(added.id, ASSIGNED)).json()) as { assignment: Assignment }).assignment;
  };
  const lanes = async (date: string) => (await day(date)).map((a) => [a.driverId, a.note, a.position, a.cancelledAt, a.sinceSent]);
  const FULL = { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-stone', foremanId: 'frm-a', note: 'Haul stone' };

  it('cancels it for the first Driver and Assigns a copy to the other at once, Added, last in his lane', async () => {
    const stone = await assigned(FULL);
    await plan({ date: '2026-11-20', driverId: 'drv-b', note: 'Fill the shop' });
    const response = await change(stone.id, { driverId: 'drv-b' }, LATER);
    expect(response.status).toBe(200);
    const { assignment, cancelled } = (await response.json()) as { assignment: Assignment; cancelled: Assignment };
    expect(cancelled).toMatchObject({ id: stone.id, driverId: 'drv-a', cancelledAt: LATER.NOW, changedAt: LATER.NOW, assignedAt: ASSIGNED.NOW, sinceSent: 'changed' });
    expect(assignment.id).not.toBe(stone.id);
    expect(assignment).toMatchObject({
      ...FULL, driverId: 'drv-b', driverName: 'Sample Driver B', position: 1, cancelledAt: null,
      createdAt: LATER.NOW, changedAt: null, assignedAt: LATER.NOW, handedFromId: stone.id, sinceSent: 'added',
    });
    expect(await lanes('2026-11-20')).toEqual([
      ['drv-a', 'Haul stone', 0, LATER.NOW, 'changed'],
      ['drv-b', 'Fill the shop', 0, null, null],
      ['drv-b', 'Haul stone', 1, null, 'added'],
    ]);
  });

  it('records the first Driver\'s fields as they were, on the cancelled one', async () => {
    const stone = await assigned(FULL);
    await change(stone.id, { driverId: null }, LATER);
    const { results } = await d1.database().prepare('SELECT changed_at AS changedAt, before FROM assignment_changes WHERE assignment_id = ?').bind(stone.id).all<{ changedAt: string; before: string }>();
    expect(results.map((r) => ({ changedAt: r.changedAt, before: JSON.parse(r.before) }))).toEqual([
      { changedAt: LATER.NOW, before: expect.objectContaining({ driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul stone', cancelledAt: null }) },
    ]);
  });

  it('takes it off his day into the Unassigned lane as a Draft copy', async () => {
    const stone = await assigned(FULL);
    const { assignment } = (await (await change(stone.id, { driverId: null }, LATER)).json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ driverId: null, assignedAt: null, handedFromId: null, sinceSent: null });
    expect(await lanes('2026-11-20')).toEqual([
      ['drv-a', 'Haul stone', 0, LATER.NOW, 'changed'],
      [null, 'Haul stone', 0, null, null],
    ]);
  });

  it('gives the copy any other fields changed with the Driver, and leaves the cancelled one as the first Driver had it', async () => {
    const stone = await assigned(FULL);
    const response = await change(stone.id, { driverId: 'drv-b', note: 'Haul stone, two loads', materialName: 'Sample Dirt' }, LATER);
    const { assignment, cancelled } = (await response.json()) as { assignment: Assignment; cancelled: Assignment };
    expect(assignment).toMatchObject({ driverId: 'drv-b', note: 'Haul stone, two loads', materialId: 'mat-dirt' });
    expect(cancelled).toMatchObject({ driverId: 'drv-a', note: 'Haul stone', materialId: 'mat-stone' });
  });

  it('changes nothing when the same Driver is sent again', async () => {
    const stone = await assigned(FULL);
    const response = await change(stone.id, { driverId: 'drv-a' }, LATER);
    expect(await response.json()).toEqual({ assignment: stone });
    expect(await lanes('2026-11-20')).toEqual([['drv-a', 'Haul stone', 0, null, null]]);
  });

  it('just moves a Draft, even beside Assigned work on its day', async () => {
    await assigned({ date: '2026-11-20', driverId: 'drv-b', note: 'Fill the shop' });
    const stone = await plan(FULL);
    const response = await change(stone.id, { driverId: 'drv-b' }, LATER);
    expect(await response.json()).toEqual({ assignment: expect.objectContaining({ id: stone.id, driverId: 'drv-b', cancelledAt: null, assignedAt: null }) });
    expect(await lanes('2026-11-20')).toEqual([
      ['drv-b', 'Fill the shop', 0, null, null],
      ['drv-b', 'Haul stone', 1, null, null],
    ]);
  });
});

describe('the Driver view read', () => {
  // Today is Thursday 2026-11-19; Dave plans Friday 2026-11-20 and Assigns its work at 4:15 PM Eastern.
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const plan = async (body: Record<string, unknown>, vars = PLANNED) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const assigned = async (body: Record<string, unknown>) => {
    const added = await plan(body);
    await assign(added.id, ASSIGNED);
    return added;
  };
  const driverDay = (driverId: string, date: string) => get(`/api/drivers/${driverId}/days/${date}`);
  const cards = async (driverId: string, date: string) => {
    const response = await driverDay(driverId, date);
    expect(response.status).toBe(200);
    return ((await response.json()) as DriverDay).assignments;
  };
  const FULL = { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-stone', foremanId: 'frm-a', note: 'Haul stone' };

  it('shows the Driver nothing of his Drafts', async () => {
    await plan(FULL);
    const response = await driverDay('drv-a', '2026-11-20');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2026-11-20', assignments: [] });
  });

  it('shows only his Assigned Assignments, in Dave\'s order, with nothing marked', async () => {
    await assigned(FULL);
    await assigned({ date: '2026-11-20', driverId: 'drv-b', note: 'Not his' });
    await plan({ date: '2026-11-20', note: 'Unassigned' });
    await plan({ date: '2026-11-20', driverId: 'drv-a', note: 'Still a Draft' });
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const response = await driverDay('drv-a', '2026-11-20');
    expect(response.status).toBe(200);
    const body = (await response.json()) as DriverDay;
    expect(Object.keys(body).sort()).toEqual(['assignments', 'date']);
    expect(body.assignments.map((a) => [a.note, a.position, a.assignedAt, a.sinceSent, a.cancelledAt, a.was])).toEqual([
      ['Haul stone', 0, ASSIGNED.NOW, null, null, {}],
      ['Fill the shop', 2, ASSIGNED.NOW, null, null, {}],
    ]);
    expect(body.assignments[0]).toMatchObject({ truckNumber: '24', fromPlaceName: 'Sample Plant', toPlaceName: 'Sample Site North', materialName: 'Sample Stone' });
  });

  it('marks one changed after it was Assigned Changed, with what each changed field was when Assigned', async () => {
    const stone = await assigned(FULL);
    await change(stone.id, { materialId: 'mat-dirt', truckId: null }, LATER);
    await change(stone.id, { materialId: 'mat-minus', note: 'Haul stone, two loads' }, { NOW: '2026-11-19T22:30:00.000Z' });
    const [card] = await cards('drv-a', '2026-11-20');
    expect(card).toMatchObject({ sinceSent: 'changed', materialName: '2" minus', truckNumber: null });
    expect(card.was).toEqual({ materialName: 'Sample Stone', truckNumber: '24', note: 'Haul stone' });
  });

  it('says what each field was when Assigned, not as it was planned before', async () => {
    const stone = await plan(FULL);
    await change(stone.id, { materialId: 'mat-dirt' }, { NOW: '2026-11-19T20:30:00.000Z' });
    await assign(stone.id, ASSIGNED);
    await change(stone.id, { materialId: 'mat-minus' }, LATER);
    const [card] = await cards('drv-a', '2026-11-20');
    expect(card.was).toEqual({ materialName: 'Sample Dirt' });
  });

  it('says what the Foreman was when Dave changes him after it was Assigned', async () => {
    const stone = await assigned(FULL);
    await change(stone.id, { foremanId: 'frm-b' }, LATER);
    const [card] = await cards('drv-a', '2026-11-20');
    expect(card).toMatchObject({ sinceSent: 'changed', foremanName: 'Sample Foreman B' });
    expect(card.was).toEqual({ foremanName: 'Sample Foreman A' });
  });

  it('shows Changed with nothing it was when only its place in his order changed, or it was changed back', async () => {
    const stone = await assigned(FULL);
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    await send('POST', `/api/assignments/${stone.id}/move`, { direction: 'later' }, LATER);
    const shop = (await cards('drv-a', '2026-11-20'))[0];
    await change(shop.id, { note: 'Fill the yard' }, LATER);
    await change(shop.id, { note: 'Fill the shop' }, { NOW: '2026-11-19T22:30:00.000Z' });
    expect((await cards('drv-a', '2026-11-20')).map((a) => [a.note, a.sinceSent, a.was])).toEqual([
      ['Fill the shop', 'changed', {}],
      ['Haul stone', 'changed', {}],
    ]);
  });

  it('keeps the name a field had when Assigned, even after its entry is renamed', async () => {
    const stone = await assigned(FULL);
    await change(stone.id, { materialId: 'mat-dirt' }, LATER);
    await send('PATCH', '/api/materials/mat-stone', { name: 'Cobblestone' });
    await send('PATCH', '/api/materials/mat-dirt', { name: 'Fill' });
    const [card] = await cards('drv-a', '2026-11-20');
    expect([card.materialName, card.was]).toEqual(['Fill', { materialName: 'Sample Stone' }]);
  });

  it('marks one Assigned on its own day Added, with nothing it was, however often it changes', async () => {
    const FRIDAY_MORNING = { NOW: '2026-11-20T13:00:00.000Z' };
    await assigned(FULL);
    const added = await plan({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    await assign(added.id, FRIDAY_MORNING);
    await change(added.id, { note: 'Fill the yard' }, { NOW: '2026-11-20T14:00:00.000Z' });
    expect((await cards('drv-a', '2026-11-20')).map((a) => [a.note, a.sinceSent, a.was])).toEqual([
      ['Haul stone', null, {}],
      ['Fill the yard', 'added', {}],
    ]);
  });

  it('includes a cancelled one, in its place and marked cancelled', async () => {
    const stone = await assigned(FULL);
    await assigned({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    await send('DELETE', `/api/assignments/${stone.id}`, undefined, LATER);
    expect((await cards('drv-a', '2026-11-20')).map((a) => [a.note, a.cancelledAt, a.sinceSent])).toEqual([
      ['Haul stone', LATER.NOW, 'changed'],
      ['Fill the shop', null, null],
    ]);
  });

  it('shows one given to another Driver after it was Assigned cancelled for the first Driver and Added for the second', async () => {
    const stone = await assigned(FULL);
    await change(stone.id, { driverId: 'drv-b' }, LATER);
    expect((await cards('drv-a', '2026-11-20')).map((a) => [a.note, a.cancelledAt, a.sinceSent])).toEqual([['Haul stone', LATER.NOW, 'changed']]);
    expect((await cards('drv-b', '2026-11-20')).map((a) => [a.note, a.cancelledAt, a.sinceSent, a.was])).toEqual([['Haul stone', null, 'added', {}]]);
  });

  it('refuses a date that is not real, a Driver that does not exist, and anything but a read', async () => {
    expect(await refusal(await driverDay('drv-a', '2026-02-30'))).toEqual({ date: 'Pick a date.' });
    expect((await driverDay('nobody', '2026-11-20')).status).toBe(404);
    const writing = await send('POST', '/api/drivers/drv-a/days/2026-11-20', {});
    expect(writing.status).toBe(405);
    expect(writing.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('reading a week', () => {
  // Today is Thursday 2026-11-19; Dave plans the next week, Monday 2026-11-23 to Sunday 2026-11-29 (Thanksgiving on the Thursday).
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const ASSIGNED = { NOW: '2026-11-19T21:15:00.000Z' };
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const plan = async (body: Record<string, unknown>, vars = PLANNED) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const assigned = async (body: Record<string, unknown>) => {
    const added = await plan(body);
    await assign(added.id, ASSIGNED);
    return added;
  };
  const week = async (monday: string) => (await (await get(`/api/weeks/${monday}`)).json()) as { days: unknown[] };

  it('answers each of its seven days with its state, its count of Drafts and its Holiday', async () => {
    await plan({ date: '2026-11-23', driverId: 'drv-a' });
    await plan({ date: '2026-11-23' });
    await plan({ date: '2026-11-23' });
    await assigned({ date: '2026-11-24', driverId: 'drv-a' });
    const wednesday = await assigned({ date: '2026-11-25', driverId: 'drv-a' });
    await change(wednesday.id, { driverId: 'drv-b' }, LATER);
    await assigned({ date: '2026-11-27', driverId: 'drv-b' });
    await plan({ date: '2026-11-27' });
    await plan({ date: '2026-11-29' });
    await plan({ date: '2026-11-30' });

    const response = await get('/api/weeks/2026-11-23');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: [
        { date: '2026-11-23', state: 'draft', drafts: 3, holiday: null },
        { date: '2026-11-24', state: 'assigned', drafts: 0, holiday: null },
        { date: '2026-11-25', state: 'changed', drafts: 0, holiday: null },
        { date: '2026-11-26', state: 'none', drafts: 0, holiday: 'Thanksgiving' },
        { date: '2026-11-27', state: 'draft', drafts: 1, holiday: null },
        { date: '2026-11-28', state: 'none', drafts: 0, holiday: null },
        { date: '2026-11-29', state: 'draft', drafts: 1, holiday: null },
      ],
    });
  });

  it('marks an Assigned day Changed once an Assignment on it is changed', async () => {
    const one = await assigned({ date: '2026-11-24', driverId: 'drv-a' });
    await change(one.id, { note: 'Two loads' }, LATER);
    expect((await week('2026-11-23')).days[1]).toMatchObject({ date: '2026-11-24', state: 'changed' });
  });

  it('keeps a day whose only Assignment is cancelled Changed, and does not count it a Draft', async () => {
    const off = await assigned({ date: '2026-11-24', driverId: 'drv-a' });
    await send('DELETE', `/api/assignments/${off.id}`, undefined, LATER);
    expect((await week('2026-11-23')).days[1]).toEqual({ date: '2026-11-24', state: 'changed', drafts: 0, holiday: null });
  });

  it('reads a week before today too', async () => {
    expect((await week('2026-11-16')).days).toHaveLength(7);
  });

  it.each([
    ['a Tuesday', '2026-11-24'],
    ['a Sunday', '2026-11-22'],
    ['not a real date', '2026-02-30'],
    ['written another way', '23-11-2026'],
  ])('refuses a date that is %s, with a message on the date', async (_why, date) => {
    const fields = await refusal(await get(`/api/weeks/${date}`));
    expect(Object.keys(fields)).toEqual(['date']);
    expect(fields.date).toBeTruthy();
  });

  it('is only read', async () => {
    const response = await send('POST', '/api/weeks/2026-11-23', {});
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('Assignments on days already Sent before Assign', () => {
  /** The statements of the migrations that carry Sent days over, in order, run on the database as it now is. */
  const carryOver = async () => {
    for (const file of ['0012_assignment_assigned_at.sql', '0013_cancelled_are_assigned.sql']) {
      const sql = readFileSync(`migrations/${file}`, 'utf8').replace(/--.*$/gm, '');
      for (const statement of sql.split(';').filter((s) => /^\s*UPDATE/i.test(s))) await d1.database().prepare(statement).run();
    }
  };

  it('become Assigned when their day was Sent, or when made if that was later, when they have a Driver; the rest stay Drafts', async () => {
    const early = await send('POST', '/api/assignments', { date: '2026-11-20', driverId: 'drv-a', note: 'Before the Send' }, { NOW: '2026-11-19T20:00:00.000Z' });
    const late = await send('POST', '/api/assignments', { date: '2026-11-20', driverId: 'drv-b', note: 'After the Send' }, { NOW: '2026-11-19T22:00:00.000Z' });
    await add({ date: '2026-11-20', note: 'Unassigned' });
    await add({ date: '2026-11-23', driverId: 'drv-a', note: 'Never Sent' });
    expect([early.status, late.status]).toEqual([201, 201]);
    await d1.database().prepare('INSERT INTO day_sends (date, sent_at) VALUES (?, ?)').bind('2026-11-20', '2026-11-19T21:15:00.000Z').run();

    await carryOver();

    expect((await day('2026-11-20')).map((a) => [a.note, a.assignedAt])).toEqual([
      ['Before the Send', '2026-11-19T21:15:00.000Z'],
      ['After the Send', '2026-11-19T22:00:00.000Z'],
      ['Unassigned', null],
    ]);
    expect((await day('2026-11-23')).map((a) => a.assignedAt)).toEqual([null]);
  });

  it('make an Unassigned one cancelled on its Sent day Assigned too, so a cancelled Assignment is never a Draft', async () => {
    const open = await send('POST', '/api/assignments', { date: '2026-11-20', note: 'Cancelled while Unassigned' }, { NOW: '2026-11-19T20:00:00.000Z' });
    const { assignment } = (await open.json()) as { assignment: Assignment };
    await d1.database().prepare('UPDATE assignments SET cancelled_at = ? WHERE id = ?').bind('2026-11-19T22:30:00.000Z', assignment.id).run();
    await d1.database().prepare('INSERT INTO day_sends (date, sent_at) VALUES (?, ?)').bind('2026-11-20', '2026-11-19T21:15:00.000Z').run();

    await carryOver();

    expect((await day('2026-11-20')).map((a) => [a.note, a.assignedAt])).toEqual([['Cancelled while Unassigned', '2026-11-19T21:15:00.000Z']]);
  });
});

describe('past days', () => {
  // The tests' clock says today is 2026-11-19 in US Eastern.
  const pastDay = (response: Response) => {
    expect(response.status).toBe(409);
    return response.json();
  };
  /** An Assignment already on a past day, as if added back when that day was still to come. */
  const onPastDay = async (body: object = {}) =>
    (
      (await (await send('POST', '/api/assignments', { date: '2026-11-18', note: 'yesterday', ...body }, { NOW: '2026-11-18T15:00:00.000Z' })).json()) as {
        assignment: Assignment;
      }
    ).assignment;

  it('refuse adding an Assignment before today, with a message on the date', async () => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-18' }));
    expect(fields).toEqual({ date: 'Days before today are read-only. Pick today or a later day.' });
    expect(await day('2026-11-18')).toEqual([]);
  });

  it('refuse changing an Assignment on a past day, and leave it as it was', async () => {
    const past = await onPastDay();
    expect(await pastDay(await change(past.id, { date: '2026-11-18', note: 'changed' }))).toEqual({
      error: 'past_day',
      message: 'This Assignment is on a day before today, which is read-only.',
    });
    expect(await day('2026-11-18')).toEqual([past]);
  });

  it('refuse moving an Assignment out of a past day', async () => {
    const past = await onPastDay();
    await pastDay(await change(past.id, { date: '2026-11-20', note: 'yesterday' }));
    expect(await day('2026-11-18')).toEqual([past]);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('refuse moving an Assignment into a past day, as any change of day', async () => {
    const { id } = await add({ date: '2026-11-20' });
    expect((await change(id, { date: '2026-11-18' })).status).toBe(409);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id })]);
  });

  it('refuse deleting an Assignment on a past day', async () => {
    const past = await onPastDay();
    await pastDay(await remove(past.id));
    expect(await day('2026-11-18')).toEqual([past]);
  });

  it('refuse ✕, Put back and Assign on a past day, and leave it as it was', async () => {
    const yesterday = { NOW: '2026-11-18T15:00:00.000Z' };
    const kept = await onPastDay({ driverId: 'drv-a' });
    const off = await onPastDay({ driverId: 'drv-a' });
    const draft = await onPastDay({ driverId: 'drv-b' });
    await assign(kept.id, yesterday);
    await assign(off.id, yesterday);
    await send('DELETE', `/api/assignments/${off.id}`, undefined, { NOW: '2026-11-18T16:00:00.000Z' });
    const before = await day('2026-11-18');
    expect(before.map((a) => a.cancelledAt)).toEqual([null, '2026-11-18T16:00:00.000Z', null]);
    await pastDay(await remove(kept.id));
    await pastDay(await send('POST', `/api/assignments/${off.id}/put-back`));
    await pastDay(await assign(draft.id));
    expect(await day('2026-11-18')).toEqual(before);
  });

  it.each(['2026-11-19', '2026-11-20'])('allow adding, changing and deleting on %s (today and tomorrow)', async (date) => {
    const { id } = await add({ date });
    const other = await add({ date });
    expect((await change(id, { note: 'changed' })).status).toBe(200);
    expect((await remove(other.id)).status).toBe(204);
    expect(await day(date)).toEqual([expect.objectContaining({ id, note: 'changed' })]);
  });

  // 03:30 UTC on 20 November is still 22:30 on the 19th in US Eastern; 05:01 UTC is just past midnight there.
  it('follow US Eastern time, not UTC, for which day is today', async () => {
    const lateEvening = { NOW: '2026-11-20T03:30:00.000Z' };
    const added = await send('POST', '/api/assignments', { date: '2026-11-19' }, lateEvening);
    expect(added.status).toBe(201);
    const { assignment } = (await added.json()) as { assignment: Assignment };
    expect((await change(assignment.id, { date: '2026-11-19', note: 'still today' }, lateEvening)).status).toBe(200);

    const afterMidnight = { NOW: '2026-11-20T05:01:00.000Z' };
    expect((await send('POST', '/api/assignments', { date: '2026-11-19' }, afterMidnight)).status).toBe(400);
    expect((await change(assignment.id, { date: '2026-11-19', note: 'now past' }, afterMidnight)).status).toBe(409);
    expect((await remove(assignment.id, afterMidnight)).status).toBe(409);
    expect((await remove(assignment.id, lateEvening)).status).toBe(204);
  });
});

/** Start from on a day: copies the latest earlier day with Assignments onto it. */
const startFrom = (date: string, vars = {}) => send('POST', `/api/days/${date}/start-from`, undefined, vars);
/** Copy to: copies a day onto another, empty one. */
const copyTo = (date: string, body: unknown, vars = {}) => send('POST', `/api/days/${date}/copy-to`, body, vars);
const copied = async (response: Response) => {
  expect(response.status).toBe(201);
  return ((await response.json()) as { assignments: Assignment[] }).assignments;
};
/** Adds an Assignment on a day before today, as if added back when that day was still to come. */
const addOn = async (date: string, body: object) =>
  ((await (await send('POST', '/api/assignments', { date, ...body }, { NOW: `${date}T15:00:00.000Z` })).json()) as { assignment: Assignment }).assignment;
/** What a copy is about: who, in what order, from where to where, hauling what, under whom, in which named Truck, and the note. */
const plan = (a: Assignment) => [a.driverId, a.position, a.fromPlaceId, a.toPlaceId, a.materialId, a.foremanId, a.truckId, a.note];

describe('Start from', () => {
  // The tests' clock says today is Thursday 2026-11-19; Monday 2026-11-23 is empty.
  it('copies the latest earlier day with Assignments onto an empty day, keeping Driver, order, Places, Material, Foreman and named Truck, and dropping notes', async () => {
    await addOn('2026-11-17', { driverId: 'drv-a', note: 'Older day' });
    await add({ date: '2026-11-19', driverId: 'drv-a', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-minus', foremanId: 'frm-a', truckId: 'trk-24', note: 'Haul stone' });
    await add({ date: '2026-11-19', driverId: 'drv-a', fromPlaceId: 'plc-north', toPlaceId: 'plc-yard' });
    await add({ date: '2026-11-19', driverId: 'drv-b', materialId: 'mat-dirt' });
    await add({ date: '2026-11-19', note: 'Unplanned' });
    await add({ date: '2026-11-24', driverId: 'drv-c', note: 'A later day is never copied' });

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map(plan)).toEqual([
      ['drv-a', 0, 'plc-plant', 'plc-north', 'mat-minus', 'frm-a', 'trk-24', null],
      ['drv-a', 1, 'plc-north', 'plc-yard', null, null, null, null],
      ['drv-b', 0, null, null, 'mat-dirt', null, null, null],
      [null, 0, null, null, null, null, null, null],
    ]);
    expect(created.every((a) => a.date === '2026-11-23')).toBe(true);
    expect(await day('2026-11-23')).toEqual(created);
  });

  it('keeps the order Dave set in each lane, with fresh positions 0, 1, 2…', async () => {
    const stone = await add({ date: '2026-11-19', driverId: 'drv-a', materialId: 'mat-stone' });
    await add({ date: '2026-11-19', driverId: 'drv-a', materialId: 'mat-dirt' });
    const minus = await add({ date: '2026-11-19', driverId: 'drv-a', materialId: 'mat-minus' });
    // Stone, dirt, minus becomes minus, stone, dirt.
    await send('POST', `/api/assignments/${minus.id}/move`, { direction: 'earlier' });
    await send('POST', `/api/assignments/${minus.id}/move`, { direction: 'earlier' });
    expect((await day('2026-11-19')).map((a) => [a.materialId, a.position])[0]).toEqual(['mat-minus', 0]);
    expect(stone.position).toBe(0);

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map((a) => [a.materialId, a.position])).toEqual([
      ['mat-minus', 0],
      ['mat-stone', 1],
      ['mat-dirt', 2],
    ]);
  });

  it('leaves cancelled Assignments behind, so a call-off is not planned again', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', materialId: 'mat-stone' });
    const off = await add({ date: '2026-11-19', driverId: 'drv-b', materialId: 'mat-dirt' });
    await assign(off.id);
    await remove(off.id);

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map((a) => [a.driverId, a.materialId, a.cancelledAt])).toEqual([['drv-a', 'mat-stone', null]]);
  });

  it('skips an earlier day whose Assignments are all cancelled, as it has nothing to copy', async () => {
    await addOn('2026-11-18', { driverId: 'drv-a', materialId: 'mat-stone' });
    const off = await add({ date: '2026-11-19', driverId: 'drv-b' });
    await assign(off.id);
    await remove(off.id);

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map((a) => [a.driverId, a.materialId])).toEqual([['drv-a', 'mat-stone']]);
  });

  it('leaves out Places, Materials, Trucks and Foremen removed since, keeping the rest of the Assignment', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-minus', foremanId: 'frm-a', truckId: 'trk-24' });
    await add({ date: '2026-11-19', driverId: 'drv-a', fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', materialId: 'mat-dirt', foremanId: 'frm-b', truckId: 'trk-27' });
    for (const removed of ['places/plc-north', 'materials/mat-minus', 'foremen/frm-a', 'trucks/trk-24']) {
      expect((await send('PATCH', `/api/${removed}`, { active: false })).status).toBe(200);
    }

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map(plan)).toEqual([
      ['drv-a', 0, 'plc-plant', null, null, null, null, null],
      ['drv-a', 1, null, 'plc-plant', 'mat-dirt', 'frm-b', 'trk-27', null],
    ]);
  });

  it('puts an Assignment whose Driver was removed in Unassigned, after the lane\'s own copies are numbered', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-b', materialId: 'mat-dirt' });
    await add({ date: '2026-11-19', driverId: 'drv-b', materialId: 'mat-stone' });
    await add({ date: '2026-11-19', materialId: 'mat-minus' });
    expect((await send('PATCH', '/api/drivers/drv-b', { active: false })).status).toBe(200);

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map((a) => [a.driverId, a.position, a.materialId])).toEqual([
      [null, 0, 'mat-dirt'],
      [null, 1, 'mat-stone'],
      [null, 2, 'mat-minus'],
    ]);
  });

  it('lands the copies on a Draft day, created now', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a' });
    const response = await startFrom('2026-11-23', { NOW: '2026-11-19T22:15:00.000Z' });
    const [one] = await copied(response.clone());
    expect(await response.json()).toMatchObject({ from: '2026-11-19', to: '2026-11-23' });
    expect(one).toMatchObject({ createdAt: '2026-11-19T22:15:00.000Z', updatedAt: '2026-11-19T22:15:00.000Z', changedAt: null, sinceSent: null });
  });

  it('makes only Drafts, even from Assigned work, with the Drivers as they were', async () => {
    const stone = await add({ date: '2026-11-19', driverId: 'drv-a' });
    await assign(stone.id);
    await add({ date: '2026-11-19', driverId: 'drv-b' });

    const created = await copied(await startFrom('2026-11-23'));

    expect(created.map((a) => [a.driverId, a.assignedAt, a.handedFromId, a.sinceSent])).toEqual([
      ['drv-a', null, null, null],
      ['drv-b', null, null, null],
    ]);
  });

  it('can start from an earlier day that is before today, and leaves that day as it was', async () => {
    await addOn('2026-11-18', { driverId: 'drv-a', note: 'Haul stone' });
    const before = await day('2026-11-18');
    expect((await copied(await startFrom('2026-11-19'))).map((a) => a.driverId)).toEqual(['drv-a']);
    expect(await day('2026-11-18')).toEqual(before);
  });

  it('makes ordinary Assignments that can be changed and taken off', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a' });
    await add({ date: '2026-11-19', driverId: 'drv-b' });
    const [first, second] = await copied(await startFrom('2026-11-23'));
    expect((await change(first.id, { driverId: 'drv-c', note: 'Changed' })).status).toBe(200);
    expect((await remove(second.id)).status).toBe(204);
    expect(await day('2026-11-23')).toEqual([expect.objectContaining({ id: first.id, driverId: 'drv-c', note: 'Changed' })]);
  });

  it('refuses a day that already has Assignments, cancelled ones included, and copies nothing', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a' });
    const off = await add({ date: '2026-11-23', driverId: 'drv-b' });
    await assign(off.id);
    await remove(off.id);
    const before = await day('2026-11-23');

    const response = await startFrom('2026-11-23');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'day_planned', message: 'That day already has Assignments, so nothing was copied onto it.' });
    expect(await day('2026-11-23')).toEqual(before);
  });

  it('refuses when no earlier day has Assignments to copy', async () => {
    await add({ date: '2026-11-24', driverId: 'drv-a' });
    const response = await startFrom('2026-11-23');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'nothing_to_copy', message: 'No earlier day has Assignments to start from.' });
    expect(await day('2026-11-23')).toEqual([]);
  });

  it.each([
    ['a day before today', '2026-11-18', 'Days before today are read-only. Pick today or a later day.'],
    ['a day not on the calendar', '2026-02-30', 'Pick a day to start.'],
    ['a day written another way', '23-11-2026', 'Pick a day to start.'],
  ])('refuses %s, with a message on the date, and copies nothing', async (_why, date, message) => {
    await addOn('2026-11-17', { driverId: 'drv-a' });
    expect(await refusal(await startFrom(date))).toEqual({ date: message });
    expect(await day('2026-11-18')).toEqual([]);
  });

  it('names the day it would copy, or none', async () => {
    const from = async (date: string) => (await (await get(`/api/days/${date}/start-from`)).json()) as { from: string | null };
    expect(await from('2026-11-23')).toEqual({ from: null });
    await addOn('2026-11-17', { driverId: 'drv-a' });
    await add({ date: '2026-11-19', driverId: 'drv-a' });
    expect(await from('2026-11-23')).toEqual({ from: '2026-11-19' });
    expect(await from('2026-11-19')).toEqual({ from: '2026-11-17' });
    expect(Object.keys(await refusal(await get('/api/days/2026-02-30/start-from')))).toEqual(['date']);
    expect((await send('DELETE', '/api/days/2026-11-23/start-from')).status).toBe(405);
  });

  /**
   * The copy names the columns it takes. The source fills every column of the
   * assignments table (a column a migration adds must be filled here, or this
   * fails), and every column outside the named list must come out as on a
   * new Assignment, so a later column is never copied by accident.
   */
  it('copies only the named columns: Driver, Truck, Places, Material and Foreman; the rest are as on a new Assignment', async () => {
    const first = await add({
      date: '2026-11-19', driverId: 'drv-a', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north',
      materialId: 'mat-minus', foremanId: 'frm-a', note: 'Haul stone',
    });
    await assign(first.id);
    // Handed over to Sample Driver B: the copy is Assigned and names the first one, so every column is filled.
    const handed = (await change(first.id, { driverId: 'drv-b' }, { NOW: '2026-11-19T20:30:00.000Z' }).then((r) => r.json())) as { assignment: Assignment };
    const source = handed.assignment;
    await change(source.id, { note: 'Haul stone, two loads' }, { NOW: '2026-11-19T20:45:00.000Z' });
    // Only a cancelled one is ever discarded or dismissed; set here anyway so the copy is seen to leave them.
    await d1.database().prepare("UPDATE assignments SET discarded_at = '2026-11-19T21:00:00.000Z', dismissed_at = '2026-11-19T21:00:00.000Z' WHERE id = ?").bind(source.id).run();
    const fresh = await add({ date: '2026-11-24' });
    const [copy] = await copied(await startFrom('2026-11-23'));

    const row = async (id: string) => (await d1.database().prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first<Record<string, unknown>>())!;
    const [from, to, added] = [await row(source.id), await row(copy.id), await row(fresh.id)];
    // Only an Assignment that is not cancelled is copied, so its cancelled time is always empty.
    const unfilled = Object.keys(from).filter((column) => from[column] == null && column !== 'cancelled_at');
    expect(unfilled, 'fill these columns in this test\'s source Assignment').toEqual([]);

    const copiedColumns = ['driver_id', 'truck_id', 'from_place_id', 'to_place_id', 'material_id', 'foreman_id'];
    const only = (r: Record<string, unknown>, keep: (column: string) => boolean) => Object.fromEntries(Object.entries(r).filter(([c]) => keep(c)));
    expect(only(to, (c) => copiedColumns.includes(c))).toEqual(only(from, (c) => copiedColumns.includes(c)));
    // Its own: a new id and day, made now, first in its lane.
    const own = ['id', 'date', 'created_at', 'updated_at', 'position'];
    expect(only(to, (c) => !copiedColumns.includes(c) && !own.includes(c))).toEqual(only(added, (c) => !copiedColumns.includes(c) && !own.includes(c)));
    expect(to).toMatchObject({ date: '2026-11-23', note: null, changed_at: null, cancelled_at: null, assigned_at: null, handed_from: null, position: 0 });
  });
});

describe('Copy to', () => {
  // The tests' clock says today is Thursday 2026-11-19; the next Working day is Friday 2026-11-20.
  it('copies a past day onto the next Working day while it is empty, by the same rules as Start from', async () => {
    await addOn('2026-11-17', { driverId: 'drv-a', materialId: 'mat-stone', note: 'Haul stone' });
    await addOn('2026-11-17', { driverId: 'drv-a', materialId: 'mat-dirt' });
    const off = await addOn('2026-11-17', { driverId: 'drv-b' });
    await assign(off.id, { NOW: '2026-11-17T15:00:00.000Z' });
    await send('DELETE', `/api/assignments/${off.id}`, undefined, { NOW: '2026-11-17T16:00:00.000Z' });

    const response = await copyTo('2026-11-17', { to: '2026-11-20' });
    const created = await copied(response.clone());

    expect(await response.json()).toMatchObject({ from: '2026-11-17', to: '2026-11-20' });
    expect(created.map((a) => [a.date, a.driverId, a.position, a.materialId, a.note])).toEqual([
      ['2026-11-20', 'drv-a', 0, 'mat-stone', null],
      ['2026-11-20', 'drv-a', 1, 'mat-dirt', null],
    ]);
    expect(await day('2026-11-20')).toEqual(created);
  });

  it('refuses a target day that already has Assignments, and copies nothing', async () => {
    await addOn('2026-11-17', { driverId: 'drv-a' });
    const already = await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Already planned' });
    const response = await copyTo('2026-11-17', { to: '2026-11-20' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe('day_planned');
    expect(await day('2026-11-20')).toEqual([already]);
  });

  it('refuses a day with nothing to copy, cancelled ones left out', async () => {
    const response = await copyTo('2026-11-17', { to: '2026-11-20' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'nothing_to_copy', message: 'That day has no Assignments to copy.' });
  });

  it.each([
    ['no target day', '2026-11-17', {}, { to: 'Pick a day to copy onto.' }],
    ['a target day before today', '2026-11-17', { to: '2026-11-18' }, { to: 'Days before today are read-only. Pick today or a later day.' }],
    ['a target day not on the calendar', '2026-11-17', { to: '2026-02-30' }, { to: 'Pick a day to copy onto.' }],
    ['a source day not on the calendar', '2026-02-30', { to: '2026-11-20' }, { date: 'Pick a day to copy.' }],
    ['a source day that is today', '2026-11-19', { to: '2026-11-20' }, { date: 'Copy to copies a day before today. Pick an earlier day.' }],
    ['a source day after today', '2026-11-20', { to: '2026-11-23' }, { date: 'Copy to copies a day before today. Pick an earlier day.' }],
  ])('refuses %s, with a message on it, and copies nothing', async (_why, from, body, fields) => {
    await addOn('2026-11-17', { driverId: 'drv-a' });
    expect(await refusal(await copyTo(from, body))).toEqual(fields);
    expect(await day('2026-11-18')).toEqual([]);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('refuses a body that is not JSON, and other methods; Copy today is gone', async () => {
    expect((await handle(new Request('https://td.example/api/days/2026-11-17/copy-to', { method: 'POST', body: 'x' }), env())).status).toBe(415);
    expect((await send('GET', '/api/days/2026-11-17/copy-to')).status).toBe(405);
    expect((await send('POST', '/api/assignments/copy', { to: '2026-11-20' })).status).toBe(405);
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
    expect(await response.json()).toMatchObject({ today, tomorrow });
  });

  // The board opens on the next Working day: a weekday that is not a Holiday.
  it.each([
    ['on a Thursday, the Friday', '2026-11-19T20:00:00Z', '2026-11-20'],
    ['on a Friday, the Monday', '2026-11-20T20:00:00Z', '2026-11-23'],
    ['late on a Friday in Eastern, already Saturday in UTC, still the Monday', '2026-11-21T03:30:00Z', '2026-11-23'],
    ['on a Saturday, the Monday', '2026-11-21T15:00:00Z', '2026-11-23'],
    ['on the day before Thanksgiving, the Friday after it', '2026-11-25T20:00:00Z', '2026-11-27'],
    ['on the Friday before Memorial Day, the Tuesday', '2026-05-22T20:00:00Z', '2026-05-26'],
  ])('gives the next Working day %s', async (_when, now, nextWorkingDay) => {
    const response = await handle(new Request('https://td.example/api/today'), env({ NOW: now }));
    expect(await response.json()).toMatchObject({ nextWorkingDay });
  });

  it.each(['not a moment', '2026-13-45'])('uses the real clock when NOW is set but is not a moment (%s)', async (now) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-25T15:00:00Z'));
      const response = await handle(new Request('https://td.example/api/today'), env({ NOW: now }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ today: '2026-11-25', tomorrow: '2026-11-26', nextWorkingDay: '2026-11-27' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('typed Place and Material names', () => {
  it('link to the active entry with that name, ignoring case, and create nothing, on add and on change', async () => {
    const before = { places: await list('/api/places?include=inactive'), materials: await list('/api/materials?include=inactive') };
    const added = await add({ date: '2026-11-20', fromPlaceName: 'sample plant', toPlaceName: 'SAMPLE SITE NORTH', materialName: '2" MINUS' });
    expect(added).toMatchObject({ fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-minus', materialName: '2" minus' });
    const changed = await change(added.id, { fromPlaceName: ' sample shop ', materialName: 'sample dirt' });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { assignment: Assignment })).toMatchObject({ assignment: { fromPlaceId: 'plc-shop', toPlaceId: 'plc-north', materialId: 'mat-dirt' } });
    expect(await list('/api/places?include=inactive')).toEqual(before.places);
    expect(await list('/api/materials?include=inactive')).toEqual(before.materials);
  });

  it('bring back a removed entry with that name and link to it', async () => {
    await send('PATCH', '/api/places/plc-yard', { active: false });
    await send('PATCH', '/api/materials/mat-stone', { active: false });
    const added = await add({ date: '2026-11-20', toPlaceName: 'sample yard', materialName: 'Sample Stone' });
    expect(added).toMatchObject({ toPlaceId: 'plc-yard', toPlaceName: 'Sample Yard', materialId: 'mat-stone' });
    expect(await list('/api/places')).toContainEqual(expect.objectContaining({ id: 'plc-yard', active: true }));
    expect(await list('/api/materials')).toContainEqual(expect.objectContaining({ id: 'mat-stone', active: true }));
  });

  it('add a new entry, a Place with no kind, and link to it, on add and on change', async () => {
    const added = await add({ date: '2026-11-20', fromPlaceName: ' Sample Pit ', materialName: 'Sample Fill' });
    expect(added).toMatchObject({ fromPlaceName: 'Sample Pit', materialName: 'Sample Fill' });
    expect(await list('/api/places')).toContainEqual({ id: added.fromPlaceId, shortName: 'Sample Pit', fullName: null, kind: null, jobId: null, usualForemanId: null, geofenceCode: null, onTruckMap: false, sortOrder: 5, active: true });
    expect(await list('/api/materials')).toContainEqual({ id: added.materialId, name: 'Sample Fill', sortOrder: 4, active: true });

    const changed = await change(added.id, { toPlaceName: 'Sample Dump', materialId: null });
    const { assignment } = (await changed.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ fromPlaceName: 'Sample Pit', toPlaceName: 'Sample Dump', materialId: null });
    expect(await list('/api/places')).toContainEqual(expect.objectContaining({ id: assignment.toPlaceId, shortName: 'Sample Dump', kind: null }));
  });

  it('add one Place when From and To type the same new name, in any case', async () => {
    const added = await add({ date: '2026-11-20', fromPlaceName: 'Sample Pit', toPlaceName: 'SAMPLE PIT' });
    expect(added.toPlaceId).toBe(added.fromPlaceId);
    expect((await list('/api/places')).filter((p) => String(p.shortName).toLowerCase() === 'sample pit')).toHaveLength(1);
  });

  const typed = (value: unknown) => ({ fromPlaceName: value, toPlaceName: value, materialName: value });

  it('refuse a blank name, with a message on each field, on add and on change', async () => {
    const blank = { fromPlaceName: 'Write the Place\'s name.', toPlaceName: 'Write the Place\'s name.', materialName: 'Write the Material\'s name.' };
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...typed('  ') }))).toEqual(blank);
    const assignment = await add({ date: '2026-11-20' });
    expect(await refusal(await change(assignment.id, typed('')))).toEqual(blank);
  });

  it('refuse a name over 100 characters, or not text, with a message on each field', async () => {
    const long = 'Keep it to 100 characters or fewer.';
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...typed('x'.repeat(101)) }))).toEqual(typed(long));
    expect((await post('/api/assignments', { date: '2026-11-20', materialName: 'x'.repeat(100) })).status).toBe(201);
    const notText = { fromPlaceName: 'Write the Place\'s name.', toPlaceName: 'Write the Place\'s name.', materialName: 'Write the Material\'s name.' };
    expect(await refusal(await post('/api/assignments', { date: '2026-11-20', ...typed(7) }))).toEqual(notText);
  });

  it('refuse a name given alongside an id for the same field, with a message on the name', async () => {
    const fields = await refusal(await post('/api/assignments', { date: '2026-11-20', fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Pit', materialId: 'mat-dirt', materialName: 'Sample Dirt' }));
    expect(fields).toEqual({
      fromPlaceName: 'Pick a Place from the list or write its name, not both.',
      materialName: 'Pick a Material from the list or write its name, not both.',
    });
  });

  it('add or bring back nothing when the Assignment is refused', async () => {
    await send('PATCH', '/api/places/plc-yard', { active: false });
    const before = { places: await list('/api/places?include=inactive'), materials: await list('/api/materials?include=inactive') };
    const refused = { fromPlaceName: 'Sample Pit', toPlaceName: 'Sample Yard', materialName: 'Sample Fill', driverId: 'nobody' };
    expect(Object.keys(await refusal(await post('/api/assignments', { date: '2026-11-20', ...refused })))).toEqual(['driverId']);
    expect(Object.keys(await refusal(await post('/api/assignments', { date: '2026-11-18', ...refused, driverId: null })))).toEqual(['date']);
    expect(await list('/api/places?include=inactive')).toEqual(before.places);
    expect(await list('/api/materials?include=inactive')).toEqual(before.materials);
  });

  it('add or bring back nothing when saving the Assignment itself fails', async () => {
    await send('PATCH', '/api/materials/mat-stone', { active: false });
    const before = { places: await list('/api/places?include=inactive'), materials: await list('/api/materials?include=inactive') };
    const db = d1.database();
    const failing = new Proxy(db, {
      get: (target, key) => key === 'prepare'
        ? (sql: string) => target.prepare(/^\s*INSERT INTO assignments\b/.test(sql) ? sql.replace('assignments', 'no_such_table') : sql)
        : Reflect.get(target, key, target),
    });
    await expect(send('POST', '/api/assignments', { date: '2026-11-20', fromPlaceName: 'Sample Pit', materialName: 'Sample Stone' }, { DB: failing })).rejects.toThrow();
    expect(await list('/api/places?include=inactive')).toEqual(before.places);
    expect(await list('/api/materials?include=inactive')).toEqual(before.materials);
  });

  it('link to the entry another request added with the same name after the lookup, rather than failing', async () => {
    const db = d1.database();
    let raced = false;
    const racing = new Proxy(db, {
      get: (target, key) => key === 'batch'
        ? async (statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await post('/api/places', { shortName: 'Sample Pit' });
          }
          return target.batch(statements);
        }
        : Reflect.get(target, key, target),
    });
    const response = await send('POST', '/api/assignments', { date: '2026-11-20', fromPlaceName: 'sample pit' }, { DB: racing });
    expect(response.status).toBe(201);
    const { assignment } = (await response.json()) as { assignment: Assignment };
    const pits = (await list('/api/places')).filter((p) => p.shortName === 'Sample Pit');
    expect(pits).toHaveLength(1);
    expect(assignment.fromPlaceId).toBe(pits[0].id);
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

  it('names the commit on every API answer, also under the prefix and for unknown routes', async () => {
    for (const path of ['/api/today', '/truck-dispatch/api/drivers', '/api/no-such-route']) {
      const response = await handle(new Request(`https://td.example${path}`), env({ COMMIT_SHA: 'abc123' }));
      expect(response.headers.get('X-Commit')).toBe('abc123');
    }
    const local = await handle(new Request('https://td.example/api/today'), env());
    expect(local.headers.get('X-Commit')).toBeNull();
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
