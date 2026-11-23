import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { chipClass, OrTypeIt, TypedBox } from '@/components/TypedName';
import { SegmentedToggle } from '@/components/SegmentedToggle';
import { NOT_A_HAUL } from '../../shared/trips';
import type { UnplannedAnswer } from './answers';

/** Where Unplanned work can be split: a Trip after its first, by leftAt, as "Split at 09:45 · J611 Bishop Kearney → Villager". */
export interface SplitChoice {
  at: string;
  label: string;
}

/** A piece of Unplanned work as the answer shows it. */
export interface AnswerableWork {
  /** UnplannedWork.id. */
  id: string;
  /** "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h". */
  line: string;
  /** Its Places that are Places (not only a geofence code), in the order first reached. */
  places: { id: string; name: string }[];
  /** Where it can be split (#77): each Trip after its first. */
  splits?: SplitChoice[];
}

/** One of the Driver's Assignments that day, as a link offers it: "A2 · Walworth Dolomite → J25008 Los Flamboyanes". */
export interface LinkableAssignment {
  id: string;
  label: string;
  /** Whose it is: with "Who was driving?" answered, a link offers only that Driver's. */
  driverId?: string;
}

/** What every way of answering gets: the piece, the lists, and where to say whether its answer is complete. */
export interface WayProps {
  work: AnswerableWork;
  materials: string[];
  /**
   * Who was driving: the Driver Dave picked when the Truck log asks "Who was
   * driving?", else the Truck's Driver; null when nobody fits. A way that
   * offers Assignments (Link) offers only this Driver's (see `assignments`).
   * The flow adds it to every answer, whichever the way.
   */
  driverId: string | null;
  /** The day's Assignments that a link can name: only the picked Driver's (`driverId`). */
  assignments: LinkableAssignment[];
  /** The answer once every question is answered; null while one is still open. */
  onReady: (answer: UnplannedAnswer | null) => void;
}

/** A labelled row of large chips; the picked one is pressed, and tapping it again unpicks it. */
function ChipRow({
  label,
  chips,
  picked,
  onPick,
  typed,
  onTyped,
}: {
  label: string;
  chips: { id: string; label: string }[];
  picked: string | null;
  onPick: (id: string | null) => void;
  /** With onTyped, "Or type it" opens a box for a name not in the list; null while it is closed. */
  typed?: string | null;
  onTyped?: (typed: string | null) => void;
}) {
  const labelId = useId();
  const typing = typed != null;
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const pressed = !typing && picked === chip.id;
          return (
            <Button
              key={chip.id}
              type="button"
              variant={pressed ? 'default' : 'outline'}
              aria-pressed={pressed}
              className={chipClass(pressed)}
              onClick={() => {
                onTyped?.(null);
                onPick(pressed ? null : chip.id);
              }}
            >
              {chip.label}
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
    </div>
  );
}

/** "Where did he load?": one chip per Place of the Unplanned work, as Make an Assignment and Link to an Assignment both ask. */
function LoadedAtRow({ work, loadedAt, onPick }: { work: AnswerableWork; loadedAt: string | null; onPick: (placeId: string | null) => void }) {
  return <ChipRow label="Where did he load?" chips={work.places.map((p) => ({ id: p.id, label: p.name }))} picked={loadedAt} onPick={onPick} />;
}

/** "Make an Assignment": where he loaded (one tap per Place of the piece), and the Material, picked or typed. Both are required. */
function MakeAnAssignmentQuestions({ work, materials, onReady }: WayProps) {
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const materialName = (typed ?? material ?? '').trim();
  useEffect(() => {
    onReady(loadedAt && materialName ? { kind: 'make', unplannedId: work.id, loadedAt, materialName } : null);
  }, [onReady, work.id, loadedAt, materialName]);
  return (
    <>
      <LoadedAtRow work={work} loadedAt={loadedAt} onPick={setLoadedAt} />
      <ChipRow label="Material" chips={materials.map((m) => ({ id: m, label: m }))} picked={material} onPick={setMaterial} typed={typed} onTyped={setTyped} />
    </>
  );
}

/** "Split this Unplanned work at a Trip": one button per Trip after the first; tapping one splits the piece there. */
function SplitRow({ splits, onSplit }: { splits: SplitChoice[]; onSplit: (at: string) => void }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2 border-t pt-3">
      <p id={labelId} className="text-sm font-medium">
        Split this Unplanned work at a Trip
      </p>
      <div className="flex flex-wrap gap-2">
        {splits.map((s) => (
          <Button key={s.at} type="button" variant="outline" size="lg" onClick={() => onSplit(s.at)}>
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** "Link to an Assignment": which of the Driver's Assignments that day, and where he loaded, as in Make an Assignment. Both are required. */
function LinkQuestions({ work, assignments, driverId, onReady }: WayProps) {
  // Only the Driver who was driving: his Assignments are the ones the Truck did that day.
  const offered = driverId ? assignments.filter((a) => !a.driverId || a.driverId === driverId) : assignments;
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    onReady(assignmentId && loadedAt ? { kind: 'link', unplannedId: work.id, assignmentId, loadedAt } : null);
  }, [onReady, work.id, assignmentId, loadedAt]);
  return (
    <>
      <ChipRow label="Which Assignment?" chips={offered} picked={assignmentId} onPick={setAssignmentId} />
      <LoadedAtRow work={work} loadedAt={loadedAt} onPick={setLoadedAt} />
    </>
  );
}

/** "Not a haul": nothing to answer but an optional note (fuel, repair, personal), so it can be saved straight away. */
function NotAHaulQuestions({ work, onReady }: WayProps) {
  const [note, setNote] = useState('');
  useEffect(() => {
    onReady({ kind: NOT_A_HAUL, unplannedId: work.id, note: note.trim() || null });
  }, [onReady, work.id, note]);
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">Note</span>
      <Input aria-label="Note" maxLength={100} className="h-11 text-base" placeholder="fuel, repair, personal (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  );
}

/** The ways Dave can answer Unplanned work, in the order offered on a segmented toggle; each is a segment and its questions. */
const WAYS: { kind: UnplannedAnswer['kind']; label: string; Questions: (props: WayProps) => JSX.Element }[] = [
  { kind: 'make', label: 'Make an Assignment', Questions: MakeAnAssignmentQuestions },
  { kind: 'link', label: 'Link to an Assignment', Questions: LinkQuestions },
  { kind: NOT_A_HAUL, label: 'Not a haul', Questions: NotAHaulQuestions },
];

/**
 * Answering one piece of Unplanned work: when the Truck log asks "Who was
 * driving?" (`drivers`, more than one), Dave first picks the Driver; then he
 * picks how (Make an Assignment, Link to an Assignment, Not a haul), answers
 * that way's questions, and Saves. Save stays off until every question is
 * answered. Link offers only the picked Driver's Assignments. A run that held
 * two hauls he splits instead, at a Trip (onSplit). Opened from the lane or
 * the Truck log; nothing is saved but the answer handed to onSave.
 */
export function UnplannedAnswerFlow({
  work,
  materials,
  drivers,
  driverId: truckDriverId = null,
  assignments = [],
  onSave,
  onSplit,
  onClose,
}: {
  work: AnswerableWork;
  materials: string[];
  /** The Drivers who fit the Truck, when more than one does: "Who was driving?" comes first. */
  drivers?: { id: string; name: string }[];
  /** The Truck's Driver when one fits; Dave is not asked. */
  driverId?: string | null;
  /** The day's Assignments, each with its Driver, for "Link to an Assignment": it offers only the picked Driver's. */
  assignments?: LinkableAssignment[];
  onSave: (answer: UnplannedAnswer) => void;
  /** Dave splits the piece at a Trip (its leftAt): a new piece starts there. */
  onSplit?: (at: string) => void;
  onClose: () => void;
}) {
  const [way, setWay] = useState<UnplannedAnswer['kind'] | null>(null);
  const [answer, setAnswer] = useState<UnplannedAnswer | null>(null);
  const [pickedDriverId, setPickedDriverId] = useState<string | null>(null);
  const askDriver = (drivers?.length ?? 0) > 1;
  /** Who was driving: Dave's pick when asked, else the Truck's Driver. Every answer carries it, so "Who was driving?" is answered whichever the way. */
  const driverId = askDriver ? pickedDriverId : truckDriverId;
  const chosen = WAYS.find((w) => w.kind === way);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">Unplanned work</DialogTitle>
          <DialogDescription>{work.line}</DialogDescription>
        </DialogHeader>
        {askDriver && <ChipRow label="Who was driving?" chips={drivers!.map((d) => ({ id: d.id, label: d.name }))} picked={pickedDriverId} onPick={setPickedDriverId} />}
        {(!askDriver || pickedDriverId) && (
          <>
            <SegmentedToggle
              label="How does Dave answer?"
              options={WAYS.map((w) => ({ value: w.kind, label: w.label }))}
              value={way}
              onChange={(kind) => {
                if (kind === way) return;
                setWay(kind);
                setAnswer(null);
              }}
            />
            {chosen && <chosen.Questions key={`${chosen.kind}:${driverId}`} work={work} materials={materials} driverId={driverId} assignments={assignments} onReady={setAnswer} />}
          </>
        )}
        {onSplit && work.splits && work.splits.length > 0 && <SplitRow splits={work.splits} onSplit={onSplit} />}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="lg" disabled={!answer} onClick={() => answer && onSave({ ...answer, ...(driverId && { driverId }) })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
