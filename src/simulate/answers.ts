/**
 * Dave's answers to the simulation's Unplanned work, as the page holds them
 * in memory, and how they become the Trip builder's inputs. Nothing is saved.
 */
import type { MadeAssignment, NotAHaul, UnplannedAnswers, UnplannedLink, UnplannedWork } from '../../shared/trips';

/** What every answer names: the piece it answers, and who was driving. */
interface AnswerTo {
  /** The Unplanned work it answers (UnplannedWork.id). */
  unplannedId: string;
  /**
   * Who was driving, when the Truck log asked and Dave picked (#77): it
   * answers "Who was driving?" too, and a made or linked Assignment is that Driver's.
   */
  driverId?: string;
}

/** An answer that says where the Truck loaded: one of the piece's Places. */
interface LoadedAt extends AnswerTo {
  /** The Place where it loaded: the Assignment's Pick up from the piece's first Trip on. */
  loadedAt: string;
}

/** "Make an Assignment": where the Truck loaded and what it hauled. */
export interface MakeAnAssignment extends LoadedAt {
  kind: 'make';
  materialName: string;
}

/** "Link to an Assignment": which of the Driver's Assignments that day it was, and where the Truck loaded. */
export interface LinkToAnAssignment extends LoadedAt {
  kind: 'link';
  assignmentId: string;
}

/** "Not a haul": fuel, a repair, personal; the note is optional. */
export interface NotAHaulAnswer extends AnswerTo {
  kind: 'not_a_haul';
  note: string | null;
}

/** One answer to one piece of Unplanned work. A split (#77) is not an answer: the page keeps splits apart. */
export type UnplannedAnswer = MakeAnAssignment | LinkToAnAssignment | NotAHaulAnswer;

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
  const drivenBy = answers.flatMap((a) => (a.driverId ? [a.driverId] : [])).at(-1) ?? null;
  const links: UnplannedLink[] = [];
  const notHauls: NotAHaul[] = [];
  for (const answer of answers) {
    const work = pieces.find((w) => w.id === answer.unplannedId);
    if (!work) continue;
    if (answer.kind === 'not_a_haul') {
      notHauls.push({ unplannedId: answer.unplannedId, note: answer.note });
      continue;
    }
    if (answer.kind === 'link') {
      // Its load Place as in Make an Assignment: From where it loaded, To where the piece went next.
      links.push({ unplannedId: answer.unplannedId, assignmentId: answer.assignmentId, fromPlaceId: answer.loadedAt, toPlaceId: dropOff(work, answer.loadedAt) });
      continue;
    }
    if (answer.kind !== 'make') continue;
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
  return { input: { madeAssignments: made, links, notHauls, splits }, made, drivenBy };
}
