import { Fragment, type ReactNode } from 'react';
import type { Assignment } from '../../shared/types';

/**
 * One Assignment as one short line on a Driver's card, built from whatever is
 * set, parts joined by " · ". For now that is the note and the Truck; Places,
 * Material and Foreman join the line as the Assignment gains them.
 */
export function AssignmentLine({ assignment }: { assignment: Assignment }) {
  const parts: ReactNode[] = [];
  if (assignment.note) parts.push(<span className="whitespace-pre-line">{assignment.note}</span>);
  if (assignment.truckNumber) parts.push(<span className="text-muted-foreground">Truck {assignment.truckNumber}</span>);

  return (
    <li className="py-2 text-sm">
      {parts.length === 0 ? (
        <span className="text-muted-foreground">No details yet</span>
      ) : (
        parts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            {part}
          </Fragment>
        ))
      )}
    </li>
  );
}
