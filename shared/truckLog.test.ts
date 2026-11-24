import { describe, expect, it } from 'vitest';
import { easternTime } from './days';
import { buildTripDay } from './trips';
import { FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from './trips.fixture';
import { truckLog, type TruckLogAssignment } from './truckLog';

const END_OF_DAY = '2026-11-16T23:59:59-05:00';
const placeName = (id: string | null) => FIXTURE_PLACES.find((p) => p.id === id)?.name ?? null;
const scenario = (id: string) => FIXTURE_SCENARIOS.find((s) => s.id === id)!.assignments;

/** The real 16 Nov day under a scenario, as the Truck log shows it at `now`. */
const logOf = (id: string, now = END_OF_DAY) => {
  const planned = scenario(id);
  const tripDay = buildTripDay({ places: FIXTURE_PLACES, visits: FIXTURE_VISITS, assignments: planned, now });
  const assignments: TruckLogAssignment[] = planned.map((a) => ({
    id: a.id,
    fromPlaceName: placeName(a.fromPlaceId),
    toPlaceName: placeName(a.toPlaceId),
    materialName: 'Stone',
  }));
  const labels = Object.fromEntries(planned.map((a) => [a.id, a.label]));
  return truckLog({ tripDay, places: FIXTURE_PLACES, assignments, labels });
};

describe('The Truck log on the real day (Mon 16 Nov 2026)', () => {
  it('writes one column per Assignment: A1 4 Loads, 3.02 h; A2 2 Loads', () => {
    const [a1, a2] = logOf('two').columns;
    expect(a1).toEqual({ id: 'a1', job: null, pickUp: 'Sample Site North', dropOff: 'Sample Plant', material: 'Stone', loads: 4, tons: null, truckingHours: 3.02 });
    expect(a2).toMatchObject({ id: 'a2', pickUp: 'Sample Quarry', dropOff: 'Sample Site North', loads: 2 });
  });

  it('lists the two drives to and from the shop by Place name', () => {
    expect(logOf('two').shopTrips.map((t) => `${easternTime(t.leftAt)}–${easternTime(t.arrivedAt)} ${t.from} → ${t.to} ${t.miles}`)).toEqual([
      '06:24–07:02 Sample Shop → Sample Site North 20.59',
      '15:41–16:03 Sample Site North → Sample Shop 18.39',
    ]);
  });

  it('gives each Assignment its Trip part, as the board block shows it', () => {
    const [a1, a2] = logOf('two').assignments;
    expect(a1.trips).toMatchObject({ loads: 4, status: 'done', truckingHours: 3.02 });
    expect(easternTime(a1.trips!.since!)).toBe('08:24');
    expect(a2.trips).toMatchObject({ loads: 2, status: 'done' });
  });

  it('lists the Unplanned work by Place name: the South stop fits neither Assignment', () => {
    const { unplanned } = logOf('two');
    expect(unplanned.map((w) => w.places)).toEqual([['Sample Site North', 'Sample Site South']]);
  });

  it('asks "Which Assignment?" by label when two Assignments fit a Trip', () => {
    const asked = logOf('ambiguous').whichAssignment;
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]).toMatchObject({ from: 'Sample Site North', to: 'Sample Plant', candidates: ['A1', 'A3'] });
  });

  it('before the Truck leaves the shop: no Loads, no Trip parts yet', () => {
    const log = logOf('two', '2026-11-16T06:00:59-05:00');
    expect(log.columns.map((c) => [c.loads, c.truckingHours])).toEqual([[0, null], [0, null]]);
    expect(log.shopTrips).toEqual([]);
  });
});
