import { describe, expect, it } from 'vitest';
import { easternTime } from '../../shared/days';
import { buildTripDay } from '../../shared/trips';
import { REAL_DAY, easternIso } from './realDay';

const scenario = (id: string) => REAL_DAY.scenarios.find((s) => s.id === id)!;
const at = (id: string, time = '23:59:59') =>
  buildTripDay({ places: REAL_DAY.places, jobs: REAL_DAY.jobs, visits: REAL_DAY.visits, assignments: scenario(id).assignments, now: easternIso(REAL_DAY.date, time) });
/** Randy's day for Truck 55 at a clock time: his Assignments name no Truck (his own), and the evening's end meter reading is passed only when asked (at end of day here). */
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

  describe('Trips with no Assignment, for Dave to answer next morning', () => {
    const forDave = (id: string, time?: string) => at(id, time).unexplained.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode}`);

    it('as planned: the 14:15 Trip from J25008 to Bishop Kearney, and the 14:33 way back from it', () => {
      expect(forDave('planned')).toEqual(['14:15 J25008 Los Flamboyanes → J611 Bishop Kearney', '14:33 J611 Bishop Kearney → J25008 Los Flamboyanes']);
    });

    it('as planned: the two make one unverified extra job, J25008 → Bishop Kearney and back, 14:15 to 14:43', () => {
      const jobs = at('planned').unverified;
      expect(jobs.map((j) => `${j.fromCode} → ${j.toCode} ${j.trips.length} Trips ${j.truckingHours} h`)).toEqual([
        'J25008 Los Flamboyanes → J611 Bishop Kearney 2 Trips 0.46 h',
      ]);
      expect(jobs[0].job).toMatchObject({ jobNumber: 'J611' });
    });

    it('with the reroute at 11:20 it is A1’s work, so there is no extra job', () => {
      expect(at('reroute').unverified).toEqual([]);
    });

    it('with the reroute at 11:20 that Trip is A1’s Load, so there are none', () => {
      expect(forDave('reroute')).toEqual([]);
    });

    it('only Trips written by `now`: none at 14:16, while the Truck has not yet reached Bishop Kearney', () => {
      expect(forDave('planned', '14:16:59')).toEqual([]);
      expect(forDave('planned', '14:25:59')).toEqual(['14:15 J25008 Los Flamboyanes → J611 Bishop Kearney']);
    });
  });

  describe('An Assignment’s Job, from its Places', () => {
    const jobs = (id: string, time?: string) => at(id, time).assignments.map((a) => a.job && `${a.job.jobNumber} ${a.job.name}`);

    it('is the pick-up’s Job when the drop-off belongs to none (A1 → Villager), else the drop-off’s (A2 → J25008)', () => {
      expect(jobs('planned')).toEqual(['J25008 Los Flamboyanes', 'J25008 Los Flamboyanes']);
    });

    it('follows the Assignment as it is: after the reroute A1 drops off at Bishop Kearney, so its Job is J611', () => {
      expect(jobs('reroute')).toEqual(['J611 Bishop Kearney', 'J25008 Los Flamboyanes']);
      expect(jobs('reroute', '11:00:59')).toEqual(['J25008 Los Flamboyanes', 'J25008 Los Flamboyanes']);
    });
  });

  describe('Trucking hours: leaving for an Assignment’s first Trip to arriving at the end of its last, loaded or empty', () => {
    const hours = (id: string, time?: string) => at(id, time).assignments.map((a) => a.truckingHours);

    it('as planned, at end of day: A1 08:24 to its last Load at 11:25, 3.02 (the way back from Bishop Kearney is the extra job’s); A2 11:30 to 13:54, 2.40', () => {
      expect(hours('planned')).toEqual([3.02, 2.4]);
    });

    it('mid-day (10:02): A1 so far, 08:24 to 10:00, 1.59; A2 none yet', () => {
      expect(hours('planned', '10:02:59')).toEqual([1.59, null]);
    });

    it('before the first Trip: none', () => {
      expect(hours('planned', '06:00:59')).toEqual([null, null]);
    });
  });

  describe('To and from the shop', () => {
    const shop = (time?: string) => at('planned', time).shopTrips.map((t) => `${easternTime(t.leftAt)}–${easternTime(t.arrivedAt)} ${t.fromCode} → ${t.toCode} ${t.miles}`);

    it('logs the drive out in the morning and the drive back at the end of the day', () => {
      expect(shop()).toEqual(['06:24–07:02 SHOP → J25008 Los Flamboyanes 20.59', '15:41–16:03 J25008 Los Flamboyanes → SHOP 18.39']);
    });

    it('logs the drive back only once the Truck is back', () => {
      expect(shop('15:50:59')).toEqual(['06:24–07:02 SHOP → J25008 Los Flamboyanes 20.59']);
    });
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
