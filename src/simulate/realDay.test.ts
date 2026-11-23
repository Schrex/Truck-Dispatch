import { describe, expect, it } from 'vitest';
import { buildTripDay, easternTime } from '../../shared/trips';
import { REAL_DAY, easternIso } from './realDay';

const scenario = (id: string) => REAL_DAY.scenarios.find((s) => s.id === id)!;
const at = (id: string, time = '23:59:59') =>
  buildTripDay({ places: REAL_DAY.places, visits: REAL_DAY.visits, assignments: scenario(id).assignments, now: easternIso(REAL_DAY.date, time) });
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
});
