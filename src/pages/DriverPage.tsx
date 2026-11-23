import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { BusinessDay, Driver, DriverDay } from '../../shared/types';
import { addDays, shortDate, weekdayName } from '../../shared/days';
import { DriverCard } from '@/components/DriverCard';
import { PageHeader } from '@/components/PageHeader';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { fetchBusinessDay, fetchDriverDay, fetchList, fetchNextSent } from '@/lib/api';
import { storedDriver, storeDriver } from '@/lib/deviceView';

/** A day as the page holds it: loading (undefined), failed (null), or as the Worker read it. */
type Shown = DriverDay | null | undefined;

/** The quick tabs, calendar days around today. */
const TABS = ['Yesterday', 'Today', 'Tomorrow'] as const;
type Tab = (typeof TABS)[number];
const TAB_OFFSET: Record<Tab, number> = { Yesterday: -1, Today: 0, Tomorrow: 1 };

/** "Yesterday", "Today" or "Tomorrow" for those days; null for any other. */
function tabFor(date: string, today: string): Tab | null {
  return TABS.find((tab) => addDays(today, TAB_OFFSET[tab]) === date) ?? null;
}

/**
 * The Driver view: one of the Driver's days at a time, read from the Worker.
 * It opens on Today; Yesterday, Today and Tomorrow are one tap (calendar days,
 * so a Sent Saturday shows on Friday), and ‹ › step one calendar day at a time,
 * weekends included, as far as he likes, since Dave can plan any day. When
 * Dave has Sent him work beyond tomorrow, "Next from Dave: Mon, Nov 23 →"
 * takes him there, so a weekend never hides Monday. The first time, it asks
 * "Who are you?" with the active Drivers as large buttons; the device then
 * remembers him, and "← Drivers" goes back to that list (the device still
 * opens on his day until another Driver is picked). Every time the page comes
 * back into view it reads today again and the day shown, so a phone left
 * overnight on Today moves on to the new day and Dave's latest changes show.
 */
export function DriverPage() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [driversFailed, setDriversFailed] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(storedDriver);
  const [picking, setPicking] = useState(false);
  /** The day picked, YYYY-MM-DD; null for today, which moves on with the clock. */
  const [picked, setPicked] = useState<string | null>(null);
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const [shown, setShown] = useState<Shown>(undefined);
  const [nextSent, setNextSent] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    fetchList('drivers').then(setDrivers, () => setDriversFailed(true));
  }, []);

  // Coming back to the page (focus, or the tab shown again) reads everything again.
  useEffect(() => {
    const refresh = () => setRefreshes((n) => n + 1);
    const visible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  // A remembered Driver who is no longer in the list (removed) is asked again.
  const driver = drivers?.find((d) => d.id === driverId) ?? null;
  const asking = picking || driverId === null || (drivers !== null && driver === null);

  useEffect(() => {
    if (!driverId || picking) return;
    let stale = false;
    // What is on screen stays until the new read answers, so a refresh does not flash.
    fetchBusinessDay().then(
      (day) => {
        if (stale) return;
        setBusinessDay(day);
        fetchDriverDay(driverId, picked ?? day.today).then(
          (answer) => !stale && setShown(answer),
          () => !stale && setShown(null),
        );
        // Only a pointer: if it cannot be read, the line is simply not shown.
        fetchNextSent(driverId).then(
          (date) => !stale && setNextSent(date),
          () => !stale && setNextSent(null),
        );
      },
      () => !stale && setShown((current) => current ?? null),
    );
    return () => {
      stale = true;
    };
  }, [driverId, picking, picked, refreshes]);

  const choose = (id: string) => {
    storeDriver(id);
    setDriverId(id);
    setPicking(false);
    setPicked(null);
    setNextSent(null);
    setShown(undefined);
  };
  const today = businessDay?.today ?? null;
  const date = picked ?? today;
  const show = (next: string) => {
    if (next === date) return;
    setPicked(next === today ? null : next);
    setShown(undefined);
  };

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader
        title="Dispatch"
        subtitle={driver && !asking ? driver.name : 'Driver view'}
        back={
          asking ? undefined : (
            <button type="button" className="py-1 text-base text-muted-foreground hover:text-foreground" onClick={() => setPicking(true)}>
              ← Drivers
            </button>
          )
        }
      >
        <ViewToggle current="driver" />
      </PageHeader>

      <main className="container max-w-2xl space-y-6 py-6">
        {asking ? (
          <section aria-labelledby="who" className="space-y-4">
            <h2 id="who" className="font-display text-2xl font-semibold uppercase tracking-wide">
              Who are you?
            </h2>
            {driversFailed && <p className="text-sm text-destructive">Could not load the Drivers. Reload the page to try again.</p>}
            {!drivers && !driversFailed && <Loading what="Drivers" />}
            <div className="grid gap-3 sm:grid-cols-2">
              {drivers?.map((d) => (
                <Button key={d.id} variant="outline" className="h-auto py-5 text-xl" onClick={() => choose(d.id)}>
                  {d.name}
                </Button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                aria-label="Day before"
                disabled={!date}
                onClick={() => date && show(addDays(date, -1))}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div role="group" aria-label="Day" className="grid flex-1 grid-cols-3 rounded-md border bg-background p-1">
                {TABS.map((tab) => {
                  const on = Boolean(date && today && tabFor(date, today) === tab);
                  return (
                    <Button
                      key={tab}
                      type="button"
                      size="lg"
                      className="px-1"
                      variant={on ? 'default' : 'ghost'}
                      aria-pressed={on}
                      disabled={!today}
                      onClick={() => today && show(addDays(today, TAB_OFFSET[tab]))}
                    >
                      {tab}
                    </Button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                aria-label="Day after"
                disabled={!date}
                onClick={() => date && show(addDays(date, 1))}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            {nextSent && nextSent !== date && (
              <button type="button" className="text-lg font-medium underline underline-offset-4" onClick={() => show(nextSent)}>
                Next from Dave: {shortDate(nextSent)} →
              </button>
            )}
            <DaySection today={today} date={date} shown={shown} />
          </>
        )}
      </main>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading {what}…
    </p>
  );
}

/**
 * The day shown, titled "Today, Sun, Nov 22" (Yesterday and Tomorrow too) or
 * just "Mon, Nov 23" for any other day: "Dave hasn't sent Monday yet." for a
 * Draft, so it is not taken for a day off; a Sent day's cards, or that there
 * is nothing for him.
 */
function DaySection({ today, date, shown }: { today: string | null; date: string | null; shown: Shown }) {
  // The day as last read, until a refresh that moved on to a new day answers.
  const day = shown?.date ?? date;
  const tab = day && today ? tabFor(day, today) : null;
  const title = day ? (tab ? `${tab}, ${shortDate(day)}` : shortDate(day)) : 'Your day';
  return (
    <section aria-labelledby="day-shown" className="space-y-3">
      <h2 id="day-shown" className="font-display text-2xl font-semibold uppercase tracking-wide">
        {title}
      </h2>
      {shown === undefined && <Loading what="your day" />}
      {shown === null && <p className="text-destructive">Could not load this day. It tries again when you come back to the page.</p>}
      {shown?.state === 'draft' && <p className="text-lg text-muted-foreground">Dave hasn't sent {weekdayName(shown.date)} yet.</p>}
      {shown?.state === 'sent' && shown.assignments.length === 0 && (
        <p className="text-lg text-muted-foreground">Nothing for you on {weekdayName(shown.date)}.</p>
      )}
      {shown?.state === 'sent' && shown.assignments.map((assignment) => <DriverCard key={assignment.id} assignment={assignment} />)}
    </section>
  );
}
