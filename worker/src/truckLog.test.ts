import { describe, expect, it } from 'vitest';
import { apiOn } from './testing/api';
import { fleetRows, fleetXlsxRows, setUpTruck55 } from './testing/fleet';
import { localD1 } from './testing/localD1';
import { easternTime } from '../../shared/days';
import type { Assignment, Place, TruckLogDay } from '../../shared/types';

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
    expect(trips.at(-1)!.written).toBe(true);
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
  it('lists "sunset", marked drive-through', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');
    expect((await readLog(truckId)).codesWithNoPlace).toEqual([{ code: 'sunset', driveThrough: true }]);
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

  it("gives A1 its Trip part at 10:02: 2 Loads, Now, 1.59 h, and A2 none yet", async () => {
    const { truckId, a1, a2 } = await planMonday();
    await importCut('2026-11-16-cut-1620.json');
    const log = await readLog(truckId, { at: '10:02' });
    const part = (id: string) => log.assignments.find((a) => a.id === id)?.trips;
    expect(part(a1.id)).toMatchObject({ loads: 2, status: 'now', truckingHours: 1.59 });
    expect(easternTime(part(a1.id)!.since!)).toBe('08:24');
    expect(part(a2.id)?.status ?? 'none').toBe('none');
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
