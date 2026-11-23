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
 * finds the Truck by its HCSS code, and each visit not stored yet is stored
 * for it, keyed by its geofence code and UTC entry minute.
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
  const DB = env.DB;
  await DB.batch([
    DB.prepare('INSERT INTO fleet_imports (id, truck_id, file_name, format, imported_at) VALUES (?, ?, ?, ?, ?)').bind(id, truck.id, fileName, format, importedAt),
    ...days.map((date) => DB.prepare('INSERT INTO fleet_import_days (import_id, truck_id, date) VALUES (?, ?, ?)').bind(id, truck.id, date)),
    ...visits.map((v) => {
      const exitedAt = v.exitedAt === null ? null : new Date(v.exitedAt).toISOString();
      return DB.prepare(
        `INSERT INTO fleet_visits (id, truck_id, geofence_code, entered_minute, entered_at, exited_at, entry_odometer, exit_odometer, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (truck_id, geofence_code, entered_minute) DO NOTHING`,
      ).bind(
        crypto.randomUUID(), truck.id, v.geofenceCode, enteredMinute(v.enteredAt), new Date(v.enteredAt).toISOString(),
        exitedAt, v.entryOdometer, exitedAt === null ? null : v.exitOdometer, id,
      );
    }),
    // The visits this Import stored are the ones that name it.
    DB.prepare('UPDATE fleet_imports SET added = (SELECT count(*) FROM fleet_visits WHERE import_id = ?1) WHERE id = ?1').bind(id),
  ]);

  const added = (await DB.prepare('SELECT added FROM fleet_imports WHERE id = ?').bind(id).first<number>('added')) ?? 0;
  return json({ import: { id, truckId: truck.id, truckNumber: truck.number, fileName, format, importedAt, added, days } satisfies FleetImport }, 201);
}
