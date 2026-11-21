import type { Env } from './app';
import { text } from './http';
import { bringBack, entryNamed, goLast, isNameTaken, LISTS, TEXT_LIMIT } from './lists';
import type { ListName, NewAssignment, TypedNames } from '../../shared/types';

/**
 * The fields an Assignment may give by name instead of by id, so Dave can type
 * a Place or Material that is not picked from the list. Each names the id field
 * it fills and the list it is found in, brought back in or added to.
 */
export const TYPED_NAMES = [
  { key: 'fromPlaceName', idKey: 'fromPlaceId', list: 'places', noun: 'Place' },
  { key: 'toPlaceName', idKey: 'toPlaceId', list: 'places', noun: 'Place' },
  { key: 'materialName', idKey: 'materialId', list: 'materials', noun: 'Material' },
] as const satisfies readonly { key: keyof TypedNames; idKey: keyof NewAssignment; list: ListName; noun: string }[];

type TypedField = (typeof TYPED_NAMES)[number];
export type TypedIdKey = TypedField['idKey'];

/** One name a request typed, tidied, with the field it was typed in. */
export interface Typed {
  field: TypedField;
  name: string;
}

/**
 * Field name to a plain message, for each typed name that is wrong: blank, not
 * text, too long, or typed alongside an id for the same field.
 */
export function checkTyped(body: Partial<NewAssignment & TypedNames>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { key, idKey, noun } of TYPED_NAMES) {
    const value = body[key];
    if (value == null) continue;
    const name = text(value);
    if (!name) errors[key] = `Write the ${noun}'s name.`;
    else if (name.length > TEXT_LIMIT) errors[key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else if (text(body[idKey])) errors[key] = `Pick a ${noun} from the list or write its name, not both.`;
  }
  return errors;
}

/** The names a request typed, tidied; a field left out or null typed nothing. */
export function typedIn(body: Partial<TypedNames>): Typed[] {
  return TYPED_NAMES.filter((field) => body[field.key] != null).map((field) => ({ field, name: text(body[field.key]) }));
}

/**
 * Saves an Assignment and the entries its typed names need, in one batch, so a
 * failed save brings back or adds nothing. `write` is the Assignment's own
 * INSERT or UPDATE (with any record it keeps of it), given the id each typed
 * name links to.
 */
export async function saveLinked(
  env: Env,
  typed: Typed[],
  write: (ids: Partial<Record<TypedIdKey, string>>) => D1PreparedStatement | D1PreparedStatement[],
): Promise<void> {
  try {
    const { ids, writes } = await linkTyped(env, typed);
    await env.DB.batch([...writes, ...[write(ids)].flat()]);
  } catch (error) {
    // Another request can add the same name between the lookup and this save;
    // the unique index stops the batch, and looking again finds that entry.
    if (!typed.some(({ field }) => isNameTaken(error, field.list))) throw error;
    const { ids, writes } = await linkTyped(env, typed);
    await env.DB.batch([...writes, ...[write(ids)].flat()]);
  }
}

/**
 * The id each typed name links to, and the writes that make it so: none for an
 * active entry, making a removed one active again, or adding a new one. Both
 * of those go last in the list's order, as from Settings.
 */
async function linkTyped(env: Env, typed: Typed[]) {
  // From and To may type the same name: it is looked up, and added, once.
  const links = new Map<string, Promise<{ id: string; writes: D1PreparedStatement[] }>>();
  const linked = typed.map(({ field, name }) => {
    const key = `${field.list}:${sameIgnoringCase(name)}`;
    if (!links.has(key)) links.set(key, linkName(env, field.list, name));
    return links.get(key)!;
  });
  const ids: Partial<Record<TypedIdKey, string>> = {};
  (await Promise.all(linked)).forEach(({ id }, i) => (ids[typed[i].field.idKey] = id));
  const writes = (await Promise.all(links.values())).flatMap(({ writes }) => writes);
  return { ids, writes };
}

/** The entry one name links to, and the writes it needs first, if any. */
async function linkName(env: Env, list: ListName, name: string) {
  const { table, name: display } = LISTS[list];
  const found = await entryNamed(env, list, name);
  if (found) {
    return { id: found.id, writes: found.active ? [] : bringBack(env, list, found.id) };
  }
  const id = crypto.randomUUID();
  return { id, writes: [env.DB.prepare(`INSERT INTO ${table} (id, ${display.column}) VALUES (?, ?)`).bind(id, name), ...goLast(env, list, id)] };
}

/** A name as SQLite's NOCASE compares it: only A to Z ignore case. */
function sameIgnoringCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
