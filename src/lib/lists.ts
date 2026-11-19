import type { ListName, Lists, PlaceKind } from '../../shared/types';

/** How each list names its entries on the Board and in pickers. */
const DISPLAY: { [L in ListName]: (entry: Lists[L]) => string } = {
  drivers: (driver) => driver.name,
  trucks: (truck) => truck.number,
  jobs: (job) => job.name,
  places: (place) => place.shortName,
  materials: (material) => material.name,
  foremen: (foreman) => foreman.name,
};

/** A Place's kind in words, in the order Settings offers them. */
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  plant: 'Plant',
  job_site: 'Job site',
  shop: 'Shop',
  yard: 'Yard',
};

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
