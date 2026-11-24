import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import { checkTyped, saveLinked, typedIn, type TypedField } from './typedNames';
import type { Assignment } from '../../shared/types';

const d1 = localD1();
const env = () => d1.env({ NOW: '2026-11-19T20:00:00.000Z' });
const send = async (method: string, path: string, body?: unknown) =>
  handle(
    new Request(`https://td.example${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    env(),
  );
const list = async (path: string) => Object.values((await (await send('GET', path)).json()) as Record<string, { id: string; active: boolean } & Record<string, unknown>[]>)[0];

/**
 * A test-only field naming two lists, the way For will (Foremen, then
 * Customers): found among Foremen, then Drivers, and added to Drivers.
 */
const FOR = {
  key: 'forName',
  noun: 'Foreman or Driver',
  lists: [
    { list: 'foremen', idKey: 'foremanId' },
    { list: 'drivers', idKey: 'driverId' },
  ],
  addTo: 'drivers',
} as const satisfies TypedField;

/** Saves what an Assignment typed in For, as the Worker saves a typed name, and reads it back. */
async function typeFor(assignment: Assignment, forName: string): Promise<Assignment> {
  const body = { forName };
  expect(checkTyped(body, [FOR])).toEqual({});
  await saveLinked(env(), typedIn(body, [FOR]), (ids) => {
    expect(Object.keys(ids).sort()).toEqual(['driverId', 'foremanId']);
    return env().DB.prepare('UPDATE assignments SET foreman_id = ?, driver_id = ? WHERE id = ?').bind(ids.foremanId, ids.driverId, assignment.id);
  });
  const { assignments } = (await (await send('GET', `/api/assignments?date=${assignment.date}`)).json()) as { assignments: Assignment[] };
  return assignments.find((a) => a.id === assignment.id)!;
}

async function addAssignment(fields: Partial<Assignment> = {}): Promise<Assignment> {
  const response = await send('POST', '/api/assignments', { date: '2026-11-20', ...fields });
  return ((await response.json()) as { assignment: Assignment }).assignment;
}

describe('a typed name that may be in one of two lists', () => {
  it('links to an active entry of the first list, ignoring case, and clears the other id', async () => {
    const assignment = await addAssignment({ driverId: 'drv-a' });
    const saved = await typeFor(assignment, 'sample foreman b');
    expect(saved).toMatchObject({ foremanId: 'frm-b', driverId: null });
  });

  it('links to an active entry of the second list when the first has none, and clears the first id', async () => {
    const assignment = await addAssignment({ foremanId: 'frm-a' });
    const saved = await typeFor(assignment, 'SAMPLE DRIVER C');
    expect(saved).toMatchObject({ foremanId: null, driverId: 'drv-c' });
  });

  it('prefers an active entry of a later list to a removed one of an earlier list', async () => {
    await send('POST', '/api/foremen', { name: 'Sample Both' });
    const [foreman] = (await list('/api/foremen')).filter((f) => f.name === 'Sample Both');
    await send('PATCH', `/api/foremen/${foreman.id}`, { active: false });
    await send('POST', '/api/drivers', { name: 'Sample Both' });
    const [driver] = (await list('/api/drivers')).filter((d) => d.name === 'Sample Both');

    const saved = await typeFor(await addAssignment(), 'sample both');
    expect(saved).toMatchObject({ foremanId: null, driverId: driver.id });
    expect(await list('/api/foremen?include=inactive')).toContainEqual(expect.objectContaining({ id: foreman.id, active: false }));
  });

  it('brings back a removed entry, from the first list it is in, and links to it', async () => {
    await send('PATCH', '/api/drivers/drv-b', { active: false });
    const saved = await typeFor(await addAssignment({ foremanId: 'frm-a' }), 'sample driver b');
    expect(saved).toMatchObject({ foremanId: null, driverId: 'drv-b' });
    expect(await list('/api/drivers')).toContainEqual(expect.objectContaining({ id: 'drv-b', active: true }));
  });

  it('adds a name in neither list to the field\'s own list, not the first one', async () => {
    const foremen = await list('/api/foremen?include=inactive');
    const saved = await typeFor(await addAssignment({ foremanId: 'frm-a' }), ' Sample Newcomer ');
    expect(saved).toMatchObject({ foremanId: null, driverName: 'Sample Newcomer' });
    expect(await list('/api/drivers')).toContainEqual(expect.objectContaining({ id: saved.driverId, name: 'Sample Newcomer', active: true }));
    expect(await list('/api/foremen?include=inactive')).toEqual(foremen);
  });

  it('refuses a name typed alongside an id for any of its lists', async () => {
    const message = { forName: 'Pick a Foreman or Driver from the list or write its name, not both.' };
    expect(checkTyped({ forName: 'Sample Foreman A', foremanId: 'frm-a' }, [FOR])).toEqual(message);
    expect(checkTyped({ forName: 'Sample Foreman A', driverId: 'drv-a' }, [FOR])).toEqual(message);
  });
});
