import { useState, type ReactNode } from 'react';
import { Loader2, Trash2, UserCheck } from 'lucide-react';
import type { Assignment, AssignmentTripPart, SinceSent } from '../../shared/types';
import { easternTime } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { foremanSite } from '@/lib/lists';
import { cancelledText, cn, loadsText, shownTripPart } from '@/lib/utils';

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

/** The mark on a block Changed or Added since it was Assigned: the word, and its colour from the Hub's tokens. */
const MARKS: Record<Exclude<SinceSent, null>, { word: string; className: string }> = {
  changed: { word: 'Changed', className: 'bg-warning text-warning-foreground' },
  added: { word: 'Added', className: 'bg-success text-success-foreground' },
};

/** The mark on a cancelled block, in place of Changed: greyed like the block itself. */
const CANCELLED = { word: 'Cancelled', className: 'border border-muted-foreground/40 bg-background text-muted-foreground' };

/** Now while the Truck is on it, Done once it moved on: from the Trip part, never from Dave or the Driver. */
const TRIP_STATUS: Record<Exclude<AssignmentTripPart['status'], 'none'>, { word: string; className: string }> = {
  now: { word: 'Now', className: 'bg-primary text-primary-foreground' },
  done: { word: 'Done', className: 'bg-muted text-muted-foreground' },
};

/**
 * The Trip part's line, "2 Loads · Now · since 08:24", once the Truck has made a
 * Trip for it; nothing at all before, or when the Worker sends no Trip part,
 * so the block looks as it always has.
 */
function TripLine({ part }: { part: AssignmentTripPart | undefined }) {
  const trips = shownTripPart(part);
  if (!trips) return null;
  const status = TRIP_STATUS[trips.status];
  return (
    <>
      {SEPARATOR}
      <span className="mt-1 flex flex-wrap items-center gap-x-1 text-muted-foreground">
        <span className="font-medium text-foreground">{loadsText(trips.loads)}</span>
        {' · '}
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', status.className)}>{status.word}</span>
        {trips.since && (
          <>
            {' · '}
            <span>since {easternTime(trips.since)}</span>
          </>
        )}
      </span>
    </>
  );
}

/** The mark on a Draft, which its Driver sees nothing of yet: outlined dashed, like the block's frame. */
const DRAFT = { word: 'Draft', className: 'border border-dashed border-muted-foreground/60 text-muted-foreground' };

/**
 * One Assignment as a block in its lane, marked First (the first in the lane that is not cancelled)
 * or Then. It reads "From → To" (or the one Place set), or its note when it
 * has no Places; under that, the Material, the Foreman, the note when it is
 * not already the title, and the Truck. The Assignment's own Foreman is named
 * beside the job site he runs, as in "TIUNY (Brody)" (the drop-off, else the
 * pick-up), and under the title only when neither Place is a job site. A
 * Truck the Assignment names (the work needs a certain one) shows plainly;
 * with none named the Driver takes his own, so his usual Truck shows in grey, read aloud as "(his own)", or
 * nothing when he has none. A Draft (not Assigned yet, so its Driver sees
 * nothing of it) has a dashed outline and is marked Draft beside First or
 * Then; an Assigned one looks plain, marked only once it is Changed or Added
 * since it was Assigned, so Dave sees what the Drivers have had changed. A
 * cancelled one stays in its place, struck through and greyed, marked
 * Cancelled (rather than Changed), as the Driver sees it. With onEdit (today
 * and later days) tapping the block opens or closes the Assignment in its
 * lane; without it (past days) it is plain. With onAssign a Draft that has a
 * Driver also has Assign on the block: one tap, no confirm (ADR 0005). With a
 * Trip part (phase 3) that has Trips, a last line says its Loads so far, Now or
 * Done, and since when ("2 Loads · Now · since 08:24"); without one the block
 * is exactly as before. With onDiscard a cancelled one has Discard in its
 * corner, on any day: one tap clears it off the Board (its Driver still sees
 * it until he dismisses it).
 */
export function AssignmentBlock({
  assignment,
  first,
  usualTruck = null,
  jobSites,
  onEdit,
  onAssign,
  onDiscard,
  open = false,
}: {
  assignment: Assignment;
  first: boolean;
  /** The ids of the Places that are job sites, so the Foreman shows beside his; none while the Places load. */
  jobSites?: ReadonlySet<string>;
  /** The number of the Driver's usual Truck, shown when the Assignment names no Truck. */
  usualTruck?: string | null;
  onEdit?: (assignment: Assignment) => void;
  /** Assigns it; settles once the Worker has answered. Offered only on a Draft with a Driver. */
  onAssign?: (assignment: Assignment) => Promise<void>;
  /** Discards it from the Board; settles once the Worker has answered. Offered only on a cancelled one. */
  onDiscard?: (assignment: Assignment) => Promise<void>;
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
  const draft = assignment.assignedAt === null && !assignment.cancelledAt;
  const mark = assignment.cancelledAt ? CANCELLED : draft ? DRAFT : assignment.sinceSent ? MARKS[assignment.sinceSent] : null;
  const assignable = Boolean(onAssign && draft && assignment.driverId);
  const discardable = Boolean(onDiscard && assignment.cancelledAt);

  const body = (
    <>
      <span className="flex items-center gap-2">
        {/* A cancelled one is off the day, so it is neither First nor Then; its mark says Cancelled. */}
        {!assignment.cancelledAt && <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{first ? 'First' : 'Then'}</span>}
        {mark && (
          <>
            {!assignment.cancelledAt && SEPARATOR}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', mark.className)}>{mark.word}</span>
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
      <TripLine part={assignment.trips} />
    </>
  );
  // A corner button (Assign or Discard) sits in the frame's last row, so only a block that has one is taller.
  const cornered = assignable || discardable;
  const frame = cn(
    'block h-full w-full rounded-md border bg-background px-3 py-2.5 text-left text-sm shadow-xs',
    draft && 'border-dashed border-muted-foreground/50',
    cornered && 'pb-16',
    // Its words are struck through on their own; the frame is only greyed, so the Cancelled mark stays readable.
    assignment.cancelledAt && 'bg-muted/60 text-muted-foreground shadow-none',
  );
  const discard = discardable && onDiscard && (
    <CornerButton label={`Discard ${words}`} variant="outline" icon={Trash2} word="Discard" onTap={() => onDiscard(assignment)} />
  );
  if (!onEdit)
    return discard ? (
      <li className="relative h-full animate-rise">
        <div className={frame}>{body}</div>
        {discard}
      </li>
    ) : (
      <li className={cn(frame, 'animate-rise')}>{body}</li>
    );
  return (
    <li className="relative h-full animate-rise">
      <button
        type="button"
        aria-label={`Edit ${words}${mark ? ` · ${mark.word}` : ''}`}
        aria-expanded={open}
        className={cn(
          frame,
          'lift flex flex-col items-stretch justify-start hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'border-primary shadow-glow hover:border-primary',
        )}
        onClick={() => onEdit(assignment)}
      >
        {body}
      </button>
      {assignable && onAssign && <CornerButton label={`Assign ${words}`} icon={UserCheck} word="Assign" onTap={() => onAssign(assignment)} />}
      {discard}
    </li>
  );
}

/** Assign on a Draft's block, or Discard on a cancelled one, in its corner: busy until the Worker answers. */
function CornerButton({
  label,
  word,
  icon: Icon,
  variant = 'default',
  onTap,
}: {
  label: string;
  word: string;
  icon: typeof UserCheck;
  variant?: 'default' | 'outline';
  onTap: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function tap() {
    setBusy(true);
    try {
      await onTap();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" size="sm" variant={variant} aria-label={label} className="absolute bottom-2 right-2 h-11 px-4" disabled={busy} onClick={tap}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} {word}
    </Button>
  );
}
