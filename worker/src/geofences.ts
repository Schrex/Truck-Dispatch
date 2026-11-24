import type { Env } from './app';
import { json, readJson, refuse } from './http';
import type { Geofence } from '../../shared/types';

/**
 * Geofences: every geofence code the app knows, each with Dave's Not
 * considered toggle (Settings). An Import adds the codes it brings, considered
 * (fleetImports.ts); HCSS's Location list is loaded once on staging. Nothing
 * here adds or deletes a code. The Trip builder skips the visits to a code
 * turned off (notConsideredCodes).
 *
 *   GET   api/geofences                              → 200 { geofences } by code
 *   PATCH api/geofences/:code  { notConsidered }     → 200 { geofence }
 */
export async function handleGeofences(request: Request, env: Env, route: string): Promise<Response | null> {
  if (route === 'geofences') {
    if (request.method === 'GET' || request.method === 'HEAD') return listGeofences(env.DB);
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }
  const one = /^geofences\/([^/]+)$/.exec(route);
  if (!one) return null;
  if (request.method === 'PATCH') return toggle(request, env.DB, decodeURIComponent(one[1]));
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'PATCH' });
}

type GeofenceRow = { code: string; notConsidered: number };
const asGeofence = (g: GeofenceRow): Geofence => ({ code: g.code, notConsidered: g.notConsidered === 1 });

async function listGeofences(DB: D1Database): Promise<Response> {
  const { results } = await DB.prepare('SELECT code, not_considered AS notConsidered FROM geofences ORDER BY code COLLATE NOCASE').all<GeofenceRow>();
  return json({ geofences: results.map(asGeofence) });
}

/** Turns a code to Not considered or back; the code is matched ignoring case (the column is NOCASE). */
async function toggle(request: Request, DB: D1Database, code: string): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  if (body instanceof Response) return body;
  if (typeof body.notConsidered !== 'boolean') return refuse({ notConsidered: 'Choose considered or not.' });
  const saved = await DB.prepare('UPDATE geofences SET not_considered = ? WHERE code = ? RETURNING code, not_considered AS notConsidered')
    .bind(body.notConsidered ? 1 : 0, code)
    .first<GeofenceRow>();
  if (!saved) return json({ error: 'not_found' }, 404);
  return json({ geofence: asGeofence(saved) });
}

/** The codes turned to Not considered, as the Trip builder takes them. */
export async function notConsideredCodes(DB: D1Database): Promise<string[]> {
  const { results } = await DB.prepare('SELECT code FROM geofences WHERE not_considered = 1 ORDER BY code COLLATE NOCASE').all<{ code: string }>();
  return results.map((r) => r.code);
}
