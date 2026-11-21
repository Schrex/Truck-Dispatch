import type { ReactNode } from 'react';
import type { Assignment, SinceSent } from '../../shared/types';
import { foremanSite } from '@/lib/lists';
import { cancelledText, cn } from '@/lib/utils';

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

/** The mark on a block Changed or Added since its day was Sent: the word, and its colour from the Hub's tokens. */
const MARKS: Record<Exclude<SinceSent, null>, { word: string; className: string }> = {
  changed: { word: 'Changed', className: 'bg-warning text-warning-foreground' },
  added: { word: 'Added', className: 'bg-success text-success-foreground' },
};

/** The mark on a cancelled block, in place of Changed: greyed like the block itself. */
const CANCELLED = { word: 'Cancelled', className: 'bg-muted text-muted-foreground' };

/**
 * One Assignment as a block in its lane, marked First (the first in the lane)
 * or Then. It reads "From → To" (or the one Place set), or its note when it
 * has no Places; under that, the Material, the Foreman, the note when it is
 * not already the title, and the Truck. The Assignment's own Foreman is named
 * beside the job site he runs, as in "TIUNY (Brody)" (the drop-off, else the
 * pick-up), and under the title only when neither Place is a job site. A
 * Truck the Assignment names (the work needs a certain one) shows plainly;
 * with none named the Driver takes his own, so his usual Truck shows in grey, read aloud as "(his own)", or
 * nothing when he has none. Once its day is Sent, a block Changed or Added
 * since is marked so beside First or Then, so Dave sees what the Drivers
 * have had changed. A cancelled one stays in its place, struck through and
 * greyed, marked Cancelled (rather than Changed), as the Driver sees it. With onEdit (today and later days) tapping the block
 * opens or closes the Assignment in its lane; without it (past days) it is plain.
 */
export function AssignmentBlock({
  assignment,
  first,
  usualTruck = null,
  jobSites,
  onEdit,
  open = false,
}: {
  assignment: Assignment;
  first: boolean;
  /** The ids of the Places that are job sites, so the Foreman shows beside his; none while the Places load. */
  jobSites?: ReadonlySet<string>;
  /** The number of the Driver's usual Truck, shown when the Assignment names no Truck. */
  usualTruck?: string | null;
  onEdit?: (assignment: Assignment) => void;
  /** Whether it is open in its lane; tapping it again closes it. */
  open?: boolean;
}) {
  const { fromPlaceId, fromPlaceName, toPlaceId, toPlaceName, foremanName } = assignment;
  const jobSite = (id: string | null, name: string | null) => Boolean(id && name && jobSites?.has(id));
  const site = foremanName ? foremanSite(jobSite(fromPlaceId, fromPlaceName), jobSite(toPlaceId, toPlaceName)) : null;
  const beside = (name: string | null, here: boolean) => (name && here ? `${name} (${foremanName})` : name);
  const places = [beside(fromPlaceName, site === 'from'), beside(toPlaceName, site === 'to')].filter(Boolean).join(' → ');
  const parts: Detail[] = [
    assignment.materialName,
    !site && foremanName && `Foreman ${foremanName}`,
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
  const mark = assignment.cancelledAt ? CANCELLED : assignment.sinceSent ? MARKS[assignment.sinceSent] : null;

  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{first ? 'First' : 'Then'}</span>
        {mark && (
          <>
            {SEPARATOR}
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', mark.className)}>{mark.word}</span>
          </>
        )}
      </span>
      {SEPARATOR}
      <span className={cn('block whitespace-pre-line font-medium', !title && 'font-normal text-muted-foreground', assignment.cancelledAt && cancelledText)}>
        {title?.shown ?? 'No details yet'}
      </span>
      {details.length > 0 && (
        <>
          {SEPARATOR}
          <span className={cn('mt-0.5 block whitespace-pre-line text-muted-foreground', assignment.cancelledAt && cancelledText)}>
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
  const frame = cn('block w-full rounded-md border bg-background px-3 py-2 text-left text-sm shadow-sm', assignment.cancelledAt && [cancelledText, 'opacity-60']);
  if (!onEdit) return <li className={frame}>{body}</li>;
  return (
    <li>
      <button
        type="button"
        aria-label={`Edit ${words}${mark ? ` · ${mark.word}` : ''}`}
        aria-expanded={open}
        className={cn(frame, 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', open && 'border-primary ring-1 ring-primary')}
        onClick={() => onEdit(assignment)}
      >
        {body}
      </button>
    </li>
  );
}
