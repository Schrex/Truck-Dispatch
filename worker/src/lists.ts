import type { Env } from './app';
import { json, readJson, refuse, text } from './http';
import { PLACE_KINDS, type ListName } from '../../shared/types';

/**
 * The lists Settings edits and the Board picks from. Each list has the same
 * three operations, and no delete:
 *
 *   GET   api/<list>                    active entries, by display name
 *   GET   api/<list>?include=inactive   every entry
 *   POST  api/<list>                    add an entry          → 201 { <one>: entry }
 *   PATCH api/<list>/<id>               change any of its fields, including active
 *
 * A list is declared once below: its table, its display name (required and
 * unique in the list, ignoring case) and its other fields. Whether an entry is
 * active matters only to the page's pickers; any entry that exists may be used.
 */

type Field =
  /** Optional free text; empty is saved as null. */
  | { key: string; column: string; kind: 'text' }
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

/** Whether an entry with this id is in the list and still in use. */
async function isActive(env: Env, list: ListName, id: string): Promise<boolean> {
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

export async function handleList(request: Request, env: Env, list: ListName, id: string | undefined, query: URLSearchParams): Promise<Response> {
  const method = request.method;
  if (id === undefined) {
    if (method === 'GET' || method === 'HEAD') return read(env, list, query.get('include') === 'inactive');
    if (method === 'POST') return save(request, env, list, null);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
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
    'active',
  ];
  return `SELECT ${columns.join(', ')} FROM ${table}`;
}

/** SQLite has no booleans: active and each fact come back as 1 or 0. */
function entry(list: ListName, row: Record<string, unknown>) {
  const facts = (LISTS[list].facts ?? []).map((f) => [f.key, row[f.key] === 1]);
  return { ...row, ...Object.fromEntries(facts), active: row.active === 1 };
}

/** One column of a saved entry, read for a rule that depends on it. */
async function columnOf(env: Env, list: ListName, id: string, column: string): Promise<unknown> {
  const row = await env.DB.prepare(`SELECT ${column} AS value FROM ${LISTS[list].table} WHERE id = ?`).bind(id).first<{ value: unknown }>();
  return row?.value ?? null;
}

async function read(env: Env, list: ListName, includeInactive: boolean): Promise<Response> {
  const { name } = LISTS[list];
  const { results } = await env.DB.prepare(
    `${select(list)} ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY ${name.column} COLLATE NOCASE, id`,
  ).all<Record<string, unknown>>();
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

  if (Object.keys(errors).length > 0) return refuse(errors);

  const columns = Object.keys(values);
  const savedId = id ?? crypto.randomUUID();
  try {
    if (adding) {
      await env.DB.prepare(`INSERT INTO ${spec.table} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`)
        .bind(savedId, ...Object.values(values))
        .run();
    } else if (columns.length > 0) {
      await env.DB.prepare(`UPDATE ${spec.table} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
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
