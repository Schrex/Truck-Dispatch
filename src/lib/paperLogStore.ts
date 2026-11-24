import { useSyncExternalStore } from 'react';
import type { PaperLogPhoto } from '../../shared/types';
import { attachPaperLog, FieldErrors, Refused, takeOffPaperLog, type NewPaperLogPhoto } from './api';

/**
 * What this page has done to Paper log photos since it loaded, held above any
 * one Paper log so nothing is lost when it closes or shows another day:
 *
 * - the photos still sending or failed with Try again (an unsent photo stays
 *   until it is kept or refused, and the page warns before it is left);
 * - the photos it attached or took off, in order, so a read that started
 *   before one of them answers with it applied (see `withChangesSince`).
 */

/** A photo the Worker has not kept yet: sending, or failed with Try again (the same id, the same picture). */
export interface Sending {
  photo: NewPaperLogPhoto;
  picture: Blob;
  failed: boolean;
}

/** A photo attached or taken off here, numbered in the order it happened. */
interface Change {
  at: number;
  photo: PaperLogPhoto;
  takenOff: boolean;
}

let version = 0;
let sends: Sending[] = [];
let changes: Change[] = [];
/** The last refusal for each attacher's Driver, by `${attacher} ${driverId}`. */
let refusals: Record<string, string> = {};
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders on any change here; answers the moment now, for `withChangesSince`. */
export function usePaperLogChanges(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** The moment now, taken as a read starts. */
export function paperLogMoment(): number {
  return version;
}

/**
 * A read's photos with what was attached or taken off here since `since`
 * applied, so a read that crossed one never drops a photo just kept or brings
 * back one just taken off. Only the read's date (and Driver, when given).
 */
export function withChangesSince(photos: PaperLogPhoto[], since: number, date: string, driverId?: string): PaperLogPhoto[] {
  let shown = photos;
  for (const change of changes) {
    if (change.at <= since || change.photo.date !== date || (driverId && change.photo.driverId !== driverId)) continue;
    shown = shown.filter((p) => p.id !== change.photo.id);
    if (!change.takenOff) shown = [...shown, change.photo];
  }
  return shown;
}

function record(photo: PaperLogPhoto, takenOff: boolean) {
  changes = [...changes, { at: version + 1, photo, takenOff }];
}

/** Every photo not yet kept that this attacher sent for this Driver, any day. */
export function unsent(driverId: string, attacher: string): Sending[] {
  return sends.filter((s) => s.photo.driverId === driverId && s.photo.attachedBy === attacher);
}

export function refusalFor(driverId: string, attacher: string): string | null {
  return refusals[`${attacher} ${driverId}`] ?? null;
}

export function sayRefused(driverId: string, attacher: string, message: string | null) {
  const key = `${attacher} ${driverId}`;
  if ((refusals[key] ?? null) === message) return;
  refusals = { ...refusals };
  if (message === null) delete refusals[key];
  else refusals[key] = message;
  changed();
}

/**
 * Sends one photo (again, for Try again: the same id and picture, so it is
 * kept once). Kept, it leaves the unsent ones and joins the changes; refused,
 * it leaves them and the Worker's message is kept for its Driver; failed, it
 * stays with Try again.
 */
export async function sendPaperLog(attempt: Sending): Promise<void> {
  const { photo } = attempt;
  sayRefused(photo.driverId, photo.attachedBy, null);
  sends = [...sends.filter((s) => s.photo.id !== photo.id), { ...attempt, failed: false }];
  changed();
  try {
    const kept = await attachPaperLog(photo, attempt.picture);
    sends = sends.filter((s) => s.photo.id !== photo.id);
    record(kept, false);
    changed();
  } catch (error) {
    if (error instanceof FieldErrors || error instanceof Refused) {
      sends = sends.filter((s) => s.photo.id !== photo.id);
      changed();
      sayRefused(photo.driverId, photo.attachedBy, error instanceof FieldErrors ? (Object.values(error.fields)[0] ?? 'This photo was not kept. Take it again.') : error.message);
      return;
    }
    sends = sends.map((s) => (s.photo.id === photo.id ? { ...s, failed: true } : s));
    changed();
  }
}

/** Dave takes a photo off; it then leaves every list here. Throws when the Worker does not have it. */
export async function takeOffPhoto(photo: PaperLogPhoto): Promise<void> {
  await takeOffPaperLog(photo.id);
  record(photo, true);
  changed();
}

// Leaving the page (a reload, closing the tab) while a photo is unsent asks first.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (sends.length === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/** Forgets everything, for tests. */
export function forgetPaperLogs() {
  sends = [];
  changes = [];
  refusals = {};
  changed();
}
