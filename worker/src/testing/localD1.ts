import { readFileSync } from 'node:fs';
import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Env } from '../app';

/**
 * A real local D1 for the tests, migrated from migrations/ like the deployed
 * ones and reseeded from seed/ (the checklist, then the fixture) before each test. Wrangler's test
 * harness runs a tiny Worker (d1-only.ts) only to own the database; the tests
 * call handle() in Node with that database in its environment.
 */
export function localD1() {
  const harness = createTestHarness({
    workers: [
      {
        config: {
          name: 'd1-only',
          main: './worker/src/testing/d1-only.ts',
          compatibility_date: '2026-11-10',
          d1_databases: [
            { binding: 'DB', database_name: 'truck-dispatch', database_id: 'test', migrations_dir: './migrations' },
          ],
        },
      },
    ],
  });
  // The reference data every environment loads, then the synthetic test data.
  const seeds = ['seed/inspection-items.sql', 'seed/fixture.sql'].map((file) => readFileSync(file, 'utf8'));
  let db: D1Database | undefined;

  beforeAll(async () => {
    await harness.listen();
    await harness.getWorker().applyD1Migrations('DB');
    db = (await harness.getWorker<{ DB: D1Database }>().getEnv()).DB;
  }, 60_000);
  afterAll(() => harness.close());
  beforeEach(async () => {
    const DB = database();
    // Rows that point at others go first: Fleet visits and Import days at Imports, and Imports at Trucks; Truck problems at Inspections, Drivers and Trucks, an Inspection's answers at it and Inspections at Drivers, Trucks and items, an Assignment's earlier fields at it, Assignments and orders at the lists, Drivers at Trucks, Places at Jobs.
    await DB.batch(['fleet_visits', 'fleet_import_days', 'fleet_imports', 'truck_problems', 'inspection_answers', 'inspections', 'assignment_changes', 'day_sends', 'assignments', 'orders', 'drivers', 'trucks', 'places', 'jobs', 'materials', 'foremen', 'inspection_items', 'not_considered'].map((table) => DB.prepare(`DELETE FROM ${table}`)));
    await reseed();
  });

  /** Runs seed/inspection-items.sql and seed/fixture.sql on the database as it is, as every deploy does. */
  const reseed = async () => {
    for (const seed of seeds) await database().exec(seed.replace(/--.*$/gm, '').replace(/\s*\n\s*/g, ' '));
  };

  const database = (): D1Database => {
    if (!db) throw new Error('The local D1 is not started yet (use it inside a test).');
    return db;
  };

  /** An environment for handle(), with the local D1 and a stand-in for the page files. */
  const env = (vars: Partial<Env> = {}): Env => ({
    ASSETS: { fetch: async (input: Request | string) => {
      const { pathname, search } = new URL(input instanceof Request ? input.url : input);
      return new Response(`asset ${pathname}${search}`);
    } } as unknown as Fetcher,
    DB: database(),
    ENVIRONMENT: 'test',
    ...vars,
  });

  return { env, database, reseed };
}
