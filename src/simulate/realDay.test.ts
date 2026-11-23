import { describe, expect, it } from 'vitest';
import { buildTripDay, easternTime } from '../../shared/trips';
import { REAL_DAY, easternIso } from './realDay';

const scenario = (id: string) => REAL_DAY.scenarios.find((s) => s.id === id)!;
const at = (id: string, time = '23:59:59') =>
  buildTripDay({ places: REAL_DAY.places, visits: REAL_DAY.visits, assignments: scenario(id).assignments, now: easternIso(REAL_DAY.date, time) });
/** Randy's day for Truck 55 at a clock time: his Assignments name no Truck (his own), and the next morning's meter reading exists only at end of day. */
const truckDayAt = (time: string, endOfDay = false) =>
  buildTripDay({
    places: REAL_DAY.places,
    visits: REAL_DAY.visits,
    assignments: scenario('planned').assignments,
    now: easternIso(REAL_DAY.date, time),
    truck: { id: REAL_DAY.truck.id, drivers: [REAL_DAY.driver], assignments: [{ driverId: 'drv-randy', truckId: null }, { driverId: 'drv-randy', truckId: null }] },
    ignition: REAL_DAY.ignition,
    meter: { startOdometer: REAL_DAY.meter.startOdometer, endOdometer: endOfDay ? REAL_DAY.meter.endOdometer : null },
  }).truckDay;
/** The Truck's day as the Truck log header reads it. */
const header = (d: ReturnType<typeof truckDayAt>) => ({
  driver: d.driver?.name ?? null,
  start: d.startAt && easternTime(d.startAt),
  end: d.endAt && easternTime(d.endAt),
  startMiles: d.startMiles,
  endMiles: d.endMiles,
  totalHours: d.totalHours,
});
/** An Assignment's Trip part as the board block reads it. */
const shown = (a: ReturnType<typeof at>['assignments'][number]) => ({
  loads: a.loads,
  status: a.status,
  since: a.since && easternTime(a.since),
});

describe('The Trip builder on the real day (MCK-55-17, Mon 16 Nov 2026)', () => {
  it('as planned, at end of day: A1 4 Loads, Done, since 08:24; A2 2 Loads, Done', () => {
    const [a1, a2] = at('planned').assignments;
    expect(shown(a1)).toEqual({ loads: 4, status: 'done', since: '08:24' });
    expect(easternTime(a1.lastLoadAt!)).toBe('11:25');
    expect(a1.tons).toBeNull();
    expect(shown(a2)).toEqual({ loads: 2, status: 'done', since: '11:30' });
  });

  it('as planned, at 10:02: A1 2 Loads and Now; A2 nothing yet', () => {
    const [a1, a2] = at('planned', '10:02:59').assignments;
    expect(shown(a1)).toEqual({ loads: 2, status: 'now', since: '08:24' });
    expect(shown(a2)).toEqual({ loads: 0, status: 'none', since: null });
  });

  it('knows nothing for either Assignment before the Truck leaves the shop', () => {
    const [a1, a2] = at('planned', '06:00:59').assignments;
    expect([a1.status, a2.status]).toEqual(['none', 'none']);
  });

  it('the other way round (Villager → J25008): A1 has 3 Loads', () => {
    expect(at('other-way').assignments[0].loads).toBe(3);
  });

  it('reroute at 11:20 (A1 to Bishop Kearney): the 4 Loads before it still count, and the Bishop Kearney stop makes 5', () => {
    expect(at('reroute').assignments[0].loads).toBe(5);
  });

  it('as planned, leaves the Bishop Kearney stop for Dave', () => {
    const forDave = at('planned').trips.filter((t) => t.match.kind === null);
    expect(forDave.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode}`)).toEqual(['14:15 J25008 Los Flamboyanes → J611 Bishop Kearney']);
  });

  describe('The Truck’s day', () => {
    it('at end of day: Randy, 06:19 (ignition on) to 16:12 (ignition off), 258,050.59 to 258,212.2 miles, 9.88 Total hours', () => {
      expect(header(truckDayAt('23:59:59', true))).toEqual({
        driver: 'Randy',
        start: '06:19',
        end: '16:12',
        startMiles: 258050.59,
        endMiles: 258212.2,
        totalHours: 9.88,
      });
    });

    it('before the Truck starts (06:00): Randy and the start miles, nothing else yet', () => {
      expect(header(truckDayAt('06:00:59'))).toEqual({ driver: 'Randy', start: null, end: null, startMiles: 258050.59, endMiles: null, totalHours: null });
    });

    it('mid-day (10:02): started 06:19, no end time, no end miles, no Total hours yet', () => {
      expect(header(truckDayAt('10:02:59'))).toEqual({ driver: 'Randy', start: '06:19', end: null, startMiles: 258050.59, endMiles: null, totalHours: null });
    });

    it('back at the shop, engine still running (16:05): ends at its arrival, 16:03', () => {
      expect(header(truckDayAt('16:05:59'))).toMatchObject({ end: '16:03', totalHours: 9.73 });
    });

    it('after ignition off (16:13), before the next reading: ends 16:12, no end miles yet', () => {
      expect(header(truckDayAt('16:13:59'))).toMatchObject({ end: '16:12', endMiles: null, totalHours: 9.88 });
    });
  });
});

describe('The Truck’s Driver', () => {
  const randy = { id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55' };
  const sam = { id: 'drv-sam', name: 'Sam', defaultTruckId: 'trk-60' };
  const driverOf = (truck: { drivers: (typeof randy)[]; assignments: { driverId: string; truckId: string | null }[] }) =>
    buildTripDay({ places: REAL_DAY.places, visits: [], assignments: [], now: easternIso(REAL_DAY.date, '12:00:00'), truck: { id: 'trk-55', ...truck } }).truckDay;

  it('is the Driver whose Assignments name the Truck, over the Driver whose usual Truck it is', () => {
    const d = driverOf({ drivers: [randy, sam], assignments: [{ driverId: 'drv-sam', truckId: 'trk-55' }] });
    expect(d.driver?.name).toBe('Sam');
  });

  it('otherwise is the Driver whose usual Truck it is', () => {
    const d = driverOf({ drivers: [randy, sam], assignments: [] });
    expect(d.driver?.name).toBe('Randy');
  });

  it('is nobody when two Drivers’ Assignments name the Truck: "Who was driving?"', () => {
    const d = driverOf({
      drivers: [randy, sam],
      assignments: [
        { driverId: 'drv-randy', truckId: 'trk-55' },
        { driverId: 'drv-sam', truckId: 'trk-55' },
      ],
    });
    expect(d.driver).toBeNull();
    expect(d.driverCandidates.map((c) => c.name)).toEqual(['Randy', 'Sam']);
  });

  it('counts an Assignment with no Truck as naming the Driver’s usual one', () => {
    const d = driverOf({
      drivers: [randy, sam],
      assignments: [
        { driverId: 'drv-randy', truckId: null },
        { driverId: 'drv-sam', truckId: 'trk-55' },
      ],
    });
    expect(d.driver).toBeNull();
  });
});
