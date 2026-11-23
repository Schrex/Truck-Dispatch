import type { CSSProperties, ReactNode } from 'react';
import { Plus, UserX } from 'lucide-react';
import type { Assignment, CheckIn, Driver, Place, Truck, TruckProblem } from '../../shared/types';
import { clockTime } from '../../shared/days';
import { AssignmentBlock } from '@/components/AssignmentBlock';
import { LaneProblems, openOn } from '@/components/ProblemMark';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, initials } from '@/lib/utils';
import { EmptyBox } from '@/components/States';

interface Lane {
  key: string;
  /** The lane's Driver; null for Unassigned. */
  driverId: string | null;
  driverName: string | null;
  /** A removed (inactive) Driver keeps a lane only on a day he has work. */
  removed: boolean;
  /** His usual Truck; null for none, for Unassigned, or while the Trucks load. */
  usualTruck: { id: string; number: string } | null;
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
  const truckOf = (id: string | null) => {
    const truck = trucks?.find((t) => t.id === id);
    return truck ? { id: truck.id, number: truck.number } : null;
  };
  const lanes = new Map<string, Lane>();
  const lane = (key: string, driverName: string, driver?: Driver): Lane => ({
    key,
    driverId: key,
    driverName,
    removed: driver ? !driver.active : false,
    usualTruck: driver ? truckOf(driver.defaultTruckId) : null,
    assignments: [],
  });
  const working = new Set(assignments.map((a) => a.driverId));
  for (const driver of drivers ?? []) {
    if (driver.active || working.has(driver.id)) lanes.set(driver.id, lane(driver.id, driver.name, driver));
  }
  const unassigned: Lane = { key: 'unassigned', driverId: null, driverName: null, removed: false, usualTruck: null, assignments: [] };
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
 * The Truck line under a lane's Driver: his usual Truck (in grey), or, while
 * today's check-ins are given, the Truck he checked in to and when (adding
 * "needs repair" when that Inspection found something), or "Not checked in".
 */
function truckLine(lane: Lane, checkIns: CheckIn[] | undefined): string | null {
  const usual = lane.usualTruck && `Truck ${lane.usualTruck.number}`;
  if (!checkIns || !lane.driverId) return usual;
  const checkIn = checkIns.find((c) => c.driverId === lane.driverId);
  if (!checkIn) return 'Not checked in';
  return `Truck ${checkIn.truckNumber} · checked in ${clockTime(checkIn.doneAt)}${checkIn.needsRepair ? ' · needs repair' : ''}`;
}

/**
 * The Truck a lane's Driver has today, for its red mark: the one he checked in
 * to, or his usual one before he checks in (or while check-ins are not read).
 */
function truckToday(lane: Lane, checkIns: CheckIn[] | undefined): { id: string; number: string } | null {
  const checkIn = checkIns?.find((c) => c.driverId === lane.driverId);
  if (checkIn) return { id: checkIn.truckId, number: checkIn.truckNumber };
  return lane.usualTruck;
}

/**
 * A lane's avatar: the Driver's initials on the Hub's yellow (greyed for a
 * removed Driver), or a dashed ring for Unassigned. Decoration only: the lane's
 * heading names it.
 */
function LaneAvatar({ name, removed }: { name: string | null; removed: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full font-display text-sm font-semibold tracking-wide',
        !name && 'border-2 border-dashed border-muted-foreground/40 text-muted-foreground',
        name && !removed && 'bg-primary text-primary-foreground shadow-xs ring-2 ring-background',
        name && removed && 'bg-muted text-muted-foreground',
      )}
    >
      {name ? initials(name) : <UserX className="h-4 w-4" />}
    </span>
  );
}

/** Where an open Assignment sits in its lane, so its editor offers only the moves it can make. */
export interface InLane {
  first: boolean;
  last: boolean;
}

/**
 * Whether the open Assignment is the first or the last of its lane that is not
 * cancelled: cancelled ones keep their place but moves step over them.
 */
function inLane(assignments: Assignment[], openId: string | null | undefined): InLane {
  const on = assignments.filter((assignment) => !assignment.cancelledAt);
  return { first: on[0]?.id === openId, last: on[on.length - 1]?.id === openId };
}

/**
 * The board's lanes: each Driver's name and usual Truck (or, with checkIns,
 * his check-in today), then his
 * Assignments as blocks in the order Dave set, marked First and Then. Tapping
 * a block calls onEdit; the block named by openId is shown open, with what
 * `editor` gives for it under the lane's blocks. With onAdd each lane but a removed
 * Driver's has a + that asks for the composer, which the lane named by
 * composingFor (a Driver's id, or null for Unassigned) shows under its
 * Driver. With onAssign each Draft with an active Driver has Assign on its block,
 * and an Unassigned lane holding Drafts says to pick a Driver to Assign one.
 * With onDiscard each cancelled block has Discard, on any day.
 * Without them the lanes are read-only.
 * With unplanned, a Driver's lane with Unplanned work that day says how many
 * pieces after his blocks ("1 Unplanned work"); with none the lane is as before.
 * On a phone a lane's blocks stack under the Driver; from an iPad in portrait
 * up, the Driver sits on the left and the blocks run beside him.
 */
export function Lanes({
  assignments,
  drivers,
  trucks,
  places = null,
  checkIns,
  problems,
  onEdit,
  onAssign,
  onDiscard,
  openId,
  editor,
  onAdd,
  composingFor,
  composer,
  unplanned,
}: {
  assignments: Assignment[];
  drivers: Driver[] | null;
  trucks: Truck[] | null;
  /** The Places, so each block names its Foreman beside the job site; null while they load. */
  places?: Place[] | null;
  /** Each Driver's check-in on today, given only while today is on screen; without it each lane shows its usual Truck. */
  checkIns?: CheckIn[];
  /** The open Truck problems, given only while today is on screen: a lane whose Driver's Truck today has one gets a red mark. */
  problems?: TruckProblem[];
  onEdit?: (assignment: Assignment) => void;
  /** Assigns a Draft that has a Driver; settles once the Worker has answered. */
  onAssign?: (assignment: Assignment) => Promise<void>;
  /** Discards a cancelled Assignment from the Board; settles once the Worker has answered. */
  onDiscard?: (assignment: Assignment) => Promise<void>;
  /** The Assignment shown open; null or undefined when none is. */
  openId?: string | null;
  /** The open Assignment's editor, shown in its lane. */
  editor?: (assignment: Assignment, inLane: InLane) => ReactNode;
  onAdd?: (driverId: string | null) => void;
  /** Which lane the composer is open in; undefined when it is closed. */
  composingFor?: string | null;
  composer?: ReactNode;
  /** How many pieces of Unplanned work each Driver (by id) has that day; only the simulation gives it so far. */
  unplanned?: Record<string, number>;
}) {
  const jobSites = new Set((places ?? []).filter((p) => p.kind === 'job_site').map((p) => p.id));
  return (
    <div className="space-y-3">
      {lanesOf(assignments, drivers, trucks).map((lane, laneIndex) => {
        const about = [lane.removed && 'Removed', truckLine(lane, checkIns)].filter(Boolean).join(' · ');
        const name = lane.driverName ?? 'Unassigned';
        const openAt = lane.assignments.findIndex((assignment) => assignment.id === openId);
        // First is the first that is not cancelled, as the moves count them; a cancelled one is off the day.
        const firstAt = lane.assignments.findIndex((assignment) => assignment.cancelledAt === null);
        const truck = problems && lane.driverId ? truckToday(lane, checkIns) : null;
        const open = openOn(truck?.id, problems);
        const aboutLine = about && (
          <p data-lane-about className="text-sm text-muted-foreground">
            {about}
          </p>
        );
        const waiting = onAssign && !lane.driverId && lane.assignments.some((assignment) => assignment.assignedAt === null && !assignment.cancelledAt);
        return (
          <Card
            key={lane.key}
            role="article"
            aria-labelledby={`lane-${lane.key}`}
            style={{ '--i': laneIndex } as CSSProperties}
            className={cn('animate-rise space-y-3 p-4 transition-shadow duration-200', (openAt >= 0 || composingFor === lane.driverId) && 'shadow-md')}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start">
              <div className="flex items-start justify-between gap-2 md:w-64 md:shrink-0 lg:w-72">
                <div className="flex min-w-0 items-start gap-3">
                  <LaneAvatar name={lane.driverName} removed={lane.removed} />
                  <div className="min-w-0 pt-0.5">
                  <h3 id={`lane-${lane.key}`} className="font-display text-lg font-semibold uppercase leading-tight tracking-wide">
                    {name}
                  </h3>
                  {truck && open.length > 0 ? (
                    <LaneProblems truckNumber={truck.number} problems={open}>
                      {aboutLine}
                    </LaneProblems>
                  ) : (
                    aboutLine
                  )}
                  {waiting && <p className="text-sm text-muted-foreground">Pick a Driver to Assign</p>}
                  </div>
                </div>
                {onAdd && !lane.removed && (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Add an Assignment for ${name}`}
                    aria-expanded={composingFor === lane.driverId}
                    className={cn(
                      'group h-11 w-11 shrink-0 rounded-full border-dashed hover:border-solid hover:border-primary hover:bg-primary hover:text-primary-foreground',
                      composingFor === lane.driverId && 'border-solid border-primary bg-primary text-primary-foreground',
                    )}
                    onClick={() => onAdd(lane.driverId)}
                  >
                    <Plus className={cn('h-5 w-5 transition-transform duration-200 ease-spring group-hover:rotate-90', composingFor === lane.driverId && 'rotate-45')} />
                  </Button>
                )}
              </div>
              {(() => {
                const unplannedCount = (lane.driverId && unplanned?.[lane.driverId]) || 0;
                const blocks = (fill: boolean) => (
                  <ol className={fill ? 'grid gap-2 sm:grid-cols-2 md:flex-1 lg:grid-cols-3' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
                    {lane.assignments.map((assignment, i) => (
                      <AssignmentBlock
                        key={assignment.id}
                        assignment={assignment}
                        first={i === firstAt}
                        usualTruck={lane.usualTruck?.number ?? null}
                        jobSites={jobSites}
                        onEdit={onEdit}
                        onAssign={lane.removed ? undefined : onAssign}
                        onDiscard={onDiscard}
                        open={i === openAt}
                      />
                    ))}
                  </ol>
                );
                if (unplannedCount === 0)
                  return lane.assignments.length === 0 ? <EmptyBox className="md:flex-1">Nothing planned yet</EmptyBox> : blocks(true);
                return (
                  <div className="space-y-2 md:flex-1">
                    {lane.assignments.length > 0 && blocks(false)}
                    {/* Amber, as the Truck log's Unplanned work box: for Dave to answer (docs/design/ui-standards.md). */}
                    <p className="inline-flex rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm font-semibold">
                      {unplannedCount} Unplanned work
                    </p>
                  </div>
                );
              })()}
            </div>
            {openAt >= 0 && editor?.(lane.assignments[openAt], inLane(lane.assignments, openId))}
            {composingFor === lane.driverId && composer}
          </Card>
        );
      })}
    </div>
  );
}
