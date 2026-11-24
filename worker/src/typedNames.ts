import type { Env } from './app';
import { text } from './http';
import { bringBack, entryNamed, goLast, isNameTaken, LISTS, TEXT_LIMIT } from './lists';
import type { ListName, NewAssignment, TypedNames } from '../../shared/types';

/**
 * A field an Assignment may give by name instead of by id, so Dave can type an
 * entry that is not picked from a list. It names the lists the name is looked
 * for in, in order, each with the id field it fills, and the list a new entry
 * is added to. A name found in one list fills that list's id field and clears
 * the field's other id fields in the same save.
 */
export interface TypedField<Key extends string = string, IdKey extends string = string> {
  key: Key;
  noun: string;
  lists: readonly { list: ListName; idKey: IdKey }[];
  addTo: ListName;
}

/**
 * The fields an Assignment may type: a Place or Material in one list, and
 * For, a Foreman or else a Customer; a new name For is always a Customer,
 * as Foremen are added only in Settings.
 */
export const TYPED_NAMES = [
  { key: 'fromPlaceName', noun: 'Place', lists: [{ list: 'places', idKey: 'fromPlaceId' }], addTo: 'places' },
  { key: 'toPlaceName', noun: 'Place', lists: [{ list: 'places', idKey: 'toPlaceId' }], addTo: 'places' },
  { key: 'materialName', noun: 'Material', lists: [{ list: 'materials', idKey: 'materialId' }], addTo: 'materials' },
  {
    key: 'forName',
    noun: 'Foreman or Customer',
    lists: [{ list: 'foremen', idKey: 'foremanId' }, { list: 'customers', idKey: 'customerId' }],
    addTo: 'customers',
  },
] as const satisfies readonly TypedField<keyof TypedNames, keyof NewAssignment>[];

type AssignmentField = (typeof TYPED_NAMES)[number];
type IdKeyOf<Field extends TypedField> = Field['lists'][number]['idKey'];
export type TypedIdKey = IdKeyOf<AssignmentField>;

/** One name a request typed, tidied, with the field it was typed in. */
export interface Typed<Field extends TypedField = AssignmentField> {
  field: Field;
  name: string;
}

/**
 * Field name to a plain message, for each typed name that is wrong: blank, not
 * text, too long, or typed alongside an id for the same field.
 */
export function checkTyped(body: object, fields: readonly TypedField[] = TYPED_NAMES): Record<string, string> {
  const sent = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const { key, lists, noun } of fields) {
    const value = sent[key];
    if (value == null) continue;
    const name = text(value);
    if (!name) errors[key] = `Write the ${noun}'s name.`;
    else if (name.length > TEXT_LIMIT) errors[key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else if (lists.some(({ idKey }) => text(sent[idKey]))) errors[key] = `Pick a ${noun} from the list or write its name, not both.`;
  }
  return errors;
}

/** The names a request typed, tidied; a field left out or null typed nothing. */
export function typedIn(body: object): Typed[];
export function typedIn<Field extends TypedField>(body: object, fields: readonly Field[]): Typed<Field>[];
export function typedIn(body: object, fields: readonly TypedField[] = TYPED_NAMES): Typed<TypedField>[] {
  const sent = body as Record<string, unknown>;
  return fields.filter((field) => sent[field.key] != null).map((field) => ({ field, name: text(sent[field.key]) }));
}

/** Every id field the typed names fill when saved: each to the id it links to, or to null. */
export function idKeysOf<Field extends TypedField>(typed: Typed<Field>[]): IdKeyOf<Field>[] {
  return typed.flatMap(({ field }) => field.lists.map(({ idKey }) => idKey as IdKeyOf<Field>));
}

/**
 * Saves an Assignment and the entries its typed names need, in one batch, so a
 * failed save brings back or adds nothing. `write` is the Assignment's own
 * INSERT or UPDATE (with any record it keeps of it), given, for every id field
 * a typed name fills, the id it links to, or null for the field's other lists.
 */
export async function saveLinked<Field extends TypedField>(
  env: Env,
  typed: Typed<Field>[],
  write: (ids: Record<IdKeyOf<Field>, string | null>) => D1PreparedStatement | D1PreparedStatement[],
): Promise<void> {
  try {
    const { ids, writes } = await linkTyped(env, typed);
    await env.DB.batch([...writes, ...[write(ids)].flat()]);
  } catch (error) {
    // Another request can add the same name between the lookup and this save;
    // the unique index stops the batch, and looking again finds that entry.
    if (!typed.some(({ field }) => isNameTaken(error, field.addTo))) throw error;
    const { ids, writes } = await linkTyped(env, typed);
    await env.DB.batch([...writes, ...[write(ids)].flat()]);
  }
}

interface Link {
  list: ListName;
  id: string;
  writes: D1PreparedStatement[];
}

/**
 * The id each typed name links to, and the writes that make it so: none for an
 * active entry, making a removed one active again, or adding a new one. Both
 * of those go last in the list's order, as from Settings.
 */
async function linkTyped<Field extends TypedField>(env: Env, typed: Typed<Field>[]) {
  // From and To may type the same name: it is looked up, and added, once.
  const links = new Map<string, Promise<Link>>();
  const linked = typed.map(({ field, name }) => {
    const key = `${field.lists.map(({ list }) => list).join(',')}>${field.addTo}:${sameIgnoringCase(name)}`;
    if (!links.has(key)) links.set(key, linkName(env, field, name));
    return links.get(key)!;
  });
  const ids = {} as Record<IdKeyOf<Field>, string | null>;
  (await Promise.all(linked)).forEach(({ list, id }, i) => {
    for (const { list: other, idKey } of typed[i].field.lists) ids[idKey as IdKeyOf<Field>] = other === list ? id : null;
  });
  const writes = (await Promise.all(links.values())).flatMap(({ writes }) => writes);
  return { ids, writes };
}

/**
 * The entry one name links to, and the writes it needs first, if any. The
 * field's lists are searched in order for an active entry, then in order for a
 * removed one, which is brought back; failing both, it is added to `addTo`.
 */
async function linkName(env: Env, field: TypedField, name: string): Promise<Link> {
  const found = await Promise.all(field.lists.map(({ list }) => entryNamed(env, list, name)));
  const active = found.findIndex((entry) => entry?.active);
  if (active >= 0) return { list: field.lists[active].list, id: found[active]!.id, writes: [] };
  const removed = found.findIndex(Boolean);
  if (removed >= 0) {
    const { list } = field.lists[removed];
    return { list, id: found[removed]!.id, writes: bringBack(env, list, found[removed]!.id) };
  }
  const list = field.addTo;
  const { table, name: display } = LISTS[list];
  const id = crypto.randomUUID();
  return { list, id, writes: [env.DB.prepare(`INSERT INTO ${table} (id, ${display.column}) VALUES (?, ?)`).bind(id, name), ...goLast(env, list, id)] };
}

/** A name as SQLite's NOCASE compares it: only A to Z ignore case. */
function sameIgnoringCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
