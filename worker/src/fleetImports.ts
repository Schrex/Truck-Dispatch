import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { businessDateOf } from '../../shared/days';
import { EXPORT_ADVICE, isMoment, type FleetExportRow } from '../../shared/fleetExport';
import { codeKey } from '../../shared/trips';
import type { CodeWithNoPlace, FleetExportFormat, FleetImport, FleetImportDay, ImportCounts } from '../../shared/types';

/**
 * Fleet imports: Dave drops an HCSS Fleet export on the
 * Fleet imports page, which reads it into rows (shared/fleetExport.ts) and
 * sends them here. The Worker never parses files. The rows' EquipmentCode
 * finds the Truck by its HCSS code. Each visit is kept once for it, keyed by
 * its geofence code and UTC entry minute: new visits are added, open ones
 * closed (see CLOSES and MORE_EXACT), and the Import keeps its counts. The
 * answer also counts per US Eastern day touched, and lists the geofence codes
 * no Place has (their visits are stored all the same).
 *
 *   POST api/fleet-imports  { fileName, format, rows }  → 201 { import }
 *
 * An Import is refused, storing nothing, where ENVIRONMENT is not on
 * IMPORTS_ALLOWED_IN, when the rows are not a Fleet export's, when they hold
 * more than one EquipmentCode, or when no active Truck has that HCSS code.
 */
export async function handleFleetImports(request: Request, env: Env, route: string): Promise<Response | null> {
  if (route !== 'fleet-imports') return null;
  if (request.method === 'POST') return importExport(request, env);
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
}

const FORMATS: FleetExportFormat[] = ['json', 'xlsx'];

/**
 * Where Imports are allowed (an allow-list: anything else, unset included, is
 * refused), so the unauthenticated Worker can't be fed a real Truck's data in
 * production. ADR 0008 (PR #82) allows one real Truck's data on staging.
 */
const IMPORTS_ALLOWED_IN = ['local', 'preview', 'staging', 'test'];

const isOdometer = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

/** A row as shared/fleetExport.ts makes it; the page sends nothing else. */
function isRow(value: unknown): value is FleetExportRow {
  const r = value as FleetExportRow;
  return (
    !!r &&
    typeof r.equipmentCode === 'string' &&
    r.equipmentCode.trim() !== '' &&
    typeof r.geofenceCode === 'string' &&
    r.geofenceCode !== '' &&
    isMoment(r.enteredAt) &&
    (r.exitedAt === null || isMoment(r.exitedAt)) &&
    isOdometer(r.entryOdometer) &&
    isOdometer(r.exitOdometer)
  );
}

/** The dedupe key's minute: the entry time in UTC cut to the minute, e.g. 2026-11-16T19:43Z. */
const enteredMinute = (enteredAt: string) => `${new Date(enteredAt).toISOString().slice(0, 16)}Z`;

async function importExport(request: Request, env: Env): Promise<Response> {
  if (!IMPORTS_ALLOWED_IN.includes(env.ENVIRONMENT ?? '')) {
    return json({ error: 'imports_not_allowed', message: 'Fleet imports are allowed only on local, preview and staging.' }, 403);
  }
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;

  const errors: Record<string, string> = {};
  const fileName = text(body.fileName);
  if (!fileName) errors.fileName = 'Say which file this is.';
  const format = body.format as FleetExportFormat;
  if (!FORMATS.includes(format)) errors.format = 'Send a JSON or xlsx Fleet export.';
  if (Object.keys(errors).length > 0) return refuse(errors);
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRow)) {
    return json({ error: 'not_a_fleet_export', message: `This is not a Fleet export. ${EXPORT_ADVICE}` }, 400);
  }
  const visits = rows as FleetExportRow[];

  const codes = new Set(visits.map((v) => v.equipmentCode.trim()));
  if (codes.size > 1) return json({ error: 'more_than_one_truck', message: 'The file must hold one Truck.' }, 400);
  const [code] = codes;
  const truck = await env.DB.prepare('SELECT id, number FROM trucks WHERE hcss_code = ? AND active = 1')
    .bind(code)
    .first<{ id: string; number: string }>();
  if (!truck) {
    return json({ error: 'unknown_truck', message: `No Truck has the HCSS code ${code}. Set it in Settings.` }, 400);
  }

  const id = crypto.randomUUID();
  const importedAt = clock(env).now.toISOString();
  const once = visitsOnce(visits);
  const DB = env.DB;
  const [perDay] = await DB.batch([
    // The counts first, per day, against the visits stored before this Import:
    // the batch is one transaction, so they always match what it does below.
    DB.prepare(`SELECT date, added, closed, unchanged FROM (${COUNTS_BY_DAY}) ORDER BY date`).bind(truck.id, JSON.stringify(once)),
    DB.prepare(
      `INSERT INTO fleet_imports (id, truck_id, file_name, format, imported_at, added, closed, unchanged)
       SELECT ?3, ?1, ?4, ?5, ?6, total(added), total(closed), total(unchanged) FROM (${COUNTS_BY_DAY})`,
    ).bind(truck.id, JSON.stringify(once), id, fileName, format, importedAt),
    DB.prepare(
      `INSERT INTO fleet_import_days (import_id, truck_id, date)
       SELECT DISTINCT ?1, ?2, json_extract(value, '$.date') FROM json_each(?3)`,
    ).bind(id, truck.id, JSON.stringify(once)),
    ...once.map((v) =>
      DB.prepare(
        `INSERT INTO fleet_visits (id, truck_id, geofence_code, entered_minute, entered_at, exited_at, entry_odometer, exit_odometer, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (truck_id, geofence_code, entered_minute) DO UPDATE SET
           entered_at = CASE WHEN ${MORE_EXACT} THEN excluded.entered_at ELSE fleet_visits.entered_at END,
           exited_at = CASE WHEN ${CLOSES} THEN excluded.exited_at ELSE fleet_visits.exited_at END,
           exit_odometer = CASE WHEN ${CLOSES} THEN excluded.exit_odometer ELSE fleet_visits.exit_odometer END,
           import_id = excluded.import_id
         WHERE ${CLOSES} OR ${MORE_EXACT}`,
      ).bind(crypto.randomUUID(), truck.id, v.geofenceCode, v.enteredMinute, v.enteredAt, v.exitedAt, v.entryOdometer, v.exitOdometer, id),
    ),
  ]);

  const days = perDay.results as unknown as FleetImportDay[];
  const codesWithNoPlace = await codesWithNoPlaceIn(DB, once);
  const sum = (key: keyof ImportCounts) => days.reduce((n, d) => n + d[key], 0);
  return json(
    {
      import: {
        id, truckId: truck.id, truckNumber: truck.number, fileName, format, importedAt,
        added: sum('added'), closed: sum('closed'), unchanged: sum('unchanged'), days, codesWithNoPlace,
      } satisfies FleetImport,
    },
    201,
  );
}

/** The codes on the Not considered list (Settings), as the Trip builder takes them. */
export async function notConsideredCodes(DB: D1Database): Promise<string[]> {
  const { results } = await DB.prepare('SELECT code FROM not_considered WHERE active = 1 ORDER BY code COLLATE NOCASE').all<{ code: string }>();
  return results.map((r) => r.code);
}

/**
 * Every geofence code in the Import that no active Place has and that is not
 * on the Not considered list (both ignoring case, as Settings and the Trip
 * builder match codes), by code. Its visits are stored all the same.
 */
export async function codesWithNoPlaceIn(DB: D1Database, visits: Pick<StoredVisit, 'geofenceCode'>[]): Promise<CodeWithNoPlace[]> {
  const { results } = await DB.prepare(
    `SELECT geofence_code AS code FROM places WHERE active = 1 AND geofence_code IS NOT NULL
     UNION ALL SELECT code FROM not_considered WHERE active = 1`,
  ).all<{ code: string }>();
  const known = new Set(results.map((p) => codeKey(p.code)));
  const codes = new Set(visits.map((v) => v.geofenceCode).filter((code) => !known.has(codeKey(code))));
  return [...codes].sort((a, b) => a.localeCompare(b)).map((code) => ({ code }));
}

/**
 * What an Import does to the stored visits, per US Eastern day its visits were
 * entered on: how many it adds, closes and holds already. ?1 is the Truck,
 * ?2 the Import's visits once (visitsOnce) as JSON.
 */
const COUNTS_BY_DAY = `
  SELECT date, CAST(added AS INTEGER) AS added, CAST(closed AS INTEGER) AS closed, CAST(count_all - added - closed AS INTEGER) AS unchanged FROM (
    SELECT json_extract(r.value, '$.date') AS date,
           count(*) AS count_all,
           total(v.id IS NULL) AS added,
           total(v.id IS NOT NULL AND v.exited_at IS NULL AND json_extract(r.value, '$.exitedAt') IS NOT NULL) AS closed
    FROM json_each(?2) r
    LEFT JOIN fleet_visits v ON v.truck_id = ?1
      AND v.geofence_code = json_extract(r.value, '$.geofenceCode')
      AND v.entered_minute = json_extract(r.value, '$.enteredMinute')
    GROUP BY 1
  )`;

/**
 * Upsert rules for a visit already stored (fleet_visits) met by a row of a
 * newer Import (excluded). A row with an exit closes an open visit; a closed
 * visit is never reopened or re-closed. An entry given with seconds replaces
 * one given only to the minute (its seconds are :00.000), never the other way.
 * The Import that does either is recorded on the visit.
 */
const CLOSES = 'fleet_visits.exited_at IS NULL AND excluded.exited_at IS NOT NULL';
const MORE_EXACT = "substr(fleet_visits.entered_at, 17) = ':00.000Z' AND substr(excluded.entered_at, 17) <> ':00.000Z'";

/** A visit as stored: times in UTC ISO 8601, keyed by geofence code and entered minute. */
interface StoredVisit {
  geofenceCode: string;
  /** The US Eastern day it was entered on, which it is filed under. */
  date: string;
  enteredMinute: string;
  enteredAt: string;
  exitedAt: string | null;
  entryOdometer: number | null;
  exitOdometer: number | null;
}

/** Whether an entry time is given only to the minute (its seconds are :00.000), as MORE_EXACT tells it in SQL. */
const toTheMinute = (enteredAt: string) => enteredAt.endsWith(':00.000Z');

/**
 * Of two entry times of one visit, the one to keep: the more exact (with
 * seconds over minute-only, as MORE_EXACT does for a stored visit), else the earlier.
 */
function entryToKeep(a: string, b: string): string {
  if (toTheMinute(a) !== toTheMinute(b)) return toTheMinute(a) ? b : a;
  return a < b ? a : b;
}

/**
 * The export's rows, each visit once. Rows with the same geofence code and
 * entered minute are one visit (a re-entry in the same minute is merged): it
 * keeps the most exact entry (entryToKeep) and the last row's exit.
 */
function visitsOnce(rows: FleetExportRow[]): StoredVisit[] {
  const byKey = new Map<string, StoredVisit>();
  for (const row of rows) {
    const enteredAt = new Date(row.enteredAt).toISOString();
    const exitedAt = row.exitedAt === null ? null : new Date(row.exitedAt).toISOString();
    const visit: StoredVisit = {
      geofenceCode: row.geofenceCode,
      date: businessDateOf(enteredAt),
      enteredMinute: enteredMinute(enteredAt),
      enteredAt,
      exitedAt,
      entryOdometer: row.entryOdometer,
      exitOdometer: exitedAt === null ? null : row.exitOdometer,
    };
    const key = `${visit.geofenceCode}\n${visit.enteredMinute}`;
    const earlier = byKey.get(key);
    byKey.set(key, earlier ? { ...earlier, enteredAt: entryToKeep(earlier.enteredAt, enteredAt), exitedAt: visit.exitedAt, exitOdometer: visit.exitOdometer } : visit);
  }
  return [...byKey.values()];
}
