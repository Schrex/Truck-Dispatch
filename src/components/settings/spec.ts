import type { ListName, Lists } from '../../../shared/types';

/**
 * A field Settings can edit: everything an entry has except its id, whether it
 * is active, facts the Worker answers, and its place in the list's order (▲▼).
 */
export type Key<L extends ListName> = Exclude<keyof Lists[L], 'id' | 'active' | 'onTruckMap' | 'sortOrder'> & string;

/** One entry of any list, as the page holds it. */
export type Row = Record<string, unknown> & { id: string; active: boolean };

/** Looks up an entry's display name in another list, or null if it is not loaded or not there. */
export type NameOf = (list: ListName, id: unknown) => string | null;

/** What the panel's fields hold now, by key: the saved value, or the one Dave just set. */
export type FormValues = Record<string, string | null>;

/**
 * An optional field of a list: free text, an entry picked from another list,
 * or one of a fixed set of values. With shownWhen, the panel asks for it only
 * while the other fields allow it, e.g. a usual Foreman only on a job site.
 */
export type ListField<L extends ListName> = (
  | { key: Key<L>; label: string; kind: 'text' }
  | { key: Key<L>; label: string; kind: 'pick'; list: ListName; empty: string }
  | {
      key: Key<L>;
      label: string;
      kind: 'choice';
      choices: { value: string; label: string }[];
      empty: string;
      /** Saved values offered as another choice, e.g. a yard shown as Shop or yard (saved as shop only when changed). */
      shownAs?: Record<string, string>;
    }
) & { shownWhen?: (form: FormValues) => boolean };

/**
 * One Settings section, declared by its fields. Adding a list or a field to
 * Settings is changing one of these (SettingsPage.tsx); the API side is
 * worker/src/lists.ts.
 */
export interface SectionSpec<L extends ListName> {
  list: L;
  /** The section's title, e.g. "Trucks". */
  title: string;
  /** One entry, e.g. "Truck". */
  noun: string;
  /** The display name: required and unique in the list, ignoring case. */
  name: { key: Key<L>; label: string };
  fields: ListField<L>[];
  /** The key detail on an entry's chip, e.g. a Driver's usual Truck. */
  detail?: (entry: Lists[L], nameOf: NameOf) => string | null;
  /** A line in the panel saying what the entry is linked to, e.g. "On the truck map". */
  status?: (entry: Lists[L]) => string;
  /** A warning before the entry is removed, e.g. a Driver's later days; null for none. */
  removeWarning?: (entry: Lists[L]) => Promise<string | null>;
}

/** Keeps each section's field keys checked against its own list, then holds it as any list's section. */
export const section = <L extends ListName>(spec: SectionSpec<L>) => spec as unknown as SectionSpec<ListName>;
