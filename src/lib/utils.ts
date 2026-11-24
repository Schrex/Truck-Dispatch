import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AssignmentTripPart, Work } from '../../shared/types';
import { easternTime } from '../../shared/days';

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

/** "1 Load", "4 Loads"; "Loads from Tickets" when the Truck cannot count them (an At-only Haul). */
export const loadsText = (loads: number | null) => (loads === null ? 'Loads from Tickets' : `${loads} ${loads === 1 ? 'Load' : 'Loads'}`);

/**
 * What the Truck did on an Assignment, in the words its kind uses, shared by
 * its block and its Driver card: a Haul its Loads ("4 Loads"); a Move none,
 * but "Done 08:15" once its last Move Trip arrived; an Other its Trucking
 * hours ("3.0 h"). Null as shownTripPart is.
 */
export function tripWords(part: AssignmentTripPart | undefined, work: Work) {
  const trips = shownTripPart(part);
  if (!trips) return null;
  return {
    trips,
    loads: work === 'haul' ? loadsText(trips.loads) : null,
    moved: work === 'move' && trips.status === 'done' && trips.movedAt ? `Done ${easternTime(trips.movedAt)}` : null,
    hours: work === 'other' && trips.truckingHours !== null ? `${trips.truckingHours.toFixed(1)} h` : null,
  };
}

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
