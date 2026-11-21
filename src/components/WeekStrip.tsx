import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekDay } from '../../shared/types';
import { addDays, dayLabel, dayWord, holidayName, mondayOf, stateWord, weekDates, weekSpan } from '../../shared/days';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchWeek } from '@/lib/api';

/**
 * What a tile says, in order: its day ("Fri 20"), Today or Tomorrow, the
 * Holiday on it, and the day's state once the Worker has said. A Holiday with
 * nothing planned shows only its name, as the Daily Schedule's does, in place
 * of "–".
 */
export function tileParts(date: string, today: string | null, day: WeekDay | undefined): string[] {
  const word = today && dayWord(date, today);
  const holiday = holidayName(date);
  const nearby = word === 'Today' || word === 'Tomorrow' ? word : null;
  const state = day && !(holiday && day.state === 'none') ? stateWord(day) : null;
  return [dayLabel(date), nearby, holiday, state].filter((part): part is string => Boolean(part));
}

/**
 * The Daily Schedule's week strip, in the Board's header: a tile for each of
 * Monday to Friday and narrow ones for Saturday and Sunday, each saying its
 * day's state, the day on screen filled and today outlined; tapping a tile
 * shows that day. The pager above moves a week at a time, keeping the
 * weekday. The states are read again whenever `refresh` changes (the Board
 * passes its day, so a Send, an add or any other change shows at once) and
 * when the page regains the focus, for changes made elsewhere. On a phone the
 * tiles scroll sideways.
 */
export function WeekStrip({
  date,
  today,
  refresh,
  onShow,
}: {
  date: string;
  /** Which day is today, once the Worker has said. */
  today: string | null;
  /** Anything that changes when the day on screen does; null while it loads. */
  refresh: unknown;
  onShow: (date: string) => void;
}) {
  const monday = mondayOf(date);
  const [week, setWeek] = useState<{ monday: string; days: WeekDay[] } | null>(null);
  const asked = useRef(0);

  const load = useCallback(() => {
    const ask = ++asked.current;
    // A failed read leaves the tiles without states; the next change or focus tries again.
    fetchWeek(monday).then(
      (days) => ask === asked.current && setWeek({ monday, days }),
      () => ask === asked.current && setWeek(null),
    );
  }, [monday]);

  const shown = week?.monday === monday ? week.days : null;
  const loaded = shown !== null;
  useEffect(() => {
    // While the day on screen reloads, the states of this week already shown stay until it has.
    if (refresh === null && loaded) return;
    load();
    // `loaded` only skips a read, it never asks for one, so it is not a reason to read again.
  }, [load, refresh]);

  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  return (
    <nav aria-label="Week" className="space-y-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous week" onClick={() => onShow(addDays(date, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p role="status" aria-label="Week shown" className="min-w-[8.5rem] text-center text-sm font-medium">
          {weekSpan(monday)}
        </p>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next week" onClick={() => onShow(addDays(date, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {weekDates(monday).map((day, index) => {
          const weekend = index >= 5;
          const chosen = day === date;
          const parts = tileParts(day, today, shown?.find((d) => d.date === day));
          const [label, ...rest] = parts;
          return (
            <li key={day} className={cn('shrink-0', weekend ? 'w-20' : 'min-w-[7.5rem] flex-1')}>
              <button
                type="button"
                aria-label={parts.join(' · ')}
                aria-pressed={chosen}
                aria-current={day === today ? 'date' : undefined}
                onClick={() => onShow(day)}
                className={cn(
                  'flex h-full min-h-[4.5rem] w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  chosen ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  day === today && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              >
                <span className="text-sm font-semibold">{label}</span>
                {rest.map((part) => (
                  <span key={part} className={cn('truncate text-xs', chosen ? 'text-primary-foreground/90' : 'text-muted-foreground')}>
                    {part}
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
