/**
 * Which view this device opens on (Scheduler or Driver) and which Driver it
 * belongs to, kept only in the browser's storage: nothing about them is saved
 * in the database, and until sign-in anyone can switch. Storage can be
 * missing or refuse (a private window, blocked site data), so every read and
 * write is guarded and the page then simply opens on the Scheduler and asks
 * "Who are you?" again.
 */

export type View = 'scheduler' | 'driver';

const VIEW_KEY = 'truck-dispatch:view';
const DRIVER_KEY = 'truck-dispatch:driver';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not remembered on this device; the page still works for this visit.
  }
}

/** The view this device last chose; the Scheduler until it chooses Driver. */
export function storedView(): View {
  return read(VIEW_KEY) === 'driver' ? 'driver' : 'scheduler';
}

export function storeView(view: View): void {
  write(VIEW_KEY, view);
}

/** The id of the Driver this device belongs to, or null until he says who he is. */
export function storedDriver(): string | null {
  return read(DRIVER_KEY);
}

/** Remembers the Driver ("Who are you?"), or forgets him with null ("Not you?"). */
export function storeDriver(driverId: string | null): void {
  write(DRIVER_KEY, driverId);
}
