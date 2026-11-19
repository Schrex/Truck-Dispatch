import { BASE } from '../../shared/base';

/**
 * Where the app is being served from, read from the address: '/truck-dispatch'
 * under the Hub prefix, '' standalone at the root. Links and API calls start
 * here, so every page stays under the prefix whichever way it was reached.
 */
export function basePath(): string {
  const { pathname } = window.location;
  return pathname === BASE || pathname.startsWith(`${BASE}/`) ? BASE : '';
}
