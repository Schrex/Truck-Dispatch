import { describe, expect, it } from 'vitest';
import { apiOn } from './testing/api';
import { fleetRows, fleetXlsxRows, setUpTruck55 } from './testing/fleet';
import { localD1 } from './testing/localD1';
import type { FleetImport } from '../../shared/types';

const d1 = localD1();
const send = apiOn(d1);

/** Monday 16 Nov 2026, 3:05 PM US Eastern: just after the 15:02 export was pulled. */
const AFTERNOON = '2026-11-16T20:05:00.000Z';

const importFile = (name: string, vars = {}) =>
  send('POST', '/api/fleet-imports', { fileName: name, format: 'json', rows: fleetRows(name) }, { NOW: AFTERNOON, ...vars });

/** The visits stored for a Truck, in entry order (there is no read route yet: the Truck log route comes later). */
const storedVisits = async (truckId: string) =>
  (
    await d1
      .database()
      .prepare('SELECT geofence_code AS geofenceCode, entered_at AS enteredAt, exited_at AS exitedAt, import_id AS importId FROM fleet_visits WHERE truck_id = ? ORDER BY entered_at')
      .bind(truckId)
      .all<{ geofenceCode: string; enteredAt: string; exitedAt: string | null; importId: string }>()
  ).results;

describe('Importing a JSON Fleet export', () => {
  it('stores the 18 visits of the 16 Nov export for Truck 55 and says 18 new', async () => {
    const { truckId } = await setUpTruck55(send);
    const response = await importFile('2026-11-16-1502.json');
    expect(response.status).toBe(201);
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made).toMatchObject({ truckId, truckNumber: '55', fileName: '2026-11-16-1502.json', format: 'json', importedAt: AFTERNOON, added: 18, days: [{ date: '2026-11-16', added: 18, closed: 0, unchanged: 0 }] });

    const visits = await storedVisits(truckId);
    expect(visits).toHaveLength(18);
    expect(visits.every((v) => v.importId === made.id)).toBe(true);
  });

  it('stores the open J25008 visit from 14:43 with no exit time', async () => {
    const { truckId } = await setUpTruck55(send);
    await importFile('2026-11-16-1502.json');
    expect((await storedVisits(truckId)).at(-1)).toMatchObject({ geofenceCode: 'J25008 Los Flamboyanes', enteredAt: '2026-11-16T19:43:31.000Z', exitedAt: null });
  });

  it('records the Import and links it to Mon 16 Nov', async () => {
    const { truckId } = await setUpTruck55(send);
    const { import: made } = (await (await importFile('2026-11-16-1502.json')).json()) as { import: FleetImport };
    const DB = d1.database();
    expect(await DB.prepare('SELECT truck_id AS truckId, file_name AS fileName, format, imported_at AS importedAt, added FROM fleet_imports WHERE id = ?').bind(made.id).first()).toEqual({
      truckId, fileName: '2026-11-16-1502.json', format: 'json', importedAt: AFTERNOON, added: 18,
    });
    expect((await DB.prepare('SELECT date FROM fleet_import_days WHERE import_id = ?').bind(made.id).all()).results).toEqual([{ date: '2026-11-16' }]);
  });

  it('adds only the visits it has not stored when the next cut of the day comes', async () => {
    const { truckId } = await setUpTruck55(send);
    const added = async (name: string) => ((await (await importFile(name)).json()) as { import: FleetImport }).import.added;
    expect(await added('2026-11-16-cut-1015.json')).toBe(8);
    expect(await added('2026-11-16-cut-1305.json')).toBe(6);
    expect(await storedVisits(truckId)).toHaveLength(14);
  });

});

/** How many Imports and visits are stored, whoever they are for. */
const storedCounts = async () => {
  const DB = d1.database();
  const count = async (table: string) => (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
  return { imports: await count('fleet_imports'), days: await count('fleet_import_days'), visits: await count('fleet_visits') };
};
const NOTHING = { imports: 0, days: 0, visits: 0 };

/** The Worker's refusal: its status, error and the reason the page shows. */
const refusalOf = async (response: Response) => {
  const body = (await response.json()) as { error: string; message: string };
  return { status: response.status, error: body.error, message: body.message };
};

describe('Refusing a Fleet export that would mix the wrong data into a Truck\'s day', () => {
  it('refuses rows for a Truck with no such HCSS code, and stores nothing', async () => {
    expect(await refusalOf(await importFile('2026-11-16-1502.json'))).toEqual({
      status: 400, error: 'unknown_truck', message: 'No Truck has the HCSS code MCK-55-17. Set it in Settings.',
    });
    expect(await storedCounts()).toEqual(NOTHING);
  });

  it('refuses rows for a Truck that has the HCSS code but is not active, like an unknown code', async () => {
    const { truckId } = await setUpTruck55(send);
    expect((await send('PATCH', `/api/trucks/${truckId}`, { active: false })).status).toBe(200);
    expect(await refusalOf(await importFile('2026-11-16-1502.json'))).toEqual({
      status: 400, error: 'unknown_truck', message: 'No Truck has the HCSS code MCK-55-17. Set it in Settings.',
    });
    expect(await storedCounts()).toEqual(NOTHING);
  });

  it('refuses a file that holds more than one Truck, even when both are set up, and stores nothing', async () => {
    await setUpTruck55(send);
    expect((await send('POST', '/api/trucks', { number: '61', hcssCode: 'MCK-61-20' })).status).toBe(201);
    const rows = fleetRows('2026-11-16-1502.json');
    rows[rows.length - 1] = { ...rows[rows.length - 1], equipmentCode: 'MCK-61-20' };
    const response = await send('POST', '/api/fleet-imports', { fileName: 'two.json', format: 'json', rows }, { NOW: AFTERNOON });
    expect(await refusalOf(response)).toEqual({ status: 400, error: 'more_than_one_truck', message: 'The file must hold one Truck.' });
    expect(await storedCounts()).toEqual(NOTHING);
  });

  it.each([
    ['no rows', []],
    ['rows without the Fleet fields', [{ hello: 1 }, { name: 'Randy' }]],
    ['some rows without the Fleet fields', [...fleetRows('2026-11-16-1502.json'), { EquipmentCode: 'MCK-55-17' }]],
    ['no row list at all', { Result: 'nothing' }],
    ['rows with a blank EquipmentCode', fleetRows('2026-11-16-1502.json').map((r) => ({ ...r, equipmentCode: '  ' }))],
  ])('refuses a file that is not a Fleet export (%s), and stores nothing', async (_, rows) => {
    await setUpTruck55(send);
    const response = await send('POST', '/api/fleet-imports', { fileName: 'notes.json', format: 'json', rows }, { NOW: AFTERNOON });
    expect(await refusalOf(response)).toEqual({
      status: 400, error: 'not_a_fleet_export', message: 'This is not a Fleet export. Export the entry/exit report from HCSS Fleet and drop that.',
    });
    expect(await storedCounts()).toEqual(NOTHING);
  });

  it.each([['production'], ['prod'], ['Staging'], [''], [undefined]])('refuses any Import where ENVIRONMENT is %j, and stores nothing', async (ENVIRONMENT) => {
    await setUpTruck55(send);
    expect(await refusalOf(await importFile('2026-11-16-1502.json', { ENVIRONMENT }))).toEqual({
      status: 403, error: 'imports_not_allowed', message: 'Fleet imports are allowed only on local, preview and staging.',
    });
    expect(await storedCounts()).toEqual(NOTHING);
  });

  it.each([['local'], ['preview'], ['staging'], ['test']])('accepts a good file where ENVIRONMENT is %s', async (ENVIRONMENT) => {
    await setUpTruck55(send);
    expect(await counts(await importFile('2026-11-16-1502.json', { ENVIRONMENT }))).toBe('18 new · 0 closed · 0 already stored');
  });
});

/** What an Import says: "8 new · 0 closed · 0 already stored". */
const counts = async (response: Response) => {
  expect(response.status).toBe(201);
  const { import: made } = (await response.json()) as { import: FleetImport };
  return `${made.added} new · ${made.closed} closed · ${made.unchanged} already stored`;
};

describe('Importing a Fleet export that repeats the day so far', () => {
  it('stores nothing new when the same export is dropped again', async () => {
    const { truckId } = await setUpTruck55(send);
    await importFile('2026-11-16-1502.json');
    expect(await counts(await importFile('2026-11-16-1502.json'))).toBe('0 new · 0 closed · 18 already stored');
    expect(await storedVisits(truckId)).toHaveLength(18);
  });

  it('closes the open J25008 visit when the cuts of the day come in order, storing each of the 19 visits once', async () => {
    const { truckId } = await setUpTruck55(send);
    expect(await counts(await importFile('2026-11-16-cut-1015.json'))).toBe('8 new · 0 closed · 0 already stored');
    const { import: midday } = (await (await importFile('2026-11-16-cut-1305.json')).json()) as { import: FleetImport };
    expect(`${midday.added} new · ${midday.closed} closed · ${midday.unchanged} already stored`).toBe('6 new · 1 closed · 7 already stored');
    expect(await counts(await importFile('2026-11-16-cut-1620.json'))).toBe('5 new · 0 closed · 14 already stored');

    const visits = await storedVisits(truckId);
    expect(visits).toHaveLength(19);
    const j25008 = visits.find((v) => v.geofenceCode === 'J25008 Los Flamboyanes' && v.enteredAt.startsWith('2026-11-16T15:00'));
    expect(j25008).toMatchObject({ exitedAt: expect.any(String), importId: midday.id });
    expect(visits.at(-1)).toMatchObject({ geofenceCode: 'SHOP', exitedAt: null });
  });

  it('closes and reopens nothing when the 10:15 cut is dropped after the 16:20 one', async () => {
    const { truckId } = await setUpTruck55(send);
    await importFile('2026-11-16-cut-1620.json');
    const before = await storedVisits(truckId);
    expect(await counts(await importFile('2026-11-16-cut-1015.json'))).toBe('0 new · 0 closed · 8 already stored');
    expect(await storedVisits(truckId)).toEqual(before);
  });

  it('keeps each Import\'s counts with the Import', async () => {
    await setUpTruck55(send);
    await importFile('2026-11-16-cut-1015.json');
    const { import: midday } = (await (await importFile('2026-11-16-cut-1305.json')).json()) as { import: FleetImport };
    expect(await d1.database().prepare('SELECT added, closed, unchanged FROM fleet_imports WHERE id = ?').bind(midday.id).first()).toEqual({ added: 6, closed: 1, unchanged: 7 });
  });

  describe('the same visit given to the minute and with seconds', () => {
    /** The J25008 visit entered 07:02:03 ET, as one export: entered at `enteredAt`. */
    const importVisit = (enteredAt: string) => {
      const [row] = fleetRows('2026-11-16-1502.json').filter((r) => r.enteredAt.startsWith('2026-11-16T12:02'));
      return send('POST', '/api/fleet-imports', { fileName: 'one.json', format: 'json', rows: [{ ...row, enteredAt }] }, { NOW: AFTERNOON });
    };

    it('keeps the seconds when they come after the minute, and counts it already stored', async () => {
      const { truckId } = await setUpTruck55(send);
      await importVisit('2026-11-16T12:02:00Z');
      expect(await counts(await importVisit('2026-11-16T12:02:03Z'))).toBe('0 new · 0 closed · 1 already stored');
      expect(await storedVisits(truckId)).toEqual([expect.objectContaining({ enteredAt: '2026-11-16T12:02:03.000Z' })]);
    });

    it('keeps the seconds when the minute comes after them', async () => {
      const { truckId } = await setUpTruck55(send);
      await importVisit('2026-11-16T12:02:03Z');
      expect(await counts(await importVisit('2026-11-16T12:02:00Z'))).toBe('0 new · 0 closed · 1 already stored');
      expect(await storedVisits(truckId)).toEqual([expect.objectContaining({ enteredAt: '2026-11-16T12:02:03.000Z' })]);
    });

    it('keeps the seconds when one file gives the visit both ways, in either order', async () => {
      const [row] = fleetRows('2026-11-16-1502.json').filter((r) => r.enteredAt.startsWith('2026-11-16T12:02'));
      const { truckId } = await setUpTruck55(send);
      for (const order of [['2026-11-16T12:02:00Z', '2026-11-16T12:02:03Z'], ['2026-11-16T12:02:03Z', '2026-11-16T12:02:00Z']]) {
        await d1.database().prepare('DELETE FROM fleet_visits').run();
        const rows = order.map((enteredAt) => ({ ...row, enteredAt }));
        const response = await send('POST', '/api/fleet-imports', { fileName: 'twice.json', format: 'json', rows }, { NOW: AFTERNOON });
        expect(await counts(response)).toBe('1 new · 0 closed · 0 already stored');
        expect(await storedVisits(truckId)).toEqual([expect.objectContaining({ enteredAt: '2026-11-16T12:02:03.000Z' })]);
      }
    });
  });
});

/** The rows of a fixture moved later by whole days, as an export of another day would give them. */
const movedDays = (rows: ReturnType<typeof fleetRows>, days: number) => {
  const move = (at: string | null) => (at === null ? null : new Date(Date.parse(at) + days * 86_400_000).toISOString());
  return rows.map((r) => ({ ...r, enteredAt: move(r.enteredAt)!, exitedAt: move(r.exitedAt) }));
};

describe('The days an Import touched', () => {
  it('reports each Eastern day with its own counts, and links the Import to both days', async () => {
    await setUpTruck55(send);
    const monday = fleetRows('2026-11-16-cut-1015.json');
    const rows = [...monday, ...movedDays(monday.slice(0, 3), 1)];
    const response = await send('POST', '/api/fleet-imports', { fileName: 'two-days.json', format: 'json', rows }, { NOW: AFTERNOON });
    expect(response.status).toBe(201);
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made.days).toEqual([
      { date: '2026-11-16', added: 8, closed: 0, unchanged: 0 },
      { date: '2026-11-17', added: 3, closed: 0, unchanged: 0 },
    ]);
    expect((await d1.database().prepare('SELECT date FROM fleet_import_days WHERE import_id = ? ORDER BY date').bind(made.id).all()).results).toEqual([
      { date: '2026-11-16' },
      { date: '2026-11-17' },
    ]);
  });

  it('files a visit entered at 23:50 Eastern under that day, though in UTC it is the next day', async () => {
    await setUpTruck55(send);
    const [row] = fleetRows('2026-11-16-1502.json');
    const late = { ...row, enteredAt: '2026-11-17T04:50:00Z', exitedAt: '2026-11-17T05:20:00Z' };
    const response = await send('POST', '/api/fleet-imports', { fileName: 'late.json', format: 'json', rows: [late] }, { NOW: AFTERNOON });
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made.days).toEqual([{ date: '2026-11-16', added: 1, closed: 0, unchanged: 0 }]);
  });
});

describe('Codes with no Place', () => {
  it('lists "sunset" from the 16 Nov JSON, marked drive-through, and stores its visits', async () => {
    const { truckId } = await setUpTruck55(send);
    const { import: made } = (await (await importFile('2026-11-16-1502.json')).json()) as { import: FleetImport };
    expect(made.codesWithNoPlace).toEqual([{ code: 'sunset', driveThrough: true }]);
    expect((await storedVisits(truckId)).filter((v) => v.geofenceCode === 'sunset')).toHaveLength(2);
  });

  it('lists a code with no Place where the Truck stopped without the drive-through mark', async () => {
    await setUpTruck55(send);
    // The Villager plant's visits, as if no Place had its code yet.
    const rows = fleetRows('2026-11-16-1502.json').map((r) => (r.geofenceCode === 'VILLAGER' ? { ...r, geofenceCode: 'BROCKPORT' } : r));
    const response = await send('POST', '/api/fleet-imports', { fileName: 'brockport.json', format: 'json', rows }, { NOW: AFTERNOON });
    expect(response.status).toBe(201);
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made.codesWithNoPlace).toEqual([
      { code: 'BROCKPORT', driveThrough: false },
      { code: 'sunset', driveThrough: true },
    ]);
  });

  it('lists none when every code has a Place, matching codes whatever their case', async () => {
    await setUpTruck55(send);
    const rows = fleetRows('2026-11-16-1502.json')
      .filter((r) => r.geofenceCode !== 'sunset')
      .map((r) => ({ ...r, geofenceCode: r.geofenceCode.toLowerCase() }));
    const response = await send('POST', '/api/fleet-imports', { fileName: 'lower.json', format: 'json', rows }, { NOW: AFTERNOON });
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made.codesWithNoPlace).toEqual([]);
  });
});

describe('Importing an xlsx Fleet export', () => {
  const XLSX = '2026-11-16-EntryExitReport.xlsx';
  const importXlsx = async () =>
    send('POST', '/api/fleet-imports', { fileName: XLSX, format: 'xlsx', rows: await fleetXlsxRows(XLSX, 'MCK-55-17') }, { NOW: AFTERNOON });

  it('after the 15:02 JSON, adds the 15 Nov Shop day and the Shop visit at 16:03, and closes J25008 at 15:41', async () => {
    const { truckId } = await setUpTruck55(send);
    await importFile('2026-11-16-1502.json');
    expect(await counts(await importXlsx())).toBe('2 new · 1 closed · 17 already stored');

    const visits = await storedVisits(truckId);
    expect(visits).toHaveLength(20);
    expect(visits.find((v) => v.enteredAt === '2026-11-16T19:43:31.000Z')).toMatchObject({ geofenceCode: 'J25008 Los Flamboyanes', exitedAt: '2026-11-16T20:41:56.000Z' });
    expect(visits.at(-1)).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-16T21:03:25.000Z', exitedAt: null });
  });

  it('stores the xlsx alone as 20 visits, 19 on Mon 16 Nov and the Shop day before, and records its format', async () => {
    const { truckId } = await setUpTruck55(send);
    const response = await importXlsx();
    expect(response.status).toBe(201);
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made).toMatchObject({ format: 'xlsx', added: 20, closed: 0, unchanged: 0, days: [{ date: '2026-11-15', added: 1, closed: 0, unchanged: 0 }, { date: '2026-11-16', added: 19, closed: 0, unchanged: 0 }] });
    expect(await d1.database().prepare('SELECT format FROM fleet_imports WHERE id = ?').bind(made.id).first()).toEqual({ format: 'xlsx' });
    expect(await storedVisits(truckId)).toHaveLength(20);
  });

  it('adds nothing when the 15:02 JSON comes after the xlsx', async () => {
    await setUpTruck55(send);
    await importXlsx();
    expect(await counts(await importFile('2026-11-16-1502.json'))).toBe('0 new · 0 closed · 18 already stored');
  });
});
