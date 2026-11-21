import { useEffect, useState } from 'react';
import { CalendarArrowDown, CalendarArrowUp, Loader2 } from 'lucide-react';
import type { Assignment, BusinessDay, CopiedDay } from '../../shared/types';
import { shortDate } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { copyDayTo, fetchDay, fetchStartFrom, FieldErrors, Refused, startDayFrom } from '@/lib/api';

/** "2 Assignments": how many a copy made. */
function counted(copy: CopiedDay): string {
  return `${copy.assignments.length} Assignment${copy.assignments.length === 1 ? '' : 's'}`;
}

/** The Worker's own message when it gave one (the day is now planned, say), otherwise `fallback`. */
function refusalOf(error: unknown, fallback: string): string {
  if (error instanceof FieldErrors) return Object.values(error.fields).join(' ');
  if (error instanceof Refused) return error.message;
  return fallback;
}

/**
 * Where a day says it is empty and offers to fill it from another. A day with
 * no Assignments at all (cancelled ones count) says "Nothing planned for Mon,
 * Nov 23", and looking at it saves nothing. On today or a later day it offers
 * **Start from** the latest earlier day with Assignments, naming that day; a
 * day before today with Assignments offers **Copy to** the next Working day
 * while that day is still empty. Neither is offered once the target day has
 * Assignments, so a copy never adds to or replaces work (the Worker refuses
 * it too). Keyed by the day, so nothing carries over to another.
 */
export function DayCopy({
  date,
  assignments,
  businessDay,
  onStarted,
  onRefused,
  onCopied,
}: {
  date: string;
  /** The day's Assignments, loaded. */
  assignments: Assignment[];
  /** Today and the next Working day by the Worker's clock; null until known, so nothing is offered before then. */
  businessDay: BusinessDay | null;
  /** Start from filled the day on screen: its Assignments as the Worker answered them. */
  onStarted: (assignments: Assignment[]) => void;
  /** Start from was refused: the day may have changed meanwhile, so it is read again. */
  onRefused: () => void;
  /** Copy to filled another day, which the Board then shows. */
  onCopied: (date: string) => void;
}) {
  const empty = assignments.length === 0;
  const editable = Boolean(businessDay && date >= businessDay.today);
  const past = Boolean(businessDay && date < businessDay.today);
  // Only work that is not cancelled is copied, so a day of call-offs has nothing to copy.
  const copyable = assignments.some((a) => !a.cancelledAt);
  const target = businessDay?.nextWorkingDay ?? null;
  /** The day Start from would copy, once the Worker has named it. */
  const [from, setFrom] = useState<string | null>(null);
  /** The next Working day, once it is known to be empty. */
  const [copyTo, setCopyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!empty || !editable) return;
    let stale = false;
    // Without the earlier day's name there is nothing to offer; the empty day still says so.
    fetchStartFrom(date).then((day) => !stale && setFrom(day), () => {});
    return () => {
      stale = true;
    };
  }, [date, empty, editable]);

  useEffect(() => {
    if (!past || !copyable || !target) return;
    let stale = false;
    fetchDay(target).then((day) => !stale && setCopyTo(day.assignments.length === 0 ? target : null), () => {});
    return () => {
      stale = true;
    };
  }, [past, copyable, target]);

  async function start() {
    setBusy(true);
    try {
      const copy = await startDayFrom(date);
      toast.success(`Started ${shortDate(date)} from ${shortDate(copy.from)}: ${counted(copy)}`);
      onStarted(copy.assignments);
    } catch (error) {
      toast.error(refusalOf(error, 'Could not start this day'));
      onRefused();
    } finally {
      setBusy(false);
    }
  }

  async function copy(to: string) {
    setBusy(true);
    try {
      const copied = await copyDayTo(date, to);
      toast.success(`Copied ${shortDate(date)} to ${shortDate(to)}: ${counted(copied)}`);
      onCopied(to);
    } catch (error) {
      toast.error(refusalOf(error, 'Could not copy this day'));
      setBusy(false);
    }
  }

  const icon = (Icon: typeof CalendarArrowDown) => (busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />);
  const offerCopy = past && copyable && copyTo;
  if (!empty && !offerCopy) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {empty && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Nothing planned for {shortDate(date)}</span>
          {editable && <span>. Use + on a lane to plan the day.</span>}
        </p>
      )}
      {empty && editable && from && (
        <Button variant="outline" size="lg" className="px-5" disabled={busy} onClick={start}>
          {icon(CalendarArrowDown)} Start from {shortDate(from)}
        </Button>
      )}
      {!empty && offerCopy && (
        <Button variant="outline" size="lg" className="px-5" disabled={busy} onClick={() => copy(copyTo)}>
          {icon(CalendarArrowUp)} Copy to {shortDate(copyTo)}
        </Button>
      )}
    </div>
  );
}
