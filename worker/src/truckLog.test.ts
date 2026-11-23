import { describe, expect, it } from 'vitest';
import { apiOn } from './testing/api';
import { fleetRows, setUpTruck55 } from './testing/fleet';
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

  it('never builds the day later than its latest Import, even when a later clock is asked for', async () => {
    const { truckId } = await planMonday();
    await importCut('2026-11-16-cut-1305.json', '2026-11-16T18:10:00.000Z');
    expect((await readLog(truckId, { at: '16:00' })).at).toBe('2026-11-16T18:10:00.000Z');
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
