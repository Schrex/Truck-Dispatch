import { BASE } from '../../shared/base';
import { handleApi } from './api';

export { BASE };

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** local, preview or staging (wrangler.jsonc). */
  ENVIRONMENT?: string;
  /** The deployed commit, set by CI with `--var COMMIT_SHA:<sha>`. */
  COMMIT_SHA?: string;
  /**
   * Fixes the current time (ISO 8601, e.g. 2026-11-19T20:00:00Z). The tests set
   * it; deployed environments leave it unset and use the real clock (clock.ts).
   */
  NOW?: string;
}

export interface Options {
  /** Under Vite's dev server, which serves the pages under BASE itself. */
  devServer?: boolean;
}

/**
 * Answers every request. The app works both at the root (standalone) and under
 * /truck-dispatch/ (forwarded by the Hub, which passes the URL unchanged):
 * the prefix is removed before the API or the page files see the path.
 */
export async function handle(request: Request, env: Env, options: Options = {}): Promise<Response> {
  const url = new URL(request.url);

  // Relative API calls from the page need the trailing slash to stay under the prefix.
  if (url.pathname === BASE) {
    url.pathname = `${BASE}/`;
    return Response.redirect(url.toString(), 301);
  }

  const underBase = url.pathname.startsWith(`${BASE}/`);
  const path = underBase ? url.pathname.slice(BASE.length) : url.pathname;

  if (path.startsWith('/api/')) {
    return withHeaders(await handleApi(request, env, path.slice('/api/'.length), url.searchParams), env);
  }

  if (options.devServer || !underBase) return env.ASSETS.fetch(request);

  url.pathname = path;
  return withHeaders(underPrefix(await env.ASSETS.fetch(new Request(url, request)), url.origin), env);
}

/** Asset redirects (e.g. /index.html to /) go back under the prefix, never to a Hub page. */
function underPrefix(response: Response, origin: string): Response {
  const location = response.headers.get('Location');
  if (!location) return response;
  const target = new URL(location, origin);
  if (target.origin !== origin) return response;
  const moved = new Response(response.body, response);
  moved.headers.set('Location', BASE + target.pathname + target.search + target.hash);
  return moved;
}

/**
 * X-Commit names the version that answered, so the smoke test can tell a reply
 * from the previous version while a deploy spreads (scripts/smoke.mjs).
 */
function withHeaders(response: Response, env: Env): Response {
  const out = new Response(response.body, response);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'same-origin');
  if (env.COMMIT_SHA) out.headers.set('X-Commit', env.COMMIT_SHA);
  return out;
}
