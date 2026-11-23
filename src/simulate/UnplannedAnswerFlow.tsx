import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { chipClass, OrTypeIt, TypedBox } from '@/components/TypedName';
import type { UnplannedAnswer } from './answers';

/** A piece of Unplanned work as the answer shows it. */
export interface AnswerableWork {
  /** UnplannedWork.id. */
  id: string;
  /** "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h". */
  line: string;
  /** Its Places that are Places (not only a geofence code), in the order first reached. */
  places: { id: string; name: string }[];
}

/** One of the Driver's Assignments that day, as a link offers it: "A2 · Walworth Dolomite → J25008 Los Flamboyanes". */
export interface LinkableAssignment {
  id: string;
  label: string;
}

/** What every way of answering gets: the piece, the lists, and where to say whether its answer is complete. */
export interface WayProps {
  work: AnswerableWork;
  materials: string[];
  /** The Driver's Assignments that day, that a link can name. */
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
      <ChipRow label="Where did he load?" chips={work.places.map((p) => ({ id: p.id, label: p.name }))} picked={loadedAt} onPick={setLoadedAt} />
      <ChipRow label="Material" chips={materials.map((m) => ({ id: m, label: m }))} picked={material} onPick={setMaterial} typed={typed} onTyped={setTyped} />
    </>
  );
}

/** "Link to an Assignment": which of the Driver's Assignments that day, and where he loaded, as in Make an Assignment. Both are required. */
function LinkQuestions({ work, assignments, onReady }: WayProps) {
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    onReady(assignmentId && loadedAt ? { kind: 'link', unplannedId: work.id, assignmentId, loadedAt } : null);
  }, [onReady, work.id, assignmentId, loadedAt]);
  return (
    <>
      <ChipRow label="Which Assignment?" chips={assignments} picked={assignmentId} onPick={setAssignmentId} />
      <ChipRow label="Where did he load?" chips={work.places.map((p) => ({ id: p.id, label: p.name }))} picked={loadedAt} onPick={setLoadedAt} />
    </>
  );
}

/** "Not a haul": nothing to answer but an optional note (fuel, repair, personal), so it can be saved straight away. */
function NotAHaulQuestions({ work, onReady }: WayProps) {
  const [note, setNote] = useState('');
  useEffect(() => {
    onReady({ kind: 'not-a-haul', unplannedId: work.id, note: note.trim() || null });
  }, [onReady, work.id, note]);
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">Note</span>
      <Input aria-label="Note" maxLength={100} className="h-11 text-base" placeholder="fuel, repair, personal (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  );
}

/** The ways Dave can answer Unplanned work, in the order offered; each is a chip and its questions. */
const WAYS: { kind: UnplannedAnswer['kind']; label: string; Questions: (props: WayProps) => JSX.Element }[] = [
  { kind: 'make', label: 'Make an Assignment', Questions: MakeAnAssignmentQuestions },
  { kind: 'link', label: 'Link to an Assignment', Questions: LinkQuestions },
  { kind: 'not-a-haul', label: 'Not a haul', Questions: NotAHaulQuestions },
];

/**
 * Answering one piece of Unplanned work: Dave picks how (Make an Assignment,
 * Link to an Assignment, Not a haul), answers that way's questions, and Saves. Save
 * stays off until every question is answered. Opened from the lane or the
 * Truck log; nothing is saved but the answer handed to onSave.
 */
export function UnplannedAnswerFlow({
  work,
  materials,
  assignments = [],
  onSave,
  onClose,
}: {
  work: AnswerableWork;
  materials: string[];
  /** The Driver's Assignments that day, for "Link to an Assignment". */
  assignments?: LinkableAssignment[];
  onSave: (answer: UnplannedAnswer) => void;
  onClose: () => void;
}) {
  const [way, setWay] = useState<UnplannedAnswer['kind'] | null>(null);
  const [answer, setAnswer] = useState<UnplannedAnswer | null>(null);
  const chosen = WAYS.find((w) => w.kind === way);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl uppercase tracking-wide">Unplanned work</DialogTitle>
          <DialogDescription>{work.line}</DialogDescription>
        </DialogHeader>
        <ChipRow
          label="How does Dave answer?"
          chips={WAYS.map((w) => ({ id: w.kind, label: w.label }))}
          picked={way}
          onPick={(id) => {
            setWay(id as UnplannedAnswer['kind'] | null);
            setAnswer(null);
          }}
        />
        {chosen && <chosen.Questions key={chosen.kind} work={work} materials={materials} assignments={assignments} onReady={setAnswer} />}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="lg" disabled={!answer} onClick={() => answer && onSave(answer)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
