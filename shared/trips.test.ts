import { describe, expect, it } from 'vitest';
import { easternTime } from './days';
import { buildTripDay, matchTrip, NOTHING_FITS, routeAt, savedRoute, type MadeAssignment, type TripAssignment } from './trips';
import { FIXTURE_METER, FIXTURE_NOT_CONSIDERED, FIXTURE_PARKED_AT_JOB, FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from './trips.fixture';

const END_OF_DAY = '2026-11-17T04:59:00Z';
const scenario = (id: string) => FIXTURE_SCENARIOS.find((s) => s.id === id)!.assignments;
const day = (id: string, now = END_OF_DAY) =>
  buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: scenario(id), now, meter: FIXTURE_METER });
/** Each Trip as "08:24 J1001 North → PLANT load a1". */
const lines = (d: ReturnType<typeof day>) =>
  d.trips.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode} ${t.match.kind ?? 'NULL'} ${t.match.assignmentId ?? '-'}`);

describe('Cleaning the raw Fleet visits', () => {
  const d = day('two');

  it('drops the two visits to ROAD, not considered, and joins the short exit, 19 rows into 16 visits', () => {
    expect(FIXTURE_VISITS).toHaveLength(19);
    expect(d.dropped.map((x) => x.raw)).toEqual([6, 9]);
    expect(d.dropped[0].reason).toBe('Not considered: ROAD');
    expect(d.merged).toEqual([{ into: 1, raw: [1, 2], reason: 'Short exit: left J1001 North for 2 min and came back' }]);
    expect(d.visits).toHaveLength(16);
  });

  it('drops a visit to a code on the Not considered list however long the Truck stayed, matching the code ignoring case', () => {
    // A 40-minute stop at the Plant, with "plant" on the list: the day reads as if the Truck drove straight past it.
    const d = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY, notConsidered: ['ROAD', ' plant '] });
    expect(d.visits.some((v) => v.geofenceCode === 'PLANT')).toBe(false);
    expect(d.dropped.filter((x) => FIXTURE_VISITS[x.raw].geofenceCode === 'PLANT').map((x) => x.reason)).toEqual(Array(4).fill('Not considered: PLANT'));
    expect(d.trips.some((t) => t.toCode === 'PLANT' || t.fromCode === 'PLANT')).toBe(false);
  });

  it('keeps a 61 s visit to a code not on the list as a stop: only the list decides', () => {
    const d = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY, notConsidered: [] });
    expect(d.dropped).toEqual([]);
    expect(d.trips.filter((t) => t.toCode === 'ROAD').map((t) => easternTime(t.arrivedAt))).toEqual(['09:52', '10:47']);
  });

  it('marks the visit that starts at local midnight as where the day began', () => {
    expect(d.visits[0].startOfDay).toBe(true);
    expect(d.visits.slice(1).every((v) => !v.startOfDay)).toBe(true);
  });

  it('lists a geofence code with no Place, once', () => {
    const places = FIXTURE_PLACES.filter((p) => p.id !== 'plc-south');
    const without = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY });
    expect(without.unknownCodes).toEqual(['J1002 South']);
    expect(d.unknownCodes).toEqual([]);
  });
});

describe('Trips and matching on the 16 Nov day', () => {
  it('makes 15 Trips: 4 Loads on A1, 2 on A2, and the South stop and the drive back from it for Dave', () => {
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
      '14:33 J1002 South → J1001 North NULL -',
      '15:41 J1001 North → SHOP empty -',
    ]);
  });

  it('takes Trip miles from the odometers, not from the miles inside a Place', () => {
    const d = day('two');
    expect(d.trips[1].miles).toBe(3.39);
    expect(d.trips.at(-1)!.miles).toBe(18.39);
  });

  it('gives each Assignment its Trip part: Loads, Done, since, last Load, Trucking hours, tons from Tickets', () => {
    const [a1, a2] = day('two').assignments;
    // A1 runs from leaving North at 08:24 to arriving at the Plant with its last Load at 11:25 (3 h 1 min):
    // the drive back from South is the Unplanned work's, not a drive to A1's pickup.
    expect(a1).toEqual({
      assignmentId: 'a1',
      job: null,
      loads: 4,
      empties: 3,
      tons: null,
      status: 'done',
      since: '2026-11-16T13:24:26Z',
      lastLoadAt: '2026-11-16T16:25:45Z',
      truckingHours: 3.02,
    });
    // A2 runs from leaving the Plant at 11:30 to arriving at North at 13:54 (2 h 24 min).
    expect(a2).toMatchObject({ loads: 2, status: 'done', since: '2026-11-16T16:30:53Z', truckingHours: 2.4, tons: null });
  });

  it('gives an Assignment with no Trips yet an empty Trip part', () => {
    const a2 = day('two', '2026-11-16T15:02:00Z').assignments[1];
    expect(a2).toEqual({ assignmentId: 'a2', job: null, loads: 0, empties: 0, tons: null, status: 'none', since: null, lastLoadAt: null, truckingHours: null });
  });

  it('gives each Assignment the Job of its To, else its At, else its From, else none', () => {
    const jobs = [
      { id: 'job-north', name: 'North', jobNumber: 'J1001' },
      { id: 'job-quarry', name: 'Quarry stockpile', jobNumber: null },
    ];
    const places = FIXTURE_PLACES.map((p) => ({ ...p, jobId: p.id === 'plc-north' ? 'job-north' : p.id === 'plc-quarry' ? 'job-quarry' : null }));
    const jobOf = (assignments: TripAssignment[]) =>
      buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places, jobs, visits: FIXTURE_VISITS, assignments, now: END_OF_DAY }).assignments.map((a) => a.job?.id ?? null);
    // A1 North → Plant: the Plant has no Job, so North's. A2 Quarry → North: North's, over the Quarry's.
    expect(jobOf(scenario('two'))).toEqual(['job-north', 'job-north']);
    const plantToSouth = { ...scenario('two')[0], fromPlaceId: 'plc-plant', toPlaceId: 'plc-south' };
    expect(jobOf([plantToSouth])).toEqual([null]);
    // The Job is the To's, then the At's, then the From's: the first that belongs to a Job.
    const [a1, a2] = scenario('two');
    expect(jobOf([{ ...a1, fromPlaceId: null, toPlaceId: null, atPlaceId: 'plc-north' }])).toEqual(['job-north']);
    expect(jobOf([{ ...a2, atPlaceId: 'plc-north' }])).toEqual(['job-north']);
    expect(jobOf([{ ...a2, toPlaceId: 'plc-plant', atPlaceId: 'plc-north' }])).toEqual(['job-north']);
    expect(jobOf([{ ...a1, fromPlaceId: 'plc-quarry', toPlaceId: 'plc-plant', atPlaceId: 'plc-north' }])).toEqual(['job-north']);
    expect(jobOf([{ ...a1, fromPlaceId: 'plc-quarry', toPlaceId: 'plc-plant', atPlaceId: 'plc-south' }])).toEqual(['job-quarry']);
  });

  it('makes the South stop and the drive back from it one piece of Unplanned work: its Places and times, never a Pick up or Drop off', () => {
    const d = day('two');
    expect(d.unplanned).toHaveLength(1);
    const [work] = d.unplanned;
    expect(work.id).toBe(work.trips[0].leftAt);
    expect(work.trips.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode}`)).toEqual([
      '14:15 J1001 North → J1002 South',
      '14:33 J1002 South → J1001 North',
    ]);
    // Where it went, in order, each once: North ⇄ South. No From, no To, no Job.
    expect(work.places).toEqual([
      { placeId: 'plc-north', code: 'J1001 North' },
      { placeId: 'plc-south', code: 'J1002 South' },
    ]);
    expect(work).not.toHaveProperty('fromPlaceId');
    expect(work).not.toHaveProperty('job');
    // 14:15:43 to 14:43:31.
    expect([easternTime(work.leftAt), easternTime(work.arrivedAt), work.truckingHours]).toEqual(['14:15', '14:43', 0.46]);
    // The drive back to North would fit A1 as a drive to its pickup (rule 4); it is the Unplanned work's, so it is nobody's.
    expect(work.trips.every((t) => t.match.kind === null && t.match.assignmentId === null)).toBe(true);
    expect(d.whichAssignment).toEqual([]);
  });

  it('keeps a Trip back that matches an Assignment’s route: only an empty guess joins the Unplanned work', () => {
    const southToNorth = { ...scenario('two')[0], id: 'a3', label: 'A3', fromPlaceId: 'plc-south', toPlaceId: 'plc-north' };
    const d = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [...scenario('two'), southToNorth], now: END_OF_DAY });
    expect(d.trips[13].match).toMatchObject({ kind: 'load', assignmentId: 'a3', rule: 1 });
    // A3 explains 14:15 too, as its way back (rule 2), so there is no Unplanned work at all.
    expect(d.unplanned).toEqual([]);
  });

  it('lists the drives to and from the shop: leaving in the morning, getting back at the end of the day', () => {
    expect(day('two').shopTrips.map((t) => `${easternTime(t.leftAt)}–${easternTime(t.arrivedAt)} ${t.fromCode} → ${t.toCode} ${t.miles}`)).toEqual([
      '06:24–07:02 SHOP → J1001 North 20.59',
      '15:41–16:03 J1001 North → SHOP 18.39',
    ]);
  });

  it('checks the day miles against Trip miles plus miles inside Places', () => {
    expect(day('two').miles).toEqual({ trips: 154.29, insidePlaces: 6.91, day: 161.61, ok: true });
    const short = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [], now: END_OF_DAY, meter: { startOdometer: 258050.59, endOdometer: 258230 } });
    expect(short.miles.ok).toBe(false);
  });

  it('builds the same Trips with miles blank when the visits have no odometers, as an xlsx export gives them', () => {
    const noMeters = FIXTURE_VISITS.map((v) => ({ ...v, entryOdometer: null, exitOdometer: null }));
    const d = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: noMeters, assignments: scenario('two'), now: END_OF_DAY, dayOver: true });
    expect(lines(d)).toEqual(lines(day('two')));
    expect(d.trips.every((t) => t.miles === null)).toBe(true);
    expect(d.truckDay).toMatchObject({ startMiles: null, endMiles: null });
    expect([easternTime(d.truckDay.startAt!), easternTime(d.truckDay.endAt!)]).toEqual(['06:24', '16:03']);
    expect(d.assignments.map((a) => a.loads)).toEqual([4, 2]);
    expect(d.miles).toEqual({ trips: null, insidePlaces: null, day: null, ok: null });
  });

  it('leaves blank only the miles of a Trip whose visits miss an odometer', () => {
    const visits = FIXTURE_VISITS.map((v, i) => (i === FIXTURE_VISITS.length - 2 ? { ...v, exitOdometer: null } : v));
    const d = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits, assignments: scenario('two'), now: END_OF_DAY });
    expect(lines(d)).toEqual(lines(day('two')));
    expect(d.trips.at(-1)!.miles).toBeNull();
    expect(d.trips[1].miles).toBe(3.39);
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

  it('asks "Which Assignment?" when two Assignments fit a Trip at the same rule, naming both', () => {
    const d = day('ambiguous');
    expect(d.trips[1].match).toMatchObject({ kind: null, assignmentId: null, rule: 1, candidates: ['a1', 'a3'] });
    expect(d.trips[1].match.reason).toMatch(/2 Assignments fit \(A1, A3\)/);
    // A1 and A3 both run North → Plant: each Load and each way back is a question, from 08:24 to 11:14, and the drive back to North at 14:33.
    expect(d.whichAssignment.map((q) => `${easternTime(q.trip.leftAt)} ${q.trip.fromCode} → ${q.trip.toCode} ${q.candidates.join('/')}`)).toEqual([
      '08:24 J1001 North → PLANT a1/a3',
      '08:43 PLANT → J1001 North a1/a3',
      '09:35 J1001 North → PLANT a1/a3',
      '09:50 PLANT → J1001 North a1/a3',
      '10:27 J1001 North → PLANT a1/a3',
      '10:41 PLANT → J1001 North a1/a3',
      '11:14 J1001 North → PLANT a1/a3',
      '14:33 J1002 South → J1001 North a1/a3',
    ]);
    expect(d.whichAssignment[0].id).toBe(d.whichAssignment[0].trip.leftAt);
  });

  it('never takes a tie as Unplanned work, not even a drive back into it: on two the same, only the drive to South is', () => {
    const d = day('ambiguous');
    // 14:33 South → North goes to both A1's and A3's pickup (rule 4): a tie, so "Which Assignment?", not the piece's way back.
    expect(d.unplanned.map((w) => w.trips.map((t) => easternTime(t.leftAt)))).toEqual([['14:15']]);
  });

  it('makes a run of three Trips nothing fits one piece: A1 cancelled at 10:10, its last three Trips to and from the Plant', () => {
    const [a1, a2] = scenario('two');
    const d = buildTripDay({
      notConsidered: FIXTURE_NOT_CONSIDERED,
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments: [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2],
      now: END_OF_DAY,
    });
    expect(d.unplanned.map((w) => w.trips.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode}`))).toEqual([
      ['10:27 J1001 North → PLANT', '10:41 PLANT → J1001 North', '11:14 J1001 North → PLANT'],
      ['14:15 J1001 North → J1002 South', '14:33 J1002 South → J1001 North'],
    ]);
    expect(d.unplanned[0].places.map((p) => p.code)).toEqual(['J1001 North', 'PLANT']);
    // The drive on to the Quarry fits A2 (to its pickup) and goes somewhere the piece had not been: A2's.
    expect(lines(d)[8]).toBe('11:30 PLANT → QUARRY empty a2');
    // A1 keeps its Trips before it was cancelled: 08:24 to back at North at 10:00.
    expect(d.assignments[0]).toMatchObject({ loads: 2, truckingHours: 1.59 });
  });
});

describe('At: where the Truck works', () => {
  const [a1, a2] = scenario('two');
  const withAssignments = (assignments: TripAssignment[], now = END_OF_DAY) =>
    buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments, now });

  it('fills a missing From with At: at North, to the Plant matches as North → Plant, with real Loads', () => {
    const d = withAssignments([{ ...a1, fromPlaceId: null, atPlaceId: 'plc-north' }, a2]);
    expect(lines(d)).toEqual(lines(day('two')));
    expect(d.assignments[0]).toMatchObject({ loads: 4, empties: 3, truckingHours: 3.02 });
  });

  it('fills a missing To with At: from the Quarry, at North matches as Quarry → North, its way back an empty, not a Load from the pickup', () => {
    const fromAt = { ...a2, toPlaceId: null, atPlaceId: 'plc-north' };
    const d = withAssignments([a1, fromAt]);
    expect(lines(d)).toEqual(lines(day('two')));
    const wayBack = { fromPlaceId: 'plc-north', toPlaceId: 'plc-quarry', leftAt: '2026-11-16T17:54:36Z' };
    expect(matchTrip(wayBack, [fromAt], FIXTURE_PLACES)).toMatchObject({ kind: 'empty', rule: 2, reason: 'The way back of the Assignment' });
    // At is not the pickup: leaving the Quarry for South is no Load, as it would be with To empty and no At.
    const elsewhere = { fromPlaceId: 'plc-quarry', toPlaceId: 'plc-south', leftAt: '2026-11-16T17:54:36Z' };
    expect(matchTrip(elsewhere, [fromAt], FIXTURE_PLACES).kind).not.toBe('load');
  });

  it('with only At, counts each Trip that starts or ends there as an At Trip: Now / Done and hours, never Loads', () => {
    const atOnly = { ...a1, fromPlaceId: null, toPlaceId: null, atPlaceId: 'plc-north' };
    const d = withAssignments([atOnly, a2]);
    expect(lines(d)).toEqual([
      // The shop rule runs first, as for every rule.
      '06:24 SHOP → J1001 North empty -',
      '08:24 J1001 North → PLANT at a1',
      '08:43 PLANT → J1001 North at a1',
      '09:35 J1001 North → PLANT at a1',
      '09:50 PLANT → J1001 North at a1',
      '10:27 J1001 North → PLANT at a1',
      '10:41 PLANT → J1001 North at a1',
      '11:14 J1001 North → PLANT at a1',
      // A2's route fits first.
      '11:30 PLANT → QUARRY empty a2',
      '12:08 QUARRY → J1001 North load a2',
      '12:54 J1001 North → QUARRY empty a2',
      '13:29 QUARRY → J1001 North load a2',
      '14:15 J1001 North → J1002 South at a1',
      '14:33 J1002 South → J1001 North at a1',
      '15:41 J1001 North → SHOP empty -',
    ]);
    expect(d.trips[1].match).toMatchObject({ rule: 7, reason: 'Starts or ends at the Assignment’s At', atPlaceId: 'plc-north' });
    // Leaving North at 08:24 to arriving back there at 14:43: 6 h 19 min. Loads are blank, from Tickets.
    expect(d.assignments[0]).toEqual({
      assignmentId: 'a1',
      job: null,
      loads: null,
      empties: 0,
      tons: null,
      status: 'done',
      since: '2026-11-16T13:24:26Z',
      lastLoadAt: null,
      truckingHours: 6.32,
    });
    expect(d.unplanned).toEqual([]);
  });

  it('is Now while the Truck’s latest Trip is an At Trip', () => {
    const atOnly = { ...a1, fromPlaceId: null, toPlaceId: null, atPlaceId: 'plc-north' };
    expect(withAssignments([atOnly], '2026-11-16T15:02:00Z').assignments[0]).toMatchObject({ status: 'now', loads: null });
  });

  it('asks "Which Assignment?" when two Assignments have only the same At', () => {
    const at = (id: string) => ({ ...a1, id, label: id.toUpperCase(), fromPlaceId: null, toPlaceId: null, atPlaceId: 'plc-north' });
    const d = withAssignments([at('a1'), at('a3')]);
    expect(d.trips[1].match).toMatchObject({ kind: null, rule: 7, candidates: ['a1', 'a3'] });
    expect(d.whichAssignment).toHaveLength(12);
  });

  it('never matches on a null At: an Assignment with no From, To or At fits nothing, not even a Place with no geofence', () => {
    const blank = { ...a1, fromPlaceId: null, toPlaceId: null, atPlaceId: null };
    const unknown = { fromPlaceId: null, toPlaceId: null, leftAt: '2026-11-16T15:00:00Z' };
    expect(matchTrip(unknown, [blank], FIXTURE_PLACES).rule).toBe(NOTHING_FITS);
  });

  it('matches no Trip at an At with no geofence code: the Assignment shows no Trips', () => {
    const places = FIXTURE_PLACES.map((p) => (p.id === 'plc-south' ? { ...p, geofenceCode: null } : p));
    const atSouth = { ...a1, fromPlaceId: null, toPlaceId: null, atPlaceId: 'plc-south' };
    const d = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places, visits: FIXTURE_VISITS, assignments: [atSouth], now: END_OF_DAY });
    expect(d.trips.some((t) => t.match.assignmentId === 'a1')).toBe(false);
    expect(d.assignments[0]).toMatchObject({ status: 'none', truckingHours: null });
  });

  it('ignores At for matching when From and To are both set', () => {
    const d = withAssignments([{ ...a1, atPlaceId: 'plc-south' }, { ...a2, atPlaceId: 'plc-plant' }]);
    expect(lines(d)).toEqual(lines(day('two')));
  });
});

describe('Move: a machine on the lowboy', () => {
  const [a1, a2] = scenario('two');
  const withAssignments = (assignments: TripAssignment[], now = END_OF_DAY) =>
    buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments, now });
  const move: TripAssignment = { ...a1, work: 'move' };

  it('matches as a Haul with the same From and To: its From → To Trips are Move Trips, its drives to the pickup and back its empties', () => {
    const d = withAssignments([move, a2]);
    expect(lines(d)).toEqual(lines(day('two')).map((line) => line.replace(' load a1', ' move a1')));
    expect(d.trips[1].match).toMatchObject({ kind: 'move', rule: 1, reason: 'From and To match the Move' });
    expect(d.trips[2].match).toMatchObject({ kind: 'empty', rule: 2 });
  });

  it('counts Move Trips toward Now / Done and Trucking hours, never toward Loads: "Done 11:25"', () => {
    const d = withAssignments([move, a2]);
    expect(d.assignments[0]).toEqual({
      assignmentId: 'a1',
      job: null,
      loads: 0,
      empties: 3,
      tons: null,
      status: 'done',
      since: '2026-11-16T13:24:26Z',
      lastLoadAt: null,
      movedAt: '2026-11-16T16:25:45Z',
      truckingHours: 3.02,
    });
    expect(withAssignments([move], '2026-11-16T15:02:00Z').assignments[0]).toMatchObject({ status: 'now', loads: 0 });
  });

  it('counts the drive to its pickup as an empty, and every From → To Trip as a Move Trip', () => {
    const plantToPickup = { fromPlaceId: 'plc-plant', toPlaceId: 'plc-quarry', leftAt: '2026-11-16T15:00:00Z' };
    const quarryMove = { ...move, fromPlaceId: 'plc-quarry', toPlaceId: 'plc-south' };
    expect(matchTrip(plantToPickup, [quarryMove], FIXTURE_PLACES)).toMatchObject({ kind: 'empty', rule: 4, assignmentId: 'a1' });
    expect(withAssignments([move]).trips.filter((t) => t.match.kind === 'move')).toHaveLength(4);
  });

  it('fits no Trip while its From or To is missing', () => {
    const d = withAssignments([{ ...move, toPlaceId: null }, { ...a2, id: 'm2', label: 'M2', work: 'move', fromPlaceId: null }]);
    expect(d.trips.some((t) => t.match.assignmentId !== null)).toBe(false);
    expect(d.assignments.map((a) => a.status)).toEqual(['none', 'none']);
  });

  it('is matched by the route it had at each Trip: a Haul turned Move at 10:00 counts Loads before and Move Trips after', () => {
    const changed = { ...move, changes: [{ changedAt: '2026-11-16T15:00:00Z', before: { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', work: 'haul' as const } }] };
    const d = withAssignments([changed, a2]);
    expect(lines(d).slice(1, 8)).toEqual([
      '08:24 J1001 North → PLANT load a1',
      '08:43 PLANT → J1001 North empty a1',
      '09:35 J1001 North → PLANT load a1',
      '09:50 PLANT → J1001 North empty a1',
      '10:27 J1001 North → PLANT move a1',
      '10:41 PLANT → J1001 North empty a1',
      '11:14 J1001 North → PLANT move a1',
    ]);
    expect(d.assignments[0]).toMatchObject({ loads: 2, movedAt: '2026-11-16T16:25:45Z' });
    // Cancelled at 10:10: the Trips after it are nobody's.
    const cancelled = withAssignments([{ ...move, cancelledAt: '2026-11-16T15:10:00Z' }, a2]);
    expect(lines(cancelled).slice(5, 8).map((l) => l.split(' ').slice(-2).join(' '))).toEqual(['NULL -', 'NULL -', 'NULL -']);
  });
});

describe('Other: Trips that fit nothing are not a haul', () => {
  const [a1, a2] = scenario('two');
  const other = (id: string, note: string, extra: Partial<TripAssignment> = {}): TripAssignment => ({
    ...a1,
    id,
    label: id.toUpperCase(),
    work: 'other',
    note,
    fromPlaceId: null,
    toPlaceId: null,
    atPlaceId: null,
    ...extra,
  });
  const withAssignments = (assignments: TripAssignment[], now = END_OF_DAY) =>
    buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments, now });

  it('counts the Trips nothing else fits on the Driver’s Other, with its text as the Why, not as Unplanned work', () => {
    const d = withAssignments([a1, a2, other('o1', 'Shop, on deck')]);
    expect(lines(d).slice(-3)).toEqual([
      '14:15 J1001 North → J1002 South not_a_haul o1',
      '14:33 J1002 South → J1001 North empty a1',
      '15:41 J1001 North → SHOP empty -',
    ]);
    expect(d.trips.at(-3)!.match).toEqual({ kind: 'not_a_haul', assignmentId: 'o1', rule: 8, reason: 'Other: Shop, on deck' });
    expect(NOTHING_FITS).toBe(9);
    expect(d.unplanned).toEqual([]);
    // Leaving North at 14:15 to arriving at South: its Trucking hours. The drive back fits A1, so it stays A1's.
    expect(d.assignments[2]).toMatchObject({ assignmentId: 'o1', loads: 0, empties: 0, status: 'done', since: '2026-11-16T19:15:43Z', truckingHours: 0.14 });
  });

  it('leaves a Trip that fits a Haul or a Move on it', () => {
    const d = withAssignments([a1, { ...a2, work: 'move' }, other('o1', 'Shop, on deck')]);
    expect(lines(d).slice(0, 12)).toEqual(
      lines(day('two'))
        .slice(0, 12)
        .map((l) => l.replace(' load a2', ' move a2')),
    );
  });

  it('counts a whole shop day on the Other: every Trip but those to and from the shop', () => {
    const d = withAssignments([other('o1', 'Shop, on deck')]);
    expect(d.trips.map((t) => t.match.kind)).toEqual(['empty', ...Array(13).fill('not_a_haul'), 'empty']);
    expect(d.unplanned).toEqual([]);
  });

  it('goes on the latest-ordered Other when two are live at once', () => {
    const d = withAssignments([other('o1', 'Shop'), other('o2', 'Water truck')]);
    expect(d.trips[1].match).toMatchObject({ assignmentId: 'o2', reason: 'Other: Water truck' });
  });

  it('counts only while the Other is live: not after it is cancelled, nor before it was an Other', () => {
    const cancelled = withAssignments([a1, a2, other('o1', 'Shop', { cancelledAt: '2026-11-16T19:00:00Z' })]);
    expect(cancelled.unplanned.map((w) => easternTime(w.leftAt))).toEqual(['14:15']);
    // A Haul with no route until 10:00, then an Other.
    const turnedOther = other('o1', 'Shop', { changes: [{ changedAt: '2026-11-16T15:00:00Z', before: { work: 'haul' } }] });
    const d = withAssignments([turnedOther]);
    expect(d.trips.map((t) => t.match.kind)).toEqual(['empty', ...Array(4).fill(null), ...Array(9).fill('not_a_haul'), 'empty']);
    expect(d.unplanned.map((w) => [easternTime(w.leftAt), w.trips.length])).toEqual([['08:24', 4]]);
  });

  it('changes nothing for a Driver with no live Other', () => {
    expect(lines(withAssignments(scenario('two')))).toEqual(lines(day('two')));
  });

  it('with check-ins, counts only on the checked-in Driver’s Other', () => {
    const randy = { id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55' };
    const driverA = { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21' };
    const assignments = [...scenario('two').map((a) => ({ ...a, driverId: randy.id, truckId: null })), other('o1', 'Shop', { driverId: driverA.id, truckId: null })];
    const d = buildTripDay({
      notConsidered: FIXTURE_NOT_CONSIDERED,
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments,
      now: END_OF_DAY,
      truck: {
        id: 'trk-55',
        drivers: [randy, driverA],
        assignments: assignments.map((a) => ({ driverId: a.driverId ?? null, truckId: a.truckId ?? null })),
        checkIns: [{ driverId: randy.id, at: '2026-11-16T11:00:00Z' }],
      },
    });
    expect(d.unplanned.map((w) => easternTime(w.leftAt))).toEqual(['14:15']);
  });
});

describe('Make an Assignment: an answer to Unplanned work', () => {
  const [a1, a2] = scenario('two');
  const cancelled = [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2];
  const plantRun = '2026-11-16T15:27:50Z';

  it('claims only the Trips of the Unplanned work it answers, never earlier ones on the same route', () => {
    // A1 cancelled at 10:10: 10:27–11:25 to and from the Plant is Unplanned work. Dave says it loaded at the Plant.
    // Plant → North is the route of A1's ways back at 08:43 and 09:50; they stay A1's.
    expect(day('two').unplanned.map((w) => w.id)).not.toContain(plantRun);
    const before = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY });
    expect(before.unplanned[0].id).toBe(plantRun);
    const d = buildTripDay({
      notConsidered: FIXTURE_NOT_CONSIDERED,
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments: cancelled,
      now: END_OF_DAY,
      answers: {
        madeAssignments: [{ id: 'a3', label: 'A3', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', atPlaceId: null, work: 'haul', cancelledAt: null, changes: [], unplannedId: plantRun }],
      },
    });
    expect(lines(d).slice(1, 8)).toEqual([
      '08:24 J1001 North → PLANT load a1',
      '08:43 PLANT → J1001 North empty a1',
      '09:35 J1001 North → PLANT load a1',
      '09:50 PLANT → J1001 North empty a1',
      '10:27 J1001 North → PLANT empty a3',
      '10:41 PLANT → J1001 North load a3',
      '11:14 J1001 North → PLANT empty a3',
    ]);
    expect(d.assignments.map((a) => [a.assignmentId, a.loads, a.empties])).toEqual([
      ['a1', 2, 2],
      ['a2', 2, 2],
      ['a3', 1, 2],
    ]);
    // The South stop is still Unplanned work.
    expect(d.unplanned.map((w) => easternTime(w.leftAt))).toEqual(['14:15']);
  });

  it('leaves Unplanned work it does not answer as it is', () => {
    const d = buildTripDay({
      notConsidered: FIXTURE_NOT_CONSIDERED,
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments: scenario('two'),
      now: END_OF_DAY,
      answers: { madeAssignments: [{ id: 'a3', label: 'A3', fromPlaceId: 'plc-south', toPlaceId: 'plc-north', atPlaceId: null, work: 'haul', cancelledAt: null, changes: [], unplannedId: plantRun }] },
    });
    expect(d.unplanned).toHaveLength(1);
    expect(d.assignments[2]).toMatchObject({ assignmentId: 'a3', loads: 0, status: 'none' });
  });
});

describe('Split: one run that held two hauls', () => {
  const [a1, a2] = scenario('two');
  const cancelled = [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2];
  const at = (splits: string[], madeAssignments: MadeAssignment[] = []) =>
    buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY, answers: { splits, madeAssignments } });
  const pieces = (d: ReturnType<typeof at>) => d.unplanned.map((w) => w.trips.map((t) => `${easternTime(t.leftAt)} ${t.fromCode} → ${t.toCode}`));
  /** 10:41, Plant → North: the second Trip of the run to and from the Plant. */
  const second = at([]).unplanned[0].trips[1].leftAt;

  it('splits a run at the Trip Dave taps: two pieces, the second starting at that Trip and named by it', () => {
    const d = at([second]);
    expect(pieces(d)).toEqual([
      ['10:27 J1001 North → PLANT'],
      ['10:41 PLANT → J1001 North', '11:14 J1001 North → PLANT'],
      ['14:15 J1001 North → J1002 South', '14:33 J1002 South → J1001 North'],
    ]);
    expect(d.unplanned[1]).toMatchObject({ id: second, places: [{ code: 'PLANT' }, { code: 'J1001 North' }] });
  });

  it('ignores a split at a run’s first Trip or at a Trip in no run', () => {
    const d = at(['2026-11-16T15:27:50Z', '2026-11-16T13:24:26Z']);
    expect(pieces(d)).toEqual(pieces(at([])));
  });

  it('answers each part on its own: each made Assignment claims only its own part’s Trips', () => {
    const made = (id: string, from: string, to: string, unplannedId: string): MadeAssignment => ({ id, label: id.toUpperCase(), fromPlaceId: from, toPlaceId: to, atPlaceId: null, work: 'haul', cancelledAt: null, changes: [], unplannedId });
    const d = at([second], [made('a3', 'plc-north', 'plc-plant', '2026-11-16T15:27:50Z'), made('a4', 'plc-plant', 'plc-north', second)]);
    expect(lines(d).slice(5, 8)).toEqual(['10:27 J1001 North → PLANT load a3', '10:41 PLANT → J1001 North load a4', '11:14 J1001 North → PLANT empty a4']);
    expect(d.assignments.slice(2).map((a) => [a.assignmentId, a.loads, a.empties, a.truckingHours])).toEqual([
      ['a3', 1, 0, 0.17],
      ['a4', 1, 1, 0.74],
    ]);
  });
});

describe('Link to an Assignment and Not a haul: answers to Unplanned work', () => {
  const [a1, a2] = scenario('two');
  const cancelled = [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2];
  const plantRun = '2026-11-16T15:27:50Z';
  const answered = (answers: Parameters<typeof buildTripDay>[0]['answers']) =>
    buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY, answers });

  it('a link reroutes the Assignment only for its own piece: A2 gains the Plant run’s Load and keeps its Quarry Loads after it', () => {
    // Linked to A2 loaded at the Plant (Plant → North from 10:27). A2's Quarry → North Loads come after it and stay A2's;
    // A1's ways back on Plant → North before it stay A1's.
    const d = answered({ links: [{ unplannedId: plantRun, assignmentId: 'a2', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north' }] });
    expect(lines(d).slice(2, 8)).toEqual([
      '08:43 PLANT → J1001 North empty a1',
      '09:35 J1001 North → PLANT load a1',
      '09:50 PLANT → J1001 North empty a1',
      '10:27 J1001 North → PLANT empty a2',
      '10:41 PLANT → J1001 North load a2',
      '11:14 J1001 North → PLANT empty a2',
    ]);
    expect(d.assignments.map((a) => [a.assignmentId, a.loads])).toEqual([
      ['a1', 2],
      ['a2', 3],
    ]);
    expect(d.unplanned.map((w) => easternTime(w.leftAt))).toEqual(['14:15']);
  });

  it('Not a haul takes its piece’s Trips out of Unplanned work and gives them to no Assignment', () => {
    const d = answered({ notAHauls: [{ unplannedId: plantRun, note: null }] });
    expect(lines(d).slice(5, 8)).toEqual([
      '10:27 J1001 North → PLANT not_a_haul -',
      '10:41 PLANT → J1001 North not_a_haul -',
      '11:14 J1001 North → PLANT not_a_haul -',
    ]);
    expect(d.unplanned.map((w) => easternTime(w.leftAt))).toEqual(['14:15']);
    expect(d.assignments.map((a) => a.loads)).toEqual([2, 2]);
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

  it('counts a Trip as soon as the Truck arrives, with no wait', () => {
    const d = day('two', '2026-11-16T13:35:30Z'); // 08:35:30, 1 min into the Plant
    expect(d.trips.at(-1)).toMatchObject({ toCode: 'PLANT', match: { kind: 'load', assignmentId: 'a1' } });
    expect(d.assignments[0].loads).toBe(1);
  });

  it('knows nothing before the first visit', () => {
    const d = day('two', '2026-11-16T04:00:00Z');
    expect(d.known).toEqual([]);
    expect(d.trips).toEqual([]);
  });
});

describe('The Truck’s end time when it stops away from the shop', () => {
  const parked = (dayOver: boolean, ignition = FIXTURE_PARKED_AT_JOB.ignition) => {
    const d = buildTripDay({ notConsidered: FIXTURE_NOT_CONSIDERED, places: FIXTURE_PLACES, visits: FIXTURE_PARKED_AT_JOB.visits, assignments: [], now: END_OF_DAY, ignition, dayOver }).truckDay;
    return { start: d.startAt && easternTime(d.startAt), end: d.endAt && easternTime(d.endAt), totalHours: d.totalHours };
  };

  it('has no end time while the day is still going: it might drive on', () => {
    expect(parked(false)).toEqual({ start: '06:20', end: null, totalHours: null });
  });

  it('once the day is over, ends at the ignition off after its last arrival, at the job', () => {
    expect(parked(true)).toEqual({ start: '06:20', end: '14:50', totalHours: 8.5 });
  });

  it('once the day is over with no ignition off, ends at its last arrival', () => {
    expect(parked(true, [])).toEqual({ start: '06:24', end: '14:43', totalHours: 8.31 });
  });
});

describe('Matching one Trip', () => {
  const a = (extra: Partial<TripAssignment>): TripAssignment => ({
    id: 'x',
    label: 'X',
    fromPlaceId: 'plc-north',
    toPlaceId: 'plc-plant',
    atPlaceId: null,
    work: 'haul',
    cancelledAt: null,
    changes: [],
    ...extra,
  });
  const trip = { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', leftAt: '2026-11-16T15:00:00Z' };

  it('still matches an Assignment cancelled after the Trip left, not one cancelled before', () => {
    expect(matchTrip(trip, [a({ cancelledAt: '2026-11-16T16:00:00Z' })], FIXTURE_PLACES).kind).toBe('load');
    expect(matchTrip(trip, [a({ cancelledAt: '2026-11-16T14:00:00Z' })], FIXTURE_PLACES).rule).toBe(NOTHING_FITS);
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

  it('reads only the route from the Assignment, its From, To, At and kind, not its other fields', () => {
    expect(routeAt(a({ driverId: 'drv-randy', truckId: 'trk-55', atPlaceId: 'plc-south', work: 'move', note: 'x' }), '2026-11-16T13:00:00Z')).toEqual({
      fromPlaceId: 'plc-north',
      toPlaceId: 'plc-plant',
      atPlaceId: 'plc-south',
      work: 'move',
    });
  });

  it('reads a route from the values saved before a change, defaulting what they lack: an older saved copy has no At and is a Haul', () => {
    const saved = { driverId: 'drv-randy', fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', atPlaceId: 'plc-south', atPlaceName: 'Sample Site South', note: 'x', work: 'move' as const };
    expect(savedRoute(saved)).toEqual({ fromPlaceId: 'plc-north', toPlaceId: 'plc-plant', atPlaceId: 'plc-south', work: 'move' });
    expect(savedRoute({ fromPlaceId: 'plc-north' })).toEqual({ fromPlaceId: 'plc-north', toPlaceId: null, atPlaceId: null, work: 'haul' });
  });

  it('reads At as it was before a change, so a new At at noon does not re-match the morning', () => {
    const changed = a({ atPlaceId: 'plc-south', changes: [{ changedAt: '2026-11-16T17:00:00Z', before: { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant' } }] });
    expect(routeAt(changed, '2026-11-16T13:00:00Z').atPlaceId).toBeNull();
    expect(routeAt(changed, '2026-11-16T18:00:00Z').atPlaceId).toBe('plc-south');
  });
});

describe('The Driver from check-ins', () => {
  const randy = { id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55' };
  const driverA = { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21' };
  const driverB = { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: 'trk-24' };
  const drivers = [randy, driverA, driverB];
  /** 06:00 and 12:00 US Eastern on 16 Nov. */
  const SIX = '2026-11-16T11:00:00Z';
  const NOON = '2026-11-16T17:00:00Z';
  /** Scenario 'two' (A1 North → Plant, A2 Quarry → North) as Randy's, naming no Truck: his usual Truck 55. */
  const randys = scenario('two').map((a) => ({ ...a, driverId: randy.id, truckId: null }));
  const withCheckIns = (assignments: TripAssignment[], checkIns: { driverId: string; at: string }[], now = END_OF_DAY) =>
    buildTripDay({
      notConsidered: FIXTURE_NOT_CONSIDERED,
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments,
      now,
      truck: { id: 'trk-55', drivers, assignments: assignments.map((a) => ({ driverId: a.driverId ?? null, truckId: a.truckId ?? null })), checkIns },
    });
  const loads = (d: ReturnType<typeof day>) => Object.fromEntries(d.assignments.map((a) => [a.assignmentId, a.loads]));

  it('names the Driver who checked in to the Truck, and his Assignments get their Loads', () => {
    const d = withCheckIns(randys, [{ driverId: randy.id, at: SIX }]);
    expect(d.truckDay.driver?.name).toBe('Randy');
    expect(loads(d)).toEqual({ a1: 4, a2: 2 });
  });

  it('matches the Trips against the checked-in Driver’s Assignments, not the Driver whose usual Truck it is', () => {
    const asA = scenario('two').map((a) => ({ ...a, id: `${a.id}-a`, driverId: driverA.id, truckId: 'trk-55' }));
    const d = withCheckIns([...randys, ...asA], [{ driverId: driverA.id, at: SIX }]);
    expect(d.truckDay.driver?.name).toBe('Sample Driver A');
    expect(loads(d)).toEqual({ a1: 0, a2: 0, 'a1-a': 4, 'a2-a': 2 });
  });

  it('hands the Truck over at the second check-in: each Trip matches the Driver at its time', () => {
    const [a1, a2] = scenario('two');
    const assignments = [
      { ...a1, driverId: driverA.id, truckId: 'trk-55' },
      { ...a2, driverId: driverB.id, truckId: 'trk-55' },
    ];
    const checkIns = [
      { driverId: driverB.id, at: NOON },
      { driverId: driverA.id, at: SIX },
    ];
    expect(withCheckIns(assignments, checkIns, '2026-11-16T16:59:59Z').truckDay.driver?.name).toBe('Sample Driver A');
    expect(withCheckIns(assignments, checkIns, NOON).truckDay.driver?.name).toBe('Sample Driver B');
    expect(loads(withCheckIns(assignments, checkIns))).toEqual({ a1: 4, a2: 2 });
    // The other way round: A1's Loads (before noon) are not B's, and A2's (after) not A's.
    const swapped = [
      { ...a1, driverId: driverB.id, truckId: 'trk-55' },
      { ...a2, driverId: driverA.id, truckId: 'trk-55' },
    ];
    expect(loads(withCheckIns(swapped, checkIns))).toEqual({ a1: 0, a2: 0 });
  });

  it('matches a checked-in Driver’s Assignment that names another Truck', () => {
    const asA = scenario('two').map((a) => ({ ...a, driverId: driverA.id, truckId: 'trk-21' }));
    expect(loads(withCheckIns(asA, [{ driverId: driverA.id, at: SIX }]))).toEqual({ a1: 4, a2: 2 });
  });

  it('asks "Who was driving?" with no check-in, and matches the Assignments that name the Truck', () => {
    const elsewhere = scenario('two').map((a) => ({ ...a, id: `${a.id}-a`, driverId: driverA.id, truckId: null }));
    const d = withCheckIns([...randys, ...elsewhere], []);
    expect(d.truckDay.driver).toBeNull();
    expect(d.truckDay.driverCandidates.map((c) => c.name)).toEqual(['Randy']);
    expect(loads(d)).toEqual({ a1: 4, a2: 2, 'a1-a': 0, 'a2-a': 0 });
  });

  it('asks "Who was driving?" for the Trips before the first check-in', () => {
    const d = withCheckIns(randys, [{ driverId: driverA.id, at: NOON }]);
    expect(withCheckIns(randys, [{ driverId: driverA.id, at: NOON }], SIX).truckDay.driver).toBeNull();
    // Randy's A1 Loads were before A checked in; his A2 Loads after it are A's to explain.
    expect(loads(d)).toEqual({ a1: 4, a2: 0 });
  });
});
