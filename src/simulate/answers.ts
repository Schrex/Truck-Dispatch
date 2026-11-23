/**
 * Dave's answers to the simulation's Unplanned work, as the page holds them
 * in memory, and how they become the Trip builder's inputs. Nothing is saved.
 */
import type { MadeAssignment, UnplannedAnswers, UnplannedWork } from '../../shared/trips';

/** "Make an Assignment": where the Truck loaded (one of the piece's Places) and what it hauled. */
export interface MakeAnAssignment {
  kind: 'make';
  /** The Unplanned work it answers (UnplannedWork.id). */
  unplannedId: string;
  /** The Place where it loaded: the made Assignment's Pick up. */
  loadedAt: string;
  materialName: string;
  /** Who was driving, when the Truck log asked and Dave picked (#77): the made Assignment is that Driver's. */
  driverId?: string;
}

/** One answer to one piece of Unplanned work. #76 and #77 add their kinds to this union. */
export type UnplannedAnswer = MakeAnAssignment;

/** A made Assignment as the simulation plans it: what the Trip builder matches, and its Material. */
export type PlannedMadeAssignment = MadeAssignment & { materialName: string; driverId: string; truckId?: string | null };

/**
 * Where a made Assignment drops off: where the piece went next after the
 * Place Dave says it loaded at; failing that, the piece's first other Place.
 */
function dropOff(work: UnplannedWork, loadedAt: string): string | null {
  const next = work.trips.find((t) => t.fromPlaceId === loadedAt && t.toPlaceId !== loadedAt)?.toPlaceId;
  return next ?? work.places.find((p) => p.placeId && p.placeId !== loadedAt)?.placeId ?? null;
}

/**
 * The Trip builder's inputs for Dave's answers. `pieces` is the whole day's
 * Unplanned work, before any answer, so an answer keeps its route whatever
 * the clock shows. Made Assignments are labelled after Dave's planned ones
 * (A3 after A1 and A2). `splits` are the Trips Dave split runs at (#77),
 * already applied to `pieces`. A made Assignment is the Driver's Dave
 * picked under "Who was driving?", else `driverId`, the Truck's Driver; the
 * last Driver picked is the answer to "Who was driving?" (`drivenBy`).
 */
export function tripAnswers(
  answers: UnplannedAnswer[],
  pieces: UnplannedWork[],
  plannedCount: number,
  driverId: string,
  splits: string[] = [],
): { input: UnplannedAnswers; made: PlannedMadeAssignment[]; drivenBy: string | null } {
  const made: PlannedMadeAssignment[] = [];
  const drivenBy = answers.flatMap((a) => (a.kind === 'make' && a.driverId ? [a.driverId] : [])).at(-1) ?? null;
  for (const answer of answers) {
    if (answer.kind !== 'make') continue;
    const work = pieces.find((w) => w.id === answer.unplannedId);
    if (!work) continue;
    made.push({
      id: `made-${answer.unplannedId}`,
      label: `A${plannedCount + made.length + 1}`,
      fromPlaceId: answer.loadedAt,
      toPlaceId: dropOff(work, answer.loadedAt),
      cancelledAt: null,
      changes: [],
      unplannedId: answer.unplannedId,
      materialName: answer.materialName,
      driverId: answer.driverId ?? drivenBy ?? driverId,
    });
  }
  return { input: { madeAssignments: made, splits }, made, drivenBy };
}
