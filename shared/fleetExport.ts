/**
 * Reading an HCSS Fleet export into the rows the Import route takes. Pure and
 * shared: the Fleet imports page parses the dropped file and sends these
 * rows; the Worker never parses files. Each format has its own reader that
 * ends in the same FleetExportRow.
 */

/** One visit of one Truck to one geofence, as an export gives it. Times are UTC ISO 8601. */
export interface FleetExportRow {
  /** The Truck's HCSS code (Fleet's EquipmentCode). */
  equipmentCode: string;
  geofenceCode: string;
  enteredAt: string;
  /** Null while the Truck is still there. */
  exitedAt: string | null;
  /** Null when the export gives none. */
  entryOdometer: number | null;
  /** Null while the visit is open, even when Fleet gives the current reading. */
  exitOdometer: number | null;
}

/** The fields of one row of Fleet's entry/exit JSON report that the Import uses. */
interface FleetJsonRow {
  EquipmentCode: string;
  GeofenceCode: string;
  EntryDateTime: string;
  ExitDateTime?: string | null;
  EntryOdometer?: number | null;
  ExitOdometer?: number | null;
}

const isMoment = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function isJsonRow(value: unknown): value is FleetJsonRow {
  const r = value as FleetJsonRow;
  return (
    !!r &&
    typeof r.EquipmentCode === 'string' &&
    typeof r.GeofenceCode === 'string' &&
    isMoment(r.EntryDateTime) &&
    (r.ExitDateTime == null || isMoment(r.ExitDateTime))
  );
}

const odometer = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The rows of Fleet's entry/exit JSON (`{ Result: [ … ] }`, or a bare array),
 * or throws with a message a person can act on.
 */
export function readFleetJson(json: unknown): FleetExportRow[] {
  const rows = Array.isArray(json) ? json : (json as { Result?: unknown } | null)?.Result;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('This file has no entry/exit rows. Export the entry/exit report from HCSS Fleet and drop that.');
  }
  if (!rows.every(isJsonRow)) {
    throw new Error('Some rows have no EquipmentCode, GeofenceCode or entry time. Is this the HCSS Fleet entry/exit report?');
  }
  return rows.map((r) => {
    const exitedAt = r.ExitDateTime ? new Date(r.ExitDateTime).toISOString() : null;
    return {
      equipmentCode: r.EquipmentCode.trim(),
      geofenceCode: r.GeofenceCode,
      enteredAt: new Date(r.EntryDateTime).toISOString(),
      exitedAt,
      entryOdometer: odometer(r.EntryOdometer),
      exitOdometer: exitedAt ? odometer(r.ExitOdometer) : null,
    };
  });
}
