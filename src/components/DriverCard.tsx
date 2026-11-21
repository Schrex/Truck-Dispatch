import type { DriverAssignment, SinceSent } from '../../shared/types';
import { cancelledText, cn } from '@/lib/utils';

/** Whose changes the Driver is told about: the dispatcher, by name, as he knows him. */
const DISPATCHER = 'Dave';

/** The mark on a card Dave changed or added after Sending, in the board's colours for Changed and Added. */
const MARKS: Record<Exclude<SinceSent, null>, { word: string; className: string }> = {
  changed: { word: `Changed by ${DISPATCHER}`, className: 'bg-warning text-warning-foreground' },
  added: { word: `Added by ${DISPATCHER}`, className: 'bg-success text-success-foreground' },
};

/** A cancelled card's mark, which says more to the Driver than Changed: he is not to go. */
const CANCELLED = { word: `Cancelled by ${DISPATCHER}`, className: 'bg-destructive text-destructive-foreground' };

/** "was Cobblestone" under a field Dave changed after Sending; "was empty" when it had nothing then. */
function Was({ value }: { value: string | null | undefined }) {
  if (value === undefined) return null;
  return <span className="block text-sm font-normal text-muted-foreground">was {value ?? 'empty'}</span>;
}

/**
 * Which Truck to take, only when it is not the usual: "Take Truck 53 for this
 * one" when Dave named one; and when he changed it after Sending, what it was
 * (a Truck, or the Driver's own).
 */
function truckLine({ truckNumber, was }: DriverAssignment): string | null {
  const before = 'truckNumber' in was ? ` (was ${was.truckNumber ? `Truck ${was.truckNumber}` : 'your own Truck'})` : '';
  if (truckNumber) return `Take Truck ${truckNumber} for this one${before}`;
  if (before) return `Take your own Truck${before}`;
  return null;
}

/**
 * One of a Driver's Assignments, large enough to read from the cab: the
 * Material, Pick up and Drop off, the note, which Truck when it is not his
 * own, and Dave's changes since Sending it: Changed (with what it was), Added,
 * or cancelled (struck through).
 */
export function DriverCard({ assignment }: { assignment: DriverAssignment }) {
  const { materialName, fromPlaceName, toPlaceName, note, cancelledAt, sinceSent, was } = assignment;
  const mark = cancelledAt ? CANCELLED : sinceSent && MARKS[sinceSent];
  const truck = truckLine(assignment);
  return (
    <article
      aria-label={materialName ?? 'Assignment'}
      className={cn('rounded-lg border bg-card p-5 text-card-foreground shadow-sm', cancelledAt && 'bg-muted')}
    >
      {mark && <p className={cn('mb-3 inline-block rounded px-2 py-1 text-base font-semibold', mark.className)}>{mark.word}</p>}
      <div className={cn('space-y-3', cancelledAt && cancelledText)}>
        <p className="text-2xl font-semibold">
          {materialName ?? 'No Material named'}
          <Was value={was.materialName} />
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
          <dt className="text-muted-foreground">Pick up</dt>
          <dd className="font-medium">{fromPlaceName ?? '–'}</dd>
          {'fromPlaceName' in was && <dd className="col-start-2 -mt-2"><Was value={was.fromPlaceName} /></dd>}
          <dt className="text-muted-foreground">Drop off</dt>
          <dd className="font-medium">{toPlaceName ?? '–'}</dd>
          {'toPlaceName' in was && <dd className="col-start-2 -mt-2"><Was value={was.toPlaceName} /></dd>}
        </dl>
        {(note || 'note' in was) && (
          <p className="whitespace-pre-line text-lg">
            {note}
            <Was value={was.note} />
          </p>
        )}
        {truck && <p className="text-lg font-semibold">{truck}</p>}
      </div>
    </article>
  );
}
