import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CheckIn as CheckInRead, Driver, InspectionAnswerKind, InspectionItem, NewInspection, Truck } from '../../shared/types';
import { clockTime } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addInspection, fetchList, FieldErrors, reportTruckProblem } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The three answers, as the Driver taps them. */
const ANSWERS: { kind: InspectionAnswerKind; word: string }[] = [
  { kind: 'ok', word: 'OK' },
  { kind: 'repair', word: 'Needs repair' },
  { kind: 'na', word: 'N/A' },
];

/**
 * Check-in on Today in the Driver view (GLOSSARY.md: Check-in, Inspection).
 * Until he has checked in, a Check in card: his Truck (the usual one
 * pre-selected), then the Inspection. Once he has, one line: "Truck 24 ·
 * checked in 6:42 · Report a problem · Check in again". Report a problem
 * reports a Truck problem, with a note, on that Truck at any time that day;
 * Check in again opens the card again for another Truck, or the same one after
 * a repair. The latest check-in counts.
 */
export function CheckIn({ driver, today, checkIn, onCheckedIn }: {
  driver: Driver;
  today: string;
  /** His latest check-in today, or null for none yet. */
  checkIn: CheckInRead | null;
  onCheckedIn: (checkIn: CheckInRead) => void;
}) {
  const [again, setAgain] = useState(false);
  if (checkIn && !again) {
    return <CheckedIn driver={driver} checkIn={checkIn} onAgain={() => setAgain(true)} />;
  }
  return (
    <CheckInCard
      driver={driver}
      today={today}
      onCancel={checkIn ? () => setAgain(false) : undefined}
      onCheckedIn={(done) => {
        setAgain(false);
        onCheckedIn(done);
      }}
    />
  );
}

/**
 * The one line once checked in, with Report a problem: a short note, required,
 * sent for the Truck of this check-in. A failed send says so and keeps the note.
 */
function CheckedIn({ driver, checkIn, onAgain }: { driver: Driver; checkIn: CheckInRead; onAgain: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const close = () => {
    setReporting(false);
    setNote('');
    setFailure(null);
  };
  const send = async () => {
    const text = note.trim();
    if (!text) return;
    setSending(true);
    setFailure(null);
    try {
      const problem = await reportTruckProblem({ driverId: driver.id, truckId: checkIn.truckId, text });
      close();
      setSent(problem.text);
    } catch (error) {
      const said = error instanceof FieldErrors ? Object.values(error.fields).join(' ') : '';
      setFailure(`Could not send the problem. Your note is kept: try Send to Dave again.${said ? ` ${said}` : ''}`);
    } finally {
      setSending(false);
    }
  };

  const link = 'font-semibold underline underline-offset-4';
  return (
    <section aria-label="Checked in" className="space-y-3 rounded-lg border bg-card p-4 text-lg">
      <p>
        Truck {checkIn.truckNumber} · checked in {clockTime(checkIn.doneAt)} ·{' '}
        <button type="button" className={link} onClick={() => (setReporting(true), setSent(null))}>
          Report a problem
        </button>{' '}
        ·{' '}
        <button type="button" className={link} onClick={onAgain}>
          Check in again
        </button>
      </p>
      {sent && <p role="status" className="text-base text-muted-foreground">Sent to Dave: {sent}</p>}
      {reporting && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            aria-label="What is the problem?"
            placeholder={`What is wrong with Truck ${checkIn.truckNumber}?`}
            className="h-12 text-lg"
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoFocus
          />
          {failure && <p className="text-base text-destructive">{failure}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" className="text-lg" disabled={!note.trim() || sending}>
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send to Dave
            </Button>
            <Button type="button" size="lg" variant="ghost" className="text-lg" disabled={sending} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** One item's answer as the card holds it until Finish. */
interface Answering {
  answer: InspectionAnswerKind;
  repairNote: string;
}

/**
 * The Check in card: pick the Truck, then Start Inspection shows the
 * checklist, each item answered with one tap, a note for Needs repair, and
 * Other notes. Finish is allowed once every item that is not optional is
 * answered and every Needs repair has its note. The Inspection's id is made
 * when it starts, so a Finish that failed is retried with the same id and is
 * never saved twice; a failure keeps every answer.
 */
function CheckInCard({ driver, today, onCancel, onCheckedIn }: {
  driver: Driver;
  today: string;
  onCancel?: () => void;
  onCheckedIn: (checkIn: CheckInRead) => void;
}) {
  const [trucks, setTrucks] = useState<Truck[] | null>(null);
  const [items, setItems] = useState<InspectionItem[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [truckId, setTruckId] = useState<string | null>(null);
  /** The Inspection's id once started; null while he is still picking the Truck. */
  const [id, setId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answering>>({});
  const [otherNotes, setOtherNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    Promise.all([fetchList('trucks'), fetchList('inspection-items')]).then(
      ([active, checklist]) => {
        if (stale) return;
        setTrucks(active);
        setItems(checklist);
        // His usual Truck, when it is still in use; otherwise none.
        setTruckId((picked) => picked ?? (active.some((t) => t.id === driver.defaultTruckId) ? driver.defaultTruckId : null));
      },
      () => !stale && setFailedToLoad(true),
    );
    return () => {
      stale = true;
    };
  }, [driver.defaultTruckId]);

  const answer = (itemId: string, kind: InspectionAnswerKind) =>
    setAnswers((current) => ({ ...current, [itemId]: { answer: kind, repairNote: current[itemId]?.repairNote ?? '' } }));
  const note = (itemId: string, repairNote: string) =>
    setAnswers((current) => ({ ...current, [itemId]: { ...current[itemId], repairNote } }));

  const complete =
    truckId !== null &&
    items !== null &&
    items.every((item) => item.optional || answers[item.id]) &&
    Object.values(answers).every((a) => a.answer !== 'repair' || a.repairNote.trim() !== '');

  const finish = async () => {
    if (!id || !truckId || !items || !complete) return;
    const body: NewInspection = {
      id,
      date: today,
      driverId: driver.id,
      truckId,
      answers: items
        .filter((item) => answers[item.id])
        .map((item) => {
          const { answer: kind, repairNote } = answers[item.id];
          return kind === 'repair' ? { itemId: item.id, answer: kind, repairNote: repairNote.trim() } : { itemId: item.id, answer: kind };
        }),
      ...(otherNotes.trim() ? { otherNotes: otherNotes.trim() } : {}),
    };
    setSaving(true);
    setProblem(null);
    try {
      const saved = await addInspection(body);
      onCheckedIn({
        driverId: saved.driverId, driverName: saved.driverName, truckId: saved.truckId, truckNumber: saved.truckNumber,
        inspectionId: saved.id, doneAt: saved.doneAt, needsRepair: saved.needsRepair,
      });
    } catch (error) {
      const said = error instanceof FieldErrors ? Object.values(error.fields).join(' ') : '';
      setProblem(`Could not finish the check-in. Your answers are kept: try Finish again.${said ? ` ${said}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="check-in" className="space-y-4 rounded-lg border-2 border-primary bg-card p-5 text-card-foreground shadow-sm">
      <h2 id="check-in" className="font-display text-2xl font-semibold uppercase tracking-wide">
        Check in
      </h2>
      {failedToLoad && <p className="text-destructive">Could not load the Trucks and the checklist. It tries again when you come back to the page.</p>}
      {!trucks && !failedToLoad && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the Trucks…
        </p>
      )}
      {trucks && (
        <div role="group" aria-label="Truck" className="flex flex-wrap gap-2">
          {trucks.map((truck) => (
            <Button
              key={truck.id}
              type="button"
              size="lg"
              className="px-4 text-lg"
              variant={truck.id === truckId ? 'default' : 'outline'}
              aria-pressed={truck.id === truckId}
              onClick={() => setTruckId(truck.id)}
            >
              Truck {truck.number}
            </Button>
          ))}
        </div>
      )}

      {id === null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" className="text-lg" disabled={!truckId || !items} onClick={() => setId(crypto.randomUUID())}>
            Start Inspection
          </Button>
          {onCancel && (
            <Button type="button" size="lg" variant="ghost" className="text-lg" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {items?.map((item) => {
              const label = item.optional ? `${item.label} (optional)` : item.label;
              const given = answers[item.id];
              return (
                <li key={item.id} className="space-y-2">
                  <div role="group" aria-label={label} className="space-y-2">
                    <p className="text-lg font-medium">{label}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {ANSWERS.map(({ kind, word }) => (
                        <Button
                          key={kind}
                          type="button"
                          size="lg"
                          className={cn('px-1 text-base', given?.answer === kind && kind === 'repair' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
                          variant={given?.answer === kind ? 'default' : 'outline'}
                          aria-pressed={given?.answer === kind}
                          onClick={() => answer(item.id, kind)}
                        >
                          {word}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {given?.answer === 'repair' && (
                    <Input
                      aria-label={`What needs repair: ${item.label}`}
                      placeholder="What needs repair?"
                      className="h-12 text-lg"
                      maxLength={1000}
                      value={given.repairNote}
                      onChange={(event) => note(item.id, event.target.value)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <label className="block space-y-2">
            <span className="text-lg font-medium">Other notes</span>
            <Textarea className="text-lg" maxLength={1000} value={otherNotes} onChange={(event) => setOtherNotes(event.target.value)} />
          </label>
          {problem && <p className="text-destructive">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" className="text-lg" disabled={!complete || saving} onClick={finish}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Finish
            </Button>
            {onCancel && (
              <Button type="button" size="lg" variant="ghost" className="text-lg" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
