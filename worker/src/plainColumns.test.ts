import { describe, expect, it } from 'vitest';
import { localD1 } from './testing/localD1';
import { copiedPlain, plainBefore, plainWas, type PlainColumn } from './plainColumns';

const d1 = localD1();

/**
 * Plain columns as a later ticket declares them, on columns the table has
 * today: the note copied only on an Assignment with a Driver, and a "work"
 * column (the note again, under another key) always copied, read as "haul"
 * when an older saved copy does not have it.
 */
const NOTE_WHEN_DRIVEN: PlainColumn = { key: 'note', column: 'note', copy: { when: 'a.driver_id IS NOT NULL' }, missing: null };
const WORK: PlainColumn = { key: 'work', column: 'note', copy: 'always', missing: 'haul' };
const NOT_COPIED: PlainColumn = { key: 'note', column: 'note', missing: null };

async function addRow(id: string, driverId: string | null, note: string) {
  await d1.database()
    .prepare("INSERT INTO assignments (id, date, driver_id, note, position, created_at, updated_at) VALUES (?, '2026-11-20', ?, ?, 0, 'x', 'x')")
    .bind(id, driverId, note)
    .run();
}

async function copiedFrom(id: string, columns: PlainColumn[]) {
  return d1.database().prepare(`SELECT ${copiedPlain(columns).join(', ')} FROM assignments a WHERE a.id = ?`).bind(id).first<Record<string, unknown>>();
}

describe('plain columns', () => {
  it('copies a plain column as is, always or only while its condition holds, and leaves out one not copied', async () => {
    await addRow('with-driver', 'drv-a', 'Gate code 41');
    await addRow('no-driver', null, 'Gate code 41');

    expect(await copiedFrom('with-driver', [NOTE_WHEN_DRIVEN])).toEqual({ note: 'Gate code 41' });
    expect(await copiedFrom('no-driver', [NOTE_WHEN_DRIVEN])).toEqual({ note: null });
    expect(await copiedFrom('no-driver', [WORK])).toEqual({ note: 'Gate code 41' });
    expect(copiedPlain([NOT_COPIED])).toEqual([]);
  });

  it('keeps a plain column with the values saved before a change, and shows it as "was" only when it changed', async () => {
    await addRow('kept', 'drv-a', 'haul');
    const row = await d1.database().prepare(`SELECT json_object(${plainBefore([WORK])}) AS before FROM assignments b WHERE b.id = 'kept'`).first<{ before: string }>();
    const before = JSON.parse(row!.before) as Record<string, unknown>;
    expect(before).toEqual({ work: 'haul' });

    expect(plainWas({ work: 'haul' }, before, [WORK])).toEqual({});
    expect(plainWas({ work: 'move' }, before, [WORK])).toEqual({ work: 'haul' });
  });

  it('reads a plain column missing from an older saved copy as its default, so it shows no false "was"', () => {
    expect(plainWas({ work: 'haul' }, {}, [WORK])).toEqual({});
    expect(plainWas({ work: 'other' }, {}, [WORK])).toEqual({ work: 'haul' });
    expect(plainWas({ note: null }, {}, [NOT_COPIED])).toEqual({});
  });
});
