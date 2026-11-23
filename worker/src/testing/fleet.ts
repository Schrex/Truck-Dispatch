import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { readFleetJson, type FleetExportRow } from '../../../shared/fleetExport';
import type { apiOn } from './api';

/** A Fleet export fixture (shared/fixtures/fleet/) read into rows, as the Fleet imports page sends them. */
export function fleetRows(name: string): FleetExportRow[] {
  return readFleetJson(JSON.parse(readFileSync(`shared/fixtures/fleet/${name}`, 'utf8')));
}

/**
 * The 16 Nov day's own data, set up in the test database: Truck 55 with its
 * HCSS code MCK-55-17, its Driver (usual Truck 55) and the five Places with
 * their geofence codes, all through the API as Settings adds them.
 */
export async function setUpTruck55(send: ReturnType<typeof apiOn>) {
  const truck = await send('POST', '/api/trucks', { number: '55', hcssCode: 'MCK-55-17' });
  expect(truck.status).toBe(201);
  const truckId = ((await truck.json()) as { truck: { id: string } }).truck.id;
  const driver = await send('POST', '/api/drivers', { name: 'Randy', defaultTruckId: truckId });
  expect(driver.status).toBe(201);
  for (const [shortName, kind, geofenceCode] of [
    ['Shop', 'shop', 'SHOP'],
    ['J25008 Los Flamboyanes', 'job_site', 'J25008 Los Flamboyanes'],
    ['Villager', 'plant', 'VILLAGER'],
    ['Walworth Dolomite', 'plant', 'WALWDOLO'],
    ['J611 Bishop Kearney', 'job_site', 'J611 Bishop Kearney'],
  ]) {
    expect((await send('POST', '/api/places', { shortName, kind, geofenceCode })).status).toBe(201);
  }
  return { truckId };
}
