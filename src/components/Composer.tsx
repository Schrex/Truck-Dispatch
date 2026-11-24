import { Fragment, useId, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { NOTE_LIMIT, type AddAssignment, type Work, type Assignment, type Customer, type Driver, type Foreman, type Material, type Place, type Truck, type TruckProblem } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { addAssignment, FieldErrors, Refused } from '@/lib/api';
import { cn } from '@/lib/utils';
import { foremanSite } from '@/lib/lists';
import { chipClass, OrTypeIt, TypedBox } from '@/components/TypedName';
import { ChipProblems, openOn } from '@/components/ProblemMark';
import { Loading } from '@/components/States';
import { SegmentedToggle } from '@/components/SegmentedToggle';

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
 * For as Dave set it: a Foreman or a Customer picked (at most one of the two
 * ids), or a name typed with "Or type it" (typed is not null while the box is
 * open), or none.
 */
export interface ForSlot {
  foremanId: string | null;
  customerId: string | null;
  typed: string | null;
}

/**
 * What the composer holds before it is saved. The Board keeps it and starts a
 * blank one each time a + opens the composer.
 */
export interface Draft {
  /** The kind of work, which decides the rows shown and the fields saved. Switching keeps what each kind's rows hold until Save. */
  work: Work;
  /** A Move's machine, as typed. */
  machine: string;
  /** The other Drivers who each get this Assignment too, beside the lane's own. */
  alsoDriverIds: string[];
  from: Slot;
  to: Slot;
  /** At: where the Truck works, usually the Job site. */
  at: Slot;
  material: Slot;
  /** For as Dave set it; undefined until he picks or types one, so defaultForeman decides. */
  for?: ForSlot;
  /** A certain Truck; null is "His own". */
  truckId: string | null;
  note: string;
  /** Whether "Note or other truck" is open. */
  more: boolean;
}

const BLANK: Slot = { id: null, typed: null };

/** A composer with nothing picked: the Truck on His own. */
export const EMPTY_DRAFT: Draft = { work: 'haul', machine: '', alsoDriverIds: [], from: BLANK, to: BLANK, at: BLANK, material: BLANK, truckId: null, note: '', more: false };

/** The lists the composer offers as chips, each in the order the API gave it; null while loading. */
export interface ComposerLists {
  drivers: Driver[] | null;
  places: Place[] | null;
  materials: Material[] | null;
  trucks: Truck[] | null;
  foremen: Foreman[] | null;
  customers: Customer[] | null;
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
 * The Foreman a new Assignment gets until Dave picks or types a For (a
 * Foreman or a Customer), so a Customer he picked is never joined by a
 * Foreman. Every rule for
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

/**
 * The Place picking a For fills an empty At with: a Customer's usual Place,
 * or the one job site a Foreman is the usual Foreman of; active Places only,
 * and none when a Foreman is the usual Foreman of no job site or of several.
 * The rule never runs the other way: an At that is a job site suggests no
 * Foreman, so the two suggestions cannot feed each other.
 */
export function usualPlace(picked: Pick<ForSlot, 'foremanId' | 'customerId'>, lists: Pick<ComposerLists, 'places' | 'customers'>): string | null {
  const active = (lists.places ?? []).filter((p) => p.active);
  if (picked.customerId) {
    const usual = lists.customers?.find((c) => c.id === picked.customerId)?.usualPlaceId;
    return active.find((p) => p.id === usual)?.id ?? null;
  }
  if (!picked.foremanId) return null;
  const sites = active.filter((p) => p.kind === 'job_site' && p.usualForemanId === picked.foremanId);
  return sites.length === 1 ? sites[0].id : null;
}

/** For as the composer shows and saves it: what Dave set, or the default Foreman. */
function forOf(draft: Draft, lists: Pick<ComposerLists, 'places' | 'foremen'>): ForSlot {
  return draft.for ?? { foremanId: defaultForeman(draft, lists.places, lists.foremen), customerId: null, typed: null };
}

/** For's name as it reads: the typed name, or the picked Foreman's or Customer's. */
function forName(slot: ForSlot, lists: Pick<ComposerLists, 'foremen' | 'customers'>): string | null {
  const typed = slot.typed?.trim();
  if (typed) return typed;
  if (slot.foremanId) return lists.foremen?.find((f) => f.id === slot.foremanId)?.name ?? null;
  return (slot.customerId && lists.customers?.find((c) => c.id === slot.customerId)?.name) || null;
}

/** A row's name as it reads: the typed name, or the picked entry's. */
function nameIn<T extends { id: string }>(slot: Slot, entries: T[] | null, name: (entry: T) => string): string | null {
  const typed = slot.typed?.trim();
  if (typed) return typed;
  const entry = slot.id ? entries?.find((e) => e.id === slot.id) : undefined;
  return entry ? name(entry) : null;
}

/** The Drivers as the sentence names them, "Randy, Sam and Mike"; null for none. */
function driversWords(drivers: string[]): string | null {
  if (drivers.length === 0) return null;
  return drivers.length === 1 ? drivers[0] : `${drivers.slice(0, -1).join(', ')} and ${drivers[drivers.length - 1]}`;
}

/**
 * The Assignment as a sentence, to check before saving: "Randy hauls for
 * Brody · 2" minus from Villager to TIUNY"; with For blank, "Randy hauls 2"
 * minus from Villager to TIUNY". A named Truck and the note come last. With
 * nothing but the day, it says so. Several Drivers read "Randy and Mike
 * haul", each in his own Truck.
 */
export function sentence(drivers: string[], draft: Draft, lists: ComposerLists): string {
  const who = driversWords(drivers) ?? 'Someone';
  const several = drivers.length > 1;
  const haul = draft.work === 'haul';
  const truck = (!several && lists.trucks?.find((t) => t.id === draft.truckId)?.number) || null;
  const note = draft.note.trim();
  // Other is the Driver, a named Truck and its text: nothing of a route.
  if (draft.work === 'other') return `${who}: ${[note || 'nothing written yet', truck && `in Truck ${truck}`].filter(Boolean).join(' · ')}`;
  // Only what the chosen kind saves: a Move has no Material, For or At; a Haul no machine.
  const material = haul ? nameIn(draft.material, lists.materials, (m) => m.name) : null;
  const from = nameIn(draft.from, lists.places, (p) => p.shortName);
  const to = nameIn(draft.to, lists.places, (p) => p.shortName);
  const at = haul ? nameIn(draft.at, lists.places, (p) => p.shortName) : null;
  const forWho = haul ? forName(forOf(draft, lists), lists) : null;
  const machine = haul ? null : draft.machine.trim() || null;
  if (!material && !from && !to && !at && !forWho && !machine && !truck) return note ? `${who}: ${note}` : `${who}: just the day so far`;
  if (!haul) {
    const move = [`${who} ${several ? 'move' : 'moves'}`, machine, from && `from ${from}`, to && `to ${to}`, truck && `in Truck ${truck}`].filter(Boolean).join(' ');
    return move + (note ? ` · ${note}` : '');
  }
  const head = `${who} ${several ? 'haul' : 'hauls'}${forWho ? ` for ${forWho}` : ''}${at ? ` at ${at}` : ''}`;
  const rest = [material, from && `from ${from}`, to && `to ${to}`, truck && `in Truck ${truck}`].filter(Boolean).join(' ');
  return [head, rest].filter(Boolean).join(forWho || at ? ' · ' : ' ') + (note ? ` · ${note}` : '');
}

/** One row's part of the request: the typed name when there is one, else the picked id (or none). */
function slotFields<I extends string, N extends string>(slot: Slot, idKey: I, nameKey: N): Partial<Record<I | N, string | null>> {
  const typed = slot.typed?.trim();
  return (typed ? { [nameKey]: typed } : { [idKey]: slot.id }) as Partial<Record<I | N, string | null>>;
}

/** For's part of the request: the typed name when there is one, else both ids (one of them, or neither, set). */
function forFields(slot: ForSlot): Pick<AddAssignment, 'foremanId' | 'customerId' | 'forName'> {
  const typed = slot.typed?.trim();
  return typed ? { forName: typed } : { foremanId: slot.foremanId, customerId: slot.customerId };
}

/**
 * What Save sends: the day, the Drivers (the first as the Assignment's own, the
 * rest beside him) and every row, typed names by name. With several Drivers
 * each takes his own Truck.
 */
function requestOf(date: string, driverIds: string[], draft: Draft, lists: ComposerLists): AddAssignment {
  const [driverId = null, ...alsoDriverIds] = driverIds;
  // Only the fields the chosen kind uses: what another kind's rows still hold is left out.
  const route = { ...slotFields(draft.from, 'fromPlaceId', 'fromPlaceName'), ...slotFields(draft.to, 'toPlaceId', 'toPlaceName') };
  const kind =
    draft.work === 'other'
      ? {}
      : draft.work === 'move'
        ? { ...route, machine: draft.machine.trim() || null }
        : {
            ...route,
            ...slotFields(draft.at, 'atPlaceId', 'atPlaceName'),
            ...slotFields(draft.material, 'materialId', 'materialName'),
            ...forFields(forOf(draft, lists)),
          };
  return {
    date,
    driverId,
    ...(alsoDriverIds.length > 0 && { alsoDriverIds }),
    truckId: alsoDriverIds.length > 0 ? null : draft.truckId,
    work: draft.work,
    ...kind,
    note: draft.note.trim() || null,
  };
}

/** The kinds the composer and the open Assignment offer. */
export const WORK_OPTIONS: { value: Work; label: string }[] = [
  { value: 'haul', label: 'Haul' },
  { value: 'move', label: 'Move' },
  { value: 'other', label: 'Other' },
];

/** The most characters a Move's machine may have, as the Worker allows. */
const MACHINE_LIMIT = 100;

/** Which row shows a refused field's message. */
const ROW_OF: Record<string, string> = {
  driverId: 'who',
  alsoDriverIds: 'who',
  fromPlaceId: 'from',
  fromPlaceName: 'from',
  toPlaceId: 'to',
  toPlaceName: 'to',
  atPlaceId: 'at',
  atPlaceName: 'at',
  materialId: 'material',
  materialName: 'material',
  truckId: 'truck',
  foremanId: 'for',
  customerId: 'for',
  forName: 'for',
  note: 'note',
  machine: 'machine',
};

/** A chip of the composer's sentence, each opening its choices: the rows of ROW_OF that a kind shows in its sentence. */
type SlotKey = 'who' | 'for' | 'at' | 'material' | 'from' | 'to' | 'machine' | 'truck';

/** One chip of the sentence: its name, the words before it, and what it reads (null: blank, dashed). */
interface SentencePart {
  key: SlotKey;
  name: string;
  lead?: string;
  value: string | null;
}

/**
 * A chip of the composer's sentence: what it holds, filled yellow, or its
 * name, dashed, while blank; ringed while its choices are open. Named
 * "From: Villager", or "From" while blank.
 */
function SentenceChip({ part, open, error, onTap }: { part: SentencePart; open: boolean; error: boolean; onTap: () => void }) {
  const set = part.value !== null;
  return (
    <Button
      type="button"
      variant={set ? 'default' : 'outline'}
      aria-label={set ? `${part.name}: ${part.value}` : part.name}
      aria-expanded={open}
      className={cn(
        chipClass(set),
        !set && 'border-dashed border-muted-foreground/60 text-muted-foreground',
        open && 'ring-2 ring-ring ring-offset-2',
        error && 'border-destructive',
      )}
      onClick={onTap}
    >
      {part.value ?? part.name}
    </Button>
  );
}

interface Chip {
  id: string | null;
  label: string;
  /** A mark after the label: the red mark of a Truck with open problems. */
  mark?: ReactNode;
}

/** A named group of chips in one row, such as For's Foremen and Customers. */
interface ChipGroup {
  name: string;
  chips: Chip[];
}

/**
 * A labelled row of large chips; the picked one is pressed. Tapping it again
 * leaves the row blank unless `required` (the Truck is always His own or one).
 * With onTyped, "Or type it" opens a box for a name not in the list, which a
 * picked chip closes again. With groups, the chips come in named groups
 * (null while any loads), one after another, "Or type it" last.
 */
function ChipRow({
  label,
  chips,
  groups,
  picked,
  onPick,
  typed,
  onTyped,
  required,
  error,
}: {
  label: string;
  chips?: Chip[] | null;
  groups?: ChipGroup[] | null;
  picked: string | null;
  onPick: (id: string | null) => void;
  typed?: string | null;
  onTyped?: (typed: string | null) => void;
  required?: boolean;
  error?: string;
}) {
  const labelId = useId();
  const typing = typed != null;
  const chip = ({ id, label: words, mark }: Chip) => {
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
  };
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {(chips === null || groups === null) && <Loading className="py-2" />}
        {chips?.map(chip)}
        {groups?.map((group) => (
          <div key={group.name} role="group" aria-label={group.name} className="w-full space-y-1.5">
            <p aria-hidden className="text-xs font-semibold text-muted-foreground">
              {group.name}
            </p>
            <div className="flex flex-wrap gap-2">{group.chips.map(chip)}</div>
          </div>
        ))}
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
        Who
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
 * to that lane (Unassigned when driverId is null), last in the lane. Haul |
 * Move | Other at the top picks its kind, which decides the sentence of chips
 * under it, read the way Dave says it: a Haul "[Randy] hauls for [Brody] at
 * [TIUNY] · [Asphalt] from [From] to [Villager]", a Move "[Scott] moves
 * [the 260 + big bucket] from [Wintergarden] to [TIUNY]", an Other "[Scott]
 * [Truck 31]" and one line of text, "What?", saved as its note. A blank chip
 * is dashed and says what it is for. Tapping a chip opens its choices under
 * the sentence, one chip at a time: Who adds other Drivers, who each get the
 * same Assignment as their own Draft, all saved together or none (the lane's
 * own Driver cannot be dropped, and with several Drivers each takes his own
 * Truck); For, At, Material, From and To are chips from their lists, each
 * with "Or type it" for a name the Worker finds, brings back or adds; the
 * machine is typed. A switch of kind keeps what each kind's chips hold, and
 * Save sends only the chosen kind's fields. "Note or other truck" opens the
 * Truck chips (His own first; a Truck with open problems carries a red mark,
 * and His own carries his usual Truck's) and the note. A sentence previews
 * it. Save needs nothing but the day; a refusal opens the refused chip and
 * says why on it, and a failure keeps what was typed and says so. Close
 * drops the draft.
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
  /** The chip of the sentence whose choices are open; one at a time. */
  const [openSlot, setOpenSlot] = useState<SlotKey | null>(null);
  const noteId = useId();
  const machineId = useId();
  const { places, materials, trucks, foremen, customers } = lists;
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
  const slotRow = (row: 'from' | 'to' | 'at' | 'material') => ({
    picked: draft[row].id,
    typed: draft[row].typed,
    onPick: (id: string | null) => change(row, (d) => ({ ...d, [row]: { ...d[row], id } })),
    onTyped: (typed: string | null) => change(row, (d) => ({ ...d, [row]: { ...d[row], typed } })),
    error: Object.entries(errors).find(([field]) => ROW_OF[field] === row)?.[1],
  });
  const active = <T extends { id: string; active: boolean }>(entries: T[] | null, label: (entry: T) => string): Chip[] | null =>
    entries && entries.filter((e) => e.active).map((e) => ({ id: e.id, label: label(e) }));
  const placeChips = active(places, (p) => p.shortName);
  // For's chips name their list in their id, as Foremen and Customers are two lists.
  const forGroups =
    foremen && customers
      ? [
          { name: 'Foremen', chips: (active(foremen, (f) => f.name) ?? []).map((c) => ({ ...c, id: `foremen:${c.id}` })) },
          { name: 'Customers', chips: (active(customers, (c) => c.name) ?? []).map((c) => ({ ...c, id: `customers:${c.id}` })) },
        ]
      : null;
  const forNow = forOf(draft, lists);
  const forPicked = forNow.foremanId ? `foremen:${forNow.foremanId}` : forNow.customerId ? `customers:${forNow.customerId}` : null;
  const pickFor = (picked: string | null) => {
    const [list, id] = picked ? picked.split(':') : [null, null];
    const slot = { foremanId: list === 'foremen' ? id : null, customerId: list === 'customers' ? id : null, typed: null };
    // Picking a For fills an empty At with its usual Place; an At Dave chose stays.
    const usual = usualPlace(slot, lists);
    const atEmpty = !draft.at.id && !draft.at.typed?.trim();
    if (usual && atEmpty) change('at', (d) => ({ ...d, at: { id: usual, typed: null } }));
    change('for', (d) => ({ ...d, for: slot }));
  };
  // Says what picking this For did, or would do, to At: only when it has a usual Place.
  const forHint =
    !forNow.typed && usualPlace(forNow, lists) && draft.for
      ? `Picking ${forName(forNow, lists)} fills At with ${forNow.foremanId ? 'his' : 'their'} usual Place.`
      : null;
  // His own is the lane's Driver's usual Truck, so it carries that Truck's mark.
  const marked = (chip: Chip, truckId: string | null) => {
    const open = openOn(truckId, problems);
    return open.length ? { ...chip, mark: <ChipProblems problems={open} /> } : chip;
  };
  const truckChips = trucks && [
    marked({ id: null, label: 'His own' }, usualTruckId),
    ...(active(trucks, (t) => t.number) ?? []).map((chip) => marked(chip, chip.id)),
  ];
  // The Truck chips, or with several Drivers why there are none: Other shows them at once, the other kinds behind "Note or other truck".
  const truckRow = several ? (
    <p className="text-sm text-muted-foreground">Each Driver takes his own Truck. Name another on his block after saving.</p>
  ) : (
    <ChipRow label="Truck" chips={truckChips} picked={draft.truckId} onPick={(truckId) => change('truck', (d) => ({ ...d, truckId }))} required error={errors.truckId} />
  );
  const place = (row: 'from' | 'to' | 'at') => nameIn(draft[row], places, (p) => p.shortName);
  const truckNumber = trucks?.find((t) => t.id === draft.truckId)?.number;
  const who: SentencePart = { key: 'who', name: 'Who', value: driversWords(names) };
  const route: SentencePart[] = [
    { key: 'from', name: 'From', lead: 'from', value: place('from') },
    { key: 'to', name: 'To', lead: 'to', value: place('to') },
  ];
  // The sentence as Dave says it: "Randy hauls for Brody at TIUNY · Asphalt from … to Villager".
  const parts: SentencePart[] =
    draft.work === 'other'
      ? [who, { key: 'truck', name: 'Truck', value: several ? 'His own' : truckNumber ? `Truck ${truckNumber}` : 'His own' }]
      : draft.work === 'move'
        ? [who, { key: 'machine', name: 'Machine', lead: several ? 'move' : 'moves', value: draft.machine.trim() || null }, ...route]
        : [
            who,
            { key: 'for', name: 'For', lead: several ? 'haul for' : 'hauls for', value: forName(forOf(draft, lists), lists) },
            { key: 'at', name: 'At', lead: 'at', value: place('at') },
            { key: 'material', name: 'Material', lead: '·', value: nameIn(draft.material, materials, (m) => m.name) },
            ...route,
          ];
  // Only a chip this kind's sentence has can be open.
  const opened = parts.find((part) => part.key === openSlot)?.key ?? null;
  const errorOf = (row: string) => Object.entries(errors).find(([field]) => ROW_OF[field] === row)?.[1];
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
      if (error instanceof FieldErrors) {
        setErrors(error.fields);
        // The first refused chip of the sentence opens, so its message shows on its row.
        const refused = Object.keys(error.fields).map((field) => ROW_OF[field]);
        const first = parts.find((part) => refused.includes(part.key));
        if (first) setOpenSlot(first.key);
      }
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
      <SegmentedToggle ariaLabel="Kind" options={WORK_OPTIONS} value={draft.work} onChange={(work) => change('work', (d) => ({ ...d, work }))} />
      <div role="group" aria-label="Assignment" className="flex flex-wrap items-center gap-2 text-base">
        {parts.map((part) =>
          part.key === 'who' && offered.length === 0 ? (
            <span key="who" className="font-medium">
              {part.value ?? 'Someone'}
            </span>
          ) : (
            <Fragment key={part.key}>
              {part.lead && <span className="text-muted-foreground">{part.lead}</span>}
              <SentenceChip part={part} open={opened === part.key} error={Boolean(errorOf(part.key))} onTap={() => setOpenSlot((current) => (current === part.key ? null : part.key))} />
            </Fragment>
          ),
        )}
        {draft.work === 'other' && (
          <>
            <Input
              aria-label="What?"
              className="h-11 min-w-48 flex-1"
              maxLength={NOTE_LIMIT}
              placeholder="Water truck, trucking as needed"
              value={draft.note}
              onChange={(event) => {
                const note = event.target.value;
                change('note', (d) => ({ ...d, note }));
              }}
            />
            {errors.note && (
              <p className="w-full text-xs text-destructive" role="alert">
                {errors.note}
              </p>
            )}
          </>
        )}
      </div>

      {opened && (
        <div className="rounded-md border bg-muted/40 p-3">
          {opened === 'who' && (
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
          {opened === 'for' && (
            <ChipRow
              label="For"
              groups={forGroups}
              picked={forPicked}
              onPick={pickFor}
              typed={forNow.typed}
              onTyped={(typed) => change('for', (d) => ({ ...d, for: { foremanId: null, customerId: null, typed } }))}
              error={errorOf('for')}
            />
          )}
          {opened === 'at' && <ChipRow label="At" chips={placeChips} {...slotRow('at')} />}
          {opened === 'material' && <ChipRow label="Material" chips={active(materials, (m) => m.name)} {...slotRow('material')} />}
          {opened === 'from' && <ChipRow label="From" chips={placeChips} {...slotRow('from')} />}
          {opened === 'to' && <ChipRow label="To" chips={placeChips} {...slotRow('to')} />}
          {opened === 'truck' && truckRow}
          {opened === 'machine' && (
            <div className="space-y-2">
              <Label htmlFor={machineId}>Machine</Label>
              <Input
                id={machineId}
                autoFocus
                className="h-11"
                maxLength={MACHINE_LIMIT}
                placeholder="the 260 + big bucket"
                value={draft.machine}
                onChange={(event) => {
                  const machine = event.target.value;
                  change('machine', (d) => ({ ...d, machine }));
                }}
              />
              {errors.machine && (
                <p className="text-xs text-destructive" role="alert">
                  {errors.machine}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {draft.work === 'haul' && forHint && <p className="text-xs text-muted-foreground">{forHint}</p>}
      {draft.work === 'move' && <p className="text-xs text-muted-foreground">The machine is typed. No Material, no For. Not counted as Loads.</p>}
      {draft.work === 'other' && <p className="text-xs text-muted-foreground">Shop, standby, water truck, vac truck. Its Trips count as not a haul.</p>}

      {/* Other shows its Truck and text above, so it has nothing to open. */}
      {draft.work !== 'other' && (
        <Button
          type="button"
          variant="ghost"
          aria-expanded={more}
          className="px-2"
          onClick={() => onDraft((d) => ({ ...d, more: !more }))}
        >
          {more ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {several ? 'Note' : 'Note or other truck'}
        </Button>
      )}
      {more && draft.work !== 'other' && (
        <>
          {truckRow}
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
