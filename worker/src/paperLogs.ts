import type { Env } from './app';
import { clock } from './clock';
import { json, refuse } from './http';
import { exists } from './lists';
import { isCalendarDate } from '../../shared/days';
import { PAPER_LOG_ATTACHERS, PAPER_LOG_MAX_BYTES, PAPER_LOG_TYPES, type PaperLogDay, type PaperLogPhoto } from '../../shared/types';

/**
 * Paper log (GLOSSARY.md): a photo of the paper Daily Truck Log for one Truck
 * on one day, attached as a backup by its Driver or by Dave. The picture goes
 * to the private photos bucket (env.PHOTOS, R2) and a row says whose it is; a
 * picture is read only through the Worker. A day to come is refused; today
 * and past days are allowed on purpose (a deliberate exception to ADR 0004,
 * still enforced here against US Eastern today).
 *
 *   POST api/paper-logs?id=&date=&truckId=&driverId=&attachedBy=   the picture as the body
 *                                         → 201 { photo }, or 200 { photo } for an id already kept
 *   GET  api/paper-logs?date=[&driverId=] the day's photos, oldest first   → 200 { date, photos }
 *   GET  api/paper-logs/:id/picture       the picture's bytes, cacheable privately for a year
 *   POST api/paper-logs/:id/take-off      Dave hides a wrong photo, kept  → 200 { photo }
 */
export async function handlePaperLogs(request: Request, env: Env, route: string, query: URLSearchParams): Promise<Response | null> {
  const method = request.method;
  const reading = method === 'GET' || method === 'HEAD';

  if (route === 'paper-logs') {
    if (reading) return readDay(env, query.get('date'), query.get('driverId'));
    if (method === 'POST') return attach(request, env, query);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
  }

  const pictureOf = /^paper-logs\/([^/]+)\/picture$/.exec(route);
  if (pictureOf) {
    if (reading) return readPicture(env, decodeURIComponent(pictureOf[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const takingOff = /^paper-logs\/([^/]+)\/take-off$/.exec(route);
  if (takingOff) {
    if (method === 'POST') return takeOff(env, decodeURIComponent(takingOff[1]));
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }

  return null;
}

/** A photo's own columns with its Truck's number and its Driver's name. */
const SELECT_PHOTO = `SELECT p.id, p.date, p.truck_id AS truckId, t.number AS truckNumber, p.driver_id AS driverId, d.name AS driverName,
       p.attached_by AS attachedBy, p.attached_at AS attachedAt, p.content_type AS contentType, p.size, p.taken_off_at AS takenOffAt
  FROM paper_log_photos p JOIN trucks t ON t.id = p.truck_id JOIN drivers d ON d.id = p.driver_id`;

function readPhoto(env: Env, id: string): Promise<PaperLogPhoto | null> {
  return env.DB.prepare(`${SELECT_PHOTO} WHERE p.id = ?`).bind(id).first<PaperLogPhoto>();
}

/** A retried attach of a photo Dave has since taken off. */
const TAKEN_OFF = 'This photo was taken off. Take it again if it is the right sheet.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTACHERS: readonly string[] = PAPER_LOG_ATTACHERS;
const TYPES: readonly string[] = PAPER_LOG_TYPES;

/** Whether the bytes begin as that kind of picture, so a file only named a picture is refused. */
function looksLike(type: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);
  if (type === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
  if (type === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === 'image/webp') {
    const webp = [0x57, 0x45, 0x42, 0x50];
    return starts(0x52, 0x49, 0x46, 0x46) && webp.every((b, i) => bytes[8 + i] === b);
  }
  return false;
}

/**
 * Attaches one photo. An id already kept answers that photo and stores
 * nothing, whatever was sent, so a send retried after a lost reply is kept
 * once; one since taken off is refused, so it never comes back. The picture
 * goes to the bucket first, under a key of its own for this attempt, and the
 * row after, so a row never points at a missing picture, and when the same id
 * arrives twice at once the loser's picture is deleted and the row keeps the
 * winner's.
 */
async function attach(request: Request, env: Env, query: URLSearchParams): Promise<Response> {
  const { now, today } = clock(env);

  const id = query.get('id') ?? '';
  if (!UUID.test(id)) return refuse({ id: 'Take the photo again.' });
  const stored = await readPhoto(env, id);
  if (stored?.takenOffAt) return refuse({ id: TAKEN_OFF });
  if (stored) return json({ photo: stored });

  if (!env.PHOTOS) return refuse({ picture: 'Photos cannot be kept here yet. Give the paper sheet to Dave.' });

  const errors: Record<string, string> = {};
  const date = query.get('date');
  if (!isCalendarDate(date)) errors.date = 'Pick a date.';
  else if (date > today) errors.date = 'A Paper log is for today or a past day.';
  const truckId = query.get('truckId') ?? '';
  if (!truckId || !(await exists(env, 'trucks', truckId))) errors.truckId = 'Pick a Truck from the list.';
  const driverId = query.get('driverId') ?? '';
  if (!driverId || !(await exists(env, 'drivers', driverId))) errors.driverId = 'Pick your name again: this Driver is not in the list.';
  const attachedBy = query.get('attachedBy') ?? '';
  if (!ATTACHERS.includes(attachedBy)) errors.attachedBy = 'Say who attached it: the Driver or Dave.';

  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const declared = Number(request.headers.get('Content-Length'));
  let bytes: Uint8Array | null = null;
  if (!TYPES.includes(type)) errors.picture = 'Send a photo (JPEG, PNG or WebP).';
  else if (declared > PAPER_LOG_MAX_BYTES) errors.picture = 'This photo is too large. Take it again.';
  else {
    bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0) errors.picture = 'The photo was empty. Take it again.';
    else if (bytes.length > PAPER_LOG_MAX_BYTES) errors.picture = 'This photo is too large. Take it again.';
    else if (!looksLike(type, bytes)) errors.picture = 'This file is not a readable photo. Take it again.';
  }

  if (Object.keys(errors).length > 0 || !bytes) return refuse(errors);

  // A key for this attempt alone, so a second send of the same id at once never overwrites the kept picture.
  const key = `paper-logs/${date}/${id}/${crypto.randomUUID()}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    await env.DB.prepare(
      `INSERT INTO paper_log_photos (id, date, truck_id, driver_id, attached_by, attached_at, picture_key, content_type, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, date, truckId, driverId, attachedBy, now.toISOString(), key, type, bytes.length)
      .run();
  } catch (error) {
    // The same send arriving twice at once: the first one kept it, and it stands; this picture is not needed.
    await env.PHOTOS.delete(key);
    if (!String(error).includes('UNIQUE constraint failed: paper_log_photos.id')) throw error;
    const kept = await readPhoto(env, id);
    if (kept?.takenOffAt) return refuse({ id: TAKEN_OFF });
    return json({ photo: kept });
  }
  return json({ photo: await readPhoto(env, id) }, 201);
}

/** A day's photos, oldest first, without the ones taken off; one Driver's when driverId is given. */
async function readDay(env: Env, date: string | null, driverId: string | null): Promise<Response> {
  if (!isCalendarDate(date)) return refuse({ date: 'Pick a date.' });
  const { results: photos } = await env.DB.prepare(
    `${SELECT_PHOTO} WHERE p.date = ? AND p.taken_off_at IS NULL AND (?2 IS NULL OR p.driver_id = ?2) ORDER BY p.attached_at, p.rowid`,
  )
    .bind(date, driverId || null)
    .all<PaperLogPhoto>();
  return json({ date, photos } satisfies PaperLogDay);
}

/**
 * Dave takes a wrong photo off: it is hidden from the day and kept, row and
 * picture. Only the first time is recorded; taking it off again changes nothing.
 */
async function takeOff(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('UPDATE paper_log_photos SET taken_off_at = ? WHERE id = ? AND taken_off_at IS NULL')
    .bind(clock(env).now.toISOString(), id)
    .run();
  const photo = await readPhoto(env, id);
  if (!photo) return json({ error: 'not_found' }, 404);
  return json({ photo });
}

/** A year: a picture never changes once kept. */
const PICTURE_CACHE = 'private, max-age=31536000, immutable';

/** A photo's picture, taken off or not, read from the bucket. */
async function readPicture(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT picture_key AS key, content_type AS type FROM paper_log_photos WHERE id = ?')
    .bind(id)
    .first<{ key: string; type: string }>();
  const object = row && env.PHOTOS ? await env.PHOTOS.get(row.key) : null;
  if (!row || !object) return json({ error: 'not_found' }, 404);
  return new Response(object.body, { headers: { 'Content-Type': row.type, 'Cache-Control': PICTURE_CACHE } });
}
