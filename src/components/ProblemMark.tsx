import { useId, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import type { TruckProblem } from '../../shared/types';

/** A Truck's open problems, from the open ones the page read: none for no Truck. */
export function openOn(truckId: string | null | undefined, problems: TruckProblem[] | undefined): TruckProblem[] {
  return truckId ? (problems ?? []).filter((problem) => problem.truckId === truckId && !problem.fixedAt) : [];
}

/** Each problem's note on its own line: what hovering a red mark says. */
const notes = (problems: TruckProblem[]) => problems.map((problem) => problem.text).join('\n');

/**
 * The red mark on a Board lane whose Truck has open problems, beside the
 * lane's Truck line (children). Hovering it says what they are; tapping it
 * (there is no hover on an iPad) lists them under the line, and tapping again
 * puts the list away.
 */
export function LaneProblems({ truckNumber, problems, children }: { truckNumber: string; problems: TruckProblem[]; children?: ReactNode }) {
  const [shown, setShown] = useState(false);
  const listId = useId();
  const name = `Open problems on Truck ${truckNumber}`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          aria-label={name}
          aria-expanded={shown}
          aria-controls={listId}
          title={notes(problems)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
          onClick={() => setShown((now) => !now)}
        >
          <CircleAlert className="h-5 w-5" />
        </button>
      </div>
      {shown && (
        <ul id={listId} aria-label={name} className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem.id}>{problem.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The red mark on a Truck chip whose Truck has open problems; hovering it says what they are. */
export function ChipProblems({ problems }: { problems: TruckProblem[] }) {
  return (
    <span role="img" aria-label="open problems" title={notes(problems)} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />
  );
}
