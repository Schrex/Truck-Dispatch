import { useEffect } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import { arrows, dayWord, holidayName, isCalendarDate, shortDate } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The Board's subtitle for a day: its short date, its word relative to today
 * and its Holiday, e.g. "Thu, Nov 26 · Next Thursday · Thanksgiving". Until
 * the Worker says which day is today, only the date.
 */
export function daySubtitle(date: string, today: string | null): string {
  return [shortDate(date), today && dayWord(date, today), holidayName(date)].filter(Boolean).join(' · ');
}

/**
 * Whether a key press belongs to something else on the page: a field being
 * typed in, a picker, or an open dialog, where the arrow keys already mean
 * something. The day only moves when nothing has claimed the keys.
 */
function claimedElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="menu"]'),
  );
}

/**
 * Moving between days in the Board's header: an arrow each side that names
 * the Working day it goes to (skipping weekends and Holidays), the left and
 * right arrow keys doing the same, "Back to" the next Working day whenever the
 * Board is on another day, and "Jump to" any date (until the week strip
 * replaces it).
 */
export function DayNavigation({
  date,
  nextWorkingDay,
  onShow,
}: {
  date: string | null;
  /** The day the Board opens on, once the Worker has said; Back to returns there. */
  nextWorkingDay: string | null;
  onShow: (date: string) => void;
}) {
  const targets = date ? arrows(date) : null;
  const previous = targets?.previous.date;
  const next = targets?.next.date;

  useEffect(() => {
    if (!previous || !next) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (claimedElsewhere(event)) return;
      event.preventDefault();
      onShow(event.key === 'ArrowLeft' ? previous : next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previous, next, onShow]);

  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="jump-to" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" /> Jump to
        </label>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-11 gap-1 px-3"
            aria-label={targets ? `Previous Working day, ${targets.previous.label}` : 'Previous Working day'}
            disabled={!targets}
            onClick={() => targets && onShow(targets.previous.date)}
          >
            <ChevronLeft className="h-4 w-4" />
            {targets?.previous.label}
          </Button>
          <Input id="jump-to" type="date" className="h-11 w-44" value={date ?? ''} onChange={(e) => isCalendarDate(e.target.value) && onShow(e.target.value)} />
          <Button
            variant="outline"
            className="h-11 gap-1 px-3"
            aria-label={targets ? `Next Working day, ${targets.next.label}` : 'Next Working day'}
            disabled={!targets}
            onClick={() => targets && onShow(targets.next.date)}
          >
            {targets?.next.label}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {date && nextWorkingDay && date !== nextWorkingDay && (
        <Button variant="ghost" size="lg" className="px-4" onClick={() => onShow(nextWorkingDay)}>
          <Undo2 className="h-4 w-4" /> Back to {shortDate(nextWorkingDay)}
        </Button>
      )}
    </>
  );
}
