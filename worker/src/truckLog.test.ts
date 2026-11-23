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
