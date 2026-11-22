import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { BusinessDay, Driver, DriverDay } from '../../shared/types';
import { addDays, shortDate, weekdayName } from '../../shared/days';
import { DriverCard } from '@/components/DriverCard';
import { PageHeader } from '@/components/PageHeader';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { fetchBusinessDay, fetchDriverDay, fetchList } from '@/lib/api';
import { storedDriver, storeDriver } from '@/lib/deviceView';

/** A day as the page holds it: loading (undefined), failed (null), or as the Worker read it. */
type Shown = DriverDay | null | undefined;

/** The days a Driver can look at, calendar days around today. */
const DAYS = ['Yesterday', 'Today', 'Tomorrow'] as const;
type Word = (typeof DAYS)[number];

/** The date each word names, from today (US Eastern, as the Worker says). */
function dateFor(word: Word, day: BusinessDay): string {
  if (word === 'Yesterday') return addDays(day.today, -1);
  if (word === 'Tomorrow') return day.tomorrow;
  return day.today;
}

/**
 * The Driver view: one Driver's day, Yesterday, Today or Tomorrow (calendar
 * days, so a Sent Saturday shows on Friday), one at a time, read from the
 * Worker. It opens on Today. The first time, it asks "Who are you?" with the
 * active Drivers as large buttons; the device then remembers him, and
 * "← Drivers" goes back to that list (the device still opens on his day until
 * another Driver is picked). Every time the page comes back into view it reads
 * today again and the day shown, so a phone left overnight moves on to the new
 * day and Dave's latest changes show.
 */
export function DriverPage() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [driversFailed, setDriversFailed] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(storedDriver);
  const [picking, setPicking] = useState(false);
  const [word, setWord] = useState<Word>('Today');
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const [shown, setShown] = useState<Shown>(undefined);
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
        fetchDriverDay(driverId, dateFor(word, day)).then(
          (answer) => !stale && setShown(answer),
          () => !stale && setShown(null),
        );
      },
      () => !stale && setShown((current) => current ?? null),
    );
    return () => {
      stale = true;
    };
  }, [driverId, picking, word, refreshes]);

  const choose = (id: string) => {
    storeDriver(id);
    setDriverId(id);
    setPicking(false);
    setWord('Today');
    setShown(undefined);
  };
  const show = (next: Word) => {
    if (next === word) return;
    setWord(next);
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
            <div role="group" aria-label="Day" className="grid grid-cols-3 rounded-md border bg-background p-1">
              {DAYS.map((d) => (
                <Button key={d} type="button" size="lg" variant={d === word ? 'default' : 'ghost'} aria-pressed={d === word} onClick={() => show(d)}>
                  {d}
                </Button>
              ))}
            </div>
            <DaySection word={word} date={businessDay ? dateFor(word, businessDay) : null} shown={shown} />
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
 * The day shown: "Dave hasn't sent Monday yet." for a Draft, so it is not
 * taken for a day off; a Sent day's cards, or that there is nothing for him.
 */
function DaySection({ word, date, shown }: { word: Word; date: string | null; shown: Shown }) {
  // The day as last read, until a refresh that moved on to a new day answers.
  const day = shown?.date ?? date;
  const title = day ? `${word}, ${shortDate(day)}` : word;
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
