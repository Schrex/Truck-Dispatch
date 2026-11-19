import { User, UserX } from 'lucide-react';
import type { Assignment } from '../../shared/types';
import { AssignmentLine } from '@/components/AssignmentLine';
import { Card, CardContent } from '@/components/ui/card';

interface Group {
  key: string;
  driverName: string | null;
  assignments: Assignment[];
}

/**
 * A day's Assignments as one card per Driver, in the order the day was read
 * (by Driver name), plus an "Unassigned" card last for those with no Driver.
 */
export function DriverCards({ assignments }: { assignments: Assignment[] }) {
  const groups = new Map<string, Group>();
  const unassigned: Group = { key: 'unassigned', driverName: null, assignments: [] };
  for (const assignment of assignments) {
    if (!assignment.driverId) {
      unassigned.assignments.push(assignment);
      continue;
    }
    const group = groups.get(assignment.driverId) ?? { key: assignment.driverId, driverName: assignment.driverName, assignments: [] };
    group.assignments.push(assignment);
    groups.set(assignment.driverId, group);
  }
  const cards = [...groups.values(), ...(unassigned.assignments.length > 0 ? [unassigned] : [])];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((group) => (
        <Card key={group.key} role="article" aria-labelledby={`driver-${group.key}`}>
          <CardContent className="p-4">
            <h3 id={`driver-${group.key}`} className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
              {group.driverName ? <User className="h-4 w-4 text-muted-foreground" /> : <UserX className="h-4 w-4 text-muted-foreground" />}
              {group.driverName ?? 'Unassigned'}
            </h3>
            <ul className="mt-1 divide-y">
              {group.assignments.map((assignment) => (
                <AssignmentLine key={assignment.id} assignment={assignment} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
