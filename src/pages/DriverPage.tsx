import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { BusinessDay, CheckIn as CheckInRead, Driver, DriverAssignment, DriverDay } from '../../shared/types';
import { addDays, dayLabel, shortDate, weekdayName } from '../../shared/days';
import { CheckIn } from '@/components/CheckIn';
import { DriverCard } from '@/components/DriverCard';
import { PageHeader } from '@/components/PageHeader';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { dismissAssignment, fetchBusinessDay, fetchCheckIns, fetchDriverDay, fetchList, fetchNextAssigned, Refused } from '@/lib/api';
import { storedDriver, storeDriver } from '@/lib/deviceView';
import { initials } from '@/lib/utils';

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
 * so on a Friday Tomorrow is Saturday), and ‹ › (each naming the day it goes to, "Sat 21") step one calendar day at a time,
 * weekends included, as far as he likes, since Dave can plan any day. When
 * Dave has Assigned him work beyond tomorrow, "Next from Dave: Mon, Nov 23 →"
 * takes him there, so a weekend never hides Monday. The first time, it asks
 * "Who are you?" with the active Drivers as large buttons; the device then
 * remembers him, and Change (beside his name, under the title) goes back to that list (the device still
 * opens on his day until another Driver is picked). Every time the page comes
 * back into view it reads today again and the day shown, so a phone left
 * overnight on Today moves on to the new day and Dave's latest changes show.
 * On Today only, the Check in card (or, once he has checked in, its one line)
 * sits above his Assignments (components/CheckIn.tsx); when his check-in
 * cannot be read, it says so and still offers the card.
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
  const [nextAssigned, setNextAssigned] = useState<string | null>(null);
  /** His latest check-in today: loading (undefined), none (null), or as the Worker read it. */
  const [checkIn, setCheckIn] = useState<CheckInRead | null | undefined>(undefined);
  const [checkInFailed, setCheckInFailed] = useState(false);
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
        // Today's check-in, read whichever day is shown, so Today never waits for it.
        fetchCheckIns(day.today).then(
          (all) => {
            if (stale) return;
            setCheckIn(all.find((c) => c.driverId === driverId) ?? null);
            setCheckInFailed(false);
          },
          () => !stale && setCheckInFailed(true),
        );
        // Only a pointer: if it cannot be read, the line is simply not shown.
        fetchNextAssigned(driverId).then(
          (date) => !stale && setNextAssigned(date),
          () => !stale && setNextAssigned(null),
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
    setNextAssigned(null);
    setCheckIn(undefined);
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
        subtitle={driver && !asking ? <WhoIsUsing name={driver.name} onChange={() => setPicking(true)} /> : 'Driver view'}
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
              {drivers?.map((d, i) => (
                <Button
                  key={d.id}
                  variant="outline"
                  style={{ '--i': i } as CSSProperties}
                  className="lift group h-auto animate-rise justify-start gap-4 rounded-lg bg-card px-4 py-4 text-xl shadow-sm"
                  onClick={() => choose(d.id)}
                >
                  {/* The initials are drawn by CSS, so the button reads as his name alone. */}
                  <span
                    aria-hidden
                    data-initials={initials(d.name)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary font-display text-lg font-semibold text-primary-foreground shadow-xs before:content-[attr(data-initials)]"
                  />
                  <span className="flex-1 text-left">{d.name}</span>
                  <ChevronRight aria-hidden className="h-5 w-5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1" />
                </Button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="flex items-stretch gap-1">
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 w-12 shrink-0 flex-col gap-0 px-1 text-xs"
                aria-label={date ? `Day before, ${dayLabel(addDays(date, -1))}` : 'Day before'}
                disabled={!date}
                onClick={() => date && show(addDays(date, -1))}
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
                className="h-auto min-h-11 w-12 shrink-0 flex-col gap-0 px-1 text-xs"
                aria-label={date ? `Day after, ${dayLabel(addDays(date, 1))}` : 'Day after'}
                disabled={!date}
                onClick={() => date && show(addDays(date, 1))}
              >
                <ChevronRight className="h-5 w-5" />
                {date && dayLabel(addDays(date, 1))}
              </Button>
            </div>
            {driver && today && date === today && (
              <>
                {checkIn === undefined && checkInFailed && (
                  <p className="text-destructive">Could not load your check-in. It tries again when you come back to the page.</p>
                )}
                {/* A check-in that cannot be read never stops him checking in: the latest one counts. */}
                {(checkIn !== undefined || checkInFailed) && (
                  <CheckIn
                    key={driver.id}
                    driver={driver}
                    today={today}
                    checkIn={checkIn ?? null}
                    onCheckedIn={(done) => {
                      setCheckIn(done);
                      setCheckInFailed(false);
                    }}
                  />
                )}
              </>
            )}
            {nextAssigned && nextAssigned !== date && (
              <button
                type="button"
                className="lift flex min-h-14 w-full animate-rise items-center justify-between gap-3 rounded-lg border border-primary/50 bg-primary/10 px-4 text-left text-lg font-medium"
                onClick={() => show(nextAssigned)}
              >
                Next from Dave: {shortDate(nextAssigned)} →
              </button>
            )}
            <DaySection
              today={today}
              date={date}
              shown={shown}
              onDismiss={async (assignment) => {
                try {
                  await dismissAssignment(assignment.id);
                  setShown((day) => day && { ...day, assignments: day.assignments.filter((a) => a.id !== assignment.id) });
                } catch (error) {
                  toast.error(error instanceof Refused ? error.message : 'Could not dismiss it. Try again.');
                }
              }}
            />
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
 * Who is using the phone, under the title: his initials, his name and Change,
 * which goes back to "Who are you?" so a shared phone can change hands. It
 * sits where every page says what it is showing, so "← Hub" stays the one
 * thing top left (docs/design/ui-standards.md).
 */
function WhoIsUsing({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        data-initials={initials(name)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xs font-semibold text-primary-foreground before:content-[attr(data-initials)]"
      />
      <span className="text-sm font-medium">{name}</span>
      <Button type="button" variant="ghost" size="sm" aria-label="Change Driver" className="h-11 px-3 text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

/**
 * The day shown, titled "Today, Sun, Nov 22" (Yesterday and Tomorrow too) or
 * just "Mon, Nov 23" for any other day: his Assigned Assignments as cards, or
 * "Nothing from Dave yet for Monday." while Dave has Assigned him nothing.
 * A cancelled card has Dismiss, which clears it off his day.
 */
function DaySection({
  today,
  date,
  shown,
  onDismiss,
}: {
  today: string | null;
  date: string | null;
  shown: Shown;
  onDismiss: (assignment: DriverAssignment) => Promise<void>;
}) {
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
      {shown && shown.assignments.length === 0 && (
        <p className="animate-rise rounded-lg border border-dashed bg-card/60 p-6 text-center text-lg text-muted-foreground">Nothing from Dave yet for {weekdayName(shown.date)}.</p>
      )}
      {shown?.assignments.map((assignment, i) => <DriverCard key={assignment.id} assignment={assignment} index={i} onDismiss={onDismiss} />)}
    </section>
  );
}
