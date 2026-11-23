import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AssignmentTripPart } from '../../shared/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * An Assignment's Trip part, when there is anything to show of it: once the
 * Truck has a Trip on it. Without a Trip part, or before its first Trip,
 * null, so the block and the card look as they always have.
 */
export function shownTripPart(trips: AssignmentTripPart | undefined): (AssignmentTripPart & { status: 'now' | 'done' }) | null {
  return trips && trips.status !== 'none' ? { ...trips, status: trips.status } : null;
}

/** "1 Load", "4 Loads". */
export const loadsText = (loads: number) => `${loads} ${loads === 1 ? 'Load' : 'Loads'}`;

/** How a cancelled Assignment's words look everywhere (its block, the open Assignment, the Driver's card): struck through and greyed. */
export const cancelledText = 'text-muted-foreground line-through';

/** "Sample Driver A" → "SA": the first letters of a name's first and last words, for its avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] ?? '');
  return (first + last).toUpperCase();
}
