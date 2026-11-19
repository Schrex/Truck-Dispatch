import { Fragment, type ReactNode } from 'react';
import type { Assignment } from '../../shared/types';

/**
 * One Assignment as one short line on a Driver's card, built from whatever is
 * set, parts joined by " · ". For now that is the note and the Truck; Places,
 * Material and Foreman join the line as the Assignment gains them. With onEdit
 * (today and later days) the line opens the Assignment; without it (past days)
 * it is plain text.
 */
export function AssignmentLine({ assignment, onEdit }: { assignment: Assignment; onEdit?: (assignment: Assignment) => void }) {
  const parts: { text: string; node: ReactNode }[] = [];
  if (assignment.note) parts.push({ text: assignment.note, node: <span className="whitespace-pre-line">{assignment.note}</span> });
  if (assignment.truckNumber) {
    const truck = `Truck ${assignment.truckNumber}`;
    parts.push({ text: truck, node: <span className="text-muted-foreground">{truck}</span> });
  }

  const text =
    parts.length === 0 ? (
      <span className="text-muted-foreground">No details yet</span>
    ) : (
      parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {part.node}
        </Fragment>
      ))
    );
  if (!onEdit) return <li className="py-2 text-sm">{text}</li>;
  return (
    <li className="text-sm">
      <button
        type="button"
        aria-label={`Edit ${parts.map((part) => part.text).join(' · ') || 'No details yet'}`}
        className="-mx-2 block w-[calc(100%+1rem)] rounded px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onEdit(assignment)}
      >
        {text}
      </button>
    </li>
  );
}
