import type { Assignment } from '../../shared/types';

/**
 * One Assignment as one short line on a Driver's card, built from whatever is
 * set. For now that is the note; Places, Material, Truck and Foreman join the
 * line as the Assignment gains them.
 */
export function AssignmentLine({ assignment }: { assignment: Assignment }) {
  return (
    <li className="py-2 text-sm">
      {assignment.note ? <span className="whitespace-pre-line">{assignment.note}</span> : <span className="text-muted-foreground">No details yet</span>}
    </li>
  );
}
