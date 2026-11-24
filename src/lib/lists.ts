import type { ListName, Lists, PlaceKind } from '../../shared/types';

/** How each list names its entries on the Board and in pickers. */
const DISPLAY: { [L in ListName]: (entry: Lists[L]) => string } = {
  drivers: (driver) => driver.name,
  trucks: (truck) => truck.number,
  jobs: (job) => job.name,
  places: (place) => place.shortName,
  materials: (material) => material.name,
  foremen: (foreman) => foreman.name,
  'inspection-items': (item) => item.label,
  'not-considered': (entry) => entry.code,
};

/** Each list's name in words, e.g. for a message that it could not load. */
export const LIST_TITLES: Record<ListName, string> = {
  drivers: 'Drivers',
  trucks: 'Trucks',
  jobs: 'Jobs',
  places: 'Places',
  materials: 'Materials',
  foremen: 'Foremen',
  'inspection-items': 'Inspection checklist',
  'not-considered': 'Not considered',
};

/** A Place's kind in words. Shop and yard stay apart in the data but read as one. */
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  plant: 'Plant',
  job_site: 'Job site',
  shop: 'Shop or yard',
  yard: 'Shop or yard',
};

/** The kinds Settings offers, in this order; Shop or yard is saved as shop. */
export const PLACE_KIND_CHOICES: PlaceKind[] = ['job_site', 'plant', 'shop'];

export function displayName<L extends ListName>(list: L, entry: Lists[L]): string {
  return DISPLAY[list](entry);
}

/** One choice in a ListPicker. */
export interface Choice {
  id: string;
  label: string;
  active: boolean;
}

/** A list's entries as picker choices; null while the list loads. */
export function choicesOf<L extends ListName>(list: L, entries: Lists[L][] | null): Choice[] | null {
  return entries && entries.map((entry) => ({ id: entry.id, label: displayName(list, entry), active: entry.active }));
}

/**
 * Which of an Assignment's Places its Foreman is named beside, as in
 * "TIUNY (Brody)": the drop-off if it is a job site, otherwise the pick-up if
 * that is one, the same rule that fills in the usual Foreman; null when
 * neither is a job site.
 */
export function foremanSite(fromIsJobSite: boolean, toIsJobSite: boolean): 'from' | 'to' | null {
  return toIsJobSite ? 'to' : fromIsJobSite ? 'from' : null;
}
