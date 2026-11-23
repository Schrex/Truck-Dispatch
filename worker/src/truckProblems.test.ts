import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { Inspection, NewInspection, TruckProblem } from '../../shared/types';

const d1 = localD1();
/** The tests' clock: Thursday 2026-11-19, 6:42 AM US Eastern, unless a test sets its own. */
const MORNING = '2026-11-19T11:42:00.000Z';
const send = (method: string, path: string, body?: unknown, vars: Parameters<typeof d1.env>[0] = {}) =>
  handle(
    new Request(`https://td.example${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    d1.env({ NOW: MORNING, ...vars }),
  );

/** The seeded checklist's ids, insp-01 (Dump box clean) to insp-12 (Suspension). */
const ITEMS = Array.from({ length: 12 }, (_, i) => `insp-${String(i + 1).padStart(2, '0')}`);

/** A whole Inspection by Sample Driver A on Truck 21: every item OK but those given as Needs repair, each with its note. */
function inspection(repairs: Record<string, string> = {}, fields: Partial<NewInspection> = {}): NewInspection {
  return {
    id: crypto.randomUUID(),
    driverId: 'drv-a',
    truckId: 'trk-21',
    answers: ITEMS.map((itemId) => (itemId in repairs ? { itemId, answer: 'repair' as const, repairNote: repairs[itemId] } : { itemId, answer: 'ok' as const })),
    ...fields,
  };
}

const add = (body: unknown, vars = {}) => send('POST', '/api/inspections', body, vars);
const saved = async (response: Response) => ((await response.json()) as { inspection: Inspection & { problems: TruckProblem[] } }).inspection;
const problems = async (query = '') => {
  const response = await send('GET', `/api/truck-problems${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { problems: TruckProblem[] }).problems;
};
const fix = (id: string, body: unknown = {}, vars = {}) => send('POST', `/api/truck-problems/${id}/fix`, body, vars);
const fixed = async (response: Response) => ((await response.json()) as { problem: TruckProblem }).problem;

describe('Truck problems from an Inspection', () => {
  it('opens one per Needs repair item, with its note, its Driver, the time and the Inspection, in the Inspection\'s answer', async () => {
    const body = inspection({ 'insp-07': 'Left marker out', 'insp-04': 'Left rear flap torn' });
    const response = await add(body);
    expect(response.status).toBe(201);
    const answer = await saved(response);
    const opened = (text: string) => ({
      id: expect.any(String), truckId: 'trk-21', truckNumber: '21', reportedByDriverId: 'drv-a', reportedByName: 'Sample Driver A',
      reportedAt: MORNING, text, inspectionId: body.id, fixedAt: null, fixedNote: null,
    });
    // In the checklist's order: Mud flaps (insp-04) comes before Lights (insp-07).
    expect(answer.problems).toEqual([opened('Left rear flap torn'), opened('Left marker out')]);
    expect(await problems()).toEqual(expect.arrayContaining(answer.problems));
    expect(await problems()).toHaveLength(2);
  });

  it('opens none for an Inspection with nothing to repair', async () => {
    expect((await saved(await add(inspection()))).problems).toEqual([]);
    expect(await problems()).toEqual([]);
  });

  it('opens none for a refused Inspection', async () => {
    const response = await add(inspection({ 'insp-07': 'Left marker out' }, { truckId: 'trk-99' }));
    expect(response.status).toBe(400);
    expect(await problems()).toEqual([]);
  });

  it('opens no second set for a retried Finish with the same id, and answers the first set', async () => {
    const body = inspection({ 'insp-07': 'Left marker out' });
    const first = await saved(await add(body));
    const again = await add({ ...body, answers: inspection({ 'insp-01': 'Mud everywhere', 'insp-07': 'Left marker out' }).answers }, { NOW: '2026-11-19T11:43:00.000Z' });
    expect(again.status).toBe(200);
    expect((await saved(again)).problems).toEqual(first.problems);
    expect(await problems()).toHaveLength(1);
  });

  it('does not stop a Truck with an open problem being checked in to again', async () => {
    await add(inspection({ 'insp-07': 'Left marker out' }));
    const later = await add(inspection({}, { driverId: 'drv-b' }), { NOW: '2026-11-19T12:10:00.000Z' });
    expect(later.status).toBe(201);
    expect((await problems('?open=1')).map((p) => p.text)).toEqual(['Left marker out']);
  });
});

describe('the Truck problems list', () => {
  /** Three problems: Truck 21's at 6:42 and 7:10, Truck 24's at 7:30. */
  const three = async () => {
    const [early] = (await saved(await add(inspection({ 'insp-07': 'Left marker out' })))).problems;
    const [middle] = (await saved(await add(inspection({ 'insp-04': 'Flap torn' }), { NOW: '2026-11-19T12:10:00.000Z' }))).problems;
    const [late] = (await saved(await add(inspection({ 'insp-02': 'Tarp ripped' }, { driverId: 'drv-b', truckId: 'trk-24' }), { NOW: '2026-11-19T12:30:00.000Z' }))).problems;
    return { early, middle, late };
  };

  it('lists open ones first, then fixed ones, each newest first', async () => {
    const { early, middle, late } = await three();
    await fix(middle.id, {}, { NOW: '2026-11-19T15:00:00.000Z' });
    expect((await problems()).map((p) => p.text)).toEqual(['Tarp ripped', 'Left marker out', 'Flap torn']);
    expect((await problems()).map((p) => p.id)).toEqual([late.id, early.id, middle.id]);
  });

  it('gives open ones only with ?open=1, and one Truck\'s with truckId', async () => {
    const { middle } = await three();
    await fix(middle.id);
    expect((await problems('?open=1')).map((p) => p.text)).toEqual(['Tarp ripped', 'Left marker out']);
    expect((await problems('?truckId=trk-21')).map((p) => p.text)).toEqual(['Left marker out', 'Flap torn']);
    expect((await problems('?open=1&truckId=trk-21')).map((p) => p.text)).toEqual(['Left marker out']);
    expect(await problems('?truckId=trk-27')).toEqual([]);
  });

  it('has no change or delete', async () => {
    expect((await send('DELETE', '/api/truck-problems')).status).toBe(405);
    expect((await send('PATCH', '/api/truck-problems', {})).status).toBe(405);
    const { early } = await three();
    for (const method of ['GET', 'PATCH', 'DELETE']) expect((await send(method, `/api/truck-problems/${early.id}/fix`, method === 'GET' || method === 'DELETE' ? undefined : {})).status).toBe(405);
  });
});

describe('reporting a problem during the day', () => {
  const report = (body: unknown, vars = {}) => send('POST', '/api/truck-problems', body, vars);
  const reported = async (response: Response) => ((await response.json()) as { problem: TruckProblem }).problem;
  const refused = async (response: Response) => {
    expect(response.status).toBe(400);
    return Object.keys(((await response.json()) as { fields: object }).fields);
  };
  /** 11:05 AM US Eastern, the same Thursday. */
  const LATE_MORNING = '2026-11-19T16:05:00.000Z';

  it('opens one on the Truck of his check-in today, with his note, the time and no Inspection', async () => {
    await add(inspection());
    const response = await report({ driverId: 'drv-a', truckId: 'trk-21', text: '  Hydraulics leaking  ' }, { NOW: LATE_MORNING });
    expect(response.status).toBe(201);
    const problem = await reported(response);
    expect(problem).toEqual({
      id: expect.any(String), truckId: 'trk-21', truckNumber: '21', reportedByDriverId: 'drv-a', reportedByName: 'Sample Driver A',
      reportedAt: LATE_MORNING, text: 'Hydraulics leaking', inspectionId: null, fixedAt: null, fixedNote: null,
    });
    expect(await problems('?open=1')).toEqual([problem]);
  });

  it('refuses a Truck that is not his latest check-in today, even one he checked in to earlier before switching', async () => {
    await add(inspection());
    await add(inspection({}, { truckId: 'trk-24' }), { NOW: '2026-11-19T12:10:00.000Z' });
    expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-21', text: 'Flat tire' }, { NOW: LATE_MORNING }))).toEqual(['truckId']);
    expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-27', text: 'Flat tire' }, { NOW: LATE_MORNING }))).toEqual(['truckId']);
    expect((await report({ driverId: 'drv-a', truckId: 'trk-24', text: 'Flat tire' }, { NOW: LATE_MORNING })).status).toBe(201);
    expect((await problems()).map((p) => p.truckId)).toEqual(['trk-24']);
  });

  it('refuses one before he has checked in today, and one on another day\'s check-in', async () => {
    expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-21', text: 'Flat tire' }))).toEqual(['truckId']);
    await add(inspection());
    // The next morning, before checking in again.
    expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-21', text: 'Flat tire' }, { NOW: '2026-11-20T12:00:00.000Z' }))).toEqual(['truckId']);
    // Another Driver's check-in to that Truck does not count for him.
    expect(await refused(await report({ driverId: 'drv-b', truckId: 'trk-21', text: 'Flat tire' }))).toEqual(['truckId']);
    expect(await problems()).toEqual([]);
  });

  it('refuses a blank or overlong note, and an unknown Driver or Truck', async () => {
    await add(inspection());
    for (const text of [undefined, '   ', 5, 'x'.repeat(1001)]) {
      expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-21', text }))).toEqual(['text']);
    }
    expect(await refused(await report({ driverId: 'drv-nobody', truckId: 'trk-21', text: 'Flat tire' }))).toEqual(['driverId']);
    expect(await refused(await report({ driverId: 'drv-a', truckId: 'trk-99', text: 'Flat tire' }))).toEqual(['truckId']);
    expect(await refused(await report({ truckId: 'trk-21', text: 'Flat tire' }))).toEqual(['driverId']);
    expect(await problems()).toEqual([]);
  });
});

describe('Mark fixed', () => {
  it('closes a problem with the time and an optional note, and it stays listed', async () => {
    const [problem] = (await saved(await add(inspection({ 'insp-07': 'Left marker out' })))).problems;
    const response = await fix(problem.id, { note: '  New bulb  ' }, { NOW: '2026-11-19T15:00:00.000Z' });
    expect(response.status).toBe(200);
    const closed = await fixed(response);
    expect(closed).toEqual({ ...problem, fixedAt: '2026-11-19T15:00:00.000Z', fixedNote: 'New bulb' });
    expect(await problems()).toEqual([closed]);
    expect(await problems('?open=1')).toEqual([]);
  });

  it('takes no note, or a blank one, as none', async () => {
    const body = inspection({ 'insp-07': 'Left marker out', 'insp-04': 'Flap torn' });
    const [one, other] = (await saved(await add(body))).problems;
    expect((await fixed(await fix(one.id))).fixedNote).toBeNull();
    expect((await fixed(await fix(other.id, { note: '   ' }))).fixedNote).toBeNull();
  });

  it('answers one already fixed as it is, changing nothing', async () => {
    const [problem] = (await saved(await add(inspection({ 'insp-07': 'Left marker out' })))).problems;
    const first = await fixed(await fix(problem.id, { note: 'New bulb' }, { NOW: '2026-11-19T15:00:00.000Z' }));
    const again = await fix(problem.id, { note: 'Other' }, { NOW: '2026-11-19T16:00:00.000Z' });
    expect(again.status).toBe(200);
    expect(await fixed(again)).toEqual(first);
  });

  it('is 404 for an unknown problem, and refuses a note that is not text or too long', async () => {
    expect((await fix('tp-nobody')).status).toBe(404);
    const [problem] = (await saved(await add(inspection({ 'insp-07': 'Left marker out' })))).problems;
    for (const note of [5, 'x'.repeat(1001)]) {
      const response = await fix(problem.id, { note });
      expect(response.status).toBe(400);
      expect(Object.keys(((await response.json()) as { fields: object }).fields)).toEqual(['note']);
    }
    expect((await problems('?open=1')).map((p) => p.id)).toEqual([problem.id]);
  });
});

describe('the truck_problems table', () => {
  it('lets the reporting Driver be empty, for problems Dave adds later', async () => {
    const { results } = await d1.database().prepare("SELECT name, \"notnull\" AS required FROM pragma_table_info('truck_problems')").all<{ name: string; required: number }>();
    expect(Object.fromEntries(results.map((c) => [c.name, c.required]))).toMatchObject({
      truck_id: 1, reported_by_driver_id: 0, reported_at: 1, text: 1, inspection_id: 0, fixed_at: 0, fixed_note: 0,
    });
  });
});
