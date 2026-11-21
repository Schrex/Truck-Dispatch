import { useState } from 'react';
import { Loader2, Undo2, X } from 'lucide-react';
import type { Assignment } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { putBackAssignment, Refused, takeOffAssignment } from '@/lib/api';

/**
 * The open Assignment's ✕, or Put back once it is cancelled, for the editor's
 * actions row. ✕ is one tap with no warning: on a Draft day it says Delete,
 * as the Worker deletes it, and on a Sent day Cancel, as the Worker keeps it
 * cancelled in its place so the Driver is told it is off. Which happens is the
 * Worker's to decide; the page shows what it answered. A tap that fails says
 * so and leaves the Assignment as it was.
 */
export function TakeOff({
  assignment,
  sent,
  onDeleted,
  onChanged,
}: {
  assignment: Assignment;
  /** Whether its day is Sent, so ✕ names what it will do. */
  sent: boolean;
  /** It was deleted (✕ on a Draft day). */
  onDeleted: (id: string) => void;
  /** It was cancelled or put back, as the Worker answered it. */
  onChanged: (assignment: Assignment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const cancelled = Boolean(assignment.cancelledAt);

  async function tap() {
    setBusy(true);
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
      else setFailed(`Could not ${sent ? 'cancel' : 'delete'} the Assignment. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  const Icon = busy ? Loader2 : cancelled ? Undo2 : X;
  return (
    <>
      {failed && (
        <p className="basis-full text-right text-sm text-destructive" role="alert">
          {failed}
        </p>
      )}
      <Button
        type="button"
        variant={cancelled ? 'default' : 'outline'}
        size="lg"
        className={cancelled ? 'px-5' : 'px-5 text-destructive hover:text-destructive'}
        disabled={busy}
        onClick={tap}
      >
        <Icon className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        {cancelled ? 'Put back' : sent ? 'Cancel' : 'Delete'}
      </Button>
    </>
  );
}
