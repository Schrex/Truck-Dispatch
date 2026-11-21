import { User, UserX } from 'lucide-react';
import type { Assignment, Driver, Truck } from '../../shared/types';
import { AssignmentBlock } from '@/components/AssignmentBlock';
import { Card } from '@/components/ui/card';

interface Lane {
  key: string;
  driverName: string | null;
  /** A removed (inactive) Driver keeps a lane only on a day he has work. */
  removed: boolean;
  usualTruck: string | null;
  assignments: Assignment[];
}

/**
 * The lanes of the day, worked out from the Drivers (in the order of their
 * list) and the day's Assignments (in the order the day was read): one per
 * active Driver, one per removed Driver who has Assignments that day, one for
 * any Driver the lists do not know yet (they may still be loading), and the
 * Unassigned lane last.
 */
function lanesOf(assignments: Assignment[], drivers: Driver[] | null, trucks: Truck[] | null): Lane[] {
  const truckNumber = (id: string | null) => trucks?.find((t) => t.id === id)?.number ?? null;
  const lanes = new Map<string, Lane>();
  const lane = (key: string, driverName: string, driver?: Driver): Lane => ({
    key,
    driverName,
    removed: driver ? !driver.active : false,
    usualTruck: driver ? truckNumber(driver.defaultTruckId) : null,
    assignments: [],
  });
  const working = new Set(assignments.map((a) => a.driverId));
  for (const driver of drivers ?? []) {
    if (driver.active || working.has(driver.id)) lanes.set(driver.id, lane(driver.id, driver.name, driver));
  }
  const unassigned: Lane = { key: 'unassigned', driverName: null, removed: false, usualTruck: null, assignments: [] };
  for (const assignment of assignments) {
    if (!assignment.driverId) {
      unassigned.assignments.push(assignment);
      continue;
    }
    if (!lanes.has(assignment.driverId)) lanes.set(assignment.driverId, lane(assignment.driverId, assignment.driverName ?? 'Unknown Driver'));
    lanes.get(assignment.driverId)?.assignments.push(assignment);
  }
  return [...lanes.values(), unassigned];
}

/**
 * The Dispatch board's lanes: each Driver's name and usual Truck, then his
 * Assignments as blocks in the order Dave set, marked First and Then. Blocks
 * open their Assignment through onEdit; without it the lanes are read-only.
 * On a phone a lane's blocks stack under the Driver; from an iPad in portrait
 * up, the Driver sits on the left and the blocks run beside him.
 */
export function Lanes({
  assignments,
  drivers,
  trucks,
  onEdit,
}: {
  assignments: Assignment[];
  drivers: Driver[] | null;
  trucks: Truck[] | null;
  onEdit?: (assignment: Assignment) => void;
}) {
  return (
    <div className="space-y-3">
      {lanesOf(assignments, drivers, trucks).map((lane) => {
        const about = [lane.removed && 'Removed', lane.usualTruck && `Truck ${lane.usualTruck}`].filter(Boolean).join(' · ');
        return (
          <Card key={lane.key} role="article" aria-labelledby={`lane-${lane.key}`} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
            <div className="md:w-44 md:shrink-0">
              <h3 id={`lane-${lane.key}`} className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
                {lane.driverName ? <User className="h-4 w-4 shrink-0 text-muted-foreground" /> : <UserX className="h-4 w-4 shrink-0 text-muted-foreground" />}
                {lane.driverName ?? 'Unassigned'}
              </h3>
              {about && (
                <p data-lane-about className="text-sm text-muted-foreground">
                  {about}
                </p>
              )}
            </div>
            {lane.assignments.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground md:flex-1">Nothing planned yet</p>
            ) : (
              <ol className="grid gap-2 sm:grid-cols-2 md:flex-1 lg:grid-cols-3">
                {lane.assignments.map((assignment, i) => (
                  <AssignmentBlock key={assignment.id} assignment={assignment} first={i === 0} onEdit={onEdit} />
                ))}
              </ol>
            )}
          </Card>
        );
      })}
    </div>
  );
}
