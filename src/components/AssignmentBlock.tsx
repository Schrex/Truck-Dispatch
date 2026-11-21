import type { Assignment } from '../../shared/types';
import { cn } from '@/lib/utils';

/**
 * Read aloud and in tests the parts of a block run together as one line
 * ("First · Sample Plant → Sample Site North · Truck 24"); on screen each part
 * sits on its own line, so the separator is for screen readers only.
 */
const SEPARATOR = <span className="sr-only"> · </span>;

/**
 * One Assignment as a block in its lane, marked First (the first in the lane)
 * or Then. It reads "From → To" (or the one Place set), or its note when it
 * has no Places; under that, the Material, the Foreman, the note when it is
 * not already the title, and the Truck. With onEdit (today and later days)
 * the block opens the Assignment; without it (past days) it is plain.
 */
export function AssignmentBlock({ assignment, first, onEdit }: { assignment: Assignment; first: boolean; onEdit?: (assignment: Assignment) => void }) {
  const places = [assignment.fromPlaceName, assignment.toPlaceName].filter(Boolean).join(' → ');
  const details = [
    assignment.materialName,
    assignment.foremanName && `Foreman ${assignment.foremanName}`,
    places && assignment.note,
    assignment.truckNumber && `Truck ${assignment.truckNumber}`,
  ].filter((part): part is string => Boolean(part));
  const title = places || assignment.note || details.shift() || null;
  const words = [title, ...details].join(' · ') || 'No details yet';

  const body = (
    <>
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{first ? 'First' : 'Then'}</span>
      {SEPARATOR}
      <span className={cn('block whitespace-pre-line font-medium', !title && 'font-normal text-muted-foreground')}>{title ?? 'No details yet'}</span>
      {details.length > 0 && (
        <>
          {SEPARATOR}
          <span className="mt-0.5 block whitespace-pre-line text-muted-foreground">
            {details.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
          </span>
        </>
      )}
    </>
  );
  const frame = 'block w-full rounded-md border bg-background px-3 py-2 text-left text-sm shadow-sm';
  if (!onEdit) return <li className={frame}>{body}</li>;
  return (
    <li>
      <button
        type="button"
        aria-label={`Edit ${words}`}
        className={cn(frame, 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        onClick={() => onEdit(assignment)}
      >
        {body}
      </button>
    </li>
  );
}
