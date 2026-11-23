import { handle, type Env } from '../app';
import type { localD1 } from './localD1';
import type { NewInspection } from '../../../shared/types';

/** The tests' clock: Thursday 2026-11-19, 6:42 AM US Eastern, unless a test sets its own. */
export const MORNING = '2026-11-19T11:42:00.000Z';

/** The seeded checklist's ids, insp-01 (Dump box clean) to insp-12 (Suspension). */
export const ITEMS = Array.from({ length: 12 }, (_, i) => `insp-${String(i + 1).padStart(2, '0')}`);

/**
 * Calls the Worker's API as a request, against the local D1, at MORNING unless
 * `vars` sets its own NOW.
 */
export function apiOn(d1: ReturnType<typeof localD1>) {
  return (method: string, path: string, body?: unknown, vars: Partial<Env> = {}) =>
    handle(
      new Request(`https://td.example${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      }),
      d1.env({ NOW: MORNING, ...vars }),
    );
}

/**
 * A whole Inspection by Sample Driver A on Truck 21: every item OK but those
 * in `repairs`, each Needs repair with its note. Other fields replace these.
 */
export function inspection({ repairs = {}, ...fields }: Partial<NewInspection> & { repairs?: Record<string, string> } = {}): NewInspection {
  return {
    id: crypto.randomUUID(),
    driverId: 'drv-a',
    truckId: 'trk-21',
    answers: ITEMS.map((itemId) => (itemId in repairs ? { itemId, answer: 'repair' as const, repairNote: repairs[itemId] } : { itemId, answer: 'ok' as const })),
    ...fields,
  };
}
