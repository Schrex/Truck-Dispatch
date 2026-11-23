import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Assignment, BusinessDay, CheckIn, Driver, Foreman, Material, Place, Truck, TruckProblem } from '../../shared/types';
import { isCalendarDate } from '../../shared/days';
import { AssignmentEditor } from '@/components/AssignmentEditor';
import { Composer, EMPTY_DRAFT, type Draft } from '@/components/Composer';
import { Lanes } from '@/components/Lanes';
import { DayNavigation, daySubtitle } from '@/components/DayNavigation';
import { DayCopy } from '@/components/DayCopy';
import { TakeOff } from '@/components/TakeOff';
import { PageHeader } from '@/components/PageHeader';
import { WeekStrip } from '@/components/WeekStrip';
import { ViewToggle } from '@/components/ViewToggle';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useReadOnFocus } from '@/lib/useReadOnFocus';
import { assignAssignment, discardAssignment, fetchBusinessDay, fetchCheckIns, fetchDay, fetchList, fetchTruckProblems, Refused } from '@/lib/api';
import { Loading } from '@/components/States';

/** Every open Truck problem, for the marks. */
const readOpenProblems = () => fetchTruckProblems({ open: true });

/**
 * The board: one day's Assignments, one lane per Driver. The day on
 * screen is kept in the address (?date=), so a reload or a shared link shows
 * the same day; with no day there, the Board opens on the next Working day
 * after today (US Eastern), so on a Friday it opens on Monday.
 * Today and later days can be changed; days before today are read-only, with
 * no add, edit or delete controls (the Worker refuses those changes too).
 * Adding starts from a lane's +, which opens the composer in that lane; one
 * is open at a time. Save closes it, and its draft is kept here, so the
 * next + (in any lane) starts with the same Places and Material; Close, or
 * another day, starts it empty.
 * Each Assignment is Assigned on its own (ADR 0005): a Draft with a Driver
 * has Assign on its block, one tap; there is no Send for the day. Below the
 * header the week strip shows the state of every day of the week.
 * On today each lane shows its Driver's check-in (or "Not checked in"), and
 * a red mark when his Truck today has open problems; on any day that can be
 * changed the composer's Truck chips carry the same mark.
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

  /** Each Driver's check-in on today, read only while today is on screen; null until it is read (or when it cannot be). */
  const [checkIns, setCheckIns] = useState<CheckIn[] | null>(null);
  const onToday = Boolean(date && businessDay && date === businessDay.today);

  /** The open Truck problems, read only while the day can be changed; empty until read (or when they cannot be). */
  const [problems, setProblems] = useState<TruckProblem[]>([]);

  const show = useCallback((day: string) => setSearch({ date: day }), [setSearch]);

  // Today's check-ins, read again on focus as the week strip is. One that cannot be read leaves the lanes showing
  // each Driver's usual Truck until the next focus.
  useReadOnFocus(onToday && businessDay ? businessDay.today : null, fetchCheckIns, setCheckIns);

  // Open problems are each Truck's state now, so they matter on any day Dave is planning; read again on focus, so one
  // marked fixed in Settings loses its mark. One that cannot be read leaves the marks as they were until the next focus.
  useReadOnFocus(editable ? true : null, readOpenProblems, setProblems);

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
    setFailed(false);
    fetchDay(date).then(
      (day) => !stale && setAssignments(day.assignments),
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
   * Shows Assignments as the Worker answered a change, a move, an Assign, a
   * cancel or a Put back, without reading the day again (which would close
   * the open one): each replaces itself, one the day does not have yet (the
   * copy an Assigned one's new Driver gets) joins it, then the day is put back in lane order
   * by position, ties kept in the order they were read.
   */
  const changed = (answered: Assignment[]) =>
    setAssignments((day) => {
      if (!day) return day;
      const byId = new Map(answered.map((a) => [a.id, a]));
      const added = answered.filter((a) => !day.some((d) => d.id === a.id));
      return [...day.map((a) => byId.get(a.id) ?? a), ...added].sort((x, y) => x.position - y.position);
    });
  /** A Draft ✕ deleted, or a cancelled one discarded, leaves the day, and its editor closes. */
  const deleted = (id: string) => {
    setOpenId(null);
    setAssignments((day) => day && day.filter((a) => a.id !== id));
  };
  /** Assign on a Draft's block: shown Assigned as the Worker answered, or the Worker's message when it refused. */
  const assign = async (assignment: Assignment) => {
    try {
      changed([await assignAssignment(assignment.id)]);
    } catch (error) {
      toast.error(error instanceof Refused ? error.message : 'Could not Assign it. Try again.');
    }
  };
  /** Discard on a cancelled block: it leaves the Board, or the Worker's message when it refused. */
  const discard = async (assignment: Assignment) => {
    try {
      await discardAssignment(assignment.id);
      deleted(assignment.id);
    } catch (error) {
      toast.error(error instanceof Refused ? error.message : 'Could not discard it. Try again.');
    }
  };
  // The day on screen as last read: each time it changes (an add, an Assign, any change), the week strip reads its states again.
  const dayShown = useMemo(() => (assignments ? { assignments } : null), [assignments]);
  const closeComposer = () => {
    setComposingFor(undefined);
    setDraft(EMPTY_DRAFT);
  };
  // Cancelled Assignments are off the day, so the count leaves them out.
  const live = assignments?.filter((a) => a.cancelledAt === null).length ?? 0;
  const composerLane = composingFor === undefined ? undefined : drivers?.find((driver) => driver.id === composingFor);

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader
        title="Dispatch"
        subtitle={date ? daySubtitle(date, businessDay?.today ?? null) : <Loading />}
        below={date && <WeekStrip date={date} today={businessDay?.today ?? null} refresh={dayShown} onShow={show} />}
      >
        <ViewToggle current="scheduler" />
        <DayNavigation date={date} nextWorkingDay={businessDay?.nextWorkingDay ?? null} onShow={show} />
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/fleet-imports">
            <Upload className="h-4 w-4" /> Fleet imports
          </Link>
        </Button>
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
        {live > 0 && (
          <p className="text-sm text-muted-foreground">
            {live} Assignment{live === 1 ? '' : 's'}
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
            checkIns={onToday ? (checkIns ?? undefined) : undefined}
            problems={onToday ? problems : undefined}
            onEdit={editable ? (assignment) => setOpenId((current) => (current === assignment.id ? null : assignment.id)) : undefined}
            onAssign={editable ? assign : undefined}
            onDiscard={discard}
            openId={editable ? openId : null}
            editor={(assignment, { first, last }) => (
              <AssignmentEditor
                assignment={assignment}
                lists={{ drivers, trucks, places, materials, foremen }}
                first={first}
                last={last}
                onSaved={({ assignment: saved, cancelled }) => {
                  changed(cancelled ? [cancelled, saved] : [saved]);
                  // Once it is Assigned, a new Driver's copy is the one now open, in his lane.
                  setOpenId(saved.id);
                }}
                onMoved={changed}
                onClose={() => setOpenId(null)}
                actions={<TakeOff assignment={assignment} onDeleted={deleted} onChanged={(a) => changed([a])} />}
              />
            )}
            onAdd={
              editable
                ? (driverId) => {
                    // Another lane's + starts a blank composer: nothing is carried over from the last one.
                    if (driverId !== composingFor) setDraft(EMPTY_DRAFT);
                    setComposingFor(driverId);
                  }
                : undefined
            }
            composingFor={editable ? composingFor : undefined}
            composer={
              date && (
                <Composer
                  key={composingFor ?? 'unassigned'}
                  date={date}
                  driverId={composingFor ?? null}
                  driverName={composerLane?.name ?? null}
                  usualTruckId={composerLane?.defaultTruckId ?? null}
                  lists={{ drivers, places, materials, trucks, foremen }}
                  problems={problems}
                  draft={draft}
                  onDraft={setDraft}
                  onSaved={([assignment]) => {
                    closeComposer();
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
