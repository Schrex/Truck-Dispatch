/**
 * Read an HCSS Fleet entry/exit export (the JSON the Fleet report returns:
 * `{ Result: [ { EquipmentCode, GeofenceCode, EntryDateTime, … } ] }`) into
 * what the Trip builder takes. Each geofence becomes a Place named by its code (its description as the full name),
 * with its kind from Fleet's geofence type, so a real day can be run as it
 * came. Pure; the simulation page uses it for an uploaded export.
 */
import type { FleetVisit, TripPlace, TripPlaceKind } from './trips';

/** The fields of one Fleet entry/exit row that the Trip builder needs. */
interface FleetRow {
  EquipmentCode?: string;
  EquipmentDescription?: string;
  GeofenceCode: string;
  GeofenceType?: string | null;
  GeofenceDescription?: string | null;
  EntryDateTime: string;
  ExitDateTime: string | null;
  EntryOdometer: number;
  ExitOdometer: number | null;
}

export interface FleetDay {
  truckCode: string;
  truckDescription: string;
  /** The US Eastern date of the first entry. */
  date: string;
  places: TripPlace[];
  visits: FleetVisit[];
}

const easternDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fleet's geofence type as a Place kind; a shop is told by its code, since Fleet calls it Other. */
export function placeKind(type: string | null | undefined, code: string): TripPlaceKind {
  if (type === 'Job') return 'job_site';
  if (type === 'Plant') return 'plant';
  if (/shop/i.test(code)) return 'shop';
  if (/yard/i.test(code)) return 'yard';
  return null;
}

function isRow(value: unknown): value is FleetRow {
  const r = value as FleetRow;
  return !!r && typeof r.GeofenceCode === 'string' && typeof r.EntryDateTime === 'string' && typeof r.EntryOdometer === 'number';
}

/** Parse the export, or throw with a message a person can act on. */
export function parseFleetEntryExit(json: unknown): FleetDay {
  const rows = (json as { Result?: unknown })?.Result ?? json;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No entry/exit rows found: expected { "Result": [ … ] } from the HCSS Fleet report.');
  if (!rows.every(isRow)) throw new Error('Some rows have no GeofenceCode, EntryDateTime or EntryOdometer: is this the entry/exit report?');
  const sorted = [...rows].sort((a, b) => Date.parse(a.EntryDateTime) - Date.parse(b.EntryDateTime));
  const places = new Map<string, TripPlace>();
  for (const r of sorted) {
    if (places.has(r.GeofenceCode)) continue;
    places.set(r.GeofenceCode, {
      id: `geo:${r.GeofenceCode}`,
      name: r.GeofenceCode,
      fullName: r.GeofenceDescription?.trim() || null,
      kind: placeKind(r.GeofenceType, r.GeofenceCode),
      geofenceCode: r.GeofenceCode,
    });
  }
  return {
    truckCode: sorted[0].EquipmentCode ?? 'Unknown Truck',
    truckDescription: sorted[0].EquipmentDescription ?? '',
    date: easternDate.format(new Date(sorted[0].EntryDateTime)),
    places: [...places.values()],
    visits: sorted.map((r) => ({
      geofenceCode: r.GeofenceCode,
      enteredAt: r.EntryDateTime,
      exitedAt: r.ExitDateTime,
      entryOdometer: r.EntryOdometer,
      // An open row carries the current reading as its exit; the Trip builder must not use it.
      exitOdometer: r.ExitDateTime ? r.ExitOdometer : null,
    })),
  };
}
