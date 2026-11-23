import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayLabel } from '../../shared/days';
import { Button } from '@/components/ui/button';

/** The quick picks, calendar days around today. */
const TABS = ['Yesterday', 'Today', 'Tomorrow'] as const;
type Tab = (typeof TABS)[number];
const TAB_OFFSET: Record<Tab, number> = { Yesterday: -1, Today: 0, Tomorrow: 1 };

/** "Yesterday", "Today" or "Tomorrow" for those days; null for any other. */
export function tabFor(date: string, today: string): Tab | null {
  return TABS.find((tab) => addDays(today, TAB_OFFSET[tab]) === date) ?? null;
}

/**
 * Moving between calendar days (ui-standards.md › Moving around): ‹ and ›
 * each naming the day it goes to ("Sat 21"), stepping one calendar day,
 * weekends included, with Yesterday | Today | Tomorrow between them as one
 * tap each. The Driver view's days and the Fleet imports page's stored day.
 */
export function CalendarDays({ date, today, onShow }: { date: string | null; today: string | null; onShow: (date: string) => void }) {
  return (
    <div className="flex items-stretch gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-12 shrink-0 flex-col gap-0 px-1 text-xs"
        aria-label={date ? `Day before, ${dayLabel(addDays(date, -1))}` : 'Day before'}
        disabled={!date}
        onClick={() => date && onShow(addDays(date, -1))}
      >
        <ChevronLeft className="h-5 w-5" />
        {date && dayLabel(addDays(date, -1))}
      </Button>
      <div role="group" aria-label="Day" className="grid flex-1 grid-cols-3 gap-0.5 rounded-lg border bg-muted/60 p-1">
        {TABS.map((tab) => {
          const on = Boolean(date && today && tabFor(date, today) === tab);
          return (
            <Button
              key={tab}
              type="button"
              size="lg"
              className={on ? 'px-1 text-base font-semibold tracking-tight shadow-sm' : 'px-1 text-base font-medium tracking-tight text-muted-foreground hover:bg-background/70'}
              variant={on ? 'default' : 'ghost'}
              aria-pressed={on}
              disabled={!today}
              onClick={() => today && onShow(addDays(today, TAB_OFFSET[tab]))}
            >
              {tab}
            </Button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-12 shrink-0 flex-col gap-0 px-1 text-xs"
        aria-label={date ? `Day after, ${dayLabel(addDays(date, 1))}` : 'Day after'}
        disabled={!date}
        onClick={() => date && onShow(addDays(date, 1))}
      >
        <ChevronRight className="h-5 w-5" />
        {date && dayLabel(addDays(date, 1))}
      </Button>
    </div>
  );
}
