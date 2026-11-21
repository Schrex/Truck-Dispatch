import type { Env } from './app';
import { json, readJson, refuse, text } from './http';
import { ORDERED_LISTS, PLACE_KINDS, type ListName } from '../../shared/types';

/**
 * The lists Settings edits and the Board picks from. Each list has the same
 * three operations, and no delete:
 *
 *   GET   api/<list>                    active entries, by display name
 *   GET   api/<list>?include=inactive   every entry
 *   POST  api/<list>                    add an entry          → 201 { <one>: entry }
 *   PATCH api/<list>/<id>               change any of its fields, including active
 *   PUT   api/<list>/order              Dave's own order of the whole list (ordered lists only)
 *
 * A list is declared once below: its table, its display name (required and
 * unique in the list, ignoring case) and its other fields. Whether an entry is
 * active matters only to the page's pickers; any entry that exists may be used.
 *
 * Drivers, Places and Materials are ordered: each entry answers its sortOrder
 * (1 is first, null for none) and a list answers ordered entries first, then
 * the rest by name. A new entry, or one brought back, has no order, so it
 * comes after the ordered ones until Dave orders the list again.
 */

type Field =
  /** Optional free text; empty is saved as null. */
  | { key: string; column: string; kind: 'text' }
  /** Optional id of an entry in another list. */
  | { key: string; column: string; kind: 'ref'; list: ListName; message: string }
  /** Optional, one of a fixed set of values; empty is saved as null. */
  | { key: string; column: string; kind: 'choice'; choices: readonly string[]; message: string };

interface List {
  table: string;
  /** The response key for one entry, e.g. { truck }. */
  one: string;
  name: { key: string; column: string; missing: string; taken: string };
  fields: Field[];
  /**
   * Yes-or-no facts read from columns Settings does not edit, e.g. whether a
   * Place has a geofence code. Answered on every read; ignored when sent.
   */
  facts?: { key: string; sql: string }[];
}

export const LISTS: Record<ListName, List> = {
  drivers: {
    table: 'drivers',
    one: 'driver',
    name: { key: 'name', column: 'name', missing: 'Write the Driver\'s name.', taken: 'There is already a Driver with this name.' },
    fields: [{ key: 'defaultTruckId', column: 'default_truck_id', kind: 'ref', list: 'trucks', message: 'Pick a Truck from the list.' }],
  },
  trucks: {
    table: 'trucks',
    one: 'truck',
    name: { key: 'number', column: 'number', missing: 'Write the Truck\'s number.', taken: 'There is already a Truck with this number.' },
    fields: [
      { key: 'hcssCode', column: 'hcss_code', kind: 'text' },
      { key: 'hcssGuid', column: 'hcss_guid', kind: 'text' },
    ],
  },
  jobs: {
    table: 'jobs',
    one: 'job',
    name: { key: 'name', column: 'name', missing: 'Write the Job\'s name.', taken: 'There is already a Job with this name.' },
    fields: [{ key: 'jobNumber', column: 'job_number', kind: 'text' }],
  },
  places: {
    table: 'places',
    one: 'place',
    name: { key: 'shortName', column: 'short_name', missing: 'Write the Place\'s short name.', taken: 'There is already a Place with this short name.' },
    fields: [
      { key: 'fullName', column: 'full_name', kind: 'text' },
      { key: 'kind', column: 'kind', kind: 'choice', choices: PLACE_KINDS, message: 'Pick plant, job site, shop or yard, or leave it empty.' },
      { key: 'jobId', column: 'job_id', kind: 'ref', list: 'jobs', message: 'Pick a Job from the list.' },
    ],
    // The geofence code itself comes from HCSS later; Settings only says whether there is one.
    facts: [{ key: 'onTruckMap', sql: 'geofence_code IS NOT NULL' }],
  },
  materials: {
    table: 'materials',
    one: 'material',
    name: { key: 'name', column: 'name', missing: 'Write the Material\'s name.', taken: 'There is already a Material with this name.' },
    fields: [],
  },
  foremen: {
    table: 'foremen',
    one: 'foreman',
    name: { key: 'name', column: 'name', missing: 'Write the Foreman\'s name.', taken: 'There is already a Foreman with this name.' },
    fields: [],
  },
};

/** The longest a list entry's name or other text may be. */
export const TEXT_LIMIT = 100;

export function isList(route: string): route is ListName {
  return Object.hasOwn(LISTS, route);
}

/** Whether Dave puts this list in his own order (its table has sort_order). */
const isOrdered = (list: ListName) => (ORDERED_LISTS as readonly ListName[]).includes(list);

/** Whether an entry with this id is in the list, active or not. */
export async function exists(env: Env, list: ListName, id: string): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 FROM ${LISTS[list].table} WHERE id = ?`).bind(id).first());
}

/** The entry whose display name is this one, ignoring case, active or not; there is at most one. */
export function entryNamed(env: Env, list: ListName, name: string): Promise<{ id: string; active: number } | null> {
  const { table, name: display } = LISTS[list];
  return env.DB.prepare(`SELECT id, active FROM ${table} WHERE ${display.column} = ? COLLATE NOCASE`).bind(name).first();
}

/** Whether a write failed because the list's unique index already has the name. */
export function isNameTaken(error: unknown, list: ListName): boolean {
  const { table, name } = LISTS[list];
  return String(error).includes(`UNIQUE constraint failed: ${table}.${name.column}`);
}

/**
 * How a list's entries are read: Dave's own order first, then the entries
 * without one by name. `alias` is the table's alias in the query, if any.
 */
export function listOrder(list: ListName, alias = ''): string {
  const { name } = LISTS[list];
  const column = (c: string) => (alias ? `${alias}.${c}` : c);
  const byName = `${column(name.column)} COLLATE NOCASE, ${column('id')}`;
  return isOrdered(list) ? `${column('sort_order')} IS NULL, ${column('sort_order')}, ${byName}` : byName;
}

/**
 * Makes a removed entry active again. In an ordered list it loses its old
 * place and goes last, since the list may have been reordered without it.
 */
export function bringBack(env: Env, list: ListName, id: string): D1PreparedStatement {
  const { table } = LISTS[list];
  return env.DB.prepare(`UPDATE ${table} SET active = 1${isOrdered(list) ? ', sort_order = NULL' : ''} WHERE id = ? AND active = 0`).bind(id);
}

export async function handleList(request: Request, env: Env, list: ListName, id: string | undefined, query: URLSearchParams): Promise<Response> {
  const method = request.method;
  if (id === undefined) {
    if (method === 'GET' || method === 'HEAD') return read(env, list, query.get('include') === 'inactive');
    if (method === 'POST') return save(request, env, list, null);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }
  if (id === 'order' && isOrdered(list)) {
    if (method === 'PUT') return reorder(request, env, list);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT' });
  }
  if (method === 'PATCH') return save(request, env, list, id);
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH' });
}

function select(list: ListName): string {
  const { table, name, fields, facts = [] } = LISTS[list];
  const columns = [
    `id`,
    `${name.column} AS ${name.key}`,
    ...fields.map((f) => `${f.column} AS ${f.key}`),
    ...facts.map((f) => `(${f.sql}) AS ${f.key}`),
    ...(isOrdered(list) ? ['sort_order AS sortOrder'] : []),
    'active',
  ];
  return `SELECT ${columns.join(', ')} FROM ${table}`;
}

/** SQLite has no booleans: active and each fact come back as 1 or 0. */
function entry(list: ListName, row: Record<string, unknown>) {
  const facts = (LISTS[list].facts ?? []).map((f) => [f.key, row[f.key] === 1]);
  return { ...row, ...Object.fromEntries(facts), active: row.active === 1 };
}

async function read(env: Env, list: ListName, includeInactive: boolean): Promise<Response> {
  const { results } = await env.DB.prepare(`${select(list)} ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY ${listOrder(list)}`).all<Record<string, unknown>>();
  return json({ [list]: results.map((row) => entry(list, row)) });
}

/** Adds an entry (id null) or changes the given fields of one. */
async function save(request: Request, env: Env, list: ListName, id: string | null): Promise<Response> {
  const spec = LISTS[list];
  if (id !== null && !(await exists(env, list, id))) return json({ error: 'not_found' }, 404);
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  const adding = id === null;

  const errors: Record<string, string> = {};
  const values: Record<string, string | number | null> = {};

  if (adding || spec.name.key in body) {
    const name = text(body[spec.name.key]);
    if (!name) errors[spec.name.key] = spec.name.missing;
    else if (name.length > TEXT_LIMIT) errors[spec.name.key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else if (await env.DB.prepare(`SELECT 1 FROM ${spec.table} WHERE ${spec.name.column} = ? COLLATE NOCASE AND id IS NOT ?`).bind(name, id).first()) {
      errors[spec.name.key] = spec.name.taken;
    } else values[spec.name.column] = name;
  }

  for (const field of spec.fields) {
    if (!(field.key in body)) continue;
    const raw = body[field.key];
    if (raw != null && typeof raw !== 'string') {
      errors[field.key] = field.kind === 'text' ? 'Write it as text.' : field.message;
      continue;
    }
    const value = text(raw) || null;
    if (field.kind === 'text' && value && value.length > TEXT_LIMIT) errors[field.key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else if (field.kind === 'ref' && value && !(await exists(env, field.list, value))) errors[field.key] = field.message;
    else if (field.kind === 'choice' && value && !field.choices.includes(value)) errors[field.key] = field.message;
    else values[field.column] = value;
  }

  if ('active' in body) {
    if (typeof body.active !== 'boolean') errors.active = 'Choose active or inactive.';
    else values.active = body.active ? 1 : 0;
  }

  if (Object.keys(errors).length > 0) return refuse(errors);

  const columns = Object.keys(values);
  const savedId = id ?? crypto.randomUUID();
  try {
    if (adding) {
      await env.DB.prepare(`INSERT INTO ${spec.table} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`)
        .bind(savedId, ...Object.values(values))
        .run();
    } else if (columns.length > 0) {
      const sets = columns.map((c) => `${c} = ?`);
      // Brought back (active from 0 to 1): it goes last, as bringBack does. SET reads the row as it was.
      if (isOrdered(list) && values.active === 1) sets.push('sort_order = CASE WHEN active = 0 THEN NULL ELSE sort_order END');
      await env.DB.prepare(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...Object.values(values), savedId)
        .run();
    }
  } catch (error) {
    // The check above covers the usual case; another request can still save the
    // same name between that check and this write, and the unique index stops it.
    if (isNameTaken(error, list)) {
      return refuse({ [spec.name.key]: spec.name.taken });
    }
    throw error;
  }
  const saved = await env.DB.prepare(`${select(list)} WHERE id = ?`).bind(savedId).first<Record<string, unknown>>();
  return json({ [spec.one]: saved && entry(list, saved) }, adding ? 201 : 200);
}

const ORDER_REFUSED = 'Send the entries of the list in order, each once.';

/**
 * Sets Dave's own order of a whole list in one request: the ids sent, first to
 * last, get 1, 2, 3…; entries left out have none and come after them by name.
 * Answers every entry, removed ones too, in the new order.
 */
async function reorder(request: Request, env: Env, list: ListName): Promise<Response> {
  const { table } = LISTS[list];
  const body = await readJson<{ order?: unknown }>(request);
  if (body instanceof Response) return body;
  const order = body.order;
  if (!Array.isArray(order) || !order.every((id): id is string => typeof id === 'string') || new Set(order).size !== order.length) {
    return refuse({ order: ORDER_REFUSED });
  }
  const found = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(order))
    .first<{ n: number }>();
  if (found?.n !== order.length) return refuse({ order: ORDER_REFUSED });

  // One batch, so a failed write leaves the old order whole.
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET sort_order = NULL`),
    ...order.map((id, i) => env.DB.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(i + 1, id)),
  ]);
  return read(env, list, true);
}
