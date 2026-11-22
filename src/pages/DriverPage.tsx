import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { BusinessDay, Driver, DriverDay } from '../../shared/types';
import { shortDate, weekdayName } from '../../shared/days';
import { DriverCard } from '@/components/DriverCard';
import { PageHeader } from '@/components/PageHeader';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { fetchBusinessDay, fetchDriverDay, fetchList } from '@/lib/api';
import { storedDriver, storeDriver } from '@/lib/deviceView';

/** A day as the page holds it: loading (undefined), failed (null), or as the Worker read it. */
type Shown = DriverDay | null | undefined;

/**
 * The Driver view: one Driver's today and tomorrow (calendar days, so a Sent
 * Saturday shows on Friday), read from the Worker. The first time, it asks
 * "Who are you?" with the active Drivers as large buttons; the device then
 * remembers him, and "Not you?" asks again. Every time the page comes back
 * into view it reads today again and both days, so a phone left overnight
 * moves on to the new day and Dave's latest changes show.
 */
export function DriverPage() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [driversFailed, setDriversFailed] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(storedDriver);
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const [today, setToday] = useState<Shown>(undefined);
  const [tomorrow, setTomorrow] = useState<Shown>(undefined);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    fetchList('drivers').then(setDrivers, () => setDriversFailed(true));
  }, []);

  // Coming back to the page (focus, or the tab shown again) reads everything again.
  useEffect(() => {
    const refresh = () => setRefreshes((n) => n + 1);
    const shown = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', shown);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', shown);
    };
  }, []);

  // A remembered Driver who is no longer in the list (removed) is asked again.
  const driver = drivers?.find((d) => d.id === driverId) ?? null;
  const asking = driverId === null || (drivers !== null && driver === null);

  useEffect(() => {
    if (!driverId) return;
    let stale = false;
    // What is on screen stays until the new read answers, so a refresh does not flash.
    fetchBusinessDay().then(
      (day) => {
        if (stale) return;
        setBusinessDay(day);
        const read = (date: string, show: (shown: Shown) => void) =>
          fetchDriverDay(driverId, date).then(
            (answer) => !stale && show(answer),
            () => !stale && show(null),
          );
        read(day.today, setToday);
        read(day.tomorrow, setTomorrow);
      },
      () => {
        if (stale) return;
        setToday((shown) => shown ?? null);
        setTomorrow((shown) => shown ?? null);
      },
    );
    return () => {
      stale = true;
    };
  }, [driverId, refreshes]);

  const choose = (id: string | null) => {
    storeDriver(id);
    setDriverId(id);
    setBusinessDay(null);
    setToday(undefined);
    setTomorrow(undefined);
  };

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Dispatch" subtitle={driver && !asking ? driver.name : 'Driver view'}>
        <ViewToggle current="driver" />
        {!asking && (
          <Button variant="outline" size="lg" className="px-5" onClick={() => choose(null)}>
            Not you?
          </Button>
        )}
      </PageHeader>

      <main className="container max-w-2xl space-y-8 py-6">
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
            <DaySection word="Today" date={businessDay?.today ?? null} shown={today} />
            <DaySection word="Tomorrow" date={businessDay?.tomorrow ?? null} shown={tomorrow} />
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
 * Today or tomorrow: "Dave hasn't sent Monday yet." for a Draft, so it is not
 * taken for a day off; a Sent day's cards, or that there is nothing for him.
 */
function DaySection({ word, date, shown }: { word: string; date: string | null; shown: Shown }) {
  // The day as last read, until a refresh that moved on to a new day answers.
  const day = shown?.date ?? date;
  const title = day ? `${word}, ${shortDate(day)}` : word;
  const id = `day-${word.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-display text-2xl font-semibold uppercase tracking-wide">
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
