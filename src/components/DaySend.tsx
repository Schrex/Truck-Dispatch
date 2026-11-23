import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import type { Assignment } from '../../shared/types';
import { dayState, shortDate } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { FieldErrors, Refused, sendDay } from '@/lib/api';

/** The business runs on US Eastern time, so its times read the same on every device, as the Worker's days do. */
const BUSINESS_TIME_ZONE = 'America/New_York';

const timeOfDay = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const dateOfDay = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "4:12 PM": a moment's time of day in US Eastern. */
function clockTime(moment: string): string {
  return timeOfDay.format(new Date(moment));
}

/** "Thu, Nov 19 · 4:15 PM": a moment as the day and time it was in US Eastern. */
function dayAndTime(moment: string): string {
  return `${shortDate(dateOfDay.format(new Date(moment)))} · ${clockTime(moment)}`;
}

/**
 * The header's state line for a day, by the shared day rules: a Draft says
 * it is not sent yet and when it was last saved, so Dave knows his work is
 * kept; a Sent day says when it was first Sent; and once anything on it is
 * Changed or Added since, that it has changed since it was Sent. The last
 * save is the latest of its Assignments' and `savedAt`, the page's own last
 * save on the day, which covers a delete that leaves no Assignment to read.
 */
export function stateLine(assignments: Assignment[], sentAt: string | null, savedAt: string | null = null): string {
  const { state } = dayState(assignments, sentAt);
  if (state === 'changed') return 'Changed since Sent';
  if (state === 'sent') return `Sent ${dayAndTime(sentAt!)}`;
  const saved = [...assignments.map((a) => a.updatedAt), ...(savedAt ? [savedAt] : [])].sort().at(-1);
  return ['Draft', 'not sent yet', saved && `saved ${clockTime(saved)}`].filter(Boolean).join(' · ');
}

/**
 * The day's state line and its Send button. Send is one tap with no warnings
 * and is offered only while the day is a Draft, on today or a later day (the
 * Worker refuses the rest); it waits for something to be planned, as the
 * Drivers are never sent an empty day. Once Sent there is no lock and no Send
 * again (ADR 0003): every change reaches the Drivers as it is saved.
 */
export function DaySend({
  date,
  assignments,
  sentAt,
  savedAt = null,
  editable,
  onSent,
}: {
  date: string;
  /** The day's Assignments, once loaded. */
  assignments: Assignment[] | null;
  sentAt: string | null;
  /** When the page last saved something on the day, such as a delete; null when it has not. */
  savedAt?: string | null;
  /** Today or a later day; days before today are read-only. */
  editable: boolean;
  onSent: (sentAt: string) => void;
}) {
  const [sending, setSending] = useState(false);
  if (!assignments) return null;

  async function send() {
    setSending(true);
    try {
      onSent(await sendDay(date));
    } catch (error) {
      // The Worker's own message when it gave one, e.g. the day has nothing on it.
      if (error instanceof FieldErrors) toast.error(Object.values(error.fields).join(' '));
      else if (error instanceof Refused) toast.error(error.message);
      else toast.error('Could not Send this day');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <p role="status" aria-label="Day state" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {stateLine(assignments, sentAt, savedAt)}
      </p>
      {editable && sentAt === null && assignments.length > 0 && (
        <p className="text-sm text-muted-foreground">Drivers can't see this day until you Send.</p>
      )}
      {editable && sentAt === null && (
        <Button size="lg" className="px-5" disabled={sending || assignments.length === 0} onClick={send}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
        </Button>
      )}
    </div>
  );
}
