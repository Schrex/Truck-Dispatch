import type { CSSProperties, ReactNode } from 'react';
import { CircleHelp, Plus, UserX } from 'lucide-react';
import type { Assignment, CheckIn, DayTruck, Driver, StoredUnplanned, StoredWhichAssignment, Truck, TruckProblem } from '../../shared/types';
import { clockTime, easternTime } from '../../shared/days';
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
function lanesOf(assignments: Assignment[], drivers: Driver[] | null, trucks: Truck[] | null, stored: DayTruck[]): Lane[] {
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
  // A Driver with Unplanned work that day has a lane too, even with no Assignments.
  const unplannedDrivers = stored.flatMap((t) => t.unplanned.flatMap((w) => (w.driver ? [w.driver] : [])));
  const working = new Set([...assignments.map((a) => a.driverId), ...unplannedDrivers.map((d) => d.id)]);
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
  for (const driver of unplannedDrivers) if (!lanes.has(driver.id)) lanes.set(driver.id, lane(driver.id, driver.name));
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

/** An avatar's round shape, whoever it stands for. */
const AVATAR = 'flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full font-display text-sm font-semibold tracking-wide';

/** The "Driver not known" row's avatar: a solid amber ring with a ?, for Dave to answer, never Unassigned's dashed ring (docs/design/ui-standards.md). */
function NotKnownAvatar() {
  return (
    <span aria-hidden className={cn(AVATAR, 'border-2 border-warning bg-warning/10')}>
      <CircleHelp className="h-4 w-4" />
    </span>
  );
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
        AVATAR,
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

/** "1 Unplanned work" under a lane's blocks, amber as the Truck log's box: for Dave to answer (docs/design/ui-standards.md). With onOpen it is a button that opens the answer. */
function UnplannedMarker({ count, onOpen }: { count: number; onOpen?: () => void }) {
  if (!onOpen) return <p className="inline-flex rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm font-semibold">{count} Unplanned work</p>;
  return (
    <button
      type="button"
      className="lift inline-flex h-11 items-center rounded-md border border-warning bg-warning/10 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      {count} Unplanned work
    </button>
  );
}

/** The amber of Unplanned work and "Which Assignment?", as the Truck log's boxes: for Dave to answer (docs/design/ui-standards.md). */
const AMBER_BOX = 'rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm';

/** "1 Unplanned work" with each piece's Places and times, "J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · 14:15–14:43": shown, not answered. */
function StoredUnplannedBox({ pieces }: { pieces: StoredUnplanned[] }) {
  const title = `${pieces.length} Unplanned work`;
  return (
    <div role="group" aria-label={title} className={AMBER_BOX}>
      <p className="font-semibold">{title}</p>
      {pieces.map((w) => (
        <p key={w.id}>{`${w.places.join(' ⇄ ')} · ${easternTime(w.leftAt)}–${easternTime(w.arrivedAt)}`}</p>
      ))}
    </div>
  );
}

/** The Trips two of the lane's Assignments fit equally: planned work, never Unplanned work. */
function WhichAssignmentBox({ ties }: { ties: StoredWhichAssignment[] }) {
  return (
    <div role="group" aria-label="Which Assignment?" className={AMBER_BOX}>
      <p className="font-semibold">Which Assignment?</p>
      {ties.map((q) => (
        <p key={q.id}>{`${easternTime(q.id)} ${q.from} → ${q.to}`}</p>
      ))}
    </div>
  );
}

/**
 * The board's lanes: each Driver's name and usual Truck (or, with checkIns,
 * his check-in today), then his
 * Assignments as blocks in the order Dave set, marked First and Then. Tapping
 * a block calls onEdit; the block named by openId is shown open, with what
 * `editor` gives for it under the lane's blocks. With onAdd each lane but a removed
 * Driver's has a + that asks for the composer, which the lane named by
 * composingFor (a Driver's id, or null for Unassigned) shows under its
 * Driver; there the + turns to × ("Close the composer for …") and onAdd
 * with that lane closes it. With onAssign each Draft with an active Driver has Assign on its block,
 * and an Unassigned lane holding Drafts says to pick a Driver to Assign one.
 * With onDiscard each cancelled block has Discard, on any day.
 * Without them the lanes are read-only.
 * With unplanned, a Driver's lane with Unplanned work that day says how much
 * after his blocks ("1 Unplanned work"); with none the lane is as before.
 * With onUnplanned as well, that marker is a button that opens the answer.
 * With stored (a real day's stored Trips), each piece of Unplanned work shows
 * after the blocks of the Driver at its time, with its Places and times, and
 * each Trip two of a lane's Assignments fit asks "Which Assignment?" there;
 * a piece with no Driver known shows in its own row under the lanes,
 * "Driver not known · Truck 55", never in Unassigned.
 * On a phone a lane's blocks stack under the Driver; from an iPad in portrait
 * up, the Driver sits on the left and the blocks run beside him.
 */
export function Lanes({
  assignments,
  drivers,
  trucks,
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
  onUnplanned,
  stored = [],
}: {
  assignments: Assignment[];
  drivers: Driver[] | null;
  trucks: Truck[] | null;
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
  /** How much Unplanned work each Driver (by id) has that day; only the simulation gives it so far. */
  unplanned?: Record<string, number>;
  /** Dave taps a Driver's Unplanned work marker (by the Driver's id) to answer it. */
  onUnplanned?: (driverId: string) => void;
  /** Each Truck's Unplanned work and ties from its stored Trips that day; none without stored visits. */
  stored?: DayTruck[];
}) {
  return (
    <div className="space-y-3">
      {lanesOf(assignments, drivers, trucks, stored).map((lane, laneIndex) => {
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
        const unplannedCount = (lane.driverId && unplanned?.[lane.driverId]) || 0;
        const pieces = lane.driverId ? stored.flatMap((t) => t.unplanned.filter((w) => w.driver?.id === lane.driverId)) : [];
        const ties = stored.flatMap((t) => t.whichAssignment.filter((q) => q.assignmentIds.some((id) => lane.assignments.some((x) => x.id === id))));
        const after = unplannedCount > 0 || pieces.length > 0 || ties.length > 0;
        // Beside the Driver the blocks fill the row, unless the Unplanned work marker sits under them.
        const blockList = (
          <ol className={!after ? 'grid gap-2 sm:grid-cols-2 md:flex-1 lg:grid-cols-3' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
            {lane.assignments.map((assignment, i) => (
              <AssignmentBlock
                key={assignment.id}
                assignment={assignment}
                first={i === firstAt}
                usualTruck={lane.usualTruck?.number ?? null}
                onEdit={onEdit}
                onAssign={lane.removed ? undefined : onAssign}
                onDiscard={onDiscard}
                open={i === openAt}
              />
            ))}
          </ol>
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
                    aria-label={composingFor === lane.driverId ? `Close the composer for ${name}` : `Add an Assignment for ${name}`}
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
              {!after ? (
                lane.assignments.length === 0 ? <EmptyBox className="md:flex-1">Nothing planned yet</EmptyBox> : blockList
              ) : (
                <div className="space-y-2 md:flex-1">
                  {lane.assignments.length > 0 && blockList}
                  {unplannedCount > 0 && (
                    <UnplannedMarker count={unplannedCount} onOpen={onUnplanned && lane.driverId ? () => onUnplanned(lane.driverId!) : undefined} />
                  )}
                  {ties.length > 0 && <WhichAssignmentBox ties={ties} />}
                  {pieces.length > 0 && <StoredUnplannedBox pieces={pieces} />}
                </div>
              )}
            </div>
            {openAt >= 0 && editor?.(lane.assignments[openAt], inLane(lane.assignments, openId))}
            {composingFor === lane.driverId && composer}
          </Card>
        );
      })}
      {stored.map((truck, i) => {
        const pieces = truck.unplanned.filter((w) => w.driver === null);
        if (pieces.length === 0) return null;
        const title = `Driver not known · Truck ${truck.truckNumber}`;
        return (
          <Card key={truck.truckId} role="article" aria-labelledby={`not-known-${truck.truckId}`} style={{ '--i': i } as CSSProperties} className="animate-rise p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start">
              <div className="flex min-w-0 items-start gap-3 md:w-64 md:shrink-0 lg:w-72">
                <NotKnownAvatar />
                <h3 id={`not-known-${truck.truckId}`} className="pt-0.5 font-display text-lg font-semibold uppercase leading-tight tracking-wide">
                  {title}
                </h3>
              </div>
              <div className="md:flex-1">
                <StoredUnplannedBox pieces={pieces} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
