import type { Env } from './app';
import { json } from './http';
import type { Geofence } from '../../shared/types';

/**
 * Geofences: every geofence code the app knows, each with Dave's Not
 * considered toggle (Settings). An Import adds the codes it brings, considered
 * (fleetImports.ts); HCSS's Location list is loaded once on staging. The Trip
 * builder skips the visits to a code turned off (notConsideredCodes).
 *
 *   GET   api/geofences  → 200 { geofences } by code
 */
export async function handleGeofences(request: Request, env: Env, route: string): Promise<Response | null> {
  if (route !== 'geofences') return null;
  if (request.method === 'GET' || request.method === 'HEAD') return listGeofences(env.DB);
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
}

async function listGeofences(DB: D1Database): Promise<Response> {
  const { results } = await DB.prepare('SELECT code, not_considered AS notConsidered FROM geofences ORDER BY code COLLATE NOCASE').all<{ code: string; notConsidered: number }>();
  return json({ geofences: results.map((g) => ({ code: g.code, notConsidered: g.notConsidered === 1 }) satisfies Geofence) });
}
