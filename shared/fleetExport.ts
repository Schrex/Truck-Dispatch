/**
 * Reading an HCSS Fleet export into the rows the Import route takes. Pure and
 * shared: the Fleet imports page parses the dropped file and sends these
 * rows; the Worker never parses files. Each format has its own reader that
 * ends in the same FleetExportRow.
 */

import { addDays, easternMoment } from './days';

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

/** What to do instead when a dropped file is not the export: said once, for the readers, the page and the Worker. */
export const EXPORT_ADVICE = 'Export the entry/exit report from HCSS Fleet and drop that.';

/** Whether a value is a time Date.parse reads, e.g. "2026-11-16T12:02:03Z". */
export const isMoment = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

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
    throw new Error(`This file has no entry/exit rows. ${EXPORT_ADVICE}`);
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

/** A sheet's cells, row by row, as an xlsx library reads them (read-excel-file on the Fleet imports page). */
export type FleetSheet = readonly (readonly unknown[])[];

/** The first four column titles of Fleet's entry/exit xlsx report; Duration and Calculated Mileage follow and are not read. */
const XLSX_TITLES = ['Location Code', 'Location Description', 'Entry Time', 'Exit Time'];

/** "Entry Date: 11/16/2026": the row that starts each day, M/D/YYYY in US Eastern. */
const ENTRY_DATE = /^Entry Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
/** "07:02:03 AM": a US Eastern wall time; Fleet gives the seconds, a minute alone is read as :00. */
const WALL_TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i;

/** Seconds since midnight of a wall time cell, or null when the cell is not one. */
function wallTime(cell: unknown): number | null {
  const match = typeof cell === 'string' ? WALL_TIME.exec(cell.trim()) : null;
  if (!match) return null;
  const [, h, m, s, half] = match;
  const hour = (Number(h) % 12) + (half.toUpperCase() === 'PM' ? 12 : 0);
  return hour * 3600 + Number(m) * 60 + Number(s ?? 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** One visit row of the sheet, under its day's Entry Date row. Times are seconds since that day's midnight. */
interface XlsxVisit {
  date: string;
  geofenceCode: string;
  entry: number;
  exit: number;
}

/**
 * The visit rows of Fleet's entry/exit xlsx report, or throws with a message
 * a person can act on.
 *
 * Its layout: a header row (Location Code, Location Description, Entry Time,
 * Exit Time, Duration, Calculated Mileage); an "Entry Date: M/D/YYYY" row
 * starting each day; then a row per visit, its times "hh:mm:ss AM" in US
 * Eastern.
 */
function xlsxVisits(sheet: FleetSheet): XlsxVisit[] {
  const [header, ...rows] = sheet;
  if (!header || !XLSX_TITLES.every((title, i) => typeof header[i] === 'string' && header[i].trim() === title)) {
    throw new Error(`This sheet is not the entry/exit report. ${EXPORT_ADVICE}`);
  }
  const visits: XlsxVisit[] = [];
  let date: string | null = null;
  rows.forEach((row, i) => {
    const firstCell = typeof row[0] === 'string' ? row[0].trim() : '';
    const day = ENTRY_DATE.exec(firstCell);
    if (day) {
      date = `${day[3]}-${pad(Number(day[1]))}-${pad(Number(day[2]))}`;
      return;
    }
    if (row.every((cell) => cell == null || cell === '')) return;
    const entry = wallTime(row[2]);
    const exit = wallTime(row[3]);
    if (!firstCell || entry === null || exit === null) {
      throw new Error(`Row ${i + 2} has no Location Code, Entry Time or Exit Time. Is this the HCSS Fleet entry/exit report?`);
    }
    if (date === null) throw new Error(`Row ${i + 2} comes before any "Entry Date" row. Is this the HCSS Fleet entry/exit report?`);
    visits.push({ date, geofenceCode: firstCell, entry, exit });
  });
  if (visits.length === 0) {
    throw new Error(`This file has no entry/exit rows. ${EXPORT_ADVICE}`);
  }
  return visits;
}

/**
 * How many visits Fleet's entry/exit xlsx report holds, or throws as
 * readFleetXlsx does: the page checks the sheet with it before Dave picks the Truck.
 */
export function countFleetXlsxVisits(sheet: FleetSheet): number {
  return xlsxVisits(sheet).length;
}

/**
 * The rows of Fleet's entry/exit xlsx report (its layout in xlsxVisits), for
 * the Truck Dave picked (its HCSS code: the xlsx names no Truck), or throws
 * with a message a person can act on. The xlsx gives no odometers, so they
 * are null. Its times are read as US Eastern explicitly, never the runtime's zone.
 *
 * Fleet cuts visits at midnight: a visit still there at the end of a day
 * exits at "12:00:00 AM". When the next day starts there at 12:00:00 AM, that
 * midnight is its exit (Fleet's own split, as the JSON gives it); otherwise the
 * Truck is still there and the visit is open.
 */
export function readFleetXlsx(sheet: FleetSheet, equipmentCode: string): FleetExportRow[] {
  const visits = xlsxVisits(sheet);
  const code = equipmentCode.trim();
  const at = (day: string, seconds: number) => easternMoment(day, Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60);
  return visits.map((visit, i) => {
    let exitedAt: string | null = at(visit.date, visit.exit);
    if (visit.exit === 0) {
      // Exit 12:00:00 AM: the visit ran to the end of its day.
      const nextDay = addDays(visit.date, 1);
      const next = visits.slice(i + 1).find((v) => v.date !== visit.date);
      const continues = next !== undefined && next.date === nextDay && next.geofenceCode === visit.geofenceCode && next.entry === 0;
      exitedAt = continues ? at(nextDay, 0) : null;
    }
    return { equipmentCode: code, geofenceCode: visit.geofenceCode, enteredAt: at(visit.date, visit.entry), exitedAt, entryOdometer: null, exitOdometer: null };
  });
}
