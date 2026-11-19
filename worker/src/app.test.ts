import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { Assignment } from '../../shared/types';

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

const send = (method: string, path: string, body?: unknown, vars: Parameters<typeof env>[0] = {}) =>
  handle(
    new Request(`https://td.example${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    env(vars),
  );
const change = (id: string, body: unknown, vars = {}) => send('PUT', `/api/assignments/${id}`, body, vars);
const remove = (id: string, vars = {}) => send('DELETE', `/api/assignments/${id}`, undefined, vars);

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


describe('changing an Assignment', () => {
  it('saves every field and the day shows the change', async () => {
    const { id } = await add({ date: '2026-11-20', note: 'Haul stone' });
    const response = await change(id, { date: '2026-11-20', driverId: 'drv-a', note: 'Haul topsoil' });
    expect(response.status).toBe(200);
    const { assignment } = (await response.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ id, date: '2026-11-20', driverId: 'drv-a', driverName: 'Sample Driver A', note: 'Haul topsoil' });
    expect(await day('2026-11-20')).toEqual([assignment]);
  });

  it('clears a field that was set', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await change(id, { date: '2026-11-20', driverId: null, note: '' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, driverId: null, driverName: null, note: null })]);
  });

  it('moves it to another Driver', async () => {
    const { id } = await add({ date: '2026-11-20', driverId: 'drv-a' });
    await change(id, { date: '2026-11-20', driverId: 'drv-b' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, driverId: 'drv-b', driverName: 'Sample Driver B' })]);
  });

  it('moves it to another day', async () => {
    const { id } = await add({ date: '2026-11-20', note: 'Haul stone' });
    await change(id, { date: '2026-11-23', note: 'Haul stone' });
    expect(await day('2026-11-20')).toEqual([]);
    expect(await day('2026-11-23')).toEqual([expect.objectContaining({ id, note: 'Haul stone' })]);
  });

  it('updates the updated time and keeps the created time', async () => {
    const { id } = await add({ date: '2026-11-20' });
    const response = await change(id, { date: '2026-11-20', note: 'Later' }, { NOW: '2026-11-19T22:15:00.000Z' });
    const { assignment } = (await response.json()) as { assignment: Assignment };
    expect(assignment).toMatchObject({ createdAt: '2026-11-19T20:00:00.000Z', updatedAt: '2026-11-19T22:15:00.000Z' });
  });

  it('refuses wrong fields as adding does, and leaves the Assignment as it was', async () => {
    const { id } = await add({ date: '2026-11-20', note: 'Haul stone' });
    const fields = await refusal(await change(id, { date: 'soon', driverId: 'nobody', note: 'x'.repeat(1001) }));
    expect(Object.keys(fields).sort()).toEqual(['date', 'driverId', 'note']);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id, note: 'Haul stone' })]);
  });

  it('answers not found for an Assignment that does not exist', async () => {
    expect((await change('nothing', { date: '2026-11-20' })).status).toBe(404);
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

describe('past days', () => {
  // The tests' clock says today is 2026-11-19 in US Eastern.
  const pastDay = (response: Response) => {
    expect(response.status).toBe(409);
    return response.json();
  };
  /** An Assignment already on a past day, as if added back when that day was still to come. */
  const onPastDay = async () =>
    (
      (await (await send('POST', '/api/assignments', { date: '2026-11-18', note: 'yesterday' }, { NOW: '2026-11-18T15:00:00.000Z' })).json()) as {
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

  it('refuse moving an Assignment into a past day, with a message on the date', async () => {
    const { id } = await add({ date: '2026-11-20' });
    const fields = await refusal(await change(id, { date: '2026-11-18' }));
    expect(fields).toEqual({ date: 'Days before today are read-only. Pick today or a later day.' });
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id })]);
  });

  it('refuse deleting an Assignment on a past day', async () => {
    const past = await onPastDay();
    await pastDay(await remove(past.id));
    expect(await day('2026-11-18')).toEqual([past]);
  });

  it.each(['2026-11-19', '2026-11-20'])('allow adding, changing, moving and deleting on %s (today and tomorrow)', async (date) => {
    const { id } = await add({ date });
    expect((await change(id, { date, note: 'changed' })).status).toBe(200);
    const other = await add({ date: date === '2026-11-19' ? '2026-11-20' : '2026-11-19' });
    expect((await change(other.id, { date })).status).toBe(200);
    expect((await remove(id)).status).toBe(204);
    expect((await day(date)).map((a) => a.id)).toEqual([other.id]);
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

const copy = (body: unknown, vars = {}) => send('POST', '/api/assignments/copy', body, vars);
const copied = async (response: Response) => {
  expect(response.status).toBe(201);
  return ((await response.json()) as { assignments: Assignment[] }).assignments;
};

describe('copying a day', () => {
  // The tests' clock says today is 2026-11-19 in US Eastern.
  it('creates one new Assignment on the target day for each on the source day, with every field but the note', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-b', note: 'Haul stone' });
    await add({ date: '2026-11-19', note: 'Unplanned' });
    await add({ date: '2026-11-19', driverId: 'drv-a' });

    const created = await copied(await copy({ from: '2026-11-19', to: '2026-11-21' }));

    expect(created).toEqual([
      expect.objectContaining({ date: '2026-11-21', driverId: 'drv-a', driverName: 'Sample Driver A', note: null }),
      expect.objectContaining({ date: '2026-11-21', driverId: 'drv-b', driverName: 'Sample Driver B', note: null }),
      expect.objectContaining({ date: '2026-11-21', driverId: null, driverName: null, note: null }),
    ]);
    expect(await day('2026-11-21')).toEqual(created);
  });

  it('leaves the source day as it was', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-b', note: 'Haul stone' });
    const before = await day('2026-11-19');
    await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));
    expect(await day('2026-11-19')).toEqual(before);
  });

  it('adds to what the target day already has, and copying twice creates the Assignments twice', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', note: 'Haul stone' });
    const already = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Already planned' });
    await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));
    await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));
    const target = await day('2026-11-20');
    expect(target.map((a) => a.note)).toEqual(['Already planned', null, null]);
    expect(target[0]).toEqual(already);
    expect(new Set(target.map((a) => a.id)).size).toBe(3);
  });

  it('creates nothing when the source day has no Assignments', async () => {
    expect(await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }))).toEqual([]);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('records the copies as created and updated now', async () => {
    await add({ date: '2026-11-19' });
    const [one] = await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }, { NOW: '2026-11-19T22:15:00.000Z' }));
    expect(one).toMatchObject({ createdAt: '2026-11-19T22:15:00.000Z', updatedAt: '2026-11-19T22:15:00.000Z' });
  });

  it('refuses copying onto a day before today, with a message on the target day, and creates nothing', async () => {
    await add({ date: '2026-11-19', note: 'Haul stone' });
    const fields = await refusal(await copy({ from: '2026-11-19', to: '2026-11-18' }));
    expect(fields).toEqual({ to: 'Days before today are read-only. Pick today or a later day.' });
    expect(await day('2026-11-18')).toEqual([]);
  });

  it('allows copying onto today', async () => {
    await add({ date: '2026-11-20', note: 'Haul stone' });
    expect(await copied(await copy({ from: '2026-11-20', to: '2026-11-19' }))).toHaveLength(1);
  });

  it.each([
    ['no days', {}, ['from', 'to']],
    ['a source day that is not on the calendar', { from: '2026-02-30', to: '2026-11-20' }, ['from']],
    ['a target day written another way', { from: '2026-11-19', to: '20-11-2026' }, ['to']],
  ])('refuses %s, with a message on each', async (_why, body, wrong) => {
    expect(Object.keys(await refusal(await copy(body))).sort()).toEqual(wrong);
  });

  it('refuses a body that is not JSON, and other methods', async () => {
    expect((await handle(new Request('https://td.example/api/assignments/copy', { method: 'POST', body: 'x' }), env())).status).toBe(415);
    expect((await send('GET', '/api/assignments/copy')).status).toBe(405);
  });

  it('makes ordinary Assignments that can be changed and deleted', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-19', driverId: 'drv-b' });
    const [first, second] = await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));
    expect((await change(first.id, { date: '2026-11-20', driverId: 'drv-c', note: 'Changed' })).status).toBe(200);
    expect((await remove(second.id)).status).toBe(204);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id: first.id, driverId: 'drv-c', note: 'Changed' })]);
  });

  /**
   * Guards later fields: the source fills every column of the assignments
   * table, so a column a migration adds must be filled here (or this fails),
   * and the copy must then carry it.
   */
  it('carries every column of the assignments table except id, date, note and the times', async () => {
    const source = await add({ date: '2026-11-19', driverId: 'drv-b', truckId: 'trk-24', note: 'Haul stone' });
    const [copy1] = await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));

    const row = (id: string) => d1.database().prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first<Record<string, unknown>>();
    const [from, to] = [await row(source.id), await row(copy1.id)];
    const unfilled = Object.keys(from!).filter((column) => from![column] == null);
    expect(unfilled, 'fill these columns in this test\'s source Assignment').toEqual([]);

    const notCopied = ['id', 'date', 'note', 'created_at', 'updated_at'];
    const carried = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([c]) => !notCopied.includes(c)));
    expect(carried(to!)).toEqual(carried(from!));
    expect(to).toMatchObject({ date: '2026-11-20', note: null });
    expect(Object.keys(carried(from!)).length).toBeGreaterThan(0);
  });

  it('copies an Assignment whose Truck was made inactive since, keeping the Truck, and the copy can be saved again', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', truckId: 'trk-21', note: 'Haul stone' });
    await send('PATCH', '/api/trucks/trk-21', { active: false });
    const [copy1] = await copied(await copy({ from: '2026-11-19', to: '2026-11-20' }));
    expect(copy1).toMatchObject({ date: '2026-11-20', truckId: 'trk-21', truckNumber: '21' });

    const saved = await change(copy1.id, { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-21', note: 'Only the note' });
    expect(saved.status).toBe(200);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id: copy1.id, truckNumber: '21', note: 'Only the note' })]);
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
