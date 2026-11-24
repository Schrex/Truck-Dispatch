import { describe, expect, it } from 'vitest';
import { apiOn, inspection } from './testing/api';
import { fleetRows, fleetXlsxRows, setUpTruck55 } from './testing/fleet';
import { localD1 } from './testing/localD1';
import { easternTime } from '../../shared/days';
import type { Assignment, Day, DriverDay, Place, StoredUnplanned, TruckLogDay } from '../../shared/types';

const d1 = localD1();
const send = apiOn(d1);

/** Sunday 15 Nov 2026, 5 PM US Eastern: Dave plans Monday. */
const SUNDAY_EVENING = '2026-11-15T22:00:00.000Z';
/** Monday 16 Nov 2026, 4:25 PM US Eastern: just after the 16:20 cut was pulled. */
const AFTER_1620 = '2026-11-16T21:25:00.000Z';
/** Tuesday 17 Nov 2026, 8 AM US Eastern: the morning after. */
const TUESDAY = '2026-11-17T13:00:00.000Z';
const MONDAY = '2026-11-16';

/** The 16 Nov day set up: Truck 55, Randy and the Places, with each Place's id by its short name. */
async function setUpDay() {
  const { truckId } = await setUpTruck55(send);
  const places = ((await (await send('GET', '/api/places')).json()) as { places: Place[] }).places;
  const drivers = ((await (await send('GET', '/api/drivers')).json()) as { drivers: { id: string; name: string }[] }).drivers;
  const placeId = (shortName: string) => places.find((p) => p.shortName === shortName)!.id;
  const randy = drivers.find((d) => d.name === 'Randy')!.id;
  return { truckId, randy, placeId };
}

/** A Draft on Mon 16 Nov, added on Sunday evening. */
async function draft(body: Record<string, unknown>): Promise<Assignment> {
  const response = await send('POST', '/api/assignments', { date: MONDAY, ...body }, { NOW: SUNDAY_EVENING });
  expect(response.status).toBe(201);
  return ((await response.json()) as { assignment: Assignment }).assignment;
}

/** An Assignment on Mon 16 Nov, Assigned on Sunday evening. */
async function assigned(body: Record<string, unknown>): Promise<Assignment> {
  const made = await draft(body);
  expect((await send('POST', `/api/assignments/${made.id}/assign`, undefined, { NOW: SUNDAY_EVENING })).status).toBe(200);
  return made;
}

/** Dave's two Assignments for Randy: A1 J25008 → Villager, A2 Walworth → J25008. */
async function planMonday() {
  const day = await setUpDay();
  const a1 = await assigned({ driverId: day.randy, fromPlaceId: day.placeId('J25008 Los Flamboyanes'), toPlaceId: day.placeId('Villager') });
  const a2 = await assigned({ driverId: day.randy, fromPlaceId: day.placeId('Walworth Dolomite'), toPlaceId: day.placeId('J25008 Los Flamboyanes') });
  return { ...day, a1, a2 };
}

const importCut = (name: string, NOW = AFTER_1620) =>
  send('POST', '/api/fleet-imports', { fileName: name, format: 'json', rows: fleetRows(name) }, { NOW });

const readLog = async (truckId: string, { date = MONDAY, at, NOW = TUESDAY }: { date?: string; at?: string; NOW?: string } = {}) => {
  const response = await send('GET', `/api/trucks/${truckId}/days/${date}${at ? `?at=${at}` : ''}`, undefined, { NOW });
  expect(response.status).toBe(200);
  return (await response.json()) as TruckLogDay;
};

/** A Trip as the Trip log reads: "06:24 Shop → J25008 Los Flamboyanes". */
const tripLine = (log: TruckLogDay, trip: TruckLogDay['tripDay']['trips'][number]) => {
  const name = (id: string | null, code: string) => log.places.find((p) => p.id === id)?.name ?? code;
  return `${easternTime(trip.leftAt)} ${name(trip.fromPlaceId, trip.fromCode)} → ${name(trip.toPlaceId, trip.toCode)}`;
};

describe('The Truck log of a stored day', () => {
  it('shows the real 16 Nov Trip log of Truck 55 once the 16:20 cut is imported', async () => {
    const { truckId, a1, a2 } = await planMonday();
    expect((await importCut('2026-11-16-cut-1620.json')).status).toBe(201);

    const log = await readLog(truckId);
    const trips = log.tripDay.trips;
    expect(tripLine(log, trips[0])).toBe('06:24 Shop → J25008 Los Flamboyanes');
    expect(tripLine(log, trips.at(-1)!)).toBe('15:41 J25008 Los Flamboyanes → Shop');
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
    expect(log.labels).toEqual({ [a1.id]: 'A1', [a2.id]: 'A2' });
  });
});

describe('The Truck log of Mon 16 Nov, a past day', () => {
  it('runs 06:24 to 16:03 with miles blank, A1 4 Loads in 3.02 h, A2 2 Loads, and the shop drives, as of the latest Import', async () => {
    const { truckId, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    const day = log.tripDay.truckDay;
    expect([easternTime(day.startAt!), easternTime(day.endAt!)]).toEqual(['06:24', '16:03']);
    expect(day).toMatchObject({ startMiles: null, endMiles: null });
    const column = (id: string) => log.truckLog.columns.find((c) => c.id === id)!;
    expect(column(a1.id)).toMatchObject({ loads: 4, truckingHours: 3.02 });
    expect(column(a2.id).loads).toBe(2);
    expect(log.truckLog.shopTrips.map((t) => `${easternTime(t.leftAt)} ${t.from} → ${t.to}`)).toEqual([
      '06:24 Shop → J25008 Los Flamboyanes',
      '15:41 J25008 Los Flamboyanes → Shop',
    ]);
    expect(log.asOf).toBe(AFTER_1620);
  });

  it('builds the same day from the 15:02 JSON closed by the xlsx, which gives no odometers', async () => {
    const { truckId, a1, a2 } = await planMonday();
    await importCut('2026-11-16-1502.json', '2026-11-16T20:05:00.000Z');
    const xlsx = '2026-11-16-EntryExitReport.xlsx';
    const rows = await fleetXlsxRows(xlsx, 'MCK-55-17');
    expect((await send('POST', '/api/fleet-imports', { fileName: xlsx, format: 'xlsx', rows }, { NOW: AFTER_1620 })).status).toBe(201);

    const log = await readLog(truckId);
    const day = log.tripDay.truckDay;
    expect([easternTime(day.startAt!), easternTime(day.endAt!)]).toEqual(['06:24', '16:03']);
    const lastTrip = log.tripDay.trips.at(-1)!;
    expect(tripLine(log, lastTrip)).toBe('15:41 J25008 Los Flamboyanes → Shop');
    expect(lastTrip.miles).toBeNull();
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
  });

  it('builds the day from the xlsx alone, every Trip with miles blank', async () => {
    const { truckId, a1, a2 } = await planMonday();
    const xlsx = '2026-11-16-EntryExitReport.xlsx';
    const rows = await fleetXlsxRows(xlsx, 'MCK-55-17');
    expect((await send('POST', '/api/fleet-imports', { fileName: xlsx, format: 'xlsx', rows }, { NOW: AFTER_1620 })).status).toBe(201);

    const log = await readLog(truckId);
    expect(log.tripDay.trips.every((t) => t.miles === null)).toBe(true);
    expect([easternTime(log.tripDay.truckDay.startAt!), easternTime(log.tripDay.truckDay.endAt!)]).toEqual(['06:24', '16:03']);
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
  });
});

describe('The end time of a stored day still going on', () => {
  /** Monday 16 Nov, 13:10 and 16:25 US Eastern: today for the Worker. */
  const AT_1310 = '2026-11-16T18:10:00.000Z';

  it('has none with only the 13:05 cut stored, and appears once the 16:20 cut is imported', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1305.json', AT_1310);
    expect((await readLog(truckId, { NOW: AT_1310 })).tripDay.truckDay.endAt).toBeNull();

    await importCut('2026-11-16-cut-1620.json', AFTER_1620);
    const log = await readLog(truckId, { NOW: AFTER_1620 });
    expect(log.dayOver).toBe(false);
    expect(easternTime(log.tripDay.truckDay.endAt!)).toBe('16:03');
  });

  it('moves "as of" to a later drop of the 16:20 cut, though it changed nothing', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1620.json', AFTER_1620);
    const later = '2026-11-16T22:30:00.000Z';
    await importCut('2026-11-16-cut-1620.json', later);
    expect((await readLog(truckId)).asOf).toBe(later);
  });
});

describe('Which Assignments a stored day matches', () => {
  it('matches no Trip to a Draft that day: its Loads are Unplanned work', async () => {
    const { truckId, randy, placeId } = await setUpDay();
    const a1 = await draft({ driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.tripDay.trips.some((t) => t.match.assignmentId === a1.id)).toBe(false);
    expect(log.assignments).toEqual([]);
    expect(log.truckLog.unplanned.length).toBeGreaterThan(0);
  });

  it('still matches a cancelled Assignment\'s Trips before the cancel, and shows it', async () => {
    const { truckId, a2 } = await planMonday();
    // Dave cancels A2 at 13:00 on Monday, between its first Load (12:08) and its second (13:29).
    expect((await send('DELETE', `/api/assignments/${a2.id}`, undefined, { NOW: '2026-11-16T18:00:00.000Z' })).status).toBe(200);
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.truckLog.columns.find((c) => c.id === a2.id)?.loads).toBe(1);
    expect(log.assignments.find((a) => a.id === a2.id)?.cancelledAt).toBe('2026-11-16T18:00:00.000Z');
  });

  it('still matches a discarded Assignment\'s Trips, though it is not shown', async () => {
    const { truckId, a1, a2 } = await planMonday();
    expect((await send('DELETE', `/api/assignments/${a2.id}`, undefined, { NOW: '2026-11-16T18:00:00.000Z' })).status).toBe(200);
    expect((await send('POST', `/api/assignments/${a2.id}/discard`, undefined, { NOW: '2026-11-16T18:05:00.000Z' })).status).toBe(204);
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    const firstWalworthLoad = log.tripDay.trips.find((t) => easternTime(t.leftAt) === '12:08')!;
    expect(firstWalworthLoad.match).toMatchObject({ kind: 'load', assignmentId: a2.id });
    expect(log.tripDay.unplanned.some((w) => w.trips.some((t) => t.leftAt === firstWalworthLoad.leftAt))).toBe(false);
    expect(log.assignments.map((a) => a.id)).toEqual([a1.id]);
    expect(log.truckLog.columns.map((c) => c.id)).toEqual([a1.id]);
  });

  it('reads only the Assignments that name the Truck, or whose Driver usually drives it', async () => {
    const { truckId, randy, placeId } = await setUpDay();
    const other = await send('POST', '/api/trucks', { number: '61' });
    const truck61 = ((await other.json()) as { truck: { id: string } }).truck.id;
    const own = await assigned({ driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await assigned({ driverId: randy, truckId: truck61, fromPlaceId: placeId('Walworth Dolomite'), toPlaceId: placeId('J25008 Los Flamboyanes') });
    await importCut('2026-11-16-cut-1620.json');

    expect((await readLog(truckId)).assignments.map((a) => a.id)).toEqual([own.id]);
  });
});

describe('Codes with no Place on a stored day', () => {
  it('leaves out "sunset", on the Not considered list, and lists it once it is taken off', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');
    expect((await readLog(truckId)).codesWithNoPlace).toEqual([]);

    const [sunset] = (await (await send('GET', '/api/not-considered')).json() as { 'not-considered': { id: string }[] })['not-considered'];
    await send('PATCH', `/api/not-considered/${sunset.id}`, { active: false });
    expect((await readLog(truckId)).codesWithNoPlace).toEqual([{ code: 'sunset' }]);
  });
});

/**
 * A real xlsx day (Mon 23 Nov 2026, Truck 53): [geofence code, entered, exited], UTC,
 * no odometers. A fuel stop at GAS STATION on the way out, and WEITSMANS, a fence
 * crossed for 61 s on a way back, are on no Place.
 */
const NOV_23: [string, string, string | null][] = [
  ['SHOP', '2026-11-23T05:00:00.000Z', '2026-11-23T11:39:31.000Z'],
  ['GAS STATION', '2026-11-23T11:40:32.000Z', '2026-11-23T11:44:37.000Z'],
  ['J2601 Talmudical', '2026-11-23T12:07:05.000Z', '2026-11-23T12:51:11.000Z'],
  ['VILLAGER', '2026-11-23T13:04:25.000Z', '2026-11-23T13:09:33.000Z'],
  ['J2601 Talmudical', '2026-11-23T13:23:50.000Z', '2026-11-23T13:27:55.000Z'],
  ['VILLAGER', '2026-11-23T13:41:10.000Z', '2026-11-23T13:47:17.000Z'],
  ['J2601 Talmudical', '2026-11-23T14:01:35.000Z', '2026-11-23T14:05:40.000Z'],
  ['VILLAGER', '2026-11-23T14:31:09.000Z', '2026-11-23T14:41:18.000Z'],
  ['J2601 Talmudical', '2026-11-23T14:56:35.000Z', '2026-11-23T15:35:54.000Z'],
  ['VILLAGER', '2026-11-23T15:47:06.000Z', '2026-11-23T15:57:18.000Z'],
  ['J2601 Talmudical', '2026-11-23T16:14:39.000Z', '2026-11-23T16:18:44.000Z'],
  ['VILLAGER', '2026-11-23T16:31:59.000Z', '2026-11-23T16:47:09.000Z'],
  ['J2601 Talmudical', '2026-11-23T17:01:26.000Z', '2026-11-23T17:06:32.000Z'],
  ['WEITSMANS', '2026-11-23T17:19:46.000Z', '2026-11-23T17:20:47.000Z'],
  ['VILLAGER', '2026-11-23T17:20:47.000Z', '2026-11-23T17:33:01.000Z'],
  ['J2601 Talmudical', '2026-11-23T17:47:17.000Z', '2026-11-23T18:23:50.000Z'],
  ['VILLAGER', '2026-11-23T18:37:06.000Z', '2026-11-23T18:43:13.000Z'],
  ['J2601 Talmudical', '2026-11-23T18:57:29.000Z', '2026-11-23T19:08:41.000Z'],
  ['VILLAGER', '2026-11-23T19:20:53.000Z', '2026-11-23T19:37:54.000Z'],
  ['J2601 Talmudical', '2026-11-23T19:52:11.000Z', '2026-11-23T19:59:21.000Z'],
  ['VILLAGER', '2026-11-23T20:10:34.000Z', '2026-11-23T20:17:53.000Z'],
  ['J2601 Talmudical', '2026-11-23T20:32:09.000Z', '2026-11-23T20:37:15.000Z'],
  ['SHOP', '2026-11-23T21:01:42.000Z', null],
];

describe('The Not considered list on a real day (Mon 23 Nov, Truck 53)', () => {
  /** Truck 53, its Driver, the three Places, and one Assignment Villager → J2601 Talmudical, Assigned the evening before; the Driver checks in at 06:00. */
  async function setUpNov23() {
    const truck = await send('POST', '/api/trucks', { number: '53', hcssCode: 'SAMPLE-53' });
    const truckId = ((await truck.json()) as { truck: { id: string } }).truck.id;
    const driver = await send('POST', '/api/drivers', { name: 'Sample Driver N', defaultTruckId: truckId });
    const driverId = ((await driver.json()) as { driver: { id: string } }).driver.id;
    const placeIds: Record<string, string> = {};
    for (const [shortName, kind] of [['SHOP', 'shop'], ['VILLAGER', 'plant'], ['J2601 Talmudical', 'job_site']]) {
      const made = await send('POST', '/api/places', { shortName, kind, geofenceCode: shortName });
      placeIds[shortName] = ((await made.json()) as { place: { id: string } }).place.id;
    }
    const evening = '2026-11-22T22:00:00.000Z';
    const made = await send('POST', '/api/assignments', { date: '2026-11-23', driverId, fromPlaceId: placeIds.VILLAGER, toPlaceId: placeIds['J2601 Talmudical'] }, { NOW: evening });
    const { assignment } = (await made.json()) as { assignment: Assignment };
    expect((await send('POST', `/api/assignments/${assignment.id}/assign`, undefined, { NOW: evening })).status).toBe(200);
    await checkIn(driverId, truckId, '2026-11-23T11:00:00.000Z');
    const rows = NOV_23.map(([geofenceCode, enteredAt, exitedAt]) => ({ equipmentCode: 'SAMPLE-53', geofenceCode, enteredAt, exitedAt, entryOdometer: null, exitOdometer: null }));
    const imported = await send('POST', '/api/fleet-imports', { fileName: 'EntryExitReport.xlsx', format: 'xlsx', rows }, { NOW: '2026-11-23T21:30:00.000Z' });
    expect(imported.status).toBe(201);
    return { truckId, assignment };
  }
  const readNov23 = (truckId: string) => readLog(truckId, { date: '2026-11-23', NOW: '2026-11-24T13:00:00.000Z' });

  it('with GAS STATION and WEITSMANS not considered: 9 Loads, no Unplanned work, no gas station in the Trip log, and the day ends at the shop at 16:01', async () => {
    await send('POST', '/api/not-considered', { code: 'GAS STATION' });
    await send('POST', '/api/not-considered', { code: 'weitsmans' });
    const { truckId, assignment } = await setUpNov23();

    const log = await readNov23(truckId);
    expect(log.truckLog.columns.find((c) => c.id === assignment.id)?.loads).toBe(9);
    expect(log.truckLog.unplanned).toEqual([]);
    expect(log.tripDay.trips.map((t) => tripLine(log, t)).filter((line) => /GAS STATION|WEITSMANS/.test(line))).toEqual([]);
    expect(tripLine(log, log.tripDay.trips[0])).toBe('06:39 SHOP → J2601 Talmudical');
    expect(easternTime(log.tripDay.truckDay.endAt!)).toBe('16:01');
    expect(log.codesWithNoPlace).toEqual([]);
  });

  it('without them, the drive from the gas station is Unplanned work and WEITSMANS splits a haul, and both are listed with no Place', async () => {
    const { truckId, assignment } = await setUpNov23();

    const log = await readNov23(truckId);
    expect(log.truckLog.unplanned.map((w) => w.places.join(' ⇄ '))).toEqual(['GAS STATION ⇄ J2601 Talmudical', 'J2601 Talmudical ⇄ WEITSMANS']);
    expect(log.truckLog.columns.find((c) => c.id === assignment.id)?.loads).toBe(9);
    expect(log.codesWithNoPlace).toEqual([{ code: 'GAS STATION' }, { code: 'WEITSMANS' }]);
  });
});

describe('A stored day with no visits', () => {
  it('has no Trips and no Import to be as of', async () => {
    const { truckId } = await planMonday();
    const log = await readLog(truckId);
    expect(log.tripDay.trips).toEqual([]);
    expect(log.asOf).toBeNull();
    expect(log.codesWithNoPlace).toEqual([]);
  });
});

describe('The clock of a stored day', () => {
  it('opens a past day at its end, over, as of its latest Import', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1305.json', '2026-11-16T18:10:00.000Z');
    await importCut('2026-11-16-cut-1620.json');
    const log = await readLog(truckId);
    expect(log).toMatchObject({ clock: '23:59', dayOver: true, asOf: AFTER_1620, at: AFTER_1620 });
    // Over, the day ends at its last arrival: back at the shop at 16:03.
    expect(easternTime(log.tripDay.truckDay.endAt!)).toBe('16:03');
  });

  it('opens today at the time of the latest Import, not the Worker\'s clock', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1305.json', '2026-11-16T18:10:00.000Z');
    const log = await readLog(truckId, { NOW: '2026-11-16T22:00:00.000Z' });
    expect(log).toMatchObject({ clock: '13:10', dayOver: false, asOf: '2026-11-16T18:10:00.000Z', at: '2026-11-16T18:10:00.000Z' });
  });

  it('builds the day at the end of the clock minute asked for', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');
    const log = await readLog(truckId, { at: '10:02' });
    expect(log).toMatchObject({ clock: '10:02', dayOver: false, at: '2026-11-16T15:02:59.000Z' });
    expect(log.tripDay.trips.every((t) => Date.parse(t.leftAt) <= Date.parse(log.at))).toBe(true);
    expect(log.tripDay.truckDay.endAt).toBeNull();
  });

  it("gives A1 its Trip part at 10:02: 2 Loads, Now, 1.59 h, and A2 none, no Trip matching it yet", async () => {
    const { truckId, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');
    const log = await readLog(truckId, { at: '10:02' });
    const part = (id: string) => log.assignments.find((a) => a.id === id)?.trips;
    expect(part(a1.id)).toMatchObject({ loads: 2, status: 'now', truckingHours: 1.59 });
    expect(easternTime(part(a1.id)!.since!)).toBe('08:24');
    expect(part(a2.id)).toBeUndefined();
    expect(log.truckLog.columns.find((c) => c.id === a1.id)).toMatchObject({ loads: 2, truckingHours: 1.59 });
  });

  it('never builds the day later than its latest Import, even when a later clock is asked for', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1305.json', '2026-11-16T18:10:00.000Z');
    expect((await readLog(truckId, { at: '16:00' })).at).toBe('2026-11-16T18:10:00.000Z');
  });
});

const readBoard = async ({ date = MONDAY, NOW = TUESDAY }: { date?: string; NOW?: string } = {}) => {
  const response = await send('GET', `/api/assignments?date=${date}`, undefined, { NOW });
  expect(response.status).toBe(200);
  return ((await response.json()) as { assignments: Assignment[] }).assignments;
};

describe('Trip parts on the day read', () => {
  it("gives Randy's blocks their Loads, Done and since once the 16:20 cut is imported", async () => {
    const { a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');

    const board = await readBoard();
    const part = (id: string) => board.find((a) => a.id === id)?.trips;
    expect(part(a1.id)).toMatchObject({ loads: 4, status: 'done' });
    expect(part(a2.id)).toMatchObject({ loads: 2, status: 'done' });
    expect([easternTime(part(a1.id)!.since!), easternTime(part(a2.id)!.since!)]).toEqual(['08:24', '11:30']);
  });

  it('gives no Trip part to a Draft, or to another Driver on another Truck', async () => {
    const { randy, placeId } = await planMonday();
    const truck61 = ((await (await send('POST', '/api/trucks', { number: '61' })).json()) as { truck: { id: string } }).truck.id;
    const sam = ((await (await send('POST', '/api/drivers', { name: 'Sam', defaultTruckId: truck61 })).json()) as { driver: { id: string } }).driver.id;
    const samsBlock = await assigned({ driverId: sam, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    const randysDraft = await draft({ driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await importCut('2026-11-16-cut-1620.json');

    const board = await readBoard();
    expect(board.find((a) => a.id === samsBlock.id)).not.toHaveProperty('trips');
    expect(board.find((a) => a.id === randysDraft.id)).not.toHaveProperty('trips');
  });

  it('answers a day with no stored visits exactly as before', async () => {
    const { randy, placeId } = await planMonday();
    const tuesday = { date: '2026-11-17', driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') };
    const made = await send('POST', '/api/assignments', tuesday, { NOW: SUNDAY_EVENING });
    const { assignment } = (await made.json()) as { assignment: Assignment };
    await send('POST', `/api/assignments/${assignment.id}/assign`, undefined, { NOW: SUNDAY_EVENING });
    const readTuesday = async () => (await send('GET', '/api/assignments?date=2026-11-17', undefined, { NOW: TUESDAY })).text();
    const before = await readTuesday();

    await importCut('2026-11-16-cut-1620.json');

    expect(await readTuesday()).toBe(before);
  });
});

const readDriver = async (driverId: string, { date = MONDAY, NOW = TUESDAY }: { date?: string; NOW?: string } = {}) => {
  const response = await send('GET', `/api/drivers/${driverId}/days/${date}`, undefined, { NOW });
  expect(response.status).toBe(200);
  return ((await response.json()) as { assignments: Assignment[] }).assignments;
};

describe("Trip parts on the Driver's day read", () => {
  it("gives Randy's cards their Loads and the last one's time once the 16:20 cut is imported", async () => {
    const { randy, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');

    const cards = await readDriver(randy);
    const part = (id: string) => cards.find((a) => a.id === id)?.trips;
    expect(part(a1.id)).toMatchObject({ loads: 4, status: 'done' });
    expect(part(a2.id)).toMatchObject({ loads: 2, status: 'done' });
    expect([easternTime(part(a1.id)!.lastLoadAt!), easternTime(part(a2.id)!.lastLoadAt!)]).toEqual(['11:25', '13:54']);
  });

  it('marks A1 Now with only the 10:15 cut stored, later that day', async () => {
    const { randy, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1015.json', '2026-11-16T15:20:00.000Z');

    const cards = await readDriver(randy, { NOW: '2026-11-16T20:00:00.000Z' });
    expect(cards.find((a) => a.id === a1.id)?.trips?.status).toBe('now');
    expect(cards.find((a) => a.id === a2.id)?.trips?.status).not.toBe('now');
  });

  it('answers a day with no stored visits exactly as before', async () => {
    const { randy, placeId } = await planMonday();
    const tuesday = { date: '2026-11-17', driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') };
    const { assignment } = (await (await send('POST', '/api/assignments', tuesday, { NOW: SUNDAY_EVENING })).json()) as { assignment: Assignment };
    await send('POST', `/api/assignments/${assignment.id}/assign`, undefined, { NOW: SUNDAY_EVENING });
    const readTuesday = async () => (await send('GET', `/api/drivers/${randy}/days/2026-11-17`, undefined, { NOW: TUESDAY })).text();
    const before = await readTuesday();

    await importCut('2026-11-16-cut-1620.json');

    expect(await readTuesday()).toBe(before);
  });
});

/** Monday 16 Nov at HH:MM US Eastern, as the Worker's clock. */
const mondayAt = (hhmm: string) => `2026-11-16T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`;

/** The Driver checks in to the Truck through the check-in route, the Worker's clock at `NOW`. */
async function checkIn(driverId: string, truckId: string, NOW: string) {
  expect((await send('POST', '/api/inspections', inspection({ driverId, truckId }), { NOW })).status).toBe(201);
}

describe('The Driver of a stored day, from check-ins', () => {
  it('names Randy when he checked in to Truck 55 at 06:00, and A1 and A2 get their Loads', async () => {
    const { truckId, randy, a1, a2 } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.tripDay.truckDay.driver?.name).toBe('Randy');
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
  });

  it("names Sample Driver A when he checked in instead, and matches the Trips against his Assignments, not Randy's", async () => {
    const { truckId, a1, a2, placeId } = await planMonday();
    const hisA1 = await assigned({ driverId: 'drv-a', truckId, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    const hisA2 = await assigned({ driverId: 'drv-a', truckId, fromPlaceId: placeId('Walworth Dolomite'), toPlaceId: placeId('J25008 Los Flamboyanes') });
    await checkIn('drv-a', truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.tripDay.truckDay.driver?.name).toBe('Sample Driver A');
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(hisA1.id), loads(hisA2.id)]).toEqual([4, 2]);
    expect([loads(a1.id), loads(a2.id)]).toEqual([0, 0]);
  });

  it('hands over at the second check-in: A before 12:00, B from 12:00, each Trip matching the Driver at its time', async () => {
    const { truckId, placeId } = await setUpDay();
    // A's Assignment is A1's route (Loads 08:24–11:14); B's is A2's (Loads 12:08, 13:29).
    const hisA1 = await assigned({ driverId: 'drv-a', truckId, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    const hisA2 = await assigned({ driverId: 'drv-b', truckId, fromPlaceId: placeId('Walworth Dolomite'), toPlaceId: placeId('J25008 Los Flamboyanes') });
    // And the other way round, so a Trip matching the wrong Driver would show.
    const wrongA1 = await assigned({ driverId: 'drv-b', truckId, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    const wrongA2 = await assigned({ driverId: 'drv-a', truckId, fromPlaceId: placeId('Walworth Dolomite'), toPlaceId: placeId('J25008 Los Flamboyanes') });
    await checkIn('drv-a', truckId, mondayAt('06:00'));
    await checkIn('drv-b', truckId, mondayAt('12:00'));
    await importCut('2026-11-16-cut-1620.json');

    expect((await readLog(truckId, { at: '11:59' })).tripDay.truckDay.driver?.name).toBe('Sample Driver A');
    expect((await readLog(truckId, { at: '12:00' })).tripDay.truckDay.driver?.name).toBe('Sample Driver B');
    const log = await readLog(truckId);
    expect(log.tripDay.truckDay.driver?.name).toBe('Sample Driver B');
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(hisA1.id), loads(hisA2.id), loads(wrongA1.id), loads(wrongA2.id)]).toEqual([4, 2, 0, 0]);
  });

  it("matches a checked-in Driver's Assignment that names another Truck, and shows it on this Truck's log", async () => {
    const { truckId, placeId } = await setUpDay();
    const onTruck21 = await assigned({ driverId: 'drv-a', truckId: 'trk-21', fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await checkIn('drv-a', truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.truckLog.columns.find((c) => c.id === onTruck21.id)?.loads).toBe(4);
    expect(log.assignments.map((a) => a.id)).toEqual([onTruck21.id]);
  });

  it('asks "Who was driving?" with no check-in, and A1 and A2 still get their Loads through Randy\'s usual Truck', async () => {
    const { truckId, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.tripDay.truckDay.driver).toBeNull();
    expect(log.tripDay.truckDay.driverCandidates.map((d) => d.name)).toEqual(['Randy']);
    const loads = (id: string) => log.truckLog.columns.find((c) => c.id === id)?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
  });

  it('never counts a check-in from an earlier day', async () => {
    const { truckId, a1 } = await planMonday();
    await checkIn('drv-a', truckId, SUNDAY_EVENING);
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    expect(log.tripDay.truckDay.driver).toBeNull();
    expect(log.truckLog.columns.find((c) => c.id === a1.id)?.loads).toBe(4);
  });

  it("keeps the Trip part of an Assignment naming another Truck that has visits too, when its Driver checked in to this one", async () => {
    const { truckId, randy, placeId } = await planMonday();
    const truck77 = ((await (await send('POST', '/api/trucks', { number: '77', hcssCode: 'MCK-77-19' })).json()) as { truck: { id: string } }).truck.id;
    const onTruck77 = await assigned({ driverId: randy, truckId: truck77, fromPlaceId: placeId('J611 Bishop Kearney'), toPlaceId: placeId('J25008 Los Flamboyanes') });
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');
    const parked = { equipmentCode: 'MCK-77-19', geofenceCode: 'SHOP', enteredAt: '2026-11-16T05:00:00.000Z', exitedAt: null, entryOdometer: null, exitOdometer: null };
    expect((await send('POST', '/api/fleet-imports', { fileName: 'truck-77.json', format: 'json', rows: [parked] }, { NOW: AFTER_1620 })).status).toBe(201);

    const fromLog = (await readLog(truckId)).assignments.find((a) => a.id === onTruck77.id)?.trips;
    expect(fromLog?.loads).toBeGreaterThan(0);
    expect((await readLog(truck77)).assignments.find((a) => a.id === onTruck77.id)?.trips).toBeUndefined();
    expect((await readBoard()).find((a) => a.id === onTruck77.id)?.trips).toEqual(fromLog);
    expect((await readDriver(randy)).find((a) => a.id === onTruck77.id)?.trips).toEqual(fromLog);
  });

  it('gives the board and the Driver page the same Trip parts as the Truck log', async () => {
    const { truckId, randy, a1, a2, placeId } = await planMonday();
    const hisA1 = await assigned({ driverId: 'drv-a', truckId: 'trk-21', fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await checkIn('drv-a', truckId, mondayAt('06:00'));
    await checkIn(randy, truckId, mondayAt('11:20'));
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    const fromLog = (id: string) => log.assignments.find((a) => a.id === id)?.trips;
    expect([fromLog(hisA1.id)?.loads, fromLog(a1.id)?.loads, fromLog(a2.id)?.loads]).toEqual([4, undefined, 2]);
    const board = await readBoard();
    const cards = [...(await readDriver('drv-a')), ...(await readDriver(randy))];
    for (const id of [hisA1.id, a1.id, a2.id]) {
      expect(board.find((a) => a.id === id)?.trips).toEqual(fromLog(id));
      expect(cards.find((a) => a.id === id)?.trips).toEqual(fromLog(id));
    }
  });
});

const readBoardDay = async ({ date = MONDAY, NOW = TUESDAY }: { date?: string; NOW?: string } = {}) => {
  const response = await send('GET', `/api/assignments?date=${date}`, undefined, { NOW });
  expect(response.status).toBe(200);
  return (await response.json()) as Day;
};

/** A piece of Unplanned work as the board reads: "Randy: J25008 Los Flamboyanes ⇄ J611 Bishop Kearney 14:15–14:43". */
const unplannedLine = (w: StoredUnplanned) =>
  `${w.driver?.name ?? 'Driver not known'}: ${w.places.join(' ⇄ ')} ${easternTime(w.leftAt)}–${easternTime(w.arrivedAt)}`;

describe('Unplanned work on the day read', () => {
  it("gives Truck 55's Unplanned work to Randy when he checked in to it at 06:00", async () => {
    const { truckId, randy } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const day = await readBoardDay();
    expect(day.trucks).toHaveLength(1);
    expect(day.trucks![0]).toMatchObject({ truckId, truckNumber: '55', whichAssignment: [] });
    expect(day.trucks![0].unplanned.map(unplannedLine)).toEqual(['Randy: J25008 Los Flamboyanes ⇄ J611 Bishop Kearney 14:15–14:43']);
    expect(day.trucks![0].unplanned[0].driver).toEqual({ id: randy, name: 'Randy' });
  });

  it('gives it no Driver when nobody checked in to the Truck', async () => {
    await planMonday();
    await importCut('2026-11-16-cut-1620.json');

    const day = await readBoardDay();
    expect(day.trucks![0].unplanned.map(unplannedLine)).toEqual(['Driver not known: J25008 Los Flamboyanes ⇄ J611 Bishop Kearney 14:15–14:43']);
  });

  it('gives a piece the Driver at the time it leaves, after a handover', async () => {
    const { truckId, randy, a1, a2 } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await checkIn('drv-a', truckId, mondayAt('14:00'));
    await importCut('2026-11-16-cut-1620.json');

    const day = await readBoardDay();
    expect(day.trucks![0].unplanned.map(unplannedLine)).toEqual(['Sample Driver A: J25008 Los Flamboyanes ⇄ J611 Bishop Kearney 14:15–14:43']);
    const loads = (id: string) => day.assignments.find((a) => a.id === id)?.trips?.loads;
    expect([loads(a1.id), loads(a2.id)]).toEqual([4, 2]);
  });

  it('asks "Which Assignment?" with both Assignments when two fit a Trip, and never makes it Unplanned work', async () => {
    const { truckId, randy, a1, placeId } = await planMonday();
    const twin = await assigned({ driverId: randy, fromPlaceId: placeId('J25008 Los Flamboyanes'), toPlaceId: placeId('Villager') });
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const { unplanned, whichAssignment } = (await readBoardDay()).trucks![0];
    expect(whichAssignment.length).toBeGreaterThan(0);
    expect(whichAssignment[0]).toMatchObject({ from: 'J25008 Los Flamboyanes', to: 'Villager', assignmentIds: [a1.id, twin.id] });
    const tied = new Set(whichAssignment.map((q) => q.id));
    expect(unplanned.some((w) => tied.has(w.id))).toBe(false);
    const log = await readLog(truckId);
    expect(log.tripDay.unplanned.flatMap((w) => w.trips).some((t) => tied.has(t.leftAt))).toBe(false);
  });

  it('gives the Truck log route the same Unplanned work and ties as the day read', async () => {
    const { truckId, randy } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1620.json');

    const log = await readLog(truckId);
    const { truckId: _id, truckNumber: _n, ...onTheDay } = (await readBoardDay()).trucks![0];
    expect(log.lanes).toEqual(onTheDay);
  });

  it('has no trucks on a day with no stored visits', async () => {
    await planMonday();
    expect(await readBoardDay({ date: '2026-11-17' })).not.toHaveProperty('trucks');
  });
});

/** The Driver's whole day read, as his phone reads it. */
const readDriverDay = async (driverId: string, { date = MONDAY, NOW = TUESDAY }: { date?: string; NOW?: string } = {}) => {
  const response = await send('GET', `/api/drivers/${driverId}/days/${date}`, undefined, { NOW });
  expect(response.status).toBe(200);
  return (await response.json()) as DriverDay;
};

describe("The Driver's Truck log on his day read", () => {
  /** Monday 16 Nov, 16:30 US Eastern: today for the Worker, after the last cut. */
  const MONDAY_1630 = mondayAt('16:30');

  /** The day's three cuts, each imported five minutes after it was pulled. */
  async function importTheCuts() {
    await importCut('2026-11-16-cut-1015.json', mondayAt('10:20'));
    await importCut('2026-11-16-cut-1305.json', mondayAt('13:10'));
    await importCut('2026-11-16-cut-1620.json', mondayAt('16:25'));
  }

  it('gives Randy, checked in to Truck 55, its log as of the latest Import: 06:24 to 16:03, miles blank, A1 and A2, the J611 Unplanned work and the shop drives', async () => {
    const { truckId, randy, a1, a2 } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importTheCuts();

    const { truckLog: log } = await readDriverDay(randy, { NOW: MONDAY_1630 });
    expect(log).toMatchObject({ truckId, truckNumber: '55', hcssCode: 'MCK-55-17', asOf: mondayAt('16:25'), dayOver: false });
    const day = log!.tripDay.truckDay;
    expect([easternTime(day.startAt!), easternTime(day.endAt!)]).toEqual(['06:24', '16:03']);
    expect(day).toMatchObject({ startMiles: null, endMiles: null, driver: { name: 'Randy' } });
    expect(log!.truckLog.columns.map((c) => [c.id, c.loads])).toEqual([
      [a1.id, 4],
      [a2.id, 2],
    ]);
    expect(log!.truckLog.unplanned).toHaveLength(1);
    expect(log!.truckLog.unplanned[0].places).toContain('J611 Bishop Kearney');
    expect(log!.truckLog.shopTrips.map((t) => `${easternTime(t.leftAt)} ${t.from} → ${t.to}`)).toEqual([
      '06:24 Shop → J25008 Los Flamboyanes',
      '15:41 J25008 Los Flamboyanes → Shop',
    ]);
  });

  it('shows what is known with only the 10:15 cut stored, and no end time', async () => {
    const { truckId, randy } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importCut('2026-11-16-cut-1015.json', mondayAt('10:20'));

    const { truckLog: log } = await readDriverDay(randy, { NOW: MONDAY_1630 });
    expect(log!.asOf).toBe(mondayAt('10:20'));
    expect(easternTime(log!.tripDay.truckDay.startAt!)).toBe('06:24');
    expect(log!.tripDay.truckDay.endAt).toBeNull();
  });

  it('is his usual Truck when he did not check in', async () => {
    const { truckId, randy } = await planMonday();
    await importTheCuts();

    expect((await readDriverDay(randy, { NOW: MONDAY_1630 })).truckLog?.truckId).toBe(truckId);
  });

  it('is the Truck he checked in to, not his usual one, and his Trips on it match his Assignments', async () => {
    const { truckId, randy, a1, a2 } = await planMonday();
    expect((await send('PATCH', `/api/drivers/${randy}`, { defaultTruckId: 'trk-21' })).status).toBe(200);
    await importTheCuts();
    expect((await readDriverDay(randy, { NOW: MONDAY_1630 })).truckLog).toBeUndefined();

    await checkIn(randy, truckId, mondayAt('06:00'));
    const { truckLog: log } = await readDriverDay(randy, { NOW: MONDAY_1630 });
    expect(log?.truckNumber).toBe('55');
    expect(log!.truckLog.columns.map((c) => [c.id, c.loads])).toEqual([
      [a1.id, 4],
      [a2.id, 2],
    ]);
  });

  it('is not on Yesterday, Tomorrow or a day with no stored visits', async () => {
    const { truckId, randy } = await planMonday();
    await checkIn(randy, truckId, mondayAt('06:00'));
    await importTheCuts();

    expect((await readDriverDay(randy, { NOW: TUESDAY })).truckLog).toBeUndefined();
    expect((await readDriverDay(randy, { date: '2026-11-17', NOW: MONDAY_1630 })).truckLog).toBeUndefined();
    expect((await readDriverDay(randy, { date: '2026-11-17', NOW: TUESDAY })).truckLog).toBeUndefined();
  });
});

describe('Refusing a Truck log read', () => {
  it('answers 404 for a Truck that does not exist', async () => {
    expect((await send('GET', `/api/trucks/nope/days/${MONDAY}`)).status).toBe(404);
  });

  it.each([['date', '/days/16-11-2026'], ['at', `/days/${MONDAY}?at=25:00`]])('refuses a bad %s', async (field, path) => {
    const { truckId } = await setUpDay();
    const response = await send('GET', `/api/trucks/${truckId}${path}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { fields: Record<string, string> }).fields).toHaveProperty(field);
  });
});
