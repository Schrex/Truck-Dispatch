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
 *                                       or, when a removed entry has that name, bring it
 *                                       back with the fields sent → 200 { <one>: entry, broughtBack: true }
 *   PATCH api/<list>/<id>               change any of its fields, including active
 *   PUT   api/<list>/order              Dave's own order of the whole list (ordered lists only)
 *
 * A list is declared once below: its table, its display name (required and
 * unique in the list, ignoring case) and its other fields. Whether an entry is
 * active matters to the page's pickers, and to the Worker where a rule says
 * so: an Inspection, and a Truck problem a Driver reports, need an active
 * Driver and Truck; Assign needs an active Driver; a reference field with
 * `removed` needs an active entry when it is picked. Elsewhere an Assignment
 * may use any entry that exists, so removing one never breaks saved work.
 *
 * Drivers, Places, Materials and the Inspection checklist are ordered: each entry answers its sortOrder
 * (1 is first, null for none) and a list answers ordered entries first, then
 * the rest by name. A new entry, or one brought back, has no order, so it
 * comes after the ordered ones until Dave orders the list again.
 */

type Field =
  /**
   * Optional free text, trimmed; empty is saved as null. With `uniqueAmongActive`,
   * no two active entries may have it, ignoring case (a removed entry's does not count).
   */
  | { key: string; column: string; kind: 'text'; uniqueAmongActive?: (holder: string) => string }
  /**
   * Optional id of an entry in another list. With `removed`, the entry must be
   * active when it is picked (it may be removed later and stay); with
   * `onlyWhen`, only an entry whose other column has that value may have one,
   * and it is emptied when that column changes to anything else.
   */
  | {
      key: string;
      column: string;
      kind: 'ref';
      list: ListName;
      message: string;
      removed?: string;
      onlyWhen?: { column: string; value: string; message: string };
    }
  /** Optional, one of a fixed set of values; empty is saved as null. */
  | { key: string; column: string; kind: 'choice'; choices: readonly string[]; message: string }
  /** On or off: true or false, saved as 1 or 0 (off when an entry is added without it). */
  | { key: string; column: string; kind: 'flag'; message: string };

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
      // A Trip finds its Place by this code from a Fleet export.
      {
        key: 'geofenceCode',
        column: 'geofence_code',
        kind: 'text',
        uniqueAmongActive: (holder) => `This geofence code is on ${holder} already. Clear it there first.`,
      },
      { key: 'kind', column: 'kind', kind: 'choice', choices: PLACE_KINDS, message: 'Pick plant, job site, shop or yard, or leave it empty.' },
      { key: 'jobId', column: 'job_id', kind: 'ref', list: 'jobs', message: 'Pick a Job from the list.' },
      {
        key: 'usualForemanId',
        column: 'usual_foreman_id',
        kind: 'ref',
        list: 'foremen',
        message: 'Pick a Foreman from the list.',
        removed: 'This Foreman was removed. Bring him back in Foremen, or pick another.',
        onlyWhen: { column: 'kind', value: 'job_site', message: 'Only a job site can have a usual Foreman.' },
      },
    ],
    // On the truck map follows from the geofence code.
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
  'inspection-items': {
    table: 'inspection_items',
    one: 'inspectionItem',
    name: { key: 'label', column: 'label', missing: 'Write what the Driver checks.', taken: 'There is already an item with this wording.' },
    fields: [{ key: 'optional', column: 'optional', kind: 'flag', message: 'Choose optional or not.' }],
  },
};

/** The longest a list entry's name or other text may be. */
export const TEXT_LIMIT = 100;

export function isList(route: string): route is ListName {
  return Object.hasOwn(LISTS, route);
}

/** Whether Dave puts this list in his own order (its table has sort_order). */
const isOrdered = (list: ListName) => (ORDERED_LISTS as readonly ListName[]).includes(list);

/** Whether an entry with this id is in the list and still in use. */
export async function isActive(env: Env, list: ListName, id: string): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 FROM ${LISTS[list].table} WHERE id = ? AND active = 1`).bind(id).first());
}

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
 * Puts an entry (just added or brought back) last in an ordered list, after
 * every other entry, and after any added before it: run in the same batch,
 * right after the write that adds it or brings it back. Entries still without
 * an order would otherwise come after it by name, so first every other entry
 * is numbered in the order the list is read now (nothing moves), then this one
 * takes the number after the highest. A list Dave does not order needs nothing.
 */
export function goLast(env: Env, list: ListName, id: string): D1PreparedStatement[] {
  if (!isOrdered(list)) return [];
  const { table } = LISTS[list];
  return [
    env.DB.prepare(
      `UPDATE ${table} SET sort_order = (SELECT n FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY ${listOrder(list)}) AS n FROM ${table} WHERE id IS NOT ?1) AS numbered WHERE numbered.id = ${table}.id)
        WHERE id IS NOT ?1 AND EXISTS (SELECT 1 FROM ${table} WHERE sort_order IS NULL AND id IS NOT ?1)`,
    ).bind(id),
    env.DB.prepare(`UPDATE ${table} SET sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ${table} WHERE id IS NOT ?1) WHERE id = ?1`).bind(id),
  ];
}

/**
 * Makes a removed entry active again. In an ordered list it loses its old
 * place and goes last, since the list may have been reordered without it.
 */
export function bringBack(env: Env, list: ListName, id: string): D1PreparedStatement[] {
  const { table } = LISTS[list];
  return [env.DB.prepare(`UPDATE ${table} SET active = 1 WHERE id = ? AND active = 0`).bind(id), ...goLast(env, list, id)];
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

/** SQLite has no booleans: active, each flag and each fact come back as 1 or 0. */
function entry(list: ListName, row: Record<string, unknown>) {
  const { fields, facts = [] } = LISTS[list];
  const booleans = [...fields.filter((f) => f.kind === 'flag'), ...facts].map((f) => [f.key, row[f.key] === 1]);
  return { ...row, ...Object.fromEntries(booleans), active: row.active === 1 };
}

/** One column of a saved entry, read for a rule that depends on it. */
async function columnOf(env: Env, list: ListName, id: string, column: string): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT ${column} AS value FROM ${LISTS[list].table} WHERE id = ?`).bind(id).first<{ value: unknown }>();
  return row?.value ?? null;
}

async function read(env: Env, list: ListName, includeInactive: boolean): Promise<Response> {
  const { results } = await env.DB.prepare(`${select(list)} ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY ${listOrder(list)}`).all<Record<string, unknown>>();
  return json({ [list]: results.map((row) => entry(list, row)) });
}

/** Adds an entry (id null), or brings back the removed one with its name, or changes the given fields of one. */
async function save(request: Request, env: Env, list: ListName, id: string | null): Promise<Response> {
  const spec = LISTS[list];
  if (id !== null && !(await exists(env, list, id))) return json({ error: 'not_found' }, 404);
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  const adding = id === null;

  const errors: Record<string, string> = {};
  const values: Record<string, string | number | null> = {};
  /** The removed entry this add brings back, when it has the name sent. */
  let revived: string | null = null;

  if (adding || spec.name.key in body) {
    const name = text(body[spec.name.key]);
    if (!name) errors[spec.name.key] = spec.name.missing;
    else if (name.length > TEXT_LIMIT) errors[spec.name.key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else {
      const named = await entryNamed(env, list, name);
      if (named && named.id !== id && (named.active || !adding)) errors[spec.name.key] = spec.name.taken;
      else {
        values[spec.name.column] = name;
        // Adding a removed entry's name brings that entry back instead (as typing it on an Assignment does).
        if (adding && named) revived = named.id;
      }
    }
  }

  for (const field of spec.fields) {
    if (!(field.key in body)) continue;
    const raw = body[field.key];
    if (field.kind === 'flag') {
      if (typeof raw !== 'boolean') errors[field.key] = field.message;
      else values[field.column] = raw ? 1 : 0;
      continue;
    }
    if (raw != null && typeof raw !== 'string') {
      errors[field.key] = field.kind === 'text' ? 'Write it as text.' : field.message;
      continue;
    }
    const value = text(raw) || null;
    if (field.kind === 'text' && value && value.length > TEXT_LIMIT) errors[field.key] = `Keep it to ${TEXT_LIMIT} characters or fewer.`;
    else if (field.kind === 'ref' && value && !(await exists(env, field.list, value))) errors[field.key] = field.message;
    else if (field.kind === 'ref' && value && field.removed && !(await isActive(env, field.list, value))) errors[field.key] = field.removed;
    else if (field.kind === 'choice' && value && !field.choices.includes(value)) errors[field.key] = field.message;
    else values[field.column] = value;
  }

  for (const field of spec.fields) {
    if (field.kind !== 'ref' || !field.onlyWhen || errors[field.key]) continue;
    const { column, value, message } = field.onlyWhen;
    const changing = column in values;
    const now = changing ? values[column] : id === null ? null : await columnOf(env, list, id, column);
    if (now === value) continue;
    if (values[field.column] != null) errors[field.key] = message;
    else if (changing) values[field.column] = null;
  }

  if ('active' in body) {
    if (typeof body.active !== 'boolean') errors.active = 'Choose active or inactive.';
    else values.active = body.active ? 1 : 0;
  }

  // A field unique among active entries: checked on what the entry will hold once saved,
  // so bringing a removed entry back is refused too when another active entry has its value now.
  for (const field of spec.fields) {
    if (field.kind !== 'text' || !field.uniqueAmongActive || errors[field.key]) continue;
    const own = id ?? revived;
    const value = field.column in values ? values[field.column] : own === null ? null : await columnOf(env, list, own, field.column);
    const active = 'active' in values ? values.active : adding ? 1 : await columnOf(env, list, own!, 'active');
    if (value == null || active !== 1) continue;
    const holder = await env.DB.prepare(
      `SELECT ${spec.name.column} AS name FROM ${spec.table} WHERE ${field.column} = ? COLLATE NOCASE AND active = 1 AND id IS NOT ?`,
    )
      .bind(value, own)
      .first<{ name: string }>();
    if (holder) errors[field.key] = field.uniqueAmongActive(holder.name);
  }

  if (Object.keys(errors).length > 0) return refuse(errors);

  // Brought back in use, with the fields sent; the ones left out stay as they were.
  if (revived) values.active = 1;
  const columns = Object.keys(values);
  const savedId = id ?? revived ?? crypto.randomUUID();
  try {
    if (adding && !revived) {
      // A new entry goes last, in the same batch, so it is never saved without its place.
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO ${spec.table} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`).bind(savedId, ...Object.values(values)),
        ...goLast(env, list, savedId),
      ]);
    } else if (columns.length > 0) {
      // Brought back (active from 0 to 1): it goes last, as bringBack does; one already active keeps its place.
      const comingBack = values.active === 1 && !(await isActive(env, list, savedId));
      await env.DB.batch([
        env.DB.prepare(`UPDATE ${spec.table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(values), savedId),
        ...(comingBack ? goLast(env, list, savedId) : []),
      ]);
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
  return json({ [spec.one]: saved && entry(list, saved), ...(revived && { broughtBack: true }) }, adding && !revived ? 201 : 200);
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
