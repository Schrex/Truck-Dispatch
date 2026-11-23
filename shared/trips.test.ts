import { describe, expect, it } from 'vitest';
import { buildTripDay, easternTime, matchTrip, routeAt, type TripAssignment } from './trips';
import { FIXTURE_METER, FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from './trips.fixture';

const END_OF_DAY = '2026-11-17T04:59:00Z';
const scenario = (id: string) => FIXTURE_SCENARIOS.find((s) => s.id === id)!.assignments;
const day = (id: string, now = END_OF_DAY) =>
  buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: scenario(id), now, meter: FIXTURE_METER });
/** Each Trip as "08:24 J1001 North → PLANT load a1". */
const lines = (d: ReturnType<typeof day>) =>
  d.trips.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode} ${t.match.kind ?? 'NULL'} ${t.match.assignmentId ?? '-'}`);

describe('Cleaning the raw Fleet visits', () => {
  const d = day('two');

  it('drops the two drive-throughs and joins the short exit, 19 rows into 16 visits', () => {
    expect(FIXTURE_VISITS).toHaveLength(19);
    expect(d.dropped.map((x) => x.raw)).toEqual([6, 9]);
    expect(d.dropped[0].reason).toMatch(/Drive-through: 61 s at ROAD/);
    expect(d.merged).toEqual([{ into: 1, raw: [1, 2], reason: 'Short exit: left J1001 North for 2 min and came back' }]);
    expect(d.visits).toHaveLength(16);
  });

  it('marks the visit that starts at local midnight as where the day began', () => {
    expect(d.visits[0].startOfDay).toBe(true);
    expect(d.visits.slice(1).every((v) => !v.startOfDay)).toBe(true);
  });

  it('lists a geofence code with no Place, once', () => {
    const places = FIXTURE_PLACES.filter((p) => p.id !== 'plc-south');
    const without = buildTripDay({ places, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY });
    expect(without.unknownCodes).toEqual(['J1002 South']);
    expect(d.unknownCodes).toEqual([]);
  });
});

describe('Trips and matching on the 16 Nov day', () => {
  it('makes 15 Trips: 4 Loads on A1, 2 on A2, the South stop for Dave', () => {
    expect(lines(day('two'))).toEqual([
      '06:24 SHOP → J1001 North empty -',
      '08:24 J1001 North → PLANT load a1',
      '08:43 PLANT → J1001 North empty a1',
      '09:35 J1001 North → PLANT load a1',
      '09:50 PLANT → J1001 North empty a1',
      '10:27 J1001 North → PLANT load a1',
      '10:41 PLANT → J1001 North empty a1',
      '11:14 J1001 North → PLANT load a1',
      '11:30 PLANT → QUARRY empty a2',
      '12:08 QUARRY → J1001 North load a2',
      '12:54 J1001 North → QUARRY empty a2',
      '13:29 QUARRY → J1001 North load a2',
      '14:15 J1001 North → J1002 South NULL -',
      '14:33 J1002 South → J1001 North empty a1',
      '15:41 J1001 North → SHOP empty -',
    ]);
  });

  it('takes Trip miles from the odometers, not from the miles inside a Place', () => {
    const d = day('two');
    expect(d.trips[1].miles).toBe(3.39);
    expect(d.trips.at(-1)!.miles).toBe(18.39);
  });

  it('says what each Assignment shows on the board and the Driver card', () => {
    const [a1, a2] = day('two').assignments;
    expect(a1).toMatchObject({ loads: 4, status: 'done', firstTripAt: '2026-11-16T13:24:26Z', lastLoadAt: '2026-11-16T16:25:45Z' });
    expect(a2).toMatchObject({ loads: 2, status: 'done' });
  });

  it('checks the day miles against Trip miles plus miles inside Places', () => {
    expect(day('two').miles).toEqual({ trips: 154.29, insidePlaces: 6.91, day: 161.61, ok: true });
    const short = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY, meter: { startOdometer: 258050.59, endOdometer: 258230 } });
    expect(short.miles.ok).toBe(false);
  });

  it('with A1’s To empty, never counts a way back or the drive to the shop as a Load', () => {
    const d = day('blank-to');
    // A1's ways back (Plant or South to North) and the drives to the shop; Quarry → North is A2's real Load.
    const notLoads = d.trips.filter((t) => (t.toCode === 'J1001 North' && t.fromCode !== 'QUARRY') || t.toCode === 'SHOP');
    expect(notLoads).toHaveLength(6);
    expect(notLoads.every((t) => t.match.kind !== 'load')).toBe(true);
    expect(d.assignments[0].loads).toBe(5); // the 4 to the Plant, and North → South
  });

  it('matches Trips before a reroute against the Assignment as it was', () => {
    const d = day('reroute');
    expect(lines(d)[1]).toBe('08:24 J1001 North → PLANT load a1');
    expect(lines(d)[12]).toBe('14:15 J1001 North → J1002 South load a1');
    expect(d.assignments[0].loads).toBe(5);
  });

  it('leaves a Trip for Dave when two Assignments fit at the same rule', () => {
    const d = day('ambiguous');
    expect(d.trips[1].match).toMatchObject({ kind: null, assignmentId: null, rule: 1 });
    expect(d.trips[1].match.reason).toMatch(/2 Assignments fit \(A1, A3\)/);
  });
});

describe('The day as the Worker knows it during the day', () => {
  it('at 10:02 knows 5 Trips, A1 is Now, and the North visit is still open', () => {
    const d = day('two', '2026-11-16T15:02:00Z');
    expect(d.trips).toHaveLength(5);
    expect(d.known.at(-1)).toMatchObject({ state: 'open', visit: { geofenceCode: 'J1001 North', exitedAt: null, exitOdometer: null } });
    expect(d.assignments[0]).toMatchObject({ loads: 2, status: 'now' });
    expect(d.assignments[1]).toMatchObject({ loads: 0, status: 'none' });
  });

  it('does not write a Trip until the visit it reaches is past the drive-through test', () => {
    const d = day('two', '2026-11-16T13:35:30Z'); // 08:35:30, 1 min into the Plant
    expect(d.trips.at(-1)).toMatchObject({ toCode: 'PLANT', written: false });
    expect(d.assignments[0].loads).toBe(0);
  });

  it('knows nothing before the first visit', () => {
    const d = day('two', '2026-11-16T04:00:00Z');
    expect(d.known).toEqual([]);
    expect(d.trips).toEqual([]);
  });
});

describe('Matching one Trip', () => {
  const a = (extra: Partial<TripAssignment>): TripAssignment => ({
    id: 'x',
    label: 'X',
    fromPlaceId: 'plc-north',
    toPlaceId: 'plc-plant',
    cancelledAt: null,
    changes: [],
    ...extra,
  });
  const trip = { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', leftAt: '2026-11-16T15:00:00Z' };

  it('still matches an Assignment cancelled after the Trip left, not one cancelled before', () => {
    expect(matchTrip(trip, [a({ cancelledAt: '2026-11-16T16:00:00Z' })], FIXTURE_PLACES).kind).toBe('load');
    expect(matchTrip(trip, [a({ cancelledAt: '2026-11-16T14:00:00Z' })], FIXTURE_PLACES).rule).toBe(7);
  });

  it('counts a plant to the drop as a Load when the Assignment has no From', () => {
    const m = matchTrip({ ...trip, fromPlaceId: 'plc-quarry', toPlaceId: 'plc-north' }, [a({ fromPlaceId: null, toPlaceId: 'plc-north' })], FIXTURE_PLACES);
    expect(m).toMatchObject({ kind: 'load', rule: 6 });
  });

  it('reads the route as it was from the earliest change after the moment', () => {
    const changed = a({
      toPlaceId: 'plc-south',
      changes: [
        { changedAt: '2026-11-16T16:00:00Z', before: { fromPlaceId: 'plc-north', toPlaceId: 'plc-quarry' } },
        { changedAt: '2026-11-16T14:00:00Z', before: { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant' } },
      ],
    });
    expect(routeAt(changed, '2026-11-16T13:00:00Z').toPlaceId).toBe('plc-plant');
    expect(routeAt(changed, '2026-11-16T15:00:00Z').toPlaceId).toBe('plc-quarry');
    expect(routeAt(changed, '2026-11-16T17:00:00Z').toPlaceId).toBe('plc-south');
  });
});
