import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Loader2, Settings } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Assignment, BusinessDay, Driver } from '../../shared/types';
import { AssignmentDialog } from '@/components/AssignmentDialog';
import { DriverCards } from '@/components/DriverCards';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchAssignments, fetchBusinessDay, fetchDrivers } from '@/lib/api';
import { formatDate, isDate, shiftDate } from '@/lib/dates';

/**
 * The Dispatch board: one day's Assignments, one card per Driver. The day on
 * screen is kept in the address (?date=), so a reload or a shared link shows
 * the same day; with no day there, the Board opens on tomorrow (US Eastern).
 * Today and later days can be changed; days before today are read-only, with
 * no add, edit or delete controls (the Worker refuses those changes too).
 */
export function BoardPage() {
  const [search, setSearch] = useSearchParams();
  const fromAddress = search.get('date');
  const date = isDate(fromAddress) ? fromAddress : null;
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null);
  const [noBusinessDay, setNoBusinessDay] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  // Until the Worker says which day is today, nothing on the Board can be changed.
  const editable = Boolean(date && businessDay && date >= businessDay.today);

  const show = (day: string, replace = false) => setSearch({ date: day }, { replace });

  useEffect(() => {
    fetchDrivers().then(setDrivers, () => setDrivers([]));
  }, []);

  useEffect(() => {
    fetchBusinessDay().then(setBusinessDay, () => setNoBusinessDay(true));
  }, []);

  useEffect(() => {
    if (!date && businessDay) setSearch({ date: businessDay.tomorrow }, { replace: true });
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

  return (
    <div className="min-h-screen bg-surface">
      <PageHeader title="Dispatch" subtitle={date ? formatDate(date) : 'Loading…'}>
        <div className="space-y-1.5">
          <label htmlFor="jump-to" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Jump to
          </label>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Previous day" disabled={!date} onClick={() => date && show(shiftDate(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input id="jump-to" type="date" className="h-11 w-44" value={date ?? ''} onChange={(e) => isDate(e.target.value) && show(e.target.value)} />
            <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Next day" disabled={!date} onClick={() => date && show(shiftDate(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Button asChild variant="outline" size="lg" className="px-5">
          <Link to="/settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </Button>
        {date && editable && <AssignmentDialog date={date} drivers={drivers} onSaved={saved} />}
      </PageHeader>

      <main className="container space-y-4 py-6">
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
        <AssignmentDialog date={date} drivers={drivers} editing={editing} onClose={() => setEditing(null)} onSaved={saved} onDeleted={reload} />
      )}
    </div>
  );
}
