import { describe, expect, it } from 'vitest';
import { readFleetJson } from './fleetExport';
import EXPORT_1502 from './fixtures/fleet/2026-11-16-1502.json?raw';
import CUT_1015 from './fixtures/fleet/2026-11-16-cut-1015.json?raw';
import CUT_1305 from './fixtures/fleet/2026-11-16-cut-1305.json?raw';
import CUT_1620 from './fixtures/fleet/2026-11-16-cut-1620.json?raw';

/** The Fleet export fixtures (shared/fixtures/fleet/) as files. */
const FILES: Record<string, string> = {
  '2026-11-16-1502.json': EXPORT_1502,
  '2026-11-16-cut-1015.json': CUT_1015,
  '2026-11-16-cut-1305.json': CUT_1305,
  '2026-11-16-cut-1620.json': CUT_1620,
};
/** A fixture parsed as the page parses the dropped file. */
const fixture = (name: string): unknown => JSON.parse(FILES[name]);

describe('Reading a JSON Fleet export', () => {
  const rows = readFleetJson(fixture('2026-11-16-1502.json'));

  it('reads the 16 Nov export pulled at 15:02 into its 18 visits, all on MCK-55-17, in UTC', () => {
    expect(rows).toHaveLength(18);
    expect(new Set(rows.map((r) => r.equipmentCode))).toEqual(new Set(['MCK-55-17']));
    expect(rows[0]).toEqual({
      equipmentCode: 'MCK-55-17',
      geofenceCode: 'SHOP',
      enteredAt: '2026-11-16T05:00:00.000Z',
      exitedAt: '2026-11-16T11:24:46.000Z',
      entryOdometer: 258050.59,
      exitOdometer: 258050.91,
    });
  });

  it('keeps J25008 from 14:43 open: no exit time and no exit odometer', () => {
    expect(rows.at(-1)).toEqual({
      equipmentCode: 'MCK-55-17',
      geofenceCode: 'J25008 Los Flamboyanes',
      enteredAt: '2026-11-16T19:43:31.000Z',
      exitedAt: null,
      entryOdometer: 258192.91,
      exitOdometer: null,
    });
  });

  it('ignores the current reading Fleet may give as the exit odometer of an open visit', () => {
    const [open] = readFleetJson([{ EquipmentCode: 'MCK-55-17', GeofenceCode: 'SHOP', EntryDateTime: '2026-11-16T21:03:25+00:00', ExitDateTime: null, EntryOdometer: 258211.79, ExitOdometer: 258212.2 }]);
    expect(open).toMatchObject({ exitedAt: null, exitOdometer: null });
  });

  it('reads a bare array of rows the same as the Result array', () => {
    expect(readFleetJson((fixture('2026-11-16-1502.json') as { Result: unknown[] }).Result)).toEqual(rows);
  });

  it('refuses a file that is not an entry/exit export, with a reason', () => {
    expect(() => readFleetJson({ Result: [] })).toThrow(/no entry\/exit rows/i);
    expect(() => readFleetJson({ hello: 1 })).toThrow(/no entry\/exit rows/i);
    expect(() => readFleetJson({ Result: [{ hello: 1 }] })).toThrow(/entry\/exit report/i);
  });
});

describe('The 16 Nov cuts, as Fleet would have exported the day at 10:15, 13:05 and 16:20', () => {
  it.each([
    ['2026-11-16-cut-1015.json', 8, ['J25008 Los Flamboyanes']],
    ['2026-11-16-cut-1305.json', 14, []],
    ['2026-11-16-cut-1620.json', 19, ['SHOP']],
  ])('%s holds %i visits, open: %j', (name, count, open) => {
    const rows = readFleetJson(fixture(name));
    expect(rows).toHaveLength(count);
    expect(rows.filter((r) => r.exitedAt === null).map((r) => r.geofenceCode)).toEqual(open);
  });
});
