import { useState, type CSSProperties } from 'react';
import { Loader2, X } from 'lucide-react';
import type { AssignmentTripPart, DriverAssignment, SinceSent } from '../../shared/types';
import { easternTime } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { cn, loadsText, shownTripPart } from '@/lib/utils';

/** Whose changes the Driver is told about: the dispatcher, by name, as he knows him. */
const DISPATCHER = 'Dave';

/** The mark on a card Dave changed or added after Assigning it, in the board's colours for Changed and Added. */
const MARKS: Record<Exclude<SinceSent, null>, { word: string; className: string }> = {
  changed: { word: `Changed by ${DISPATCHER}`, className: 'bg-warning text-warning-foreground' },
  added: { word: `Added by ${DISPATCHER}`, className: 'bg-success text-success-foreground' },
};

/** A cancelled card's mark, which says more to the Driver than Changed: he is not to go. */
const CANCELLED = { word: `Cancelled by ${DISPATCHER}`, className: 'bg-destructive text-destructive-foreground' };

/** "was Cobblestone" under a field Dave changed after Assigning it; "was empty" when it had nothing then. */
function Was({ value }: { value: string | null | undefined }) {
  if (value === undefined) return null;
  return <span className="block text-sm font-normal text-muted-foreground">was {value ?? 'empty'}</span>;
}

/**
 * Which Truck to take, only when it is not the usual: "Take Truck 53 for this
 * one" when Dave named one; and when he changed it after Assigning it, what it was
 * (a Truck, or the Driver's own).
 */
function truckLine({ truckNumber, was }: DriverAssignment): string | null {
  const before = 'truckNumber' in was ? ` (was ${was.truckNumber ? `Truck ${was.truckNumber}` : 'your own Truck'})` : '';
  if (truckNumber) return `Take Truck ${truckNumber} for this one${before}`;
  if (before) return `Take your own Truck${before}`;
  return null;
}

/**
 * The Trip part's line, "4 Loads · last 11:25", with Now on the Assignment he
 * is on now, once the Truck has Trips on it. Without a Trip part, or before its
 * first Trip, nothing: the card looks as it always has.
 */
function TripLine({ part }: { part: AssignmentTripPart | undefined }) {
  const trips = shownTripPart(part);
  if (!trips) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-lg">
      {trips.status === 'now' && <span className="rounded bg-primary px-2 py-0.5 text-base font-semibold text-primary-foreground">Now</span>}
      <span className="font-medium">
        {loadsText(trips.loads)}
        {trips.lastLoadAt && ` · last ${easternTime(trips.lastLoadAt)}`}
      </span>
    </p>
  );
}

/**
 * One of a Driver's Assignments, large enough to read from the cab: the
 * Material, Pick up and Drop off, the Foreman (when there is one), the note, which Truck when it is not his
 * own, and Dave's changes since Assigning it: Changed (with what it was), Added,
 * or cancelled (struck through). When the Assignment has a Trip part, its Loads,
 * the last one's time and Now. With onDismiss a cancelled card has Dismiss in its bottom right corner,
 * which clears it off his day once he has read it.
 */
export function DriverCard({
  assignment,
  index = 0,
  onDismiss,
}: {
  assignment: DriverAssignment;
  /** Its place in his day, so the cards come in one after another. */
  index?: number;
  /** Clears a cancelled card off his day; settles once the Worker has answered. */
  onDismiss?: (assignment: DriverAssignment) => Promise<void>;
}) {
  const { materialName, fromPlaceName, toPlaceName, foremanName, note, cancelledAt, sinceSent, was } = assignment;
  const mark = cancelledAt ? CANCELLED : sinceSent && MARKS[sinceSent];
  const truck = truckLine(assignment);
  const struck = cancelledAt && 'line-through';
  return (
    <article
      aria-label={materialName ?? 'Assignment'}
      style={{ '--i': index } as CSSProperties}
      className={cn(
        'relative animate-rise overflow-hidden rounded-lg border bg-card p-5 pl-6 text-card-foreground shadow-md',
        cancelledAt && 'border-destructive/40 bg-muted shadow-none',
      )}
    >
      {/* The edge colour says at a glance what Dave did: yellow to go, amber Changed, green Added, red cancelled. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1.5',
          cancelledAt ? 'bg-destructive/70' : sinceSent === 'changed' ? 'bg-warning' : sinceSent === 'added' ? 'bg-success' : 'bg-primary',
        )}
      />
      {mark && (
        <div className="mb-3">
          <p className={cn('inline-block rounded-full px-3 py-1.5 text-base font-semibold shadow-xs', mark.className)}>{mark.word}</p>
        </div>
      )}
      {/* On a cancelled card the values are struck through, not the labels beside them. */}
      <div className={cn('space-y-3', cancelledAt && 'text-muted-foreground')}>
        <TripLine part={assignment.trips} />
        <p className={cn('text-2xl font-semibold', struck)}>
          {materialName ?? 'No Material named'}
          <Was value={was.materialName} />
        </p>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-lg">
          <dt className="text-muted-foreground">Pick up</dt>
          <dd className={cn('font-medium', struck)}>{fromPlaceName ?? '–'}</dd>
          {'fromPlaceName' in was && <dd className="col-start-2 -mt-2"><Was value={was.fromPlaceName} /></dd>}
          <dt className="text-muted-foreground">Drop off</dt>
          <dd className={cn('font-medium', struck)}>{toPlaceName ?? '–'}</dd>
          {'toPlaceName' in was && <dd className="col-start-2 -mt-2"><Was value={was.toPlaceName} /></dd>}
          {(foremanName || 'foremanName' in was) && (
            <>
              <dt className="text-muted-foreground">Foreman</dt>
              <dd className={cn('font-medium', struck)}>{foremanName ?? '–'}</dd>
              {'foremanName' in was && <dd className="col-start-2 -mt-2"><Was value={was.foremanName} /></dd>}
            </>
          )}
        </dl>
        {(note || 'note' in was) && (
          <p className={cn('whitespace-pre-line text-lg', struck)}>
            {note}
            <Was value={was.note} />
          </p>
        )}
        {truck && <p className={cn('text-lg font-semibold', struck)}>{truck}</p>}
      </div>
      {/* A card's action sits in its bottom right corner, as on the Board. */}
      {cancelledAt && onDismiss && (
        <div className="mt-4 flex justify-end">
          <DismissButton onDismiss={() => onDismiss(assignment)} />
        </div>
      )}
    </article>
  );
}

/** Dismiss on a cancelled card: large enough to tap from the cab, busy until the Worker answers. */
function DismissButton({ onDismiss }: { onDismiss: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function tap() {
    setBusy(true);
    try {
      await onDismiss();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" variant="outline" size="lg" className="h-11 bg-background px-4 text-base" disabled={busy} onClick={tap}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Dismiss
    </Button>
  );
}
