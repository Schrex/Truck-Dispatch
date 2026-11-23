import { describe, expect, it } from 'vitest';
import { parseFleetEntryExit, placeKind } from './fleetImport';

const row = (GeofenceCode: string, GeofenceType: string, EntryDateTime: string, ExitDateTime: string | null, EntryOdometer: number, ExitOdometer: number | null, GeofenceDescription: string | null = null) => ({
  EquipmentCode: 'MCK-55-17',
  EquipmentDescription: '2017 Mack Granite - 55',
  GeofenceCode,
  GeofenceType,
  GeofenceDescription,
  EntryDateTime,
  ExitDateTime,
  EntryOdometer,
  ExitOdometer,
});

describe('Reading an HCSS Fleet entry/exit export', () => {
  const day = parseFleetEntryExit({
    Result: [
      row('VILLAGER', 'Plant', '2026-11-16T13:34:37+00:00', '2026-11-16T13:43:48+00:00', 258076.3, 258076.59, 'Villager City Plant'),
      row('SHOP', 'Other', '2026-11-16T05:00:00+00:00', '2026-11-16T11:24:46+00:00', 258050.59, 258050.91, 'Our shop and equipment yard'),
      row('J25008 Los Flamboyanes', 'Job', '2026-11-16T19:43:31+00:00', null, 258192.91, 258193.0, 'Los Flamboyanes - Christa '),
      row('sunset', 'Other', '2026-11-16T14:52:56+00:00', '2026-11-16T14:53:57+00:00', 258084.91, 258085.41),
    ],
    Status: 5,
    IsCompleted: true,
  });

  it('reads the Truck and the US Eastern date of its first entry', () => {
    expect(day).toMatchObject({ truckCode: 'MCK-55-17', truckDescription: '2017 Mack Granite - 55', date: '2026-11-16' });
  });

  it('makes one Place per geofence, named by its code with its description as the full name, its kind from Fleet’s type', () => {
    expect(day.places).toEqual([
      { id: 'geo:SHOP', name: 'SHOP', fullName: 'Our shop and equipment yard', kind: 'shop', geofenceCode: 'SHOP' },
      { id: 'geo:VILLAGER', name: 'VILLAGER', fullName: 'Villager City Plant', kind: 'plant', geofenceCode: 'VILLAGER' },
      { id: 'geo:sunset', name: 'sunset', fullName: null, kind: null, geofenceCode: 'sunset' },
      { id: 'geo:J25008 Los Flamboyanes', name: 'J25008 Los Flamboyanes', fullName: 'Los Flamboyanes - Christa', kind: 'job_site', geofenceCode: 'J25008 Los Flamboyanes' },
    ]);
  });

  it('sorts the visits by entry and ignores the exit odometer of an open one', () => {
    expect(day.visits.map((v) => v.geofenceCode)).toEqual(['SHOP', 'VILLAGER', 'sunset', 'J25008 Los Flamboyanes']);
    expect(day.visits.at(-1)).toMatchObject({ exitedAt: null, exitOdometer: null });
  });

  it('refuses anything that is not an entry/exit export', () => {
    expect(() => parseFleetEntryExit({ Result: [] })).toThrow(/No entry\/exit rows/);
    expect(() => parseFleetEntryExit({ Result: [{ hello: 1 }] })).toThrow(/is this the entry\/exit report/);
  });

  it('tells a shop or yard by its code, since Fleet calls them Other', () => {
    expect(placeKind('Other', 'North Yard')).toBe('yard');
    expect(placeKind('Other', 'sunset')).toBe(null);
  });
});
