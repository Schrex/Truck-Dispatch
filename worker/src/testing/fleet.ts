import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { readFleetJson, type FleetExportRow } from '../../../shared/fleetExport';
import type { apiOn } from './api';
import type { localD1 } from './localD1';

/** A Fleet export fixture (shared/fixtures/fleet/) read into rows, as the Fleet imports page sends them. */
export function fleetRows(name: string): FleetExportRow[] {
  return readFleetJson(JSON.parse(readFileSync(`shared/fixtures/fleet/${name}`, 'utf8')));
}

/**
 * The 16 Nov day's own data, set up in the test database: Truck 55 with its
 * HCSS code MCK-55-17, its Driver (usual Truck 55) and the five Places with
 * their geofence codes. Places get their codes in the database directly, as
 * Settings does not edit them yet.
 */
export async function setUpTruck55(d1: ReturnType<typeof localD1>, send: ReturnType<typeof apiOn>) {
  const truck = await send('POST', '/api/trucks', { number: '55', hcssCode: 'MCK-55-17' });
  expect(truck.status).toBe(201);
  const truckId = ((await truck.json()) as { truck: { id: string } }).truck.id;
  const driver = await send('POST', '/api/drivers', { name: 'Randy', defaultTruckId: truckId });
  expect(driver.status).toBe(201);
  const DB = d1.database();
  await DB.batch(
    [
      ['plc-55-shop', 'Shop', 'shop', 'SHOP'],
      ['plc-55-j25008', 'J25008 Los Flamboyanes', 'job_site', 'J25008 Los Flamboyanes'],
      ['plc-55-villager', 'Villager', 'plant', 'VILLAGER'],
      ['plc-55-walworth', 'Walworth Dolomite', 'plant', 'WALWDOLO'],
      ['plc-55-j611', 'J611 Bishop Kearney', 'job_site', 'J611 Bishop Kearney'],
    ].map(([id, name, kind, code]) =>
      DB.prepare('INSERT INTO places (id, short_name, kind, geofence_code) VALUES (?, ?, ?, ?)').bind(id, name, kind, code),
    ),
  );
  return { truckId };
}
