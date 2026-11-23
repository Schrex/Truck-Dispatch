import { describe, expect, it } from 'vitest';
import { apiOn } from './testing/api';
import { fleetRows, setUpTruck55 } from './testing/fleet';
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
    const { truckId } = await setUpTruck55(d1, send);
    const response = await importFile('2026-11-16-1502.json');
    expect(response.status).toBe(201);
    const { import: made } = (await response.json()) as { import: FleetImport };
    expect(made).toMatchObject({ truckId, truckNumber: '55', fileName: '2026-11-16-1502.json', format: 'json', importedAt: AFTERNOON, added: 18, days: ['2026-11-16'] });

    const visits = await storedVisits(truckId);
    expect(visits).toHaveLength(18);
    expect(visits.every((v) => v.importId === made.id)).toBe(true);
  });

  it('stores the open J25008 visit from 14:43 with no exit time', async () => {
    const { truckId } = await setUpTruck55(d1, send);
    await importFile('2026-11-16-1502.json');
    expect((await storedVisits(truckId)).at(-1)).toMatchObject({ geofenceCode: 'J25008 Los Flamboyanes', enteredAt: '2026-11-16T19:43:31.000Z', exitedAt: null });
  });

  it('records the Import and links it to Mon 16 Nov', async () => {
    const { truckId } = await setUpTruck55(d1, send);
    const { import: made } = (await (await importFile('2026-11-16-1502.json')).json()) as { import: FleetImport };
    const DB = d1.database();
    expect(await DB.prepare('SELECT truck_id AS truckId, file_name AS fileName, format, imported_at AS importedAt, added FROM fleet_imports WHERE id = ?').bind(made.id).first()).toEqual({
      truckId, fileName: '2026-11-16-1502.json', format: 'json', importedAt: AFTERNOON, added: 18,
    });
    expect((await DB.prepare('SELECT date FROM fleet_import_days WHERE import_id = ?').bind(made.id).all()).results).toEqual([{ date: '2026-11-16' }]);
  });

  it('adds only the visits it has not stored when the next cut of the day comes', async () => {
    const { truckId } = await setUpTruck55(d1, send);
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
