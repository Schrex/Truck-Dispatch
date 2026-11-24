import { useState, type CSSProperties } from 'react';
import { Loader2, X } from 'lucide-react';
import { WORK_FIELD_WORDS, WORK_FIELDS, WORK_WORDS, type AssignmentTripPart, type DriverAssignment, type SinceSent, type Was, type Work, type WorkField } from '../../shared/types';
import { easternTime } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { CUSTOMER_TAG, forLine, KIND_PILL, WORK_PILL } from '@/components/AssignmentBlock';
import { cn, tripWords } from '@/lib/utils';

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

/** Each field only some kinds show, by its "was" and the word for it in the Changed line. */
const HIDDEN_WAS = [
  { field: 'for', key: 'forName' },
  { field: 'at', key: 'atPlaceName' },
  { field: 'material', key: 'materialName' },
  { field: 'machine', key: 'machine' },
  { field: 'from', key: 'fromPlaceName' },
  { field: 'to', key: 'toPlaceName' },
] as const satisfies readonly { field: WorkField; key: keyof Was }[];

/** A field's word at the start of a part: "Machine was D6". */
const leading = (field: WorkField) => `${WORK_FIELD_WORDS[field].charAt(0).toUpperCase()}${WORK_FIELD_WORDS[field].slice(1)}`;

/**
 * What Dave changed that the card no longer shows, for the Changed line: the
 * kind it was ("was Haul"), then each field its kind does not show ("Material
 * was Sample Stone", after a Haul became a Move). Null when there is none.
 */
function hiddenWas(work: Work, was: Was): string | null {
  const shown: readonly string[] = WORK_FIELDS[work];
  const parts = [
    was.work !== undefined && was.work !== work ? `was ${WORK_WORDS[was.work ?? 'haul']}` : null,
    ...HIDDEN_WAS.filter(({ field, key }) => !shown.includes(field) && key in was).map(({ field, key }) => `${leading(field)} was ${was[key] ?? 'empty'}`),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
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
function TripLine({ part, work }: { part: AssignmentTripPart | undefined; work: Work }) {
  const shown = tripWords(part, work);
  if (!shown) return null;
  const { trips, loads, moved, hours } = shown;
  const words = loads ? `${loads}${trips.lastLoadAt ? ` · last ${easternTime(trips.lastLoadAt)}` : ''}` : (moved ?? hours);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-lg">
      {trips.status === 'now' && <span className="rounded bg-primary px-2 py-0.5 text-base font-semibold text-primary-foreground">Now</span>}
      {words && <span className="font-medium">{words}</span>}
    </p>
  );
}

/**
 * One of a Driver's Assignments, large enough to read from the cab: whom it is
 * for first, "Haul for Ed" (with "Customer" under it for a Customer; none when
 * For is blank), then At (only when set), the Material, Pick up and Drop off, the note, which Truck when it is not his
 * own, and Dave's changes since Assigning it. A Move leads with its machine, then
 * From and To; an Other is its text in large type: Changed (with what it was), Added,
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
  const { materialName, fromPlaceName, toPlaceName, atPlaceName, note, cancelledAt, sinceSent, was, work, machine } = assignment;
  const move = work === 'move';
  // Other is its text alone (its note), in large type.
  const other = work === 'other';
  const forWho = forLine(assignment);
  // What Dave changed that this kind of card does not show goes in the Changed line.
  const hidden = sinceSent === 'changed' && !cancelledAt ? hiddenWas(work, was) : null;
  const mark = cancelledAt ? CANCELLED : sinceSent && MARKS[sinceSent];
  const truck = truckLine(assignment);
  const struck = cancelledAt && 'line-through';
  return (
    <article
      aria-label={(move ? machine : other ? note : materialName) ?? 'Assignment'}
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
      {/* Its place in his day and its kind: the kind is the pill only, never the edge. */}
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
        <span>{index + 1} ·</span>
        <span className={cn(KIND_PILL, 'text-[11px]', WORK_PILL[work])}>{WORK_WORDS[work]}</span>
      </p>
      {mark && (
        <div className="mb-3">
          <p className={cn('inline-block rounded-full px-3 py-1.5 text-base font-semibold shadow-xs', mark.className)}>{mark.word}</p>
          {hidden && <p className="mt-1 text-sm text-muted-foreground">{hidden}</p>}
        </div>
      )}
      {/* On a cancelled card the values are struck through, not the labels beside them. */}
      <div className={cn('space-y-3', cancelledAt && 'text-muted-foreground')}>
        <TripLine part={assignment.trips} work={work} />
        {other ? (
          <p className={cn('whitespace-pre-line text-2xl font-bold', struck)}>
            {note ?? 'Nothing written'}
            <Was value={was.note} />
          </p>
        ) : move ? (
          <>
            <p className={cn('text-2xl font-bold', struck)}>
              {machine ?? 'No machine named'}
              <Was value={was.machine} />
            </p>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-lg">
              <Line label="From" value={fromPlaceName} was={was} wasKey="fromPlaceName" struck={struck} />
              <Line label="To" value={toPlaceName} was={was} wasKey="toPlaceName" struck={struck} />
            </dl>
          </>
        ) : (
          <>
            {(forWho || 'forName' in was) && (
              <div>
                <p className={cn('text-2xl font-bold', struck)}>Haul for {forWho?.name ?? 'no one named'}</p>
                {forWho?.customer && <span className={cn('mt-1 inline-block', CUSTOMER_TAG.className)}>{CUSTOMER_TAG.word}</span>}
                <Was value={was.forName} />
              </div>
            )}
            {(atPlaceName || 'atPlaceName' in was) && (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-lg">
                <Line label="At" value={atPlaceName} was={was} wasKey="atPlaceName" struck={struck} />
              </dl>
            )}
            {(materialName || 'materialName' in was) && (
              <p className={cn('text-2xl font-semibold', struck)}>
                {materialName ?? 'No Material named'}
                <Was value={was.materialName} />
              </p>
            )}
            <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-lg">
              <Line label="Pick up" value={fromPlaceName} was={was} wasKey="fromPlaceName" struck={struck} />
              <Line label="Drop off" value={toPlaceName} was={was} wasKey="toPlaceName" struck={struck} />
            </dl>
          </>
        )}
        {!other && (note || 'note' in was) && (
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

/** A labelled line of a card, only when it is set or Dave changed it after Assigning it (then with what it was). */
function Line({
  label,
  value,
  was,
  wasKey,
  struck,
}: {
  label: string;
  value: string | null;
  was: Was;
  wasKey: 'fromPlaceName' | 'toPlaceName' | 'atPlaceName';
  struck: string | null | false;
}) {
  if (!value && !(wasKey in was)) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium', struck)}>{value ?? '–'}</dd>
      {wasKey in was && (
        <dd className="col-start-2 -mt-2">
          <Was value={was[wasKey]} />
        </dd>
      )}
    </>
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
