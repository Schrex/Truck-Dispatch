import type { Assignment } from '../../shared/types';

/**
 * One Assignment as one short line on a Driver's card, built from whatever is
 * set. For now that is the note; Places, Material, Truck and Foreman join the
 * line as the Assignment gains them. With onEdit (today and later days) the
 * line opens the Assignment; without it (past days) it is plain text.
 */
export function AssignmentLine({ assignment, onEdit }: { assignment: Assignment; onEdit?: (assignment: Assignment) => void }) {
  const text = assignment.note ? <span className="whitespace-pre-line">{assignment.note}</span> : <span className="text-muted-foreground">No details yet</span>;
  if (!onEdit) return <li className="py-2 text-sm">{text}</li>;
  return (
    <li className="text-sm">
      <button
        type="button"
        aria-label={`Edit ${assignment.note ?? 'No details yet'}`}
        className="-mx-2 block w-[calc(100%+1rem)] rounded px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onEdit(assignment)}
      >
        {text}
      </button>
    </li>
  );
}
