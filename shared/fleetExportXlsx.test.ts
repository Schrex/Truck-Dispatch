import { readSheet } from 'read-excel-file/universal';
import { describe, expect, it, vi } from 'vitest';
import { countFleetXlsxVisits, readFleetJson, readFleetXlsx, type FleetExportRow } from './fleetExport';
import EXPORT_1502 from './fixtures/fleet/2026-11-16-1502.json?raw';
import XLSX from './fixtures/fleet/2026-11-16-EntryExitReport.xlsx?inline';

// The reader must read the sheet's times as US Eastern whatever zone it runs
// in, so this file runs in Tokyo (UTC+9, no daylight saving).
vi.stubEnv('TZ', 'Asia/Tokyo');

/** The real 16 Nov xlsx as Dave downloads it from HCSS Fleet (a data URL), read into cells as the page reads it. */
const sheet = () => readSheet(Uint8Array.from(atob(XLSX.split(',')[1]), (c) => c.charCodeAt(0)).buffer);

describe('Reading an xlsx Fleet export', () => {
  it('runs in a time zone other than US Eastern', () => {
    expect(new Date('2026-11-16T12:00:00Z').getTimezoneOffset()).toBe(-540);
  });

  it('reads the 16 Nov xlsx into 20 visits: the 15 Nov Shop day and 19 on 16 Nov, all for the Truck Dave picked', async () => {
    const rows = readFleetXlsx(await sheet(), 'MCK-55-17');
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.equipmentCode))).toEqual(new Set(['MCK-55-17']));
    expect(rows.filter((r) => r.enteredAt.startsWith('2026-11-15'))).toHaveLength(1);
  });

  it('reads Eastern wall times to UTC with their seconds, and gives no odometers', async () => {
    const rows = readFleetXlsx(await sheet(), 'MCK-55-17');
    expect(rows[2]).toEqual({
      equipmentCode: 'MCK-55-17',
      geofenceCode: 'J25008 Los Flamboyanes',
      enteredAt: '2026-11-16T12:02:03.000Z',
      exitedAt: '2026-11-16T12:13:29.000Z',
      entryOdometer: null,
      exitOdometer: null,
    });
    expect(rows.find((r) => r.geofenceCode === 'WALWDOLO')).toMatchObject({ enteredAt: '2026-11-16T16:56:23.000Z', exitedAt: '2026-11-16T17:08:37.000Z' });
  });

  it('closes a visit cut at midnight when the next day starts there at 12:00:00 AM, and leaves the last Shop visit open', async () => {
    const rows = readFleetXlsx(await sheet(), 'MCK-55-17');
    expect(rows[0]).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-15T05:00:00.000Z', exitedAt: '2026-11-16T05:00:00.000Z' });
    expect(rows[1]).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-16T05:00:00.000Z', exitedAt: '2026-11-16T11:24:46.000Z' });
    expect(rows.at(-1)).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-16T21:03:25.000Z', exitedAt: null });
  });

  it('gives the same visits as the 15:02 JSON for the same times, apart from odometers', async () => {
    const xlsx = readFleetXlsx(await sheet(), 'MCK-55-17');
    const json = readFleetJson(JSON.parse(EXPORT_1502));
    const visit = ({ geofenceCode, enteredAt }: FleetExportRow) => `${geofenceCode} ${enteredAt}`;
    expect(xlsx.slice(1, 19).map(visit)).toEqual(json.map(visit));
    expect(xlsx[18]).toMatchObject({ geofenceCode: 'J25008 Los Flamboyanes', exitedAt: '2026-11-16T20:41:56.000Z' });
  });

  it('reads the times in daylight saving time as EDT', () => {
    const rows = readFleetXlsx(
      [
        ['Location Code', 'Location Description', 'Entry Time', 'Exit Time', 'Duration', 'Calculated Mileage'],
        ['Entry Date: 7/1/2026', null, null, null, null, null],
        ['SHOP', null, '06:24:46 AM', '01:05:00 PM', 6.67, 0],
      ],
      'MCK-55-17',
    );
    expect(rows[0]).toMatchObject({ enteredAt: '2026-07-01T10:24:46.000Z', exitedAt: '2026-07-01T17:05:00.000Z' });
  });

  it('leaves a visit open when the Truck is still there and Fleet left its Exit Time blank', () => {
    // As exported on 23 Nov in the evening: the Truck back at the shop at 4:20 PM, still inside.
    const rows = readFleetXlsx(
      [
        ['Location Code', 'Location Description', 'Entry Time', 'Exit Time', 'Duration', 'Calculated Mileage'],
        ['Entry Date: 11/23/2026', null, null, null, null, null],
        ['J2601 Talmudical', 'Talmudical Institue', '12:38:53 PM', '12:58:32 PM', 0.33, 0.2],
        ['SHOP', 'Our shop and equipment yard', '04:20:36 PM', null, 6.48, 0.1],
      ],
      'MCK-59-27',
    );
    expect(rows).toEqual([
      { equipmentCode: 'MCK-59-27', geofenceCode: 'J2601 Talmudical', enteredAt: '2026-11-23T17:38:53.000Z', exitedAt: '2026-11-23T17:58:32.000Z', entryOdometer: null, exitOdometer: null },
      { equipmentCode: 'MCK-59-27', geofenceCode: 'SHOP', enteredAt: '2026-11-23T21:20:36.000Z', exitedAt: null, entryOdometer: null, exitOdometer: null },
    ]);
  });

  it('still refuses a row with no Entry Time, or an Exit Time that is not a time', () => {
    const header = ['Location Code', 'Location Description', 'Entry Time', 'Exit Time', 'Duration', 'Calculated Mileage'];
    const day = ['Entry Date: 11/23/2026', null, null, null, null, null];
    expect(() => readFleetXlsx([header, day, ['SHOP', null, null, '04:20:36 PM', 1, 0]], 'MCK-59-27')).toThrow(/Row 3/);
    expect(() => readFleetXlsx([header, day, ['SHOP', null, '04:20:36 PM', 'soon', 1, 0]], 'MCK-59-27')).toThrow(/Row 3/);
  });

  it('refuses a sheet that is not the entry/exit report, with a reason', () => {
    expect(() => readFleetXlsx([['Name', 'Phone']], 'MCK-55-17')).toThrow(/entry\/exit report/i);
    expect(() => readFleetXlsx([['Location Code', 'Location Description', 'Entry Time', 'Exit Time', 'Duration', 'Calculated Mileage']], 'MCK-55-17')).toThrow(/no entry\/exit rows/i);
    expect(() =>
      readFleetXlsx(
        [
          ['Location Code', 'Location Description', 'Entry Time', 'Exit Time', 'Duration', 'Calculated Mileage'],
          ['SHOP', null, '06:24:46 AM', '07:00:00 AM', 1, 0],
        ],
        'MCK-55-17',
      ),
    ).toThrow(/Entry Date/);
  });
});

describe('Checking an xlsx Fleet export before Dave picks its Truck', () => {
  it('counts the 20 visits of the 16 Nov xlsx', async () => {
    expect(countFleetXlsxVisits(await sheet())).toBe(20);
  });

  it('refuses a sheet that is not the entry/exit report, as reading it does', () => {
    expect(() => countFleetXlsxVisits([['Name', 'Phone']])).toThrow(/entry\/exit report/i);
  });
});
