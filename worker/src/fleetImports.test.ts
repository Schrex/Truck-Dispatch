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
    expect(made).toMatchObject({ truckId, truckNumber: '55', fileName: '2026-11-16-1502.json', format: 'json', importedAt: AFTERNOON, added: 18, days: ['2026-11-16'] });

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

  it('refuses rows for a Truck with no such HCSS code', async () => {
    const response = await importFile('2026-11-16-1502.json');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toMatch(/MCK-55-17.*Settings/);
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
    expect(made).toMatchObject({ format: 'xlsx', added: 20, closed: 0, unchanged: 0, days: ['2026-11-15', '2026-11-16'] });
    expect(await d1.database().prepare('SELECT format FROM fleet_imports WHERE id = ?').bind(made.id).first()).toEqual({ format: 'xlsx' });
    expect(await storedVisits(truckId)).toHaveLength(20);
  });

  it('adds nothing when the 15:02 JSON comes after the xlsx', async () => {
    await setUpTruck55(send);
    await importXlsx();
    expect(await counts(await importFile('2026-11-16-1502.json'))).toBe('0 new · 0 closed · 18 already stored');
  });
});
