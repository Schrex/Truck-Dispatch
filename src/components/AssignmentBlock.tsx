import type { ReactNode } from 'react';
import type { Assignment } from '../../shared/types';
import { cn } from '@/lib/utils';

/**
 * Read aloud and in tests the parts of a block run together as one line
 * ("First · Sample Plant → Sample Site North · Truck 24"); on screen each part
 * sits on its own line, so the separator is for screen readers only.
 */
const SEPARATOR = <span className="sr-only"> · </span>;

/** One part of a block: the words it reads as, and how it shows on screen. */
interface Detail {
  words: string;
  shown: ReactNode;
  /** The Driver's usual Truck, shown because the Assignment names none. */
  hisOwn?: boolean;
}

/**
 * The block's Truck: the one the Assignment names, plainly; with none named,
 * the Driver's usual Truck in grey, since he takes his own; or none at all.
 */
function truckOf(named: string | null, usual: string | null): Detail | null {
  if (named) return { words: `Truck ${named}`, shown: <span className="text-foreground">Truck {named}</span> };
  if (!usual) return null;
  return {
    words: `Truck ${usual} (his own)`,
    hisOwn: true,
    shown: (
      <>
        <span className="text-muted-foreground">Truck {usual}</span>
        <span className="sr-only"> (his own)</span>
      </>
    ),
  };
}

/**
 * One Assignment as a block in its lane, marked First (the first in the lane)
 * or Then. It reads "From → To" (or the one Place set), or its note when it
 * has no Places; under that, the Material, the Foreman, the note when it is
 * not already the title, and the Truck. A Truck the Assignment names (the
 * work needs a certain one) shows plainly; with none named the Driver takes
 * his own, so his usual Truck shows in grey, read aloud as "(his own)", or
 * nothing when he has none. With onEdit (today and later days) the block
 * opens the Assignment; without it (past days) it is plain.
 */
export function AssignmentBlock({
  assignment,
  first,
  usualTruck = null,
  onEdit,
}: {
  assignment: Assignment;
  first: boolean;
  /** The number of the Driver's usual Truck, shown when the Assignment names no Truck. */
  usualTruck?: string | null;
  onEdit?: (assignment: Assignment) => void;
}) {
  const places = [assignment.fromPlaceName, assignment.toPlaceName].filter(Boolean).join(' → ');
  const parts: Detail[] = [
    assignment.materialName,
    assignment.foremanName && `Foreman ${assignment.foremanName}`,
    places && assignment.note,
  ]
    .filter((part): part is string => Boolean(part))
    .map((part) => ({ words: part, shown: part }));
  const truck = truckOf(assignment.truckNumber, usualTruck);
  const details = truck ? [...parts, truck] : parts;
  const headline = places || assignment.note;
  // His own Truck is never the title: an Assignment with nothing else set still has no details yet.
  const title: Detail | null = headline ? { words: headline, shown: headline } : details[0]?.hisOwn ? null : (details.shift() ?? null);
  // The edit button is named by what the Assignment itself says: his own Truck is not part of it, and his lane already names it.
  const words =
    [title, ...details]
      .filter((part) => part && !part.hisOwn)
      .map((part) => part?.words)
      .join(' · ') || 'No details yet';

  const body = (
    <>
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{first ? 'First' : 'Then'}</span>
      {SEPARATOR}
      <span className={cn('block whitespace-pre-line font-medium', !title && 'font-normal text-muted-foreground')}>{title?.shown ?? 'No details yet'}</span>
      {details.length > 0 && (
        <>
          {SEPARATOR}
          <span className="mt-0.5 block whitespace-pre-line text-muted-foreground">
            {details.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part.shown}
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
