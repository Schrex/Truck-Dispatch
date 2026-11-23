import { describe, expect, it } from 'vitest';
import { easternTime } from './days';
import { buildTripDay, matchTrip, routeAt, type MadeAssignment, type TripAssignment } from './trips';
import { FIXTURE_METER, FIXTURE_PARKED_AT_JOB, FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from './trips.fixture';

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

  it('gives each Assignment the Job of its drop-off, else of its pick-up, else none', () => {
    const jobs = [
      { id: 'job-north', name: 'North', jobNumber: 'J1001' },
      { id: 'job-quarry', name: 'Quarry stockpile', jobNumber: null },
    ];
    const places = FIXTURE_PLACES.map((p) => ({ ...p, jobId: p.id === 'plc-north' ? 'job-north' : p.id === 'plc-quarry' ? 'job-quarry' : null }));
    const jobOf = (assignments: TripAssignment[]) =>
      buildTripDay({ places, jobs, visits: FIXTURE_VISITS, assignments, now: END_OF_DAY }).assignments.map((a) => a.job?.id ?? null);
    // A1 North → Plant: the Plant has no Job, so North's. A2 Quarry → North: North's, over the Quarry's.
    expect(jobOf(scenario('two'))).toEqual(['job-north', 'job-north']);
    const plantToSouth = { ...scenario('two')[0], fromPlaceId: 'plc-plant', toPlaceId: 'plc-south' };
    expect(jobOf([plantToSouth])).toEqual([null]);
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
    const d = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: [...scenario('two'), southToNorth], now: END_OF_DAY });
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

  it('asks "Which Assignment?" when two Assignments fit a Trip at the same rule, naming both', () => {
    const d = day('ambiguous');
    expect(d.trips[1].match).toMatchObject({ kind: null, assignmentId: null, rule: 1, candidates: ['a1', 'a3'] });
    expect(d.trips[1].match.reason).toMatch(/2 Assignments fit \(A1, A3\)/);
    // A1 and A3 both run North → Plant: each Load and each way back is a question, from 08:24 to 11:14.
    expect(d.whichAssignment.map((q) => `${easternTime(q.trip.leftAt)} ${q.trip.fromCode} → ${q.trip.toCode} ${q.candidates.join('/')}`)).toEqual([
      '08:24 J1001 North → PLANT a1/a3',
      '08:43 PLANT → J1001 North a1/a3',
      '09:35 J1001 North → PLANT a1/a3',
      '09:50 PLANT → J1001 North a1/a3',
      '10:27 J1001 North → PLANT a1/a3',
      '10:41 PLANT → J1001 North a1/a3',
      '11:14 J1001 North → PLANT a1/a3',
    ]);
    expect(d.whichAssignment[0].id).toBe(d.whichAssignment[0].trip.leftAt);
  });

  it('never takes a tie as Unplanned work: on two the same, only the South stop is', () => {
    const d = day('ambiguous');
    expect(d.unplanned.map((w) => w.trips.map((t) => easternTime(t.leftAt)))).toEqual([['14:15', '14:33']]);
  });

  it('makes a run of three Trips nothing fits one piece: A1 cancelled at 10:10, its last three Trips to and from the Plant', () => {
    const [a1, a2] = scenario('two');
    const d = buildTripDay({
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

describe('Make an Assignment: an answer to Unplanned work', () => {
  const [a1, a2] = scenario('two');
  const cancelled = [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2];
  const plantRun = '2026-11-16T15:27:50Z';

  it('claims only the Trips of the Unplanned work it answers, never earlier ones on the same route', () => {
    // A1 cancelled at 10:10: 10:27–11:25 to and from the Plant is Unplanned work. Dave says it loaded at the Plant.
    // Plant → North is the route of A1's ways back at 08:43 and 09:50; they stay A1's.
    expect(day('two').unplanned.map((w) => w.id)).not.toContain(plantRun);
    const before = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY });
    expect(before.unplanned[0].id).toBe(plantRun);
    const d = buildTripDay({
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments: cancelled,
      now: END_OF_DAY,
      answers: {
        madeAssignments: [{ id: 'a3', label: 'A3', fromPlaceId: 'plc-plant', toPlaceId: 'plc-north', cancelledAt: null, changes: [], unplannedId: plantRun }],
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
      places: FIXTURE_PLACES,
      visits: FIXTURE_VISITS,
      assignments: scenario('two'),
      now: END_OF_DAY,
      answers: { madeAssignments: [{ id: 'a3', label: 'A3', fromPlaceId: 'plc-south', toPlaceId: 'plc-north', cancelledAt: null, changes: [], unplannedId: plantRun }] },
    });
    expect(d.unplanned).toHaveLength(1);
    expect(d.assignments[2]).toMatchObject({ assignmentId: 'a3', loads: 0, status: 'none' });
  });
});

describe('Split: one run that held two hauls', () => {
  const [a1, a2] = scenario('two');
  const cancelled = [{ ...a1, cancelledAt: '2026-11-16T15:10:00Z' }, a2];
  const at = (splits: string[], madeAssignments: MadeAssignment[] = []) =>
    buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY, answers: { splits, madeAssignments } });
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
    const made = (id: string, from: string, to: string, unplannedId: string): MadeAssignment => ({ id, label: id.toUpperCase(), fromPlaceId: from, toPlaceId: to, cancelledAt: null, changes: [], unplannedId });
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
    buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: cancelled, now: END_OF_DAY, answers });

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
    const d = answered({ notHauls: [{ unplannedId: plantRun, note: null }] });
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

describe('The Truck’s end time when it stops away from the shop', () => {
  const parked = (dayOver: boolean, ignition = FIXTURE_PARKED_AT_JOB.ignition) => {
    const d = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_PARKED_AT_JOB.visits, assignments: [], now: END_OF_DAY, ignition, dayOver }).truckDay;
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
