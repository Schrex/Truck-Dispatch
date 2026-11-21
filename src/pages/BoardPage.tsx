import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Assignment, BusinessDay, Driver, Foreman, Material, Place, Truck } from '../../shared/types';
import { isCalendarDate } from '../../shared/days';
import { AssignmentEditor } from '@/components/AssignmentEditor';
import { afterSave, Composer, EMPTY_DRAFT, type Draft } from '@/components/Composer';
import { Lanes } from '@/components/Lanes';
import { DayNavigation, daySubtitle } from '@/components/DayNavigation';
import { DayCopy } from '@/components/DayCopy';
import { DaySend } from '@/components/DaySend';
import { TakeOff } from '@/components/TakeOff';
import { PageHeader } from '@/components/PageHeader';
import { WeekStrip } from '@/components/WeekStrip';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { fetchBusinessDay, fetchDay, fetchList } from '@/lib/api';

/**
 * The Dispatch board: one day's Assignments, one lane per Driver. The day on
 * screen is kept in the address (?date=), so a reload or a shared link shows
 * the same day; with no day there, the Board opens on the next Working day
 * after today (US Eastern), so on a Friday it opens on Monday.
 * Today and later days can be changed; days before today are read-only, with
 * no add, edit or delete controls (the Worker refuses those changes too).
 * Adding starts from a lane's +, which opens the composer in that lane; one
 * is open at a time, and its draft is kept here, so the Places and Material
 * carry from one lane to the next until Close.
 * The header says whether the day is a Draft, Sent or Changed since Sent,
 * with Send while it is a Draft, and below it the week strip shows the
 * state of every day of the week.
 */
export function BoardPage() {
  const [search, setSearch] = useSearchParams();
  const fromAddress = search.get('date');
  const date = isCalendarDate(fromAddress) ? fromAddress : null;
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [trucks, setTrucks] = useState<Truck[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [foremen, setForemen] = useState<Foreman[] | null>(null);
  const [listsFailed, setListsFailed] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  // When the day on screen was first Sent; null while it is a Draft.
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const [noBusinessDay, setNoBusinessDay] = useState(false);
  /** The Assignment open in its lane, by id, so it stays open when a new Driver moves it; null when none is. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** The lane the composer is open in (a Driver's id, or null for Unassigned); undefined when closed. */
  const [composingFor, setComposingFor] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Until the Worker says which day is today, nothing on the Board can be changed.
  const editable = Boolean(date && businessDay && date >= businessDay.today);

  const show = useCallback((day: string) => setSearch({ date: day }), [setSearch]);

  useEffect(() => {
    // Inactive entries too, so an Assignment that still uses one shows it in its picker.
    // A list that fails to load is left empty, so the Board stays usable, and the page says so.
    const failed = () => {
      setListsFailed(true);
      return [];
    };
    fetchList('drivers', { includeInactive: true }).catch(failed).then(setDrivers);
    fetchList('trucks', { includeInactive: true }).catch(failed).then(setTrucks);
    fetchList('places', { includeInactive: true }).catch(failed).then(setPlaces);
    fetchList('materials', { includeInactive: true }).catch(failed).then(setMaterials);
    fetchList('foremen', { includeInactive: true }).catch(failed).then(setForemen);
  }, []);

  useEffect(() => {
    fetchBusinessDay().then(setBusinessDay, () => setNoBusinessDay(true));
  }, []);

  useEffect(() => {
    if (!date && businessDay) setSearch({ date: businessDay.nextWorkingDay }, { replace: true });
  }, [date, businessDay, setSearch]);

  // The composer adds to the day on screen: another day starts with it closed.
  useEffect(() => {
    setComposingFor(undefined);
    setDraft(EMPTY_DRAFT);
    setOpenId(null);
  }, [date]);

  useEffect(() => {
    if (!date) return;
    let stale = false;
    setAssignments(null);
    setSentAt(null);
    setFailed(false);
    fetchDay(date).then(
      (day) => {
        if (stale) return;
        setAssignments(day.assignments);
        setSentAt(day.sentAt);
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [date, reloads]);

  const saved = (assignment: Assignment) => {
    if (assignment.date === date) setReloads((n) => n + 1);
    else show(assignment.date);
  };
  const reload = () => setReloads((n) => n + 1);
  /**
   * Shows Assignments as the Worker answered a change, a move, a cancel or a
   * Put back, without reading the day again (which would close the open
   * one): each replaces itself, one the day does not have yet (the copy a Sent
   * day's new Driver gets) joins it, then the day is put back in lane order
   * by position, ties kept in the order they were read.
   */
  const changed = (answered: Assignment[]) =>
    setAssignments((day) => {
      if (!day) return day;
      const byId = new Map(answered.map((a) => [a.id, a]));
      const added = answered.filter((a) => !day.some((d) => d.id === a.id));
      return [...day.map((a) => byId.get(a.id) ?? a), ...added].sort((x, y) => x.position - y.position);
    });
  /** An Assignment ✕ deleted (on a Draft day) leaves the day, and its editor closes. */
  const deleted = (id: string) => {
    setOpenId(null);
    setAssignments((day) => day && day.filter((a) => a.id !== id));
  };
  // The day on screen as last read or Sent: each time it changes (an add, a Send, any change), the week strip reads its states again.
  const dayShown = useMemo(() => (assignments ? { assignments, sentAt } : null), [assignments, sentAt]);
  const closeComposer = () => {
    setComposingFor(undefined);
    setDraft(EMPTY_DRAFT);
  };
  const composerLane = composingFor === undefined ? undefined : drivers?.find((driver) => driver.id === composingFor);

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader
        title="Dispatch"
        subtitle={date ? daySubtitle(date, businessDay?.today ?? null) : 'Loading…'}
        below={date && <WeekStrip date={date} today={businessDay?.today ?? null} refresh={dayShown} onShow={show} />}
      >
        <ViewToggle current="scheduler" />
        <DayNavigation date={date} nextWorkingDay={businessDay?.nextWorkingDay ?? null} onShow={show} />
        {date && <DaySend date={date} assignments={assignments} sentAt={sentAt} editable={editable} onSent={setSentAt} />}
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </Button>
      </PageHeader>

      <main className="container space-y-4 py-6">
        {listsFailed && (
          <p className="text-sm text-destructive">
            Could not load the Drivers, Trucks, Places, Materials and Foremen to pick from. Reload the page to try again.
          </p>
        )}
        {assignments && assignments.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {assignments.length} Assignment{assignments.length === 1 ? '' : 's'}
          </p>
        )}

        {date && businessDay && !editable && (
          <p className="text-sm text-muted-foreground">This day is before today, so it is read-only.</p>
        )}
        {(failed || (!date && noBusinessDay)) && <p className="text-sm text-destructive">Could not load the Assignments for this day.</p>}
        {!assignments && !failed && !(!date && noBusinessDay) && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Assignments…
          </p>
        )}
        {date && assignments && (
          <DayCopy
            key={date}
            date={date}
            assignments={assignments}
            businessDay={businessDay}
            onStarted={setAssignments}
            onRefused={reload}
            onCopied={show}
          />
        )}
        {assignments && (
          <Lanes
            assignments={assignments}
            drivers={drivers}
            trucks={trucks}
            places={places}
            onEdit={editable ? (assignment) => setOpenId((current) => (current === assignment.id ? null : assignment.id)) : undefined}
            openId={editable ? openId : null}
            editor={(assignment, { first, last }) => (
              <AssignmentEditor
                assignment={assignment}
                lists={{ drivers, trucks, places, materials, foremen }}
                first={first}
                last={last}
                onSaved={({ assignment: saved, cancelled }) => {
                  changed(cancelled ? [cancelled, saved] : [saved]);
                  // On a Sent day a new Driver's copy is the one now open, in his lane.
                  setOpenId(saved.id);
                }}
                onMoved={changed}
                onClose={() => setOpenId(null)}
                actions={<TakeOff assignment={assignment} sent={sentAt !== null} onDeleted={deleted} onChanged={(a) => changed([a])} />}
              />
            )}
            onAdd={editable ? setComposingFor : undefined}
            composingFor={editable ? composingFor : undefined}
            composer={
              date && (
                <Composer
                  key={composingFor ?? 'unassigned'}
                  date={date}
                  driverId={composingFor ?? null}
                  driverName={composerLane?.name ?? null}
                  lists={{ places, materials, trucks, foremen }}
                  draft={draft}
                  onDraft={setDraft}
                  onSaved={(assignment) => {
                    setDraft(afterSave);
                    saved(assignment);
                  }}
                  onClose={closeComposer}
                />
              )
            }
          />
        )}
      </main>
    </div>
  );
}
