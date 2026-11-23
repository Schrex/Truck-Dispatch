import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { NOTE_LIMIT, type AddAssignment, type Assignment, type Driver, type Foreman, type Material, type Place, type Truck, type TruckProblem } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { addAssignment, FieldErrors, Refused } from '@/lib/api';
import { foremanSite } from '@/lib/lists';
import { chipClass, OrTypeIt, TypedBox } from '@/components/TypedName';
import { ChipProblems, openOn } from '@/components/ProblemMark';

/**
 * A Place or Material row of the composer: a chip picked from the list (its
 * id), or a name typed with "Or type it" (typed is not null while the box is
 * open), or neither.
 */
export interface Slot {
  id: string | null;
  typed: string | null;
}

/**
 * What the composer holds before it is saved. The Board keeps it and starts a
 * blank one each time a + opens the composer.
 */
export interface Draft {
  /** The other Drivers who each get this Assignment too, beside the lane's own. */
  alsoDriverIds: string[];
  from: Slot;
  to: Slot;
  material: Slot;
  /** The Foreman Dave picked (null: none); undefined until he picks, so defaultForeman decides. */
  foremanId?: string | null;
  /** A certain Truck; null is "His own". */
  truckId: string | null;
  note: string;
  /** Whether "Note or other truck" is open. */
  more: boolean;
}

const BLANK: Slot = { id: null, typed: null };

/** A composer with nothing picked: the Truck on His own. */
export const EMPTY_DRAFT: Draft = { alsoDriverIds: [], from: BLANK, to: BLANK, material: BLANK, truckId: null, note: '', more: false };

/** The lists the composer offers as chips, each in the order the API gave it; null while loading. */
export interface ComposerLists {
  drivers: Driver[] | null;
  places: Place[] | null;
  materials: Material[] | null;
  trucks: Truck[] | null;
  foremen: Foreman[] | null;
}

/**
 * The Place a row names: the picked one, or the one whose short name was
 * typed (ignoring case), which the Worker will link; null for a new name.
 */
function placeIn(slot: Slot, places: Place[] | null): Place | null {
  const typed = slot.typed?.trim().toLowerCase();
  if (typed) return places?.find((p) => p.shortName.toLowerCase() === typed) ?? null;
  return (slot.id && places?.find((p) => p.id === slot.id)) || null;
}

/**
 * The Foreman a new Assignment gets until Dave picks one. Every rule for
 * filling him in lives here, so it can grow without touching the composer:
 * the drop-off's usual Foreman if it is a job site, otherwise the pick-up's
 * if that is one (so hauling out of TIUNY still names Brody). A usual Foreman
 * removed from the Foremen since is left out, as Dave could not pick him.
 */
export function defaultForeman(draft: Draft, places: Place[] | null, foremen: Foreman[] | null = null): string | null {
  const to = placeIn(draft.to, places);
  const from = placeIn(draft.from, places);
  const site = foremanSite(from?.kind === 'job_site', to?.kind === 'job_site');
  const usual = (site === 'to' ? to : site === 'from' ? from : null)?.usualForemanId ?? null;
  if (usual && foremen?.some((f) => f.id === usual && !f.active)) return null;
  return usual;
}

/** The Foreman the composer shows and saves: Dave's pick, or the default. */
function foremanOf(draft: Draft, lists: Pick<ComposerLists, 'places' | 'foremen'>): string | null {
  return draft.foremanId !== undefined ? draft.foremanId : defaultForeman(draft, lists.places, lists.foremen);
}

/** A row's name as it reads: the typed name, or the picked entry's. */
function nameIn<T extends { id: string }>(slot: Slot, entries: T[] | null, name: (entry: T) => string): string | null {
  const typed = slot.typed?.trim();
  if (typed) return typed;
  const entry = slot.id ? entries?.find((e) => e.id === slot.id) : undefined;
  return entry ? name(entry) : null;
}

/**
 * The Assignment as a sentence, to check before saving: "Randy hauls 2" minus
 * from Villager to TIUNY (Brody)". The Foreman follows the job site he runs
 * (the drop-off, else the pick-up), or with no job site the drop-off, else the
 * pick-up; a named Truck and the note come last. With nothing but the day, it
 * says so. Several Drivers read "Randy and Mike haul", each in his own Truck.
 */
export function sentence(drivers: string[], draft: Draft, lists: ComposerLists): string {
  const who = drivers.length === 0 ? 'Someone' : drivers.length === 1 ? drivers[0] : `${drivers.slice(0, -1).join(', ')} and ${drivers[drivers.length - 1]}`;
  const several = drivers.length > 1;
  const material = nameIn(draft.material, lists.materials, (m) => m.name);
  const from = nameIn(draft.from, lists.places, (p) => p.shortName);
  const to = nameIn(draft.to, lists.places, (p) => p.shortName);
  const foremanId = foremanOf(draft, lists);
  const foreman = lists.foremen?.find((f) => f.id === foremanId)?.name ?? null;
  const truck = (!several && lists.trucks?.find((t) => t.id === draft.truckId)?.number) || null;
  const note = draft.note.trim();
  if (!material && !from && !to && !foreman && !truck) return note ? `${who}: ${note}` : `${who}: just the day so far`;
  const jobSite = (slot: Slot) => placeIn(slot, lists.places)?.kind === 'job_site';
  const site = foremanSite(jobSite(draft.from), jobSite(draft.to)) ?? (to ? 'to' : 'from');
  const at = (place: string | null, here: boolean) => (place ? `${place}${here && foreman ? ` (${foreman})` : ''}` : null);
  const words = [
    `${who} ${several ? 'haul' : 'hauls'}`,
    material,
    from && `from ${at(from, site === 'from')}`,
    to && `to ${at(to, site === 'to')}`,
    !from && !to && foreman && `(${foreman})`,
    truck && `in Truck ${truck}`,
  ].filter(Boolean);
  return words.join(' ') + (note ? ` · ${note}` : '');
}

/** One row's part of the request: the typed name when there is one, else the picked id (or none). */
function slotFields<I extends string, N extends string>(slot: Slot, idKey: I, nameKey: N): Partial<Record<I | N, string | null>> {
  const typed = slot.typed?.trim();
  return (typed ? { [nameKey]: typed } : { [idKey]: slot.id }) as Partial<Record<I | N, string | null>>;
}

/**
 * What Save sends: the day, the Drivers (the first as the Assignment's own, the
 * rest beside him) and every row, typed names by name. With several Drivers
 * each takes his own Truck.
 */
function requestOf(date: string, driverIds: string[], draft: Draft, lists: ComposerLists): AddAssignment {
  const [driverId = null, ...alsoDriverIds] = driverIds;
  return {
    date,
    driverId,
    ...(alsoDriverIds.length > 0 && { alsoDriverIds }),
    truckId: alsoDriverIds.length > 0 ? null : draft.truckId,
    ...slotFields(draft.from, 'fromPlaceId', 'fromPlaceName'),
    ...slotFields(draft.to, 'toPlaceId', 'toPlaceName'),
    ...slotFields(draft.material, 'materialId', 'materialName'),
    foremanId: foremanOf(draft, lists),
    note: draft.note.trim() || null,
  };
}

/** Which row shows a refused field's message. */
const ROW_OF: Record<string, string> = {
  driverId: 'who',
  alsoDriverIds: 'who',
  fromPlaceId: 'from',
  fromPlaceName: 'from',
  toPlaceId: 'to',
  toPlaceName: 'to',
  materialId: 'material',
  materialName: 'material',
  truckId: 'truck',
  foremanId: 'foreman',
  note: 'note',
};

interface Chip {
  id: string | null;
  label: string;
  /** A mark after the label: the red mark of a Truck with open problems. */
  mark?: ReactNode;
}

/**
 * A labelled row of large chips; the picked one is pressed. Tapping it again
 * leaves the row blank unless `required` (the Truck is always His own or one).
 * With onTyped, "Or type it" opens a box for a name not in the list, which a
 * picked chip closes again.
 */
function ChipRow({
  label,
  chips,
  picked,
  onPick,
  typed,
  onTyped,
  required,
  error,
}: {
  label: string;
  chips: Chip[] | null;
  picked: string | null;
  onPick: (id: string | null) => void;
  typed?: string | null;
  onTyped?: (typed: string | null) => void;
  required?: boolean;
  error?: string;
}) {
  const labelId = useId();
  const typing = typed != null;
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {chips === null && <span className="py-2 text-sm text-muted-foreground">Loading…</span>}
        {chips?.map(({ id, label: words, mark }) => {
          const pressed = !typing && picked === id;
          return (
            <Button
              key={id ?? 'none'}
              type="button"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              className={chipClass(pressed)}
              onClick={() => {
                onTyped?.(null);
                onPick(pressed && !required ? null : id);
              }}
            >
              {words}
              {mark}
            </Button>
          );
        })}
        {onTyped && (
          <OrTypeIt
            typing={typing}
            onClick={() => {
              onPick(null);
              onTyped(typing ? null : '');
            }}
          />
        )}
      </div>
      {typing && onTyped && <TypedBox label={label} value={typed ?? ''} onChange={onTyped} />}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Who?": the Drivers who each get the Assignment, as chips. The lane's own
 * Driver is pressed and stays so; tapping another adds or drops him.
 */
function WhoRow({
  drivers,
  laneDriverId,
  picked,
  onToggle,
  error,
}: {
  drivers: Driver[];
  laneDriverId: string | null;
  picked: string[];
  onToggle: (driverId: string) => void;
  error?: string;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        Who?
      </p>
      <div className="flex flex-wrap gap-2">
        {drivers.map((driver) => {
          const own = driver.id === laneDriverId;
          const pressed = own || picked.includes(driver.id);
          return (
            <Button
              key={driver.id}
              type="button"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              aria-disabled={own || undefined}
              title={own ? 'This is his lane' : undefined}
              className={chipClass(pressed)}
              onClick={() => !own && onToggle(driver.id)}
            >
              {driver.name}
            </Button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The F1 composer, opened by a lane's +, always blank: it adds one Assignment
 * to that lane (Unassigned when driverId is null), last in the lane. "Who?"
 * adds other Drivers, who each get the same Assignment as their own Draft, all
 * saved together or none; the lane's own Driver cannot be dropped, and with
 * several Drivers each takes his own Truck, so the Truck chips are hidden. Pick up and Drop off
 * are rows of Place chips, "Hauling what?" a row of Material chips, each with
 * "Or type it" for a name the Worker finds, brings back or adds; "Note or
 * other truck" opens the Truck chips (His own first; a Truck with open
 * problems carries a red mark, and His own carries his usual Truck's) and the note. A sentence
 * previews it. Save needs nothing but the day; a refusal or failure keeps
 * what was typed and says so. Close drops the draft.
 */
export function Composer({
  date,
  driverId,
  driverName,
  usualTruckId = null,
  lists,
  problems,
  draft,
  onDraft,
  onSaved,
  onClose,
}: {
  date: string;
  driverId: string | null;
  driverName: string | null;
  /** The lane's Driver's usual Truck, which His own stands for; null for none (or Unassigned). */
  usualTruckId?: string | null;
  lists: ComposerLists;
  /** The open Truck problems: each Truck chip with one is marked red, His own by the usual Truck's. */
  problems?: TruckProblem[];
  draft: Draft;
  onDraft: (change: (draft: Draft) => Draft) => void;
  /** Every Assignment the save made, the lane's own first. */
  onSaved: (assignments: Assignment[]) => void;
  onClose: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const noteId = useId();
  const { places, materials, trucks, foremen } = lists;
  // The lane's own Driver first (the Assignment is his), then the others picked, in the list's order.
  const offered = (lists.drivers ?? []).filter((d) => d.active);
  const others = offered.filter((d) => d.id !== driverId && draft.alsoDriverIds.includes(d.id));
  const driverIds = [...(driverId ? [driverId] : []), ...others.map((d) => d.id)];
  const names = [...(driverName ? [driverName] : []), ...others.map((d) => d.name)];
  const several = driverIds.length > 1;

  const change = (row: string, update: (draft: Draft) => Draft) => {
    onDraft(update);
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => ROW_OF[field] !== row)));
  };
  const slotRow = (row: 'from' | 'to' | 'material') => ({
    picked: draft[row].id,
    typed: draft[row].typed,
    onPick: (id: string | null) => change(row, (d) => ({ ...d, [row]: { ...d[row], id } })),
    onTyped: (typed: string | null) => change(row, (d) => ({ ...d, [row]: { ...d[row], typed } })),
    error: Object.entries(errors).find(([field]) => ROW_OF[field] === row)?.[1],
  });
  const active = <T extends { id: string; active: boolean }>(entries: T[] | null, label: (entry: T) => string): Chip[] | null =>
    entries && entries.filter((e) => e.active).map((e) => ({ id: e.id, label: label(e) }));
  const placeChips = active(places, (p) => p.shortName);
  // His own is the lane's Driver's usual Truck, so it carries that Truck's mark.
  const marked = (chip: Chip, truckId: string | null) => {
    const open = openOn(truckId, problems);
    return open.length ? { ...chip, mark: <ChipProblems problems={open} /> } : chip;
  };
  const truckChips = trucks && [
    marked({ id: null, label: 'His own' }, usualTruckId),
    ...(active(trucks, (t) => t.number) ?? []).map((chip) => marked(chip, chip.id)),
  ];
  const unplaced = Object.entries(errors).filter(([field]) => !ROW_OF[field] || (ROW_OF[field] === 'who' && offered.length === 0)).map(([, message]) => message);
  const more = draft.more || Boolean(errors.truckId || errors.note);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFailed(null);
    setErrors({});
    try {
      const assignments = await addAssignment(requestOf(date, driverIds, draft, lists));
      toast.success(assignments.length > 1 ? `${assignments.length} Assignments saved` : 'Assignment saved');
      onSaved(assignments);
    } catch (error) {
      if (error instanceof FieldErrors) setErrors(error.fields);
      else {
        setFailed(error instanceof Refused ? error.message : 'Could not save the Assignment. Try again.');
        toast.error('Could not save the Assignment');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={`New Assignment for ${driverName ?? 'Unassigned'}`}
      onSubmit={save}
      noValidate
      className="animate-unfold space-y-4 rounded-md border border-primary/40 bg-background p-4 shadow-md"
    >
      {offered.length > 0 && (
        <WhoRow
          drivers={offered}
          laneDriverId={driverId}
          picked={draft.alsoDriverIds}
          onToggle={(id) =>
            change('who', (d) => ({ ...d, alsoDriverIds: d.alsoDriverIds.includes(id) ? d.alsoDriverIds.filter((other) => other !== id) : [...d.alsoDriverIds, id] }))
          }
          error={errors.alsoDriverIds ?? errors.driverId}
        />
      )}
      <ChipRow label="Pick up" chips={placeChips} {...slotRow('from')} />
      <ChipRow label="Drop off" chips={placeChips} {...slotRow('to')} />
      <ChipRow label="Hauling what?" chips={active(materials, (m) => m.name)} {...slotRow('material')} />
      <ChipRow
        label="Foreman"
        chips={active(foremen, (f) => f.name)}
        picked={foremanOf(draft, lists)}
        onPick={(foremanId) => change('foreman', (d) => ({ ...d, foremanId }))}
        error={errors.foremanId}
      />

      <Button
        type="button"
        variant="ghost"
        aria-expanded={more}
        className="px-2"
        onClick={() => onDraft((d) => ({ ...d, more: !more }))}
      >
        {more ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {several ? 'Note' : 'Note or other truck'}
      </Button>
      {more && (
        <>
          {several ? (
            <p className="text-sm text-muted-foreground">Each Driver takes his own Truck. Name another on his block after saving.</p>
          ) : (
            <ChipRow
              label="Truck"
              chips={truckChips}
              picked={draft.truckId}
              onPick={(truckId) => change('truck', (d) => ({ ...d, truckId }))}
              required
              error={errors.truckId}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor={noteId}>Note</Label>
            <Textarea
              id={noteId}
              rows={2}
              maxLength={NOTE_LIMIT}
              value={draft.note}
              onChange={(event) => {
                const note = event.target.value;
                change('note', (d) => ({ ...d, note }));
              }}
            />
            {errors.note && (
              <p className="text-xs text-destructive" role="alert">
                {errors.note}
              </p>
            )}
          </div>
        </>
      )}

      <p role="status" className="rounded-md bg-muted px-3 py-2 text-base font-medium">
        {sentence(names, draft, lists)}
      </p>
      {[...unplaced, failed].filter(Boolean).map((message) => (
        <p key={message} className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ))}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" className="px-5" onClick={onClose}>
          <X className="h-4 w-4" /> Close
        </Button>
        <Button type="submit" size="lg" className="px-5" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}
