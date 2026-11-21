import { describe, expect, it, vi } from 'vitest';
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
    expect(await day.json()).toEqual({ assignments: [assignment], sentAt: null });
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
      ['changedAt', 'createdAt', 'date', 'driverId', 'driverName', 'foremanId', 'foremanName', 'fromPlaceId', 'fromPlaceName', 'id', 'materialId', 'materialName', 'note', 'position', 'sinceSent', 'toPlaceId', 'toPlaceName', 'truckId', 'truckNumber', 'updatedAt'],
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

type Entry = { id: string; active: boolean } & Record<string, unknown>;
const list = async (path: string) => {
  const response = await get(path);
  expect(response.status).toBe(200);
  return Object.values((await response.json()) as Record<string, Entry[]>)[0];
};

/**
 * The tests' D1, except that another request (`other`) runs just before the
 * first write to `table`: after this request has checked, before it writes.
 */
const racedBy = (table: string, other: () => Promise<unknown>): D1Database => {
  const db = d1.database();
  let raced = false;
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = db.prepare(sql);
    if (raced || !new RegExp(`^\\s*(INSERT INTO|UPDATE) ${table}\\b`).test(sql)) return statement;
    raced = true;
    const bind = (...values: unknown[]) => {
      const bound = statement.bind(...values);
      return Object.assign(Object.create(bound) as D1PreparedStatement, {
        run: async () => {
          await other();
          return bound.run();
        },
      });
    };
    return Object.assign(Object.create(statement) as D1PreparedStatement, { bind });
  };
  return new Proxy(db, { get: (target, key) => (key === 'prepare' ? prepare : Reflect.get(target, key, target)) });
};

// Every list behaves the same way; each is named by its display field.
describe.each([
  { route: 'drivers', one: 'driver', name: 'name', seeded: 'drv-a', seededName: 'Sample Driver A', fresh: 'Sample Driver D' },
  { route: 'trucks', one: 'truck', name: 'number', seeded: 'trk-21', seededName: '21', fresh: '30' },
  { route: 'jobs', one: 'job', name: 'name', seeded: 'job-n', seededName: 'Sample Job North', fresh: 'Sample Job East' },
  { route: 'places', one: 'place', name: 'shortName', seeded: 'plc-plant', seededName: 'Sample Plant', fresh: 'Sample Pit' },
  { route: 'materials', one: 'material', name: 'name', seeded: 'mat-minus', seededName: '2" minus', fresh: 'Sample Fill' },
  { route: 'foremen', one: 'foreman', name: 'name', seeded: 'frm-a', seededName: 'Sample Foreman A', fresh: 'Sample Foreman D' },
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

  it('refuses a name another request saved after the check, with the same message, rather than failing', async () => {
    const { [name]: taken } = await refusal(await post(`/api/${route}`, { [name]: seededName }));
    const added = await send('POST', `/api/${route}`, { [name]: fresh }, { DB: racedBy(route, () => post(`/api/${route}`, { [name]: fresh })) });
    expect(await refusal(added)).toEqual({ [name]: taken });
    const other = `${fresh} 2`;
    const renamed = await send('PATCH', `/api/${route}/${seeded}`, { [name]: other }, { DB: racedBy(route, () => post(`/api/${route}`, { [name]: other })) });
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
  it('list the seeded Places by short name, with full name, kind, Job and whether each is on the truck map, and no geofence code', async () => {
    const places = await list('/api/places');
    expect(places.map((p) => p.shortName)).toEqual(['Sample Plant', 'Sample Shop', 'Sample Site North', 'Sample Yard']);
    expect(places[2]).toEqual({ id: 'plc-north', shortName: 'Sample Site North', fullName: 'Sample Job North site', kind: 'job_site', jobId: 'job-n', usualForemanId: null, onTruckMap: false, active: true });
    expect(places.map((p) => p.onTruckMap)).toEqual([true, false, false, false]);
    for (const place of places) expect(Object.keys(place)).not.toContain('geofenceCode');
  });

  it('are not on the truck map when added, and cannot be put on it from Settings', async () => {
    const { place } = (await (await post('/api/places', { shortName: 'Sample Pit', onTruckMap: true })).json()) as { place: Entry };
    expect(place.onTruckMap).toBe(false);
    const changed = await send('PATCH', `/api/places/${place.id}`, { onTruckMap: true });
    expect(((await changed.json()) as { place: Entry }).place.onTruckMap).toBe(false);
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
      { id: 'mat-minus', name: '2" minus', active: true },
      { id: 'mat-dirt', name: 'Sample Dirt', active: true },
      { id: 'mat-stone', name: 'Sample Stone', active: true },
    ]);
    expect((await list('/api/foremen')).map((f) => f.name)).toEqual(['Sample Foreman A', 'Sample Foreman B', 'Sample Foreman C']);
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
    const second = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil run' });
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
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil run' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Two loads' });
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone', 'Sample Driver A: Two loads', 'Sample Driver B: Topsoil run', 'Unassigned: Who takes this?']);
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
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil run' });
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Fill the shop' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    const response = await change(moved.id, { date: '2026-11-20', driverId: 'drv-b', note: 'Haul stone' });
    expect(((await response.json()) as { assignment: Assignment }).assignment.position).toBe(2);
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver B: Topsoil run', 'Sample Driver B: Fill the shop', 'Sample Driver B: Haul stone']);
  });

  it('puts an Assignment taken off its Driver last in the Unassigned lane', async () => {
    await add({ date: '2026-11-20', note: 'Who takes this?' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await change(moved.id, { date: '2026-11-20', driverId: null, note: 'Haul stone' });
    expect(await lanes('2026-11-20')).toEqual(['Unassigned: Who takes this?', 'Unassigned: Haul stone']);
  });

  it('keeps an Assignment in its place when a change leaves its Driver as it was', async () => {
    const first = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil run' });
    await change(first.id, { date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone, two loads' });
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone, two loads', 'Sample Driver A: Topsoil run']);
  });

  it('leaves the order and the changed time alone when the same Driver is sent again', async () => {
    const first = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Topsoil run' });
    const response = await change(first.id, { driverId: 'drv-a' }, { NOW: '2026-11-19T22:15:00.000Z' });
    expect(((await response.json()) as { assignment: Assignment }).assignment).toEqual(first);
    expect(await lanes('2026-11-20')).toEqual(['Sample Driver A: Haul stone', 'Sample Driver A: Topsoil run']);
  });

  it('records a change on the Assignment that moved lanes, not on the ones it moved past', async () => {
    await add({ date: '2026-11-20', driverId: 'drv-b', note: 'Topsoil run' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Fill the shop' });
    const moved = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Haul stone' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Two loads' });
    await change(moved.id, { driverId: 'drv-b' });
    const changed = Object.fromEntries((await day('2026-11-20')).map((a) => [a.note, a.changedAt !== null]));
    expect(changed).toEqual({ 'Topsoil run': false, 'Haul stone': true, 'Fill the shop': false, 'Two loads': false });
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

describe('sending a day', () => {
  // Today is Thursday 2026-11-19; Dave plans Friday 2026-11-20 and Sends it at 4:15 PM Eastern.
  const PLANNED = { NOW: '2026-11-19T20:00:00.000Z' };
  const SENT = '2026-11-19T21:15:00.000Z';
  const LATER = { NOW: '2026-11-19T22:00:00.000Z' };
  const sendDay = (date: string, vars: Parameters<typeof env>[0] = { NOW: SENT }) => send('POST', `/api/days/${date}/send`, undefined, vars);
  const read = async (date: string) => (await (await get(`/api/assignments?date=${date}`)).json()) as { assignments: Assignment[]; sentAt: string | null };
  const addAt = async (body: unknown, vars: Parameters<typeof env>[0]) =>
    ((await (await send('POST', '/api/assignments', body, vars)).json()) as { assignment: Assignment }).assignment;
  const marks = async (date: string) => Object.fromEntries((await day(date)).map((a) => [a.note, a.sinceSent]));
  /** The earlier fields kept for an Assignment, oldest first. No route reads them yet; the Driver view will. */
  const earlier = async (id: string) =>
    (
      await d1.database().prepare('SELECT changed_at AS changedAt, before FROM assignment_changes WHERE assignment_id = ? ORDER BY changed_at').bind(id).all<{ changedAt: string; before: string }>()
    ).results.map((row) => ({ changedAt: row.changedAt, before: JSON.parse(row.before) }));

  it('starts every day as a Draft, with no sent time and nothing marked', async () => {
    await add({ date: '2026-11-20', note: 'Haul stone' });
    const { sentAt, assignments } = await read('2026-11-20');
    expect(sentAt).toBeNull();
    expect(assignments.map((a) => a.sinceSent)).toEqual([null]);
  });

  it('records the first Send of a day, and the day then carries its sent time', async () => {
    await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    const response = await sendDay('2026-11-20');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: '2026-11-20', sentAt: SENT });
    expect((await read('2026-11-20')).sentAt).toBe(SENT);
    expect((await read('2026-11-23')).sentAt).toBeNull();
  });

  it('does nothing when the day is Sent again: it keeps its first sent time', async () => {
    await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await sendDay('2026-11-20');
    const again = await sendDay('2026-11-20', LATER);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ date: '2026-11-20', sentAt: SENT });
    expect((await read('2026-11-20')).sentAt).toBe(SENT);
  });

  it('can Send today', async () => {
    await add({ date: '2026-11-19', note: 'Haul stone' });
    expect((await sendDay('2026-11-19')).status).toBe(200);
  });

  it.each([
    ['not a real date', '2026-02-30'],
    ['written another way', '20-11-2026'],
    ['a day before today', '2026-11-18'],
  ])('refuses a date that is %s, with a message on the date', async (_why, date) => {
    const fields = await refusal(await sendDay(date));
    expect(Object.keys(fields)).toEqual(['date']);
    expect(fields.date).toBeTruthy();
  });

  it('refuses a day with no Assignments, which stays a Draft', async () => {
    await add({ date: '2026-11-23', note: 'Another day' });
    const response = await sendDay('2026-11-20');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'nothing_to_send', message: expect.any(String) });
    expect((await read('2026-11-20')).sentAt).toBeNull();
  });

  it('only Sends with POST', async () => {
    const response = await send('GET', '/api/days/2026-11-20/send');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('marks an Assignment changed after the Send Changed, and leaves the rest alone', async () => {
    const stone = await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await addAt({ date: '2026-11-20', note: 'Fill the shop' }, PLANNED);
    await sendDay('2026-11-20');
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': null, 'Fill the shop': null });
    await change(stone.id, { materialId: 'mat-stone' }, LATER);
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': 'changed', 'Fill the shop': null });
  });

  it('marks an Assignment added after the Send Added, also in the answer that adds it', async () => {
    await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await sendDay('2026-11-20');
    const added = await addAt({ date: '2026-11-20', note: 'Two more loads' }, LATER);
    expect(added.sinceSent).toBe('added');
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': null, 'Two more loads': 'added' });
  });

  it('does not mark what changed before the Send', async () => {
    const stone = await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await change(stone.id, { driverId: 'drv-a' }, { NOW: '2026-11-19T20:30:00.000Z' });
    await sendDay('2026-11-20');
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone': null });
  });

  it('keeps an Assignment\'s fields as they were before each change after the Send', async () => {
    const stone = await addAt(
      { date: '2026-11-20', driverId: 'drv-a', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', materialId: 'mat-stone', foremanId: 'frm-a', note: 'Haul stone' },
      PLANNED,
    );
    await sendDay('2026-11-20');
    await change(stone.id, { materialId: 'mat-dirt', note: 'Haul dirt' }, LATER);
    await change(stone.id, { toPlaceName: 'Sample New Pit' }, { NOW: '2026-11-19T23:00:00.000Z' });
    expect(await earlier(stone.id)).toEqual([
      {
        changedAt: LATER.NOW,
        before: {
          driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-24', truckNumber: '24',
          fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North',
          materialId: 'mat-stone', materialName: 'Sample Stone', foremanId: 'frm-a', foremanName: 'Sample Foreman A',
          note: 'Haul stone', position: 0,
        },
      },
      {
        changedAt: '2026-11-19T23:00:00.000Z',
        before: expect.objectContaining({ toPlaceId: 'plc-north', toPlaceName: 'Sample Site North', materialName: 'Sample Dirt', note: 'Haul dirt' }),
      },
    ]);
  });

  it('keeps nothing for changes on a Draft day, or for a change that changes nothing', async () => {
    const stone = await addAt({ date: '2026-11-20', note: 'Haul stone', materialId: 'mat-stone' }, PLANNED);
    await change(stone.id, { note: 'Haul stone, two loads' }, PLANNED);
    await sendDay('2026-11-20');
    await change(stone.id, { note: 'Haul stone, two loads', materialId: 'mat-stone' }, LATER);
    expect(await earlier(stone.id)).toEqual([]);
    expect(await marks('2026-11-20')).toEqual({ 'Haul stone, two loads': null });
  });

  it('still deletes an Assignment that has earlier fields kept', async () => {
    const stone = await addAt({ date: '2026-11-20', note: 'Haul stone' }, PLANNED);
    await sendDay('2026-11-20');
    await change(stone.id, { note: 'Haul dirt' }, LATER);
    expect((await remove(stone.id, LATER)).status).toBe(204);
    expect(await day('2026-11-20')).toEqual([]);
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

    const created = await copied(await copy({ to: '2026-11-21' }));

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
    await copied(await copy({ to: '2026-11-20' }));
    expect(await day('2026-11-19')).toEqual(before);
  });

  it('adds to what the target day already has, and copying twice creates the Assignments twice', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', note: 'Haul stone' });
    const already = await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Already planned' });
    await copied(await copy({ to: '2026-11-20' }));
    await copied(await copy({ to: '2026-11-20' }));
    const target = await day('2026-11-20');
    expect(target.map((a) => a.note)).toEqual(['Already planned', null, null]);
    expect(target[0]).toEqual(already);
    expect(new Set(target.map((a) => a.id)).size).toBe(3);
  });

  it('creates nothing when the source day has no Assignments', async () => {
    expect(await copied(await copy({ to: '2026-11-20' }))).toEqual([]);
    expect(await day('2026-11-20')).toEqual([]);
  });

  it('records the copies as created and updated now', async () => {
    await add({ date: '2026-11-19' });
    const [one] = await copied(await copy({ to: '2026-11-20' }, { NOW: '2026-11-19T22:15:00.000Z' }));
    expect(one).toMatchObject({ createdAt: '2026-11-19T22:15:00.000Z', updatedAt: '2026-11-19T22:15:00.000Z' });
  });

  it('refuses copying onto a day before today, with a message on the target day, and creates nothing', async () => {
    await add({ date: '2026-11-19', note: 'Haul stone' });
    const fields = await refusal(await copy({ to: '2026-11-18' }));
    expect(fields).toEqual({ to: 'Days before today are read-only. Pick today or a later day.' });
    expect(await day('2026-11-18')).toEqual([]);
  });

  it('refuses copying today onto itself, and creates nothing', async () => {
    await add({ date: '2026-11-19', note: 'Haul stone' });
    const fields = await refusal(await copy({ to: '2026-11-19' }));
    expect(fields).toEqual({ to: 'Today cannot be copied onto itself. Pick a later day.' });
    expect(await day('2026-11-19')).toHaveLength(1);
  });

  it('copies from today by the Worker\'s clock, never a day the page sends', async () => {
    await add({ date: '2026-11-19', note: 'Yesterday by now' });
    await add({ date: '2026-11-20', driverId: 'drv-a', note: 'Today by now' });
    const afterMidnight = { NOW: '2026-11-20T05:01:00.000Z' };
    // A page left open since yesterday still thinks today is 2026-11-19.
    const created = await copied(await copy({ from: '2026-11-19', to: '2026-11-22' }, afterMidnight));
    expect(created).toEqual([expect.objectContaining({ date: '2026-11-22', driverId: 'drv-a', note: null })]);
  });

  it.each([
    ['no day', {}, ['to']],
    ['a target day that is not on the calendar', { to: '2026-02-30' }, ['to']],
    ['a target day written another way', { to: '20-11-2026' }, ['to']],
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
    const [first, second] = await copied(await copy({ to: '2026-11-20' }));
    expect((await change(first.id, { date: '2026-11-20', driverId: 'drv-c', note: 'Changed' })).status).toBe(200);
    expect((await remove(second.id)).status).toBe(204);
    expect(await day('2026-11-20')).toEqual([expect.objectContaining({ id: first.id, driverId: 'drv-c', note: 'Changed' })]);
  });

  /**
   * Guards later fields: the source fills every column of the assignments
   * table, so a column a migration adds must be filled here (or this fails),
   * and the copy must then carry it.
   */
  it('carries every column of the assignments table except id, date, note and the times (a copy is not changed yet)', async () => {
    const source = await add({
      date: '2026-11-19', driverId: 'drv-b', truckId: 'trk-24', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north',
      materialId: 'mat-minus', foremanId: 'frm-a', note: 'Haul stone',
    });
    await change(source.id, { note: 'Haul stone, two loads' });
    const [copy1] = await copied(await copy({ to: '2026-11-20' }));

    const row = (id: string) => d1.database().prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first<Record<string, unknown>>();
    const [from, to] = [await row(source.id), await row(copy1.id)];
    const unfilled = Object.keys(from!).filter((column) => from![column] == null);
    expect(unfilled, 'fill these columns in this test\'s source Assignment').toEqual([]);

    const notCopied = ['id', 'date', 'note', 'created_at', 'updated_at', 'changed_at'];
    const carried = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([c]) => !notCopied.includes(c)));
    expect(carried(to!)).toEqual(carried(from!));
    expect(to).toMatchObject({ date: '2026-11-20', note: null, changed_at: null });
    expect(Object.keys(carried(from!)).length).toBeGreaterThan(0);
  });

  it('copies an Assignment whose Truck was made inactive since, keeping the Truck, and the copy can be saved again', async () => {
    await add({ date: '2026-11-19', driverId: 'drv-a', truckId: 'trk-21', note: 'Haul stone' });
    await send('PATCH', '/api/trucks/trk-21', { active: false });
    const [copy1] = await copied(await copy({ to: '2026-11-20' }));
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
    expect(await list('/api/places')).toContainEqual({ id: added.fromPlaceId, shortName: 'Sample Pit', fullName: null, kind: null, jobId: null, usualForemanId: null, onTruckMap: false, active: true });
    expect(await list('/api/materials')).toContainEqual({ id: added.materialId, name: 'Sample Fill', active: true });

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
