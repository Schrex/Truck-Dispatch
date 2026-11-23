import { describe, expect, it } from 'vitest';
import { handle } from './app';
import { localD1 } from './testing/localD1';
import type { CheckIns, Inspection, NewInspection } from '../../shared/types';

const d1 = localD1();
/** The tests' clock: Thursday 2026-11-19, 6:42 AM US Eastern, unless a test sets its own. */
const MORNING = '2026-11-19T11:42:00.000Z';
const env = (vars: Parameters<typeof d1.env>[0] = {}) => d1.env({ NOW: MORNING, ...vars });
const send = (method: string, path: string, body?: unknown, vars: Parameters<typeof d1.env>[0] = {}) =>
  handle(
    new Request(`https://td.example${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    env(vars),
  );

/** The seeded checklist's ids, insp-01 (Dump box clean) to insp-12 (Suspension). */
const ITEMS = Array.from({ length: 12 }, (_, i) => `insp-${String(i + 1).padStart(2, '0')}`);

/** A whole Inspection: every item OK unless the test says, by Sample Driver A on Truck 21. */
function inspection(fields: Partial<NewInspection> = {}): NewInspection {
  return {
    id: crypto.randomUUID(),
    driverId: 'drv-a',
    truckId: 'trk-21',
    answers: ITEMS.map((itemId) => ({ itemId, answer: 'ok' as const })),
    ...fields,
  };
}

/** The answers with one item's answer replaced. */
const answering = (itemId: string, answer: NewInspection['answers'][number]) =>
  ITEMS.map((id) => (id === itemId ? answer : { itemId: id, answer: 'ok' as const }));

const add = (body: unknown, vars = {}) => send('POST', '/api/inspections', body, vars);
const saved = async (response: Response) => ((await response.json()) as { inspection: Inspection }).inspection;
const checkIns = async (date: string) => {
  const response = await send('GET', `/api/check-ins?date=${date}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as CheckIns).checkIns;
};
const refusal = async (response: Response) => {
  expect(response.status).toBe(400);
  return ((await response.json()) as { fields: Record<string, string> }).fields;
};

describe('adding an Inspection (checking in)', () => {
  it('saves it for today, timed by the Worker\'s clock, and the Driver is checked in to its Truck', async () => {
    const body = inspection({ answers: answering('insp-07', { itemId: 'insp-07', answer: 'repair', repairNote: 'Left marker out' }), otherNotes: 'Radio crackles' });
    const response = await add(body);
    expect(response.status).toBe(201);
    const answer = await saved(response);
    expect(answer).toMatchObject({
      id: body.id, date: '2026-11-19', driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-21', truckNumber: '21',
      doneAt: MORNING, otherNotes: 'Radio crackles', needsRepair: true,
    });
    expect(answer.answers).toHaveLength(12);
    expect(answer.answers[6]).toEqual({ position: 6, itemId: 'insp-07', label: 'Lights', answer: 'repair', repairNote: 'Left marker out' });
    expect(answer.answers[0]).toEqual({ position: 0, itemId: 'insp-01', label: 'Dump box clean', answer: 'ok', repairNote: null });

    expect(await checkIns('2026-11-19')).toEqual([
      { driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-21', truckNumber: '21', inspectionId: body.id, doneAt: MORNING, needsRepair: true },
    ]);
  });
});

describe('what an Inspection needs', () => {
  const nothingSaved = async () => {
    const { n } = (await d1.database().prepare('SELECT COUNT(*) AS n FROM inspections').first<{ n: number }>())!;
    expect(n).toBe(0);
  };

  it('refuses one that leaves out an item that is not optional, naming the item', async () => {
    const fields = await refusal(await add(inspection({ answers: answering('insp-03', { itemId: 'insp-03', answer: 'ok' }).filter((a) => a.itemId !== 'insp-03') })));
    expect(fields).toEqual({ 'answers.insp-03': 'Answer Truck paperwork.' });
    await nothingSaved();
  });

  it('lets an optional item be left out, and saves only the items answered', async () => {
    await send('PATCH', '/api/inspection-items/insp-12', { optional: true });
    const response = await add(inspection({ answers: ITEMS.slice(0, 11).map((itemId) => ({ itemId, answer: 'na' as const })) }));
    expect(response.status).toBe(201);
    const { answers, needsRepair } = await saved(response);
    expect(answers.map((a) => a.itemId)).toEqual(ITEMS.slice(0, 11));
    expect(needsRepair).toBe(false);
  });

  it.each([
    ['no note', { itemId: 'insp-06', answer: 'repair' as const }],
    ['a blank note', { itemId: 'insp-06', answer: 'repair' as const, repairNote: '   ' }],
  ])('refuses a Needs repair with %s', async (_case, answer) => {
    expect(await refusal(await add(inspection({ answers: answering('insp-06', answer) })))).toEqual({ 'answers.insp-06': 'Say what needs repair.' });
    await nothingSaved();
  });

  it('keeps a repair note only on a Needs repair', async () => {
    const { answers } = await saved(await add(inspection({ answers: answering('insp-06', { itemId: 'insp-06', answer: 'ok', repairNote: 'Stray' }) })));
    expect(answers[5]).toMatchObject({ answer: 'ok', repairNote: null });
  });

  it('refuses an answer that is not OK, Needs repair or N/A', async () => {
    const answers = answering('insp-02', { itemId: 'insp-02', answer: 'fine' as never });
    expect(await refusal(await add(inspection({ answers })))).toEqual({ 'answers.insp-02': 'Answer OK, Needs repair or N/A.' });
  });

  it('refuses an item that is not on the checklist, or was removed from it', async () => {
    await send('PATCH', '/api/inspection-items/insp-12', { active: false });
    const answers = [...ITEMS.map((itemId) => ({ itemId, answer: 'ok' as const })), { itemId: 'insp-99', answer: 'ok' as const }];
    expect(await refusal(await add(inspection({ answers })))).toEqual({
      'answers.insp-12': 'This item is no longer on the checklist.',
      'answers.insp-99': 'This item is no longer on the checklist.',
    });
    await nothingSaved();
  });

  it('refuses an item answered twice, or answers that are not a list', async () => {
    const twice = [...ITEMS.map((itemId) => ({ itemId, answer: 'ok' as const })), { itemId: 'insp-01', answer: 'na' as const }];
    expect(await refusal(await add(inspection({ answers: twice })))).toEqual({ 'answers.insp-01': 'Answer each item once.' });
    expect(Object.keys(await refusal(await add({ ...inspection(), answers: 'all ok' })))).toEqual(['answers']);
  });

  it.each([
    ['an unknown Driver', { driverId: 'drv-nobody' }, 'driverId'],
    ['no Driver', { driverId: undefined }, 'driverId'],
    ['an unknown Truck', { truckId: 'trk-99' }, 'truckId'],
    ['no Truck', { truckId: undefined }, 'truckId'],
    ['an id that is not a UUID', { id: 'abc' }, 'id'],
    ['other notes that are not text', { otherNotes: 5 as never }, 'otherNotes'],
    ['other notes too long', { otherNotes: 'x'.repeat(1001) }, 'otherNotes'],
  ])('refuses %s', async (_case, fields, key) => {
    expect(Object.keys(await refusal(await add(inspection(fields))))).toEqual([key]);
    await nothingSaved();
  });

  it.each([
    ['Driver', 'drivers/drv-a', { driverId: 'drv-a' }, 'driverId'],
    ['Truck', 'trucks/trk-21', { truckId: 'trk-21' }, 'truckId'],
  ])('refuses a removed %s', async (_what, entry, fields, key) => {
    await send('PATCH', `/api/${entry}`, { active: false });
    expect(Object.keys(await refusal(await add(inspection(fields))))).toEqual([key]);
  });
});

describe('today only', () => {
  it('dates it by the Worker\'s US Eastern today, even late in the evening when UTC is already tomorrow', async () => {
    const late = '2026-11-20T03:30:00.000Z';
    const response = await add(inspection(), { NOW: late });
    expect(await saved(response)).toMatchObject({ date: '2026-11-19', doneAt: late });
  });

  it('accepts a date sent as today, and refuses any other day, so a phone left on yesterday never checks in to it', async () => {
    expect((await add(inspection({ date: '2026-11-19' }))).status).toBe(201);
    for (const date of ['2026-11-18', '2026-11-20', 'Thursday']) {
      expect(await refusal(await add(inspection({ date })))).toEqual({ date: 'Check in only on today.' });
    }
    expect(await checkIns('2026-11-18')).toEqual([]);
    expect(await checkIns('2026-11-20')).toEqual([]);
  });
});

describe('the official record', () => {
  it('is never changed or deleted: 405', async () => {
    const { id } = await saved(await add(inspection()));
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const response = await send(method, `/api/inspections/${id}`, method === 'DELETE' ? undefined : { truckId: 'trk-24' });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD');
    }
    expect((await send('GET', '/api/inspections')).status).toBe(405);
    expect((await send('DELETE', '/api/inspections')).status).toBe(405);
  });

  it('is read back as it was saved, and an unknown one is 404', async () => {
    const added = await saved(await add(inspection()));
    const response = await send('GET', `/api/inspections/${added.id}`);
    expect(response.status).toBe(200);
    expect(await saved(response)).toEqual(added);
    expect((await send('GET', `/api/inspections/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('refuses a change even from inside the database', async () => {
    const { id } = await saved(await add(inspection()));
    await expect(d1.database().prepare('UPDATE inspections SET truck_id = ? WHERE id = ?').bind('trk-24', id).run()).rejects.toThrow(/never changed/);
    await expect(d1.database().prepare('UPDATE inspection_answers SET answer = ? WHERE inspection_id = ?').bind('na', id).run()).rejects.toThrow(/never changed/);
  });

  it('keeps each item\'s wording as it was: renaming an item later does not change it', async () => {
    const { id } = await saved(await add(inspection()));
    await send('PATCH', '/api/inspection-items/insp-07', { label: 'Lights / signals' });
    const later = await saved(await add(inspection()));
    const before = await saved(await send('GET', `/api/inspections/${id}`));
    expect(before.answers[6].label).toBe('Lights');
    expect(later.answers[6].label).toBe('Lights / signals');
  });

  it('keeps done_at as an exact UTC moment, with indexes for check-ins and for phase 3', async () => {
    const { id } = await saved(await add(inspection()));
    const row = await d1.database().prepare('SELECT done_at FROM inspections WHERE id = ?').bind(id).first<{ done_at: string }>();
    expect(row?.done_at).toBe('2026-11-19T11:42:00.000Z');
    const { results } = await d1.database().prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'inspections' AND sql IS NOT NULL").all<{ name: string }>();
    const columns = async (index: string) =>
      (await d1.database().prepare(`SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`).all<{ name: string }>()).results.map((c) => c.name);
    expect(await Promise.all(results.map((r) => columns(r.name)))).toEqual(expect.arrayContaining([['truck_id', 'done_at'], ['driver_id', 'date']]));
  });
});

describe('check-ins', () => {
  it('count each Driver\'s latest Inspection that day, and the earlier ones stay', async () => {
    const first = await saved(await add(inspection({ answers: answering('insp-04', { itemId: 'insp-04', answer: 'repair', repairNote: 'Torn' }) })));
    const second = await saved(await add(inspection({ truckId: 'trk-27' }), { NOW: '2026-11-19T16:05:00.000Z' }));
    expect(await checkIns('2026-11-19')).toEqual([
      { driverId: 'drv-a', driverName: 'Sample Driver A', truckId: 'trk-27', truckNumber: '27', inspectionId: second.id, doneAt: '2026-11-19T16:05:00.000Z', needsRepair: false },
    ]);
    expect((await send('GET', `/api/inspections/${first.id}`)).status).toBe(200);
  });

  it('break a tie on the time by the order they were added', async () => {
    await add(inspection({ truckId: 'trk-24' }));
    const later = await saved(await add(inspection({ truckId: 'trk-27' })));
    expect(await checkIns('2026-11-19')).toEqual([expect.objectContaining({ inspectionId: later.id, truckNumber: '27' })]);
  });

  it('accept two Drivers checked in to one Truck, each in the Drivers\' order', async () => {
    expect((await add(inspection({ driverId: 'drv-b', truckId: 'trk-21' }))).status).toBe(201);
    expect((await add(inspection({ driverId: 'drv-a', truckId: 'trk-21' }))).status).toBe(201);
    expect((await checkIns('2026-11-19')).map((c) => [c.driverName, c.truckNumber])).toEqual([
      ['Sample Driver A', '21'],
      ['Sample Driver B', '21'],
    ]);
  });

  it('can be read for past days, and a day with none has none', async () => {
    const tuesday = await saved(await add(inspection(), { NOW: '2026-11-17T12:00:00.000Z' }));
    expect(await checkIns('2026-11-17')).toEqual([expect.objectContaining({ inspectionId: tuesday.id })]);
    expect(await checkIns('2026-11-19')).toEqual([]);
  });

  it('refuse a date that is not real, and anything but a read', async () => {
    expect(Object.keys(await refusal(await send('GET', '/api/check-ins?date=2026-02-30')))).toEqual(['date']);
    expect(Object.keys(await refusal(await send('GET', '/api/check-ins')))).toEqual(['date']);
    expect((await send('POST', '/api/check-ins?date=2026-11-19', {})).status).toBe(405);
  });
});

describe('a retried Finish', () => {
  it('answers the Inspection already saved with that id, and creates nothing', async () => {
    const body = inspection();
    const first = await saved(await add(body));
    const again = await add({ ...body, truckId: 'trk-24', otherNotes: 'Sent twice' }, { NOW: '2026-11-19T11:43:00.000Z' });
    expect(again.status).toBe(200);
    expect(await saved(again)).toEqual(first);
    const { n } = (await d1.database().prepare('SELECT COUNT(*) AS n FROM inspections').first<{ n: number }>())!;
    expect(n).toBe(1);
    expect(await checkIns('2026-11-19')).toEqual([expect.objectContaining({ inspectionId: body.id, truckNumber: '21' })]);
  });
});
