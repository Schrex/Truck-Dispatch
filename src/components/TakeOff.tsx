import { useState } from 'react';
import { Loader2, Trash2, Undo2, X } from 'lucide-react';
import type { Assignment } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { discardAssignment, putBackAssignment, Refused, takeOffAssignment } from '@/lib/api';

/**
 * The open Assignment's ✕, or Put back once it is cancelled, for the editor's
 * actions row. ✕ is one tap with no warning: on a Draft it says Delete, as
 * the Worker deletes it, and on an Assigned Assignment Cancel, as the Worker
 * keeps it cancelled in its place so the Driver is told it is off. Which
 * happens is the Worker's to decide; the page shows what it answered. A
 * cancelled one also offers Discard, which clears it off the Board (its
 * Driver still sees it until he dismisses it). A tap that fails says so and
 * leaves the Assignment as it was.
 */
export function TakeOff({
  assignment,
  onDeleted,
  onChanged,
}: {
  assignment: Assignment;
  /** It was deleted (✕ on a Draft) or discarded (a cancelled one). */
  onDeleted: (id: string) => void;
  /** It was cancelled or put back, as the Worker answered it. */
  onChanged: (assignment: Assignment) => void;
}) {
  const [busy, setBusy] = useState<'tap' | 'discard' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cancelled = Boolean(assignment.cancelledAt);
  // ✕ names what it will do: an Assigned one is cancelled, a Draft deleted.
  const assigned = assignment.assignedAt !== null;

  async function discard() {
    setBusy('discard');
    setFailed(null);
    try {
      await discardAssignment(assignment.id);
      onDeleted(assignment.id);
    } catch (error) {
      setFailed(error instanceof Refused ? error.message : 'Could not discard the Assignment. Try again.');
      setBusy(null);
    }
  }

  async function tap() {
    setBusy('tap');
    setFailed(null);
    try {
      if (cancelled) onChanged(await putBackAssignment(assignment.id));
      else {
        const kept = await takeOffAssignment(assignment.id);
        if (kept) onChanged(kept);
        else onDeleted(assignment.id);
      }
    } catch (error) {
      if (error instanceof Refused) setFailed(error.message);
      else if (cancelled) setFailed('Could not put the Assignment back. Try again.');
      else setFailed(`Could not ${assigned ? 'cancel' : 'delete'} the Assignment. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  const Icon = busy === 'tap' ? Loader2 : cancelled ? Undo2 : X;
  return (
    <>
      {failed && (
        <p className="basis-full text-right text-sm text-destructive" role="alert">
          {failed}
        </p>
      )}
      {cancelled && (
        <Button type="button" variant="outline" size="lg" className="px-5" disabled={busy !== null} onClick={discard}>
          {busy === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Discard
        </Button>
      )}
      <Button
        type="button"
        variant={cancelled ? 'default' : 'outline'}
        size="lg"
        className={cancelled ? 'px-5' : 'px-5 text-destructive hover:text-destructive'}
        disabled={busy !== null}
        onClick={tap}
      >
        <Icon className={busy === 'tap' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        {cancelled ? 'Put back' : assigned ? 'Cancel' : 'Delete'}
      </Button>
    </>
  );
}
