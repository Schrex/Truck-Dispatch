import { describe, expect, it } from 'vitest';
import { easternTime } from '../../shared/days';
import { buildTripDay, linkedAssignment, routeAt } from '../../shared/trips';
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

  describe('Unplanned work: Trips no Assignment explains, for Dave to answer next morning', () => {
    /** Each piece as "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43 · 2 Trips · 0.46 h". */
    const unplanned = (id: string, time?: string) =>
      at(id, time).unplanned.map(
        (w) => `${w.places.map((p) => p.code).join(' ⇄ ')} · ${easternTime(w.leftAt)}–${easternTime(w.arrivedAt)} · ${w.trips.length} Trips · ${w.truckingHours} h`,
      );

    it('as planned, at end of day: one piece, the drive to Bishop Kearney and back, 14:15 to 14:43', () => {
      expect(unplanned('planned')).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43 · 2 Trips · 0.46 h']);
      expect(at('planned').unplanned[0].trips.map((t) => easternTime(t.leftAt))).toEqual(['14:15', '14:33']);
    });

    it('as planned: neither Trip is any Assignment’s, so nothing shows a Pick up or Drop off for it', () => {
      const d = at('planned');
      expect(d.unplanned[0].trips.map((t) => t.match.assignmentId)).toEqual([null, null]);
      expect(d.assignments.map((a) => a.loads)).toEqual([4, 2]);
      expect(d.whichAssignment).toEqual([]);
    });

    it('with the reroute at 11:20 the Bishop Kearney Trips are A1’s, so there is none', () => {
      expect(unplanned('reroute')).toEqual([]);
    });

    it('before 14:23 there is none; it grows as each Trip is written', () => {
      expect(unplanned('planned', '14:16:59')).toEqual([]);
      expect(unplanned('planned', '14:24:59')).toEqual([]);
      // The 14:15 Trip is written 2 min after it reached Bishop Kearney at 14:23:53.
      expect(unplanned('planned', '14:25:59')).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:23 · 1 Trips · 0.14 h']);
      expect(unplanned('planned', '14:45:59')).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43 · 2 Trips · 0.46 h']);
      expect(at('planned', '14:45:59').unplanned[0].id).toBe(at('planned', '14:25:59').unplanned[0].id);
    });

    it('never shows the drive back as A1’s, even in the two minutes before it is written', () => {
      const d = at('planned', '14:44:59');
      expect(d.trips.at(-1)).toMatchObject({ fromCode: 'J611 Bishop Kearney', written: false, match: { assignmentId: null } });
      expect(d.assignments[0].truckingHours).toBe(3.02);
    });
  });

  describe('Make an Assignment: Dave says where the Unplanned work loaded, and the rules count it', () => {
    const J25008 = 'plc-j25008';
    const J611 = 'plc-j611';
    /** The 16 Nov day with Dave's answer: a made Assignment, A3, From the Truck, for the drive to Bishop Kearney and back. */
    const answered = (fromPlaceId: string, toPlaceId: string, time = '23:59:59') => {
      const unplannedId = at('planned').unplanned[0].id;
      return buildTripDay({
        places: REAL_DAY.places,
        jobs: REAL_DAY.jobs,
        visits: REAL_DAY.visits,
        assignments: scenario('planned').assignments,
        now: easternIso(REAL_DAY.date, time),
        answers: { madeAssignments: [{ id: 'a3', label: 'A3', fromPlaceId, toPlaceId, cancelledAt: null, changes: [], unplannedId }] },
      });
    };
    /** The run's two Trips as "14:15 empty a3 Going to the Assignment’s pickup". */
    const run = (d: ReturnType<typeof answered>) =>
      d.trips
        .filter((t) => ['14:15', '14:33'].includes(easternTime(t.leftAt)))
        .map((t) => `${easternTime(t.leftAt)} ${t.match.kind} ${t.match.assignmentId} ${t.match.reason}`);

    it('loaded at J611 Bishop Kearney: 1 Load at 14:33, 14:15 empty to its pickup, Job J25008, 0.46 h, and no Unplanned work', () => {
      const d = answered(J611, J25008);
      expect(d.unplanned).toEqual([]);
      expect(run(d)).toEqual(['14:15 empty a3 Going to the Assignment’s pickup', '14:33 load a3 From and To match the Assignment']);
      const a3 = d.assignments.find((a) => a.assignmentId === 'a3')!;
      expect(a3).toMatchObject({ loads: 1, empties: 1, tons: null, truckingHours: 0.46, job: { jobNumber: 'J25008', name: 'Los Flamboyanes' } });
      // Dave's planned Assignments are as before.
      expect(d.assignments.map((a) => [a.assignmentId, a.loads, a.truckingHours])).toEqual([
        ['a1', 4, 3.02],
        ['a2', 2, 2.4],
        ['a3', 1, 0.46],
      ]);
    });

    it('loaded at J25008: the opposite route, so 14:15 is the Load and 14:33 the way back, Job J611', () => {
      const d = answered(J25008, J611);
      expect(d.unplanned).toEqual([]);
      expect(run(d)).toEqual(['14:15 load a3 From and To match the Assignment', '14:33 empty a3 The way back of the Assignment']);
      expect(d.assignments[2]).toMatchObject({ loads: 1, truckingHours: 0.46, job: { jobNumber: 'J611' } });
    });

    it('before its Trips are written, the made Assignment has none yet', () => {
      expect(answered(J611, J25008, '14:00:59').assignments[2]).toMatchObject({ loads: 0, status: 'none', truckingHours: null });
    });
  });

  describe('Link to an Assignment: a reroute of it from the Unplanned work’s first Trip', () => {
    /** The 16 Nov day with the drive to Bishop Kearney and back linked to A2, loaded at J611 (J611 → J25008). */
    const linked = (time = '23:59:59') => {
      const unplannedId = at('planned').unplanned[0].id;
      return buildTripDay({
        places: REAL_DAY.places,
        jobs: REAL_DAY.jobs,
        visits: REAL_DAY.visits,
        assignments: scenario('planned').assignments,
        now: easternIso(REAL_DAY.date, time),
        answers: { links: [{ unplannedId, assignmentId: 'a2', fromPlaceId: 'plc-j611', toPlaceId: 'plc-j25008' }] },
      });
    };

    it('as planned, linked to A2 loaded at J611: A2 has 3 Loads, 11:30 to 14:43, and there is no Unplanned work', () => {
      const d = linked();
      expect(d.unplanned).toEqual([]);
      const a2 = d.assignments.find((a) => a.assignmentId === 'a2')!;
      expect(shown(a2)).toEqual({ loads: 3, status: 'done', since: '11:30' });
      expect(easternTime(a2.lastLoadAt!)).toBe('14:43');
      expect(a2.truckingHours).toBe(3.21);
      expect(a2.job).toMatchObject({ jobNumber: 'J25008' });
      // A1 keeps its own Trips.
      expect(d.assignments[0]).toMatchObject({ loads: 4, truckingHours: 3.02 });
    });

    it('counts the run’s Trips by the rules: 14:15 empty to A2’s new pickup, 14:33 a Load', () => {
      const run = linked()
        .trips.filter((t) => ['14:15', '14:33'].includes(easternTime(t.leftAt)))
        .map((t) => `${easternTime(t.leftAt)} ${t.match.kind} ${t.match.assignmentId}`);
      expect(run).toEqual(['14:15 empty a2', '14:33 load a2']);
    });

    it('records the link as a change to A2’s route at 14:15, the first Trip’s leave time', () => {
      const a2 = scenario('planned').assignments[1];
      const unplannedId = at('planned').unplanned[0].id;
      const rerouted = linkedAssignment(a2, { unplannedId, assignmentId: 'a2', fromPlaceId: 'plc-j611', toPlaceId: 'plc-j25008' });
      expect(easternTime(rerouted.changes.at(-1)!.changedAt)).toBe('14:15');
      expect(rerouted.changes.at(-1)!.before).toEqual({ fromPlaceId: a2.fromPlaceId, toPlaceId: a2.toPlaceId });
      expect(routeAt(rerouted, easternIso(REAL_DAY.date, '14:00:00'))).toEqual({ fromPlaceId: a2.fromPlaceId, toPlaceId: a2.toPlaceId });
      expect(routeAt(rerouted, easternIso(REAL_DAY.date, '23:00:00'))).toEqual({ fromPlaceId: 'plc-j611', toPlaceId: 'plc-j25008' });
    });
  });

  describe('Not a haul: the Unplanned work was fuel, a repair or personal', () => {
    const notAHaul = (note: string | null, time = '23:59:59') => {
      const unplannedId = at('planned').unplanned[0].id;
      return buildTripDay({
        places: REAL_DAY.places,
        jobs: REAL_DAY.jobs,
        visits: REAL_DAY.visits,
        assignments: scenario('planned').assignments,
        now: easternIso(REAL_DAY.date, time),
        answers: { notHauls: [{ unplannedId, note }] },
      });
    };

    it('with the note "fuel": no Unplanned work, both Trips stay, marked not a haul with the note, and belong to no Assignment', () => {
      const d = notAHaul('fuel');
      expect(d.unplanned).toEqual([]);
      const run = d.trips
        .filter((t) => ['14:15', '14:33'].includes(easternTime(t.leftAt)))
        .map((t) => `${easternTime(t.leftAt)} ${t.match.kind} ${t.match.assignmentId} ${t.match.reason}`);
      expect(run).toEqual(['14:15 not_a_haul null Not a haul: fuel', '14:33 not_a_haul null Not a haul: fuel']);
      expect(d.assignments.map((a) => [a.loads, a.truckingHours])).toEqual([
        [4, 3.02],
        [2, 2.4],
      ]);
    });

    it('with no note it just says Not a haul', () => {
      expect(notAHaul(null).trips.find((t) => easternTime(t.leftAt) === '14:15')!.match.reason).toBe('Not a haul');
    });

    it('leaves Total hours as they were: 9.88', () => {
      const unplannedId = at('planned').unplanned[0].id;
      const d = buildTripDay({
        places: REAL_DAY.places,
        visits: REAL_DAY.visits,
        assignments: scenario('planned').assignments,
        now: easternIso(REAL_DAY.date, '23:59:59'),
        ignition: REAL_DAY.ignition,
        dayOver: true,
        answers: { notHauls: [{ unplannedId, note: 'fuel' }] },
      });
      expect(d.truckDay.totalHours).toBe(9.88);
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

    it('as planned, at end of day: A1 08:24 to its last Load at 11:25, 3.02 (the drive back from Bishop Kearney is the Unplanned work’s); A2 11:30 to 13:54, 2.40', () => {
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
  const driverOf = (truck: { drivers: (typeof randy)[]; assignments: { driverId: string; truckId: string | null }[]; drivenBy?: string | null }) =>
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

  it('is the Driver Dave picks when it asks "Who was driving?", but only one of those who fit', () => {
    const both = [
      { driverId: 'drv-randy', truckId: 'trk-55' },
      { driverId: 'drv-sam', truckId: 'trk-55' },
    ];
    expect(driverOf({ drivers: [randy, sam], assignments: both, drivenBy: 'drv-sam' }).driver?.name).toBe('Sam');
    expect(driverOf({ drivers: [randy, sam], assignments: both, drivenBy: 'drv-sam' }).driverCandidates).toHaveLength(2);
    expect(driverOf({ drivers: [randy, sam], assignments: both, drivenBy: 'drv-nobody' }).driver).toBeNull();
  });
});
