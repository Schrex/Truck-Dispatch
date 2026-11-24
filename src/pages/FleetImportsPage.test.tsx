// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
// The pages load lazily in the app (App.tsx); importing it here compiles it
// before the first test, so a cold run never waits on that inside a test.
import './FleetImportsPage';
import { REAL_DAY } from '@/simulate/realDay';
import { readFleetJson, type FleetExportRow } from '../../shared/fleetExport';
import { buildTripDay, type TripAssignment } from '../../shared/trips';
import { truckLog, truckLogLanes } from '../../shared/truckLog';
import { easternMoment } from '../../shared/days';
import type { Assignment, Driver, FleetImport, NewFleetImport, Truck, TruckLogDay } from '../../shared/types';
// The 16 Nov export pulled at 15:02, as Dave downloads it from HCSS Fleet.
import EXPORT_1502 from '../../shared/fixtures/fleet/2026-11-16-1502.json?raw';
// The whole 16 Nov day cut at 13:05 and at 16:20, as Fleet would have exported it then.
import CUT_1305 from '../../shared/fixtures/fleet/2026-11-16-cut-1305.json?raw';
import CUT_1620 from '../../shared/fixtures/fleet/2026-11-16-cut-1620.json?raw';
// The 16 Nov xlsx, the whole day, as a data URL.
import XLSX from '../../shared/fixtures/fleet/2026-11-16-EntryExitReport.xlsx?inline';


/** What each Import the page sent was. */
let sent: NewFleetImport[];
/** What the Worker answers an Import with, when not the stored one. */
let refusal: { status: number; body: unknown } | null;
/** What the Worker's answer to an Import says, over the stored one. */
let answered: Partial<FleetImport>;
/** The Geofences turned to Not considered as the Worker holds them: "sunset" unless a test says otherwise. */
let notConsidered: string[];
/** Whether turning a Geofence to Not considered fails. */
let notConsideredFails: boolean;
/** The query of each Clear Fleet imports the page sent, in order. */
let cleared: string[];

/** The Import route as the page sees it: every visit sent is new, on Truck 55. */
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/api/fleet-imports') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as NewFleetImport;
    sent.push(body);
    if (refusal) return answer(refusal.body, refusal.status);
    return answer({
      import: { id: 'imp-1', truckId: 'trk-55', truckNumber: '55', fileName: body.fileName, format: body.format, importedAt: '2026-11-16T20:05:00.000Z', added: body.rows.length, closed: 0, unchanged: 0, days: [{ date: '2026-11-16', added: body.rows.length, closed: 0, unchanged: 0 }], codesWithNoPlace: [], ...answered } satisfies FleetImport,
    }, 201);
  }
  if (url.pathname.endsWith('/api/fleet-imports') && init?.method === 'DELETE') {
    cleared.push(url.search);
    storedDays = {};
    return answer({ cleared: { imports: 2, visits: 14, geofences: url.searchParams.get('geofences') === '1' ? 9 : 0 } });
  }
  const geofence = /\/api\/geofences\/([^/]+)$/.exec(url.pathname);
  if (geofence && init?.method === 'PATCH') {
    const code = decodeURIComponent(geofence[1]);
    const body = JSON.parse(String(init.body)) as { notConsidered: boolean };
    if (notConsideredFails) return answer({ error: 'oops' }, 500);
    if (body.notConsidered) notConsidered.push(code);
    return answer({ geofence: { code, notConsidered: body.notConsidered } });
  }
  if (url.pathname.endsWith('/api/trucks')) return answer({ trucks: TRUCKS });
  if (url.pathname.endsWith('/api/today')) return answer({ today: TUESDAY, tomorrow: '2026-11-18', nextWorkingDay: '2026-11-18' });
  const truckDay = /\/api\/trucks\/([^/]+)\/days\/([^/]+)$/.exec(url.pathname);
  if (truckDay) {
    const at = url.searchParams.get('at') ?? undefined;
    asked.push(at ?? null);
    return answer(storedDays[`${truckDay[1]} ${truckDay[2]}`]?.(at) ?? noVisits(truckDay[1], truckDay[2]));
  }
  if (url.pathname.endsWith('/api/drivers')) return answer({ drivers: DRIVERS });
  return answer({ error: 'not_found' }, 404);
});

const TUESDAY = '2026-11-17';
/** When the 16:20 cut was imported: 4:25 PM US Eastern on Mon 16 Nov. */
const AS_OF = '2026-11-16T21:25:00.000Z';

/** The real day's Places, and Dave's two Assignments for Randy: A1 J25008 → Villager, A2 Walworth → J25008. */
const [, J25008, VILLAGER, WALWORTH] = REAL_DAY.places.map((p) => p.id);
const PLANNED: TripAssignment[] = [
  { id: 'a1', label: 'A1', fromPlaceId: J25008, toPlaceId: VILLAGER, cancelledAt: null, changes: [] },
  { id: 'a2', label: 'A2', fromPlaceId: WALWORTH, toPlaceId: J25008, cancelledAt: null, changes: [] },
];

/** A1 and A2 as the Worker reads them, Assigned to Randy. */
const shown = (id: string, fromPlaceName: string, toPlaceName: string, materialName: string): Assignment => ({
  id, date: '2026-11-16', driverId: 'drv-randy', driverName: 'Randy', truckId: null, truckNumber: null,
  fromPlaceId: null, fromPlaceName, toPlaceId: null, toPlaceName, atPlaceId: null, atPlaceName: null, materialId: null, materialName, foremanId: null, foremanName: null, customerId: null, customerName: null, note: null, work: 'haul', machine: null,
  position: 0, createdAt: '2026-11-15T22:00:00.000Z', updatedAt: '2026-11-15T22:00:00.000Z', changedAt: null, cancelledAt: null,
  assignedAt: '2026-11-15T22:00:00.000Z', handedFromId: null, sinceSent: null,
});
const SHOWN = [shown('a1', 'J25008 Los Flamboyanes', 'Villager', 'Fill'), shown('a2', 'Walworth Dolomite', 'J25008 Los Flamboyanes', '1&2 stone')];

/**
 * A Truck's stored day as the Worker answers it: the Fleet rows stored, through
 * the Trip builder and the shared Truck log function. A past day by default;
 * `today` builds it as the Worker does on the day itself, at the latest Import.
 */
function storedDay(
  truckId: string,
  date: string,
  rows: FleetExportRow[],
  asOf: string | null,
  { today = false, clock, randyCheckedIn = false }: { today?: boolean; clock?: string; randyCheckedIn?: boolean } = {},
): TruckLogDay {
  const visits = rows.map((r) => ({ geofenceCode: r.geofenceCode, enteredAt: r.enteredAt, exitedAt: r.exitedAt, entryOdometer: r.entryOdometer, exitOdometer: r.exitOdometer }));
  const opened = clock ?? (today ? '13:10' : '23:59');
  // The end of the clock minute, never past the latest Import, as the Worker builds it.
  const [hour, minute] = opened.split(':').map(Number);
  const endOfMinute = easternMoment(date, hour, minute, 59);
  const at = clock === undefined ? (asOf ?? `${date}T23:59:59.000Z`) : asOf && Date.parse(asOf) < Date.parse(endOfMinute) ? asOf : endOfMinute;
  const dayOver = !today && opened === '23:59';
  const tripDay = buildTripDay({ places: REAL_DAY.places, notConsidered, jobs: REAL_DAY.jobs, visits, assignments: rows.length ? PLANNED : [], now: at, dayOver });
  const labels = { a1: 'A1', a2: 'A2' };
  const { assignments, ...truckLogBody } = truckLog({ tripDay, places: REAL_DAY.places, assignments: rows.length ? SHOWN : [], labels });
  return {
    truckId, truckNumber: '55', date, asOf, clock: opened, at, dayOver, places: REAL_DAY.places, tripDay, labels, assignments,
    truckLog: truckLogBody,
    // The codes no Place has and that are not on the Not considered list, as the Worker lists them.
    codesWithNoPlace: [...new Set(rows.map((r) => r.geofenceCode))]
      .filter((code) => !REAL_DAY.places.some((p) => p.geofenceCode === code) && !notConsidered.includes(code))
      .map((code) => ({ code })),
    // Randy's check-in at 06:00 gives the Unplanned work its Driver; with none it has no Driver known.
    lanes: truckLogLanes(tripDay, truckLogBody, randyCheckedIn ? RANDY_AT_6 : null),
  };
}
/** Truck 55 with Randy checked in to it at 06:00 on Mon 16 Nov. */
const RANDY_AT_6 = {
  id: 'trk-55',
  drivers: [{ id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55' }],
  assignments: [],
  checkIns: [{ driverId: 'drv-randy', at: '2026-11-16T11:00:00.000Z' }],
};
const noVisits = (truckId: string, date: string) => storedDay(truckId, date, [], null);
/** The stored days the Worker has, by "truckId date": each built at the clock asked for (none: as the Worker opens it). */
let storedDays: Record<string, (clock?: string) => TruckLogDay>;
/** Stores a Truck's day for the stub to answer, at whatever clock the page asks. */
const store = (truckId: string, date: string, rows: FleetExportRow[], asOf: string | null, options: { today?: boolean; randyCheckedIn?: boolean } = {}) => {
  storedDays[`${truckId} ${date}`] = (clock) => storedDay(truckId, date, rows, asOf, { ...options, clock });
};
/** The clock each read of a stored day asked for, in order; null when it asked for none. */
let asked: (string | null)[];

/** Randy, who usually drives Truck 55. */
const DRIVERS: Driver[] = [{ id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55', sortOrder: null, active: true }];

/** The active Trucks: 55 has its HCSS code, 12 has none yet. */
const TRUCKS: Truck[] = [
  { id: 'trk-12', number: '12', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-55', number: '55', hcssCode: 'MCK-55-17', hcssGuid: null, active: true },
];

beforeEach(() => {
  sent = [];
  refusal = null;
  answered = {};
  notConsidered = ['sunset'];
  notConsideredFails = false;
  cleared = [];
  storedDays = {};
  asked = [];
  api.mockClear();
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openPage = async () => {
  window.history.pushState(null, '', '/fleet-imports');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Fleet imports' });
};

const drop = (file: File) => fireEvent.drop(screen.getByRole('button', { name: /drop a fleet export/i }), { dataTransfer: { files: [file], types: ['Files'] } });

describe('The Fleet imports page', () => {
  it('says "18 new · 0 closed · 0 already stored" when the 16 Nov JSON is dropped, having sent its 18 rows', async () => {
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));

    expect(await screen.findByText('18 new · 0 closed · 0 already stored')).toBeTruthy();
    expect(screen.getByText(/EntryExit-1502\.json · Truck 55/)).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ fileName: 'EntryExit-1502.json', format: 'json' });
    expect(sent[0].rows).toHaveLength(18);
    expect(sent[0].rows.at(-1)).toMatchObject({ equipmentCode: 'MCK-55-17', geofenceCode: 'J25008 Los Flamboyanes', exitedAt: null });
  });

  it('takes a file picked instead of dropped', async () => {
    await openPage();
    fireEvent.change(screen.getByLabelText('Pick a file'), { target: { files: [new File([EXPORT_1502], 'pick.json', { type: 'application/json' })] } });
    expect(await screen.findByText('18 new · 0 closed · 0 already stored')).toBeTruthy();
  });

  it('says why a file that is not a Fleet export was not imported, and sends nothing', async () => {
    await openPage();
    drop(new File(['{"hello":1}'], 'notes.json', { type: 'application/json' }));
    expect(await screen.findByText(/no entry\/exit rows/i)).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it.each([
    [400, 'unknown_truck', 'No Truck has the HCSS code MCK-55-17. Set it in Settings.'],
    [400, 'more_than_one_truck', 'The file must hold one Truck.'],
    [400, 'not_a_fleet_export', 'This is not a Fleet export. Export the entry/exit report from HCSS Fleet and drop that.'],
    [403, 'imports_not_allowed', 'Fleet imports are allowed only on local, preview and staging.'],
  ])('shows the Worker\'s reason when it refuses the Import (%i %s)', async (status, error, message) => {
    refusal = { status, body: { error, message } };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('EntryExit-1502.json was not imported')).toBeTruthy();
    expect(screen.queryByText(/new · .* closed/)).toBeNull();
  });

  it('names each day the Import touched with its counts', async () => {
    answered = {
      added: 8, closed: 1, unchanged: 0,
      days: [
        { date: '2026-11-16', added: 3, closed: 1, unchanged: 0 },
        { date: '2026-11-17', added: 5, closed: 0, unchanged: 0 },
      ],
    };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    expect(await screen.findByText('Mon 16 Nov: 3 new · 1 closed; Tue 17 Nov: 5 new')).toBeTruthy();
  });

  it('lists the codes with no Place, each with Don\'t consider', async () => {
    answered = { codesWithNoPlace: [{ code: 'BROCKPORT' }, { code: 'GAS STATION' }] };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    const list = await screen.findByRole('list', { name: 'Codes with no Place' });
    expect(Array.from(list.querySelectorAll('li')).map((li) => li.firstChild?.textContent)).toEqual(['BROCKPORT', 'GAS STATION']);
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(["Don't consider BROCKPORT", "Don't consider GAS STATION"]);
  });

  it('Don\'t consider on an Import\'s code turns that Geofence to Not considered and takes it off that Import\'s codes', async () => {
    answered = { codesWithNoPlace: [{ code: 'BROCKPORT' }, { code: 'GAS STATION' }] };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    const list = await screen.findByRole('list', { name: 'Codes with no Place' });
    fireEvent.click(within(list).getByRole('button', { name: "Don't consider GAS STATION" }));
    await waitFor(() => expect(Array.from(list.querySelectorAll('li')).map((li) => li.firstChild?.textContent)).toEqual(['BROCKPORT']));
    expect(notConsidered).toContain('GAS STATION');
  });

  it('keeps the code listed and says so when Don\'t consider fails', async () => {
    answered = { codesWithNoPlace: [{ code: 'GAS STATION' }] };
    notConsideredFails = true;
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    const list = await screen.findByRole('list', { name: 'Codes with no Place' });
    fireEvent.click(within(list).getByRole('button', { name: "Don't consider GAS STATION" }));
    expect(await screen.findByText('Could not turn GAS STATION to Not considered')).toBeTruthy();
    expect(within(list).getByRole('button', { name: "Don't consider GAS STATION" })).toBeTruthy();
  });

  it('shows no codes with no Place when every code has one', async () => {
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    await screen.findByText('18 new · 0 closed · 0 already stored');
    expect(screen.queryByRole('list', { name: 'Codes with no Place' })).toBeNull();
  });
});

describe('Dropping an xlsx Fleet export', () => {
  /** The real 16 Nov xlsx, as Dave downloads it from HCSS Fleet. */
  const xlsx = () =>
    new File([Uint8Array.from(atob(XLSX.split(',')[1]), (c) => c.charCodeAt(0))], 'EntryExitReport.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

  it('asks which Truck it is for, offering only Trucks with an HCSS code, and imports its 20 rows for the one picked', async () => {
    await openPage();
    drop(xlsx());

    // Asked on the drop's own card: the stored day below has its Truck chips too.
    const imports = within(await screen.findByRole('region', { name: 'Imports' }));
    const pick = await imports.findByRole('button', { name: 'Truck 55 (MCK-55-17)' }, { timeout: 5000 });
    expect(imports.getByText(/which truck/i)).toBeTruthy();
    expect(imports.queryByRole('button', { name: /Truck 12/ })).toBeNull();
    expect(sent).toEqual([]);
    // The Trucks are chips; none is picked yet.
    expect(pick.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(pick);
    // The picked chip stays pressed while the Worker imports it.
    expect(imports.getByRole('button', { name: 'Truck 55 (MCK-55-17)' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('20 new · 0 closed · 0 already stored')).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ fileName: 'EntryExitReport.xlsx', format: 'xlsx' });
    expect(new Set(sent[0].rows.map((r) => r.equipmentCode))).toEqual(new Set(['MCK-55-17']));
    expect(sent[0].rows.at(-1)).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-16T21:03:25.000Z', exitedAt: null });
  });

  it('says why an xlsx that is not the entry/exit report was not imported, and asks for no Truck', async () => {
    await openPage();
    drop(new File([new Uint8Array([1, 2, 3])], 'notes.xlsx'));
    expect(await screen.findByText(/not an xlsx spreadsheet/i, undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(/which truck/i)).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('A stored day on the Fleet imports page', () => {
  /** The Trip log's rows: Left, From → To, Miles, Kind, Assignment, Why. */
  const tripLog = () =>
    within(within(screen.getByRole('region', { name: 'Trip log' })).getByRole('table', { name: 'Trips' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent));

  /** Taps the Truck's chip, then Yesterday: Mon 16 Nov, as today is Tue 17 Nov. */
  const pickMonday = async (truck: string) => {
    fireEvent.click(within(await screen.findByRole('group', { name: 'Truck' })).getByRole('button', { name: truck }));
    const day = screen.getByRole('group', { name: 'Day' });
    await waitFor(() => expect((within(day).getByRole('button', { name: 'Yesterday' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(day).getByRole('button', { name: 'Yesterday' }));
  };
  /** The quick pick pressed for the stored day, and the day it names. */
  const dayShown = () => ({
    pressed: within(screen.getByRole('group', { name: 'Day' }))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent),
    date: screen.getByRole('heading', { name: /^Stored day/ }).textContent,
  });

  it('shows the real Trip log of Truck 55 on Mon 16 Nov, with the 16:20 cut stored', async () => {
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF);
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');

    await screen.findByText('As of the Import at 16:25');
    const rows = tripLog();
    expect(rows[0].slice(0, 2)).toEqual(['06:24', 'Shop → J25008 Los Flamboyanes']);
    expect(rows.at(-1)!.slice(0, 2)).toEqual(['15:41', 'J25008 Los Flamboyanes → Shop']);
    const loadsOn = (label: string) => rows.filter((r) => r[3] === 'load' && r[4] === label).length;
    expect([loadsOn('A1'), loadsOn('A2')]).toEqual([4, 2]);
  });

  /** The Truck log header, as the paper's boxes: label → what is written in it. */
  const header = () => {
    const group = within(screen.getByRole('region', { name: 'Truck log' })).getByRole('group', { name: 'Truck log header' });
    return Object.fromEntries([...group.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
  };
  /** The Truck log's Assignment columns, in Dave's order: each as label → what is written in it. */
  const columns = () =>
    within(screen.getByRole('region', { name: 'Truck log' }))
      .getAllByRole('group', { name: /^Assignment \d/ })
      .map((col) => Object.fromEntries([...col.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));

  it('shows the Truck log of Mon 16 Nov: 06:24 to 16:03, miles blank for a meter reading, A1 and A2, the shop drives', async () => {
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF);
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');

    await screen.findByRole('region', { name: 'Truck log' });
    expect(header()).toMatchObject({
      Truck: '55 (MCK-55-17)',
      Date: 'Mon 16 Nov 2026',
      'Start time': '06:24',
      'End time': '16:03',
      'Start miles': 'meter reading',
      'End miles': 'meter reading',
      'Total hours': '9.64',
    });
    expect(columns().map((c) => [c['Pick up'], c['# of loads'], c['Trucking hours']])).toEqual([
      ['J25008 Los Flamboyanes', '4', '3.02'],
      ['Walworth Dolomite', '2', expect.any(String)],
    ]);
    const shop = within(screen.getByRole('group', { name: 'To and from the shop' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(shop.map((line) => line.slice(0, 11))).toEqual(['06:24–07:02', '15:41–16:03']);
    expect(screen.getByText('As of the Import at 16:25')).toBeTruthy();
  });

  it('has no end time on a day still going on, with only the 13:05 cut stored', async () => {
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1305)), '2026-11-16T18:10:00.000Z', { today: true });
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');

    await screen.findByRole('region', { name: 'Truck log' });
    expect(header()).toMatchObject({ 'Start time': '06:24', 'End time': '', 'Total hours': '' });
  });

  it('lists no codes with no Place when "sunset" is turned to Not considered', async () => {
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF);
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');
    await screen.findByRole('region', { name: 'Truck log' });
    expect(screen.queryByRole('list', { name: 'Codes with no Place' })).toBeNull();
  });

  it('Don\'t consider on "sunset" turns that Geofence to Not considered and the day re-reads without it', async () => {
    notConsidered = [];
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF);
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');
    const day = await screen.findByRole('region', { name: 'Stored day' });
    const list = await within(day).findByRole('list', { name: 'Codes with no Place' });
    const trips = () => within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row').map((r) => r.textContent ?? '');
    expect(trips().some((row) => row.includes('sunset'))).toBe(true);
    const reads = asked.length;

    fireEvent.click(within(list).getByRole('button', { name: "Don't consider sunset" }));

    await waitFor(() => expect(within(day).queryByRole('list', { name: 'Codes with no Place' })).toBeNull());
    expect(notConsidered).toEqual(['sunset']);
    expect(asked.length).toBeGreaterThan(reads);
    expect(trips().some((row) => row.includes('sunset'))).toBe(false);
  });

  it('says "No Trips yet" on a day with no stored visits, and that no Import has covered it', async () => {
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');
    expect(await screen.findByText(/No Trips yet/)).toBeTruthy();
    expect(screen.getByText('No Import has covered this day yet.')).toBeTruthy();
  });

  it('offers only Trucks with an HCSS code, and opens on today', async () => {
    await openPage();
    const trucks = await screen.findByRole('group', { name: 'Truck' });
    await waitFor(() => expect(within(trucks).getAllByRole('button').map((o) => o.textContent)).toEqual(['Truck 55 (MCK-55-17)']));
    expect(within(trucks).getByRole('button', { name: 'Truck 55 (MCK-55-17)' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(dayShown()).toEqual({ pressed: ['Today'], date: 'Stored day · Tue, Nov 17' }));
  });

  it('says when it tries again after a day could not be read, and does on the next pick', async () => {
    storedDays['trk-55 2026-11-16'] = () => {
      throw new TypeError('Failed to fetch');
    };
    await openPage();
    await pickMonday('Truck 55 (MCK-55-17)');
    expect(await screen.findByText('Could not load the day. It tries again when you pick a Truck, a day or a time.')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('group', { name: 'Day' })).getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('No Import has covered this day yet.')).toBeTruthy();
  });

  it('shows the Truck and day an Import just touched', async () => {
    store('trk-55', '2026-11-16', readFleetJson(JSON.parse(EXPORT_1502)), '2026-11-16T20:05:00.000Z');
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    await screen.findByText('18 new · 0 closed · 0 already stored');
    await waitFor(() => expect(dayShown()).toEqual({ pressed: ['Yesterday'], date: 'Stored day · Mon, Nov 16' }));
    expect(await screen.findByText('As of the Import at 15:05')).toBeTruthy();
  });

  describe('the replay clock and the Scheduler and Driver views', () => {
    const A1 = 'First · Haul · J25008 Los Flamboyanes → Villager · Fill · Truck 55 (his own)';
    const A2 = 'Then · Haul · Walworth Dolomite → J25008 Los Flamboyanes · 1&2 stone · Truck 55 (his own)';
    // What each card says after its place in his day and its kind pill ("1 ·Haul") and its Loads.
    const CARD_A1 = 'FillPick upJ25008 Los FlamboyanesDrop offVillager';
    const CARD_A2 = '1&2 stonePick upWalworth DolomiteDrop offJ25008 Los Flamboyanes';
    const scheduler = () => screen.getByRole('region', { name: 'Scheduler view' });
    /** Randy's blocks as Dave reads them, in Dave's order. */
    const randy = () =>
      within(within(scheduler()).getByRole('article', { name: 'Randy' }))
        .getAllByRole('listitem')
        .map((block) => block.textContent);
    /** Randy's cards on his phone, in Dave's order. */
    const cards = () => within(screen.getByRole('region', { name: 'Driver view' })).getAllByRole('article').map((card) => card.textContent);
    const clock = () => screen.getByRole('slider', { name: 'Clock' }) as HTMLInputElement;
    const setClock = (minutes: number) => fireEvent.change(clock(), { target: { value: String(minutes) } });

    const openMonday = async () => {
      store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF);
      await openPage();
      await pickMonday('Truck 55 (MCK-55-17)');
      await within(await screen.findByRole('region', { name: 'Scheduler view' })).findByRole('article', { name: 'Randy' });
    };

    it("shows the Unplanned work in Randy's lane, after A2, when he checked in to Truck 55", async () => {
      store('trk-55', '2026-11-16', readFleetJson(JSON.parse(CUT_1620)), AS_OF, { randyCheckedIn: true });
      await openPage();
      await pickMonday('Truck 55 (MCK-55-17)');
      const lane = await within(await screen.findByRole('region', { name: 'Scheduler view' })).findByRole('article', { name: 'Randy' });
      expect(within(lane).getByRole('group', { name: '1 Unplanned work' }).textContent).toBe('1 Unplanned work' + 'J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43');
      expect(within(scheduler()).queryByRole('article', { name: /^Driver not known/ })).toBeNull();
    });

    it('shows the Unplanned work in a row under the lanes, "Driver not known · Truck 55", when nobody checked in', async () => {
      await openMonday();
      expect(within(within(scheduler()).getByRole('article', { name: 'Randy' })).queryByText(/Unplanned work/)).toBeNull();
      const row = within(scheduler()).getByRole('article', { name: 'Driver not known · Truck 55' });
      expect(within(row).getByRole('group', { name: '1 Unplanned work' }).textContent).toBe('1 Unplanned work' + 'J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43');
    });

    it("opens Mon 16 Nov at the end of the day: Randy's lane with A1 and A2 Done, and his cards with their last Loads", async () => {
      await openMonday();
      expect(screen.getByText('end of day')).toBeTruthy();
      expect(clock().value).toBe(String(23 * 60 + 59));
      expect(randy()).toEqual([`${A1} · 4 Loads · Done · since 08:24`, `${A2} · 2 Loads · Done · since 11:30`]);
      expect(cards()).toEqual([`1 ·Haul4 Loads · last 11:25${CARD_A1}`, `2 ·Haul2 Loads · last 13:54${CARD_A2}`]);
      expect(asked.at(-1)).toBeNull();
    });

    it('dragged to 10:02, shows A1 with 2 Loads, Now, 1.59 h, and the Trip log and Truck log follow it', async () => {
      await openMonday();
      setClock(10 * 60 + 2);

      await waitFor(() => expect(randy()).toEqual([`${A1} · 2 Loads · Now · since 08:24`, A2]));
      expect(asked.at(-1)).toBe('10:02');
      expect(screen.getByText('10:02')).toBeTruthy();
      expect(cards()[0]).toMatch(/^1 ·HaulNow2 Loads · last /);
      expect(columns()[0]).toMatchObject({ '# of loads': '2', 'Trucking hours': '1.59' });
      expect(header()).toMatchObject({ 'Start time': '06:24', 'End time': '' });
      expect(tripLog().every(([left]) => left! <= '10:02')).toBe(true);
    });

    it('plays the day in 10-minute steps', async () => {
      await openMonday();
      setClock(10 * 60);
      await screen.findByText('10:00');
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Play the day' }));
        act(() => {
          vi.advanceTimersToNextTimer();
        });
        expect(await screen.findByText('10:10')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
        await waitFor(() => expect(asked.at(-1)).toBe('10:10'));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Start over', () => {
    const startOver = () => screen.getByRole('region', { name: 'Start over' });

    it('asks once more, then clears every Import and stored visit, empties the Imports list and reads the day again', async () => {
      store('trk-55', '2026-11-17', readFleetJson(JSON.parse(CUT_1305)), AS_OF);
      await openPage();
      drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
      expect(await screen.findByText('18 new · 0 closed · 0 already stored')).toBeTruthy();

      fireEvent.click(within(startOver()).getByRole('button', { name: 'Clear Fleet imports' }));
      expect(cleared).toEqual([]);
      fireEvent.click(within(startOver()).getByRole('button', { name: 'Yes, clear them' }));

      await waitFor(() => expect(cleared).toEqual(['']));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Imports' })).toBeNull());
      expect(await screen.findByText('No Import has covered this day yet.')).toBeTruthy();
      expect(within(startOver()).getByRole('button', { name: 'Clear Fleet imports' })).toBeTruthy();
    });

    it('clears the Geofences too with the switch on', async () => {
      await openPage();
      fireEvent.click(within(startOver()).getByRole('switch', { name: 'Also clear Geofences' }));
      fireEvent.click(within(startOver()).getByRole('button', { name: 'Clear Fleet imports' }));
      fireEvent.click(within(startOver()).getByRole('button', { name: 'Yes, clear them' }));
      await waitFor(() => expect(cleared).toEqual(['?geofences=1']));
    });

    it('sends nothing on Cancel', async () => {
      await openPage();
      fireEvent.click(within(startOver()).getByRole('button', { name: 'Clear Fleet imports' }));
      fireEvent.click(within(startOver()).getByRole('button', { name: 'Cancel' }));
      expect(within(startOver()).getByRole('button', { name: 'Clear Fleet imports' })).toBeTruthy();
      expect(cleared).toEqual([]);
    });
  });
});
