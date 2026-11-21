import type { Env } from './app';
import { clock } from './clock';
import { json, readJson, refuse, text } from './http';
import { exists, handleList, isList } from './lists';
import { checkTyped, saveLinked, typedIn, type Typed } from './typedNames';
import { isCalendarDate } from '../../shared/days';
import type { Assignment, BusinessDay, ListName, NewAssignment, TypedNames } from '../../shared/types';

/** The JSON API under /api/ (or /truck-dispatch/api/). */
export async function handleApi(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'health' && reading) {
    return json({ ok: true, environment: env.ENVIRONMENT ?? 'unknown', commit: env.COMMIT_SHA ?? null });
  }

  if (route === 'today' && reading) {
    const { today, tomorrow, nextWorkingDay } = clock(env);
    return json({ today, tomorrow, nextWorkingDay } satisfies BusinessDay);
  }

  const laterOf = /^drivers\/([^/]+)\/later-days$/.exec(route);
  if (laterOf) {
    if (reading) return laterDays(env, decodeURIComponent(laterOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const [list, entryId, ...rest] = route.split('/');
  if (isList(list) && rest.length === 0) return handleList(request, env, list, entryId, query);

  if (route === 'assignments') {
    if (reading) return readDay(env, query.get('date'));
    if (method === 'POST') return addAssignment(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  if (route === 'assignments/copy') {
    if (method === 'POST') return copyDay(request, env);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  const one = /^assignments\/([^/]+)$/.exec(route);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'PUT') return changeAssignment(request, env, id);
    if (method === 'DELETE') return deleteAssignment(env, id);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT, DELETE' });
  }

  if (['health', 'today'].includes(route)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  return json({ error: 'not_found' }, 404);
}

/**
 * How many days after today a Driver has Assignments on, so Settings can warn
 * before he is removed that work is still planned for him.
 */
async function laterDays(env: Env, driverId: string): Promise<Response> {
  if (!(await exists(env, 'drivers', driverId))) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare('SELECT COUNT(DISTINCT date) AS days FROM assignments WHERE driver_id = ? AND date > ?')
    .bind(driverId, clock(env).today)
    .first<{ days: number }>();
  return json({ laterDays: row?.days ?? 0 });
}

/** Each Assignment with the names of its Driver, Truck, Places, Material and Foreman, so the page never has to look them up. */
const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName,
       a.truck_id AS truckId, t.number AS truckNumber,
       a.from_place_id AS fromPlaceId, pf.short_name AS fromPlaceName,
       a.to_place_id AS toPlaceId, pt.short_name AS toPlaceName,
       a.material_id AS materialId, m.name AS materialName,
       a.foreman_id AS foremanId, f.name AS foremanName, a.note,
       a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id LEFT JOIN trucks t ON t.id = a.truck_id
  LEFT JOIN places pf ON pf.id = a.from_place_id LEFT JOIN places pt ON pt.id = a.to_place_id
  LEFT JOIN materials m ON m.id = a.material_id LEFT JOIN foremen f ON f.id = a.foreman_id`;

/** How a day's Assignments are listed: by Driver name, then in the order they were added; those with no Driver last. */
const DAY_ORDER = 'ORDER BY a.driver_id IS NULL, d.name COLLATE NOCASE, a.created_at, a.rowid';

async function readDay(env: Env, date: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const { results } = await env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.date = ? ${DAY_ORDER}`).bind(date).all<Assignment>();
  return json({ assignments: results });
}

/**
 * Columns a copy does not take from its source: a copy is a new Assignment on
 * another day, with an empty note. Every other column, including any a later
 * migration adds, is copied as it is (an inactive entry stays on the copy).
 */
const NOT_COPIED = new Set(['id', 'date', 'note', 'created_at', 'updated_at']);

/**
 * Copies every Assignment on today (by the Worker's clock, never a day the
 * page sends) onto a later day, adding to what that day already has. Answers
 * the new Assignments, in the order a day is read.
 */
async function copyDay(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ to?: unknown }>(request);
  if (body instanceof Response) return body;
  const { today: from, now } = clock(env);
  const to = body.to;
  if (!isCalendarDate(to)) return refuse({ to: 'Pick a day to copy onto.' });
  if (to < from) return refuse({ to: PAST_DATE });
  if (to === from) return refuse({ to: 'Today cannot be copied onto itself. Pick a later day.' });

  const { results: sources } = await env.DB.prepare('SELECT * FROM assignments WHERE date = ? ORDER BY created_at, rowid')
    .bind(from)
    .all<Record<string, unknown>>();
  if (sources.length === 0) return json({ assignments: [] }, 201);

  const createdAt = now.toISOString();
  const ids: string[] = [];
  const inserts = sources.map((source) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const row: Record<string, unknown> = { id, date: to, note: null, created_at: createdAt, updated_at: createdAt };
    for (const [column, value] of Object.entries(source)) if (!NOT_COPIED.has(column)) row[column] = value;
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO assignments (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).bind(...columns.map((c) => row[c]));
  });
  await env.DB.batch(inserts);

  const { results } = await env.DB.prepare(
    `${SELECT_ASSIGNMENT} WHERE a.id IN (SELECT value FROM json_each(?)) ${DAY_ORDER}`,
  )
    .bind(JSON.stringify(ids))
    .all<Assignment>();
  return json({ assignments: results }, 201);
}

async function addAssignment(request: Request, env: Env): Promise<Response> {
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  const id = crypto.randomUUID();
  const now = clock(env).now.toISOString();
  const columns = ['id', ...SAVED_COLUMNS, 'created_at', 'updated_at'];
  await saveLinked(env, read.typed, (typed) =>
    env.DB.prepare(`INSERT INTO assignments (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(id, ...savedValues({ ...read, ...typed }), now, now));
  return json({ assignment: await findAssignment(env, id) }, 201);
}

/** Replaces every field: one left out or empty is cleared. The Assignment may move to another Driver or day. */
async function changeAssignment(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  const read = await readAssignment(request, env);
  if (read instanceof Response) return read;

  await saveLinked(env, read.typed, (typed) =>
    env.DB.prepare(`UPDATE assignments SET ${SAVED_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...savedValues({ ...read, ...typed }), clock(env).now.toISOString(), id));
  return json({ assignment: await findAssignment(env, id) });
}

/** A real delete: nothing of the Assignment is kept. */
async function deleteAssignment(env: Env, id: string): Promise<Response> {
  const existing = await findAssignment(env, id);
  if (!existing) return json({ error: 'not_found' }, 404);
  if (isPast(env, existing.date)) return onPastDay();
  await env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(id).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/** Days before today (US Eastern) are read-only: nothing on them is added, changed, moved or deleted. */
function isPast(env: Env, date: string): boolean {
  return date < clock(env).today;
}

function onPastDay(): Response {
  return json({ error: 'past_day', message: 'This Assignment is on a day before today, which is read-only.' }, 409);
}

function findAssignment(env: Env, id: string): Promise<Assignment | null> {
  return env.DB.prepare(`${SELECT_ASSIGNMENT} WHERE a.id = ?`).bind(id).first<Assignment>();
}

const PICK_PLACE = 'Pick a Place from the list.';

/**
 * An Assignment's references to entries in the lists, declared once: each
 * drives the field's type check, its existence check, and its column in the
 * INSERT and UPDATE. Any entry that exists may be used, active or not.
 */
const REFERENCES = [
  { key: 'driverId', column: 'driver_id', list: 'drivers', message: 'Pick a Driver from the list.' },
  { key: 'truckId', column: 'truck_id', list: 'trucks', message: 'Pick a Truck from the list.' },
  { key: 'fromPlaceId', column: 'from_place_id', list: 'places', message: PICK_PLACE },
  { key: 'toPlaceId', column: 'to_place_id', list: 'places', message: PICK_PLACE },
  { key: 'materialId', column: 'material_id', list: 'materials', message: 'Pick a Material from the list.' },
  { key: 'foremanId', column: 'foreman_id', list: 'foremen', message: 'Pick a Foreman from the list.' },
] as const satisfies readonly { key: keyof NewAssignment; column: string; list: ListName; message: string }[];

type ReferenceKey = (typeof REFERENCES)[number]['key'];

/** A field added to NewAssignment does not compile until it is declared in REFERENCES or handled like date and note. */
type Undeclared = Exclude<keyof NewAssignment, 'date' | 'note' | ReferenceKey>;
const everyFieldDeclared: [Undeclared] extends [never] ? true : Undeclared = true;
void everyFieldDeclared;

/**
 * An Assignment as a request sends it, checked and tidied. A Place or Material
 * it typed by name is linked only when it is saved (see saveLinked).
 */
type ReadAssignment = { date: string; note: string | null; typed: Typed[] } & Record<ReferenceKey, string | null>;

/** The columns adding or changing an Assignment saves, in the order savedValues gives them. */
const SAVED_COLUMNS = ['date', ...REFERENCES.map((r) => r.column), 'note'];

function savedValues(read: ReadAssignment): (string | null)[] {
  return [read.date, ...REFERENCES.map((r) => read[r.key]), read.note];
}

/** The Assignment a request sends, checked and tidied, or the response refusing it. */
async function readAssignment(request: Request, env: Env): Promise<ReadAssignment | Response> {
  const body = await readJson<Partial<NewAssignment & TypedNames>>(request);
  if (body instanceof Response) return body;

  const errors = { ...validate(body), ...checkTyped(body) };
  const ids = Object.fromEntries(REFERENCES.map((r) => [r.key, text(body[r.key]) || null])) as Record<ReferenceKey, string | null>;
  // Every existence check at once, not one after another.
  const found = await Promise.all(REFERENCES.map((r) => {
    const id = ids[r.key];
    return id === null || exists(env, r.list, id);
  }));
  REFERENCES.forEach((r, i) => {
    if (!found[i]) errors[r.key] = r.message;
  });
  if (!errors.date && isPast(env, body.date as string)) errors.date = PAST_DATE;
  if (Object.keys(errors).length > 0) return refuse(errors);
  return { date: body.date as string, ...ids, note: text(body.note) || null, typed: typedIn(body) };
}

const PAST_DATE = 'Days before today are read-only. Pick today or a later day.';

const NOTE_LIMIT = 1000;

/** Field name to a plain message, for each field that is wrong. Fields it does not know are ignored. */
function validate(body: Partial<NewAssignment>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isCalendarDate(body.date)) errors.date = 'Pick a date.';
  for (const r of REFERENCES) if (body[r.key] != null && typeof body[r.key] !== 'string') errors[r.key] = r.message;
  if (body.note != null && typeof body.note !== 'string') errors.note = 'Write the note as text.';
  else if (text(body.note).length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters or fewer.`;
  return errors;
}
