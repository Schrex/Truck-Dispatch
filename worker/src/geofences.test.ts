import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiOn } from './testing/api';
import { localD1 } from './testing/localD1';
import type { Geofence } from '../../shared/types';

const d1 = localD1();
const send = apiOn(d1);

/** The Geofences as Settings reads them. */
const geofences = async () => {
  const response = await send('GET', '/api/geofences');
  expect(response.status).toBe(200);
  return ((await response.json()) as { geofences: Geofence[] }).geofences;
};

describe('The Geofences migration', () => {
  /** The INSERT statements of 0020_geofences.sql, run on the database as it now is. */
  const carryOver = async () => {
    const sql = readFileSync('migrations/0020_geofences.sql', 'utf8').replace(/--.*$/gm, '');
    for (const statement of sql.split(';').filter((s) => /^\s*INSERT/i.test(s))) await d1.database().prepare(statement).run();
  };

  it('carries the codes on the Not considered list over, turned off, and every stored visit\'s code, considered', async () => {
    const DB = d1.database();
    await DB.batch([
      DB.prepare('INSERT INTO not_considered (id, code, active) VALUES (?, ?, ?)').bind('nc-1', ' GAS STATION ', 1),
      DB.prepare('INSERT INTO not_considered (id, code, active) VALUES (?, ?, ?)').bind('nc-2', 'weitsmans', 1),
      DB.prepare('INSERT INTO not_considered (id, code, active) VALUES (?, ?, ?)').bind('nc-3', 'SAMPLE OLD FUEL', 0),
      DB.prepare("INSERT INTO trucks (id, number, hcss_code, active) VALUES ('trk-m', '90', 'SAMPLE-90', 1)"),
      DB.prepare("INSERT INTO fleet_imports (id, truck_id, file_name, format, imported_at, added, closed, unchanged) VALUES ('imp-m', 'trk-m', 'x.json', 'json', '2026-11-23T21:30:00.000Z', 3, 0, 0)"),
      ...[['SHOP', '05:00'], ['Gas Station', '11:40'], ['sunset', '12:00']].map(([code, time]) =>
        DB.prepare(
          "INSERT INTO fleet_visits (id, truck_id, geofence_code, entered_minute, entered_at, exited_at, entry_odometer, exit_odometer, import_id) VALUES (?, 'trk-m', ?, ?, ?, NULL, NULL, NULL, 'imp-m')",
        ).bind(`v-${code}`, code, `2026-11-23T${time}Z`, `2026-11-23T${time}:00.000Z`),
      ),
    ]);

    await carryOver();

    expect(await geofences()).toEqual([
      { code: 'GAS STATION', notConsidered: true },
      { code: 'SHOP', notConsidered: false },
      { code: 'sunset', notConsidered: false },
      { code: 'weitsmans', notConsidered: true },
    ]);
  });
});
