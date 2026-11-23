import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { businessDateOf } from '../../shared/days';
import type { FleetExportRow } from '../../shared/fleetExport';
import type { FleetExportFormat, FleetImport } from '../../shared/types';

/**
 * Fleet imports: Dave drops an HCSS Fleet export on the
 * Fleet imports page, which reads it into rows (shared/fleetExport.ts) and
 * sends them here. The Worker never parses files. The rows' EquipmentCode
 * finds the Truck by its HCSS code. Each visit is kept once for it, keyed by
 * its geofence code and UTC entry minute: new visits are added, open ones
 * closed (see CLOSES and MORE_EXACT), and the Import keeps its counts.
 *
 *   POST api/fleet-imports  { fileName, format, rows }  → 201 { import }
 */
export async function handleFleetImports(request: Request, env: Env, route: string): Promise<Response | null> {
  if (route !== 'fleet-imports') return null;
  if (request.method === 'POST') return importExport(request, env);
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
}

const FORMATS: FleetExportFormat[] = ['json', 'xlsx'];

const isMoment = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isOdometer = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

/** A row as shared/fleetExport.ts makes it; the page sends nothing else. */
function isRow(value: unknown): value is FleetExportRow {
  const r = value as FleetExportRow;
  return (
    !!r &&
    typeof r.equipmentCode === 'string' &&
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
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;

  const errors: Record<string, string> = {};
  const fileName = text(body.fileName);
  if (!fileName) errors.fileName = 'Say which file this is.';
  const format = body.format as FleetExportFormat;
  if (!FORMATS.includes(format)) errors.format = 'Send a JSON or xlsx Fleet export.';
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRow)) errors.rows = 'Send the export\'s entry/exit rows.';
  if (Object.keys(errors).length > 0) return refuse(errors);
  const visits = rows as FleetExportRow[];

  const code = visits[0].equipmentCode.trim();
  const truck = await env.DB.prepare('SELECT id, number FROM trucks WHERE hcss_code = ? AND active = 1')
    .bind(code)
    .first<{ id: string; number: string }>();
  if (!truck) {
    return json({ error: 'unknown_truck', message: `No Truck has the HCSS code ${code}. Set it in Settings.` }, 400);
  }

  const id = crypto.randomUUID();
  const importedAt = clock(env).now.toISOString();
  const days = [...new Set(visits.map((v) => businessDateOf(v.enteredAt)))].sort();
  const once = visitsOnce(visits);
  const DB = env.DB;
  await DB.batch([
    // The counts first, against the visits stored before this Import: the batch
    // is one transaction, so they always match what it does below.
    DB.prepare(
      `INSERT INTO fleet_imports (id, truck_id, file_name, format, imported_at, added, closed, unchanged)
       SELECT ?1, ?2, ?3, ?4, ?5, added, closed, count_all - added - closed FROM (
         SELECT count(*) AS count_all,
                total(v.id IS NULL) AS added,
                total(v.id IS NOT NULL AND v.exited_at IS NULL AND json_extract(r.value, '$.exitedAt') IS NOT NULL) AS closed
         FROM json_each(?6) r
         LEFT JOIN fleet_visits v ON v.truck_id = ?2
           AND v.geofence_code = json_extract(r.value, '$.geofenceCode')
           AND v.entered_minute = json_extract(r.value, '$.enteredMinute')
       )`,
    ).bind(id, truck.id, fileName, format, importedAt, JSON.stringify(once)),
    ...days.map((date) => DB.prepare('INSERT INTO fleet_import_days (import_id, truck_id, date) VALUES (?, ?, ?)').bind(id, truck.id, date)),
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

  const counts = await DB.prepare('SELECT added, closed, unchanged FROM fleet_imports WHERE id = ?')
    .bind(id)
    .first<{ added: number; closed: number; unchanged: number }>();
  const { added, closed, unchanged } = counts ?? { added: 0, closed: 0, unchanged: 0 };
  return json(
    { import: { id, truckId: truck.id, truckNumber: truck.number, fileName, format, importedAt, added, closed, unchanged, days } satisfies FleetImport },
    201,
  );
}

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
  enteredMinute: string;
  enteredAt: string;
  exitedAt: string | null;
  entryOdometer: number | null;
  exitOdometer: number | null;
}

/**
 * The export's rows, each visit once. Rows with the same geofence code and
 * entered minute are one visit (a re-entry in the same minute is merged): it
 * keeps the first row's entry and the last row's exit.
 */
function visitsOnce(rows: FleetExportRow[]): StoredVisit[] {
  const byKey = new Map<string, StoredVisit>();
  for (const row of rows) {
    const enteredAt = new Date(row.enteredAt).toISOString();
    const exitedAt = row.exitedAt === null ? null : new Date(row.exitedAt).toISOString();
    const visit: StoredVisit = {
      geofenceCode: row.geofenceCode,
      enteredMinute: enteredMinute(enteredAt),
      enteredAt,
      exitedAt,
      entryOdometer: row.entryOdometer,
      exitOdometer: exitedAt === null ? null : row.exitOdometer,
    };
    const key = `${visit.geofenceCode}\n${visit.enteredMinute}`;
    const first = byKey.get(key);
    byKey.set(key, first ? { ...first, enteredAt: first.enteredAt < enteredAt ? first.enteredAt : enteredAt, exitedAt: visit.exitedAt, exitOdometer: visit.exitOdometer } : visit);
  }
  return [...byKey.values()];
}
