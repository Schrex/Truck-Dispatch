import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2, X } from 'lucide-react';
import { NOTE_LIMIT, type Assignment, type AssignmentChange, type ChangedAssignment, type Driver, type Foreman, type Material, type Place, type Truck, type TypedNames } from '../../shared/types';
import { chipClass, OrTypeIt, TypedBox } from '@/components/TypedName';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { changeAssignment, FieldErrors, moveAssignment, Refused } from '@/lib/api';
import { cancelledText, cn } from '@/lib/utils';

/** Every entry of each list, inactive ones included, so a part that uses one still shows it; null while loading. */
export interface EditorLists {
  drivers: Driver[] | null;
  trucks: Truck[] | null;
  places: Place[] | null;
  materials: Material[] | null;
  foremen: Foreman[] | null;
}

/** A part of the sentence that is picked from a list. */
type PartKey = 'driverId' | 'materialId' | 'fromPlaceId' | 'toPlaceId' | 'truckId' | 'foremanId';

interface Choice {
  id: string;
  label: string;
  active: boolean;
}

/** One part of the open Assignment's sentence: its name, its list, and the word for it left blank. */
interface Part {
  key: PartKey;
  name: string;
  /** The words before the chip in the sentence, if any. */
  lead?: string;
  choices: Choice[] | null;
  /** What the chip says when the part is blank, e.g. "no Material". */
  blankWords: string;
  /** The choice that leaves it blank: "Unassigned" for the Driver, "His own" for the Truck, else "Leave blank". */
  blankChoice: string;
  /** Whether the blank choice comes first (His own) or last. */
  blankFirst?: boolean;
  /** The entry's name as the Assignment carries it, for an entry the lists do not have (yet). */
  saved: string | null;
  /** For a Place or Material, the field that sends a name typed with "Or type it". */
  typedKey?: keyof TypedNames;
}

function partsOf(assignment: Assignment, lists: EditorLists): Part[] {
  const choices = <T extends { id: string; active: boolean }>(entries: T[] | null, label: (entry: T) => string): Choice[] | null =>
    entries && entries.map((e) => ({ id: e.id, label: label(e), active: e.active }));
  const places = choices(lists.places, (p) => p.shortName);
  return [
    { key: 'driverId', name: 'Driver', choices: choices(lists.drivers, (d) => d.name), blankWords: 'Unassigned', blankChoice: 'Unassigned', saved: assignment.driverName },
    { key: 'materialId', name: 'Material', lead: 'hauls', choices: choices(lists.materials, (m) => m.name), blankWords: 'no Material', blankChoice: 'Leave blank', saved: assignment.materialName, typedKey: 'materialName' },
    { key: 'fromPlaceId', name: 'From', lead: 'from', choices: places, blankWords: 'no Place', blankChoice: 'Leave blank', saved: assignment.fromPlaceName, typedKey: 'fromPlaceName' },
    { key: 'toPlaceId', name: 'To', lead: 'to', choices: places, blankWords: 'no Place', blankChoice: 'Leave blank', saved: assignment.toPlaceName, typedKey: 'toPlaceName' },
    { key: 'truckId', name: 'Truck', lead: 'in', choices: choices(lists.trucks, (t) => t.number), blankWords: 'His own', blankChoice: 'His own', blankFirst: true, saved: assignment.truckNumber },
    { key: 'foremanId', name: 'Foreman', lead: 'for', choices: choices(lists.foremen, (f) => f.name), blankWords: 'no Foreman', blankChoice: 'Leave blank', saved: assignment.foremanName },
  ];
}

/** Which way a move goes, and its button's words. */
const MOVES = [
  { direction: 'earlier', words: 'Do this first', icon: ArrowUp },
  { direction: 'later', words: 'Do this later', icon: ArrowDown },
] as const;

/** A plain message for a save or move that did not go through: the Worker's own when it gave one. */
function messageOf(error: unknown, key: string | null, fallback: string): string {
  if (error instanceof FieldErrors) return (key && error.fields[key]) || Object.values(error.fields).join(' ') || fallback;
  if (error instanceof Refused) return error.message;
  return fallback;
}

/**
 * An Assignment opened in its lane (F2): a sentence of chips, "Driver hauls
 * Material from From to To in Truck for Foreman", and its note. Tapping a chip
 * offers that part's list as a row of chips (one row at a time): active
 * entries, plus the one the Assignment uses if it was removed since, and a
 * choice that leaves it blank (Unassigned for the Driver, His own for the
 * Truck, "Leave blank" for the rest); From, To and Material also offer "Or
 * type it", as the composer does, sending the name typed. Each pick saves only that part, and the
 * note saves on its own when Dave leaves it, so nothing waits on a Save and a
 * change made on another device to another part stays. The chips show the
 * Assignment as saved: a save that fails says so and the old value stays.
 * A new Driver moves it last in his lane; it stays open there.
 * "Do this first" and "Do this later" move it one place in its lane, each
 * left out at that end of the lane. The actions row starts with `actions`,
 * where ✕ and Put back belong. A cancelled Assignment opens only to them: its
 * sentence struck through, with no chips, note or moves, since the Worker
 * refuses changing it until it is put back.
 */
export function AssignmentEditor({
  assignment,
  lists,
  first,
  last,
  onSaved,
  onMoved,
  onClose,
  actions,
}: {
  assignment: Assignment;
  lists: EditorLists;
  /** Whether it is first in its lane, so it cannot be done any earlier. */
  first: boolean;
  /** Whether it is last in its lane, so it cannot be done any later. */
  last: boolean;
  /** The Worker's answer to a change: the Assignment, or, for an Assigned one given a new Driver, its copy and the first one cancelled. */
  onSaved: (changed: ChangedAssignment) => void;
  /** Its lane in its new order after a move. */
  onMoved: (lane: Assignment[]) => void;
  onClose: () => void;
  /** More actions on the open Assignment, shown first in its actions row. */
  actions?: ReactNode;
}) {
  const [tapped, setTapped] = useState<PartKey | null>(null);
  const [saving, setSaving] = useState<PartKey | 'note' | 'move' | null>(null);
  const [failed, setFailed] = useState<{ on: PartKey | 'note' | 'move'; message: string } | null>(null);
  const [note, setNote] = useState(assignment.note ?? '');
  const noteId = useId();
  const parts = partsOf(assignment, lists);

  // A note saved elsewhere shows here, unless Dave is part way through his own.
  useEffect(() => {
    setNote((current) => (document.activeElement?.id === noteId ? current : (assignment.note ?? '')));
  }, [assignment.note, noteId]);

  async function save(on: PartKey | 'note', change: AssignmentChange, name: string) {
    setSaving(on);
    setFailed(null);
    try {
      onSaved(await changeAssignment(assignment.id, change));
      if (on !== 'note') setTapped(null);
    } catch (error) {
      setFailed({ on, message: messageOf(error, on, `Could not save the ${name}. Try again.`) });
    } finally {
      setSaving(null);
    }
  }

  async function move(direction: 'earlier' | 'later') {
    setSaving('move');
    setFailed(null);
    try {
      onMoved(await moveAssignment(assignment.id, direction));
    } catch (error) {
      setFailed({ on: 'move', message: messageOf(error, 'direction', 'Could not move the Assignment. Try again.') });
    } finally {
      setSaving(null);
    }
  }

  if (assignment.cancelledAt) {
    const sentence = parts
      .map((part) => {
        const value = assignment[part.key];
        const shown = value ? (part.choices?.find((c) => c.id === value)?.label ?? part.saved ?? '…') : part.blankWords;
        return [part.lead, shown].filter(Boolean).join(' ');
      })
      .join(' ');
    return (
      <section aria-label="Open Assignment" className="animate-unfold space-y-4 rounded-md border border-primary/40 bg-background p-4 shadow-md">
        <p className={cn('text-base', cancelledText)}>{sentence}</p>
        {assignment.note && <p className={cn('whitespace-pre-line text-sm', cancelledText)}>{assignment.note}</p>}
        <p className="text-sm">Cancelled: the Driver is told it is off his day. Put it back to change it.</p>
        <div data-actions className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <Button type="button" variant="outline" size="lg" className="px-5" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
      </section>
    );
  }

  const open = parts.find((part) => part.key === tapped);
  const alert = (on: PartKey | 'note' | 'move') =>
    failed?.on === on && (
      <p className="text-sm text-destructive" role="alert">
        {failed.message}
      </p>
    );

  return (
    <section aria-label="Open Assignment" className="animate-unfold space-y-4 rounded-md border border-primary/40 bg-background p-4 shadow-md">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-2 text-base">
        {parts.map((part) => {
          const value = assignment[part.key];
          const shown = value ? (part.choices?.find((c) => c.id === value)?.label ?? part.saved ?? '…') : part.blankWords;
          return (
            <span key={part.key} className="contents">
              {part.lead && <span className="text-muted-foreground">{part.lead}</span>}
              <Button
                type="button"
                variant={tapped === part.key ? 'default' : 'outline'}
                aria-label={`${part.name}: ${shown}`}
                aria-expanded={tapped === part.key}
                disabled={!part.choices}
                className={cn('h-11 rounded-full px-4 text-base', !value && tapped !== part.key && 'text-muted-foreground')}
                onClick={() => setTapped((current) => (current === part.key ? null : part.key))}
              >
                {saving === part.key && <Loader2 className="h-4 w-4 animate-spin" />}
                {shown}
              </Button>
            </span>
          );
        })}
      </p>

      {open && (
        <ChoiceRow
          key={open.key}
          part={open}
          value={assignment[open.key]}
          busy={saving === open.key}
          onPick={(id) => save(open.key, { [open.key]: id }, open.name)}
          onTyped={(name) => open.typedKey && saving !== open.key && save(open.key, { [open.typedKey]: name }, open.name)}
        />
      )}
      {open && alert(open.key)}

      <div className="space-y-2">
        <Label htmlFor={noteId}>Note</Label>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={NOTE_LIMIT}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            // The Worker trims and saves an empty note as none; compare as it would.
            if ((note.trim() || null) !== (assignment.note?.trim() || null)) save('note', { note }, 'note');
          }}
        />
        {saving === 'note' && <p className="text-xs text-muted-foreground">Saving…</p>}
        {alert('note')}
      </div>

      {alert('move')}
      <div data-actions className="flex flex-wrap items-center justify-end gap-2">
        {/* Cancel or Delete stands apart on the left, so it is never mistaken for Close. */}
        <div className="mr-auto flex flex-wrap items-center gap-2">{actions}</div>
        {MOVES.filter(({ direction }) => (direction === 'earlier' ? !first : !last)).map(({ direction, words, icon: Icon }) => (
          <Button key={direction} type="button" variant="outline" size="lg" className="px-5" disabled={saving === 'move'} onClick={() => move(direction)}>
            <Icon className="h-4 w-4" />
            {words}
          </Button>
        ))}
        <Button type="button" variant="outline" size="lg" className="px-5" onClick={onClose}>
          <X className="h-4 w-4" /> Close
        </Button>
      </div>
    </section>
  );
}

/**
 * The row of choices a tapped part offers: its list's active entries, plus
 * the one the Assignment uses if it has been removed since, marked so, and
 * the blank choice. The one it has now is pressed; tapping it changes nothing.
 * A Place or Material also offers "Or type it", as the composer does: what is
 * typed is handed to onTyped on Enter or on leaving the box, unless blank.
 */
function ChoiceRow({
  part,
  value,
  busy,
  onPick,
  onTyped,
}: {
  part: Part;
  value: string | null;
  busy: boolean;
  onPick: (id: string | null) => void;
  onTyped: (name: string) => void;
}) {
  const labelId = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const typing = typed !== null;
  const entries = (part.choices ?? [])
    .filter((choice) => choice.active || choice.id === value)
    .map((choice) => ({ id: choice.id as string | null, label: choice.active ? choice.label : `${choice.label} (removed)` }));
  const blank = { id: null, label: part.blankChoice };
  const chips = part.blankFirst ? [blank, ...entries] : [...entries, blank];
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="sr-only">
        {part.name}
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const pressed = !typing && chip.id === value;
          return (
            <Button
              key={chip.id ?? 'blank'}
              type="button"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              disabled={busy}
              className={chipClass(pressed)}
              onClick={() => !pressed && onPick(chip.id)}
            >
              {chip.label}
            </Button>
          );
        })}
        {part.typedKey && <OrTypeIt typing={typing} onClick={() => setTyped(typing ? null : '')} />}
      </div>
      {typing && (
        <TypedBox
          label={part.name}
          value={typed}
          onChange={setTyped}
          onDone={() => {
            if (typed.trim()) onTyped(typed.trim());
          }}
        />
      )}
    </div>
  );
}
