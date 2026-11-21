import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Copy, Loader2, Settings } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Assignment, BusinessDay, Driver, Foreman, Material, Place, Truck } from '../../shared/types';
import { isCalendarDate } from '../../shared/days';
import { AssignmentDialog } from '@/components/AssignmentDialog';
import { DayNavigation, daySubtitle } from '@/components/DayNavigation';
import { DriverCards } from '@/components/DriverCards';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { copyTodayOnto, fetchAssignments, fetchBusinessDay, fetchList, FieldErrors, Refused } from '@/lib/api';

/**
 * The Dispatch board: one day's Assignments, one card per Driver. The day on
 * screen is kept in the address (?date=), so a reload or a shared link shows
 * the same day; with no day there, the Board opens on the next Working day
 * after today (US Eastern), so on a Friday it opens on Monday.
 * Today and later days can be changed; days before today are read-only, with
 * no add, edit or delete controls (the Worker refuses those changes too).
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
  const [editing, setEditing] = useState<Assignment | null>(null);
  // Until the Worker says which day is today, nothing on the Board can be changed.
  const editable = Boolean(date && businessDay && date >= businessDay.today);
  // Copy today brings today's plan onto a later day.
  const canCopyToday = Boolean(date && businessDay && date > businessDay.today);
  const [copying, setCopying] = useState(false);

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

  useEffect(() => {
    if (!date) return;
    let stale = false;
    setAssignments(null);
    setFailed(false);
    fetchAssignments(date).then(
      (list) => !stale && setAssignments(list),
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

  async function copyToday() {
    if (!date || !businessDay) return;
    setCopying(true);
    try {
      const copies = await copyTodayOnto(date);
      if (copies.length === 0) toast.info('Today has no Assignments to copy');
      else {
        toast.success(`Copied ${copies.length} Assignment${copies.length === 1 ? '' : 's'} from today`);
        reload();
      }
    } catch (error) {
      // The Worker's own message when it gave one, e.g. the day is now before today.
      if (error instanceof FieldErrors) toast.error(Object.values(error.fields).join(' '));
      else if (error instanceof Refused) toast.error(error.message);
      else toast.error('Could not copy today');
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Dispatch" subtitle={date ? daySubtitle(date, businessDay?.today ?? null) : 'Loading…'}>
        <DayNavigation date={date} nextWorkingDay={businessDay?.nextWorkingDay ?? null} onShow={show} />
        {canCopyToday && (
          <Button variant="outline" size="lg" className="px-5" disabled={copying} onClick={copyToday}>
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copy today
          </Button>
        )}
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </Button>
        {date && editable && (
          <AssignmentDialog date={date} drivers={drivers} trucks={trucks} places={places} materials={materials} foremen={foremen} onSaved={saved} />
        )}
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
        {assignments?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-background py-16 text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No Assignments for this day</p>
            {editable && <p className="text-sm text-muted-foreground">Use Add Assignment to plan the day.</p>}
          </div>
        )}
        {assignments && assignments.length > 0 && <DriverCards assignments={assignments} onEdit={editable ? setEditing : undefined} />}
      </main>
      {date && (
        <AssignmentDialog
          date={date}
          drivers={drivers}
          trucks={trucks}
          places={places}
          materials={materials}
          foremen={foremen}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onDeleted={reload}
        />
      )}
    </div>
  );
}
