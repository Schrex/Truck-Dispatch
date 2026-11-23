import { useEffect, useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import type { TruckProblem } from '../../../shared/types';
import { businessDateOf, clockTime, shortDate } from '../../../shared/days';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { fetchTruckProblems, fixTruckProblem } from '@/lib/api';

/** "Thu, Nov 19 6:42": a moment's day and time in US Eastern. */
const when = (moment: string) => `${shortDate(businessDateOf(moment))} ${clockTime(moment)}`;
const nameOf = (problem: TruckProblem) => `Truck ${problem.truckNumber}: ${problem.text}`;

/**
 * Truck problems in Settings, under Trucks: open ones first, then fixed ones,
 * each newest first, as the Worker lists them. Dave marks one fixed, with an
 * optional note; it stays listed as fixed, so a Truck's history is never lost.
 * Only Drivers report problems, so there is no Add.
 */
export function TruckProblemsSection() {
  const [problems, setProblems] = useState<TruckProblem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchTruckProblems().then(setProblems, () => setFailed(true));
  }, []);

  /** Puts a problem just fixed first among the fixed ones, as the Worker would list it. */
  const closed = (fixed: TruckProblem) =>
    setProblems((current) => {
      const others = (current ?? []).filter((p) => p.id !== fixed.id);
      return [...others.filter((p) => !p.fixedAt), fixed, ...others.filter((p) => p.fixedAt)];
    });

  const open = problems?.filter((p) => !p.fixedAt) ?? [];
  const fixed = problems?.filter((p) => p.fixedAt) ?? [];
  return (
    <section aria-labelledby="section-truck-problems" className="space-y-3 rounded-lg border bg-background p-4">
      <h2 id="section-truck-problems" className="font-display text-xl font-semibold uppercase tracking-wide">
        Truck problems
      </h2>
      {failed && <p className="text-sm text-destructive">Could not load the Truck problems. Reload the page to try again.</p>}
      {!problems && !failed && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Truck problems…
        </p>
      )}
      {problems && open.length === 0 && <p className="text-sm text-muted-foreground">No open Truck problems.</p>}
      {open.length > 0 && (
        <ul aria-label="Open Truck problems" className="divide-y">
          {open.map((problem) => (
            <OpenProblem key={problem.id} problem={problem} onFixed={closed} />
          ))}
        </ul>
      )}
      {fixed.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fixed</h3>
          <ul aria-label="Fixed Truck problems" className="divide-y text-muted-foreground">
            {fixed.map((problem) => (
              <li key={problem.id} aria-label={nameOf(problem)} className="py-2">
                <Reported problem={problem} />
                <p className="text-xs">
                  Fixed {when(problem.fixedAt!)}
                  {problem.fixedNote && ` · ${problem.fixedNote}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Its Truck and note, then who reported it and when. */
function Reported({ problem }: { problem: TruckProblem }) {
  return (
    <div className="min-w-0">
      <p className="text-sm">
        <span className="font-semibold">Truck {problem.truckNumber}</span>
        <span className="ml-2">{problem.text}</span>
      </p>
      <p className="text-xs text-muted-foreground">{[problem.reportedByName, when(problem.reportedAt)].filter(Boolean).join(' · ')}</p>
    </div>
  );
}

/** An open problem with Mark fixed, which asks how it was fixed (optional) before saving. */
function OpenProblem({ problem, onFixed }: { problem: TruckProblem; onFixed: (fixed: TruckProblem) => void }) {
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const noteId = `fix-note-${problem.id}`;

  async function save() {
    setSaving(true);
    try {
      onFixed(await fixTruckProblem(problem.id, note.trim() || undefined));
    } catch {
      toast.error(`Could not mark ${nameOf(problem)} fixed`);
      setSaving(false);
    }
  }

  return (
    <li aria-label={nameOf(problem)} className="space-y-2 py-2">
      <div className="flex items-start justify-between gap-3">
        <Reported problem={problem} />
        {!fixing && (
          <Button variant="outline" size="sm" onClick={() => setFixing(true)}>
            <Wrench className="h-4 w-4" /> Mark fixed
          </Button>
        )}
      </div>
      {fixing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={noteId} className="text-xs font-medium">
              How it was fixed (optional)
            </label>
            <Input id={noteId} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} autoFocus />
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => (setFixing(false), setNote(''))}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}
