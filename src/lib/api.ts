import type { Assignment, ClearedImports, AssignmentChange, BusinessDay, ChangedAssignment, CheckIn, CheckIns, CopiedDay, Day, DriverDay, FleetImport, Geofence, NewFleetImport, Inspection, NewInspection, EntryFields, ListName, Lists, AddAssignment, OrderedList, PaperLogAttacher, PaperLogDay, PaperLogPhoto, TruckLogDay, TruckProblem, WeekDay } from '../../shared/types';
import { basePath } from './basePath';

// Every call starts at the base path the page was reached under: /api/...
// standalone and /truck-dispatch/api/... under the Hub, on any page.

export class FieldErrors extends Error {
  constructor(public fields: Record<string, string>) {
    super('Some fields need fixing.');
  }
}

/** The Worker said no with a plain message, e.g. the Assignment is on a past day. */
export class Refused extends Error {}

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  const path = `${basePath()}/${route}`;
  const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 400 && body.fields) throw new FieldErrors(body.fields);
  if (!response.ok && typeof body.message === 'string') throw new Refused(body.message);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return body as T;
}

/** Today and tomorrow in US Eastern time, by the Worker's clock. */
export function fetchBusinessDay(): Promise<BusinessDay> {
  return request<BusinessDay>('api/today');
}

/**
 * A list's entries in its order (Dave's own for Drivers, Places and Materials,
 * then by display name): active ones only, or every entry with
 * includeInactive (Settings, and the Board so a saved inactive entry keeps its name).
 */
export async function fetchList<L extends ListName>(list: L, { includeInactive = false } = {}): Promise<Lists[L][]> {
  const body = await request<Record<L, Lists[L][]>>(`api/${list}${includeInactive ? '?include=inactive' : ''}`);
  return body[list];
}

/**
 * Adds an entry to a list. When a removed entry already has that name, the
 * Worker brings it back instead, with the fields sent (broughtBack). There is
 * no delete: an entry is made inactive with changeEntry.
 */
export async function addEntry<L extends ListName>(list: L, fields: EntryFields<L>): Promise<{ entry: Lists[L]; broughtBack: boolean }> {
  const { broughtBack, ...one } = await request<Record<string, Lists[L]> & { broughtBack?: boolean }>(`api/${list}`, json('POST', fields));
  return { entry: Object.values(one)[0] as Lists[L], broughtBack: broughtBack === true };
}

/** Changes only the given fields of an entry, e.g. its name or { active: false }. */
export async function changeEntry<L extends ListName>(list: L, id: string, fields: EntryFields<L>): Promise<Lists[L]> {
  return Object.values(await request<Record<string, Lists[L]>>(`api/${list}/${encodeURIComponent(id)}`, json('PATCH', fields)))[0];
}

/**
 * Sets Dave's own order of a whole list: the ids first to last; any left out
 * have none. Answers every entry, removed ones too, in the new order.
 */
export async function reorderList<L extends OrderedList>(list: L, ids: string[]): Promise<Lists[L][]> {
  return (await request<Record<L, Lists[L][]>>(`api/${list}/order`, json('PUT', { order: ids })))[list];
}

/** How many days after today hold one of the Driver's Assignments, to warn before he is removed. */
export async function fetchLaterDays(driverId: string): Promise<number> {
  return (await request<{ laterDays: number }>(`api/drivers/${encodeURIComponent(driverId)}/later-days`)).laterDays;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** A day's Assignments, Drafts and Assigned ones alike, each marked Changed or Added since it was Assigned. */
export function fetchDay(date: string): Promise<Day> {
  return request<Day>(`api/assignments?date=${encodeURIComponent(date)}`);
}

/** The state of each day of the week starting on a Monday, Monday to Sunday, for the week strip. */
export async function fetchWeek(monday: string): Promise<WeekDay[]> {
  return (await request<{ days: WeekDay[] }>(`api/weeks/${encodeURIComponent(monday)}`)).days;
}

/**
 * Assign: gives one Assignment to its Driver, who sees it from then on
 * (ADR 0005). Answers it Assigned. Refused for one with no Driver, a
 * cancelled one or one on a day before today, with the Worker's message.
 */
export async function assignAssignment(id: string): Promise<Assignment> {
  return (await request<{ assignment: Assignment }>(`api/assignments/${encodeURIComponent(id)}/assign`, { method: 'POST' })).assignment;
}

/**
 * Adds an Assignment, last in its lane, and the same one for each of
 * `alsoDriverIds`; answers them all, the first Driver's first. A Place or
 * Material may be given by name instead of by id (typed in the composer); the
 * Worker links or adds it.
 */
export async function addAssignment(assignment: AddAssignment): Promise<Assignment[]> {
  return (
    await request<{ assignments: Assignment[] }>('api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    })
  ).assignments;
}

/**
 * Changes only the fields given; the rest of the Assignment stays as it is.
 * Once it is Assigned, a new Driver answers the copy added in his lane and
 * the first one, cancelled.
 */
export function changeAssignment(id: string, changes: AssignmentChange): Promise<ChangedAssignment> {
  return request<ChangedAssignment>(`api/assignments/${encodeURIComponent(id)}`, json('PATCH', changes));
}

/**
 * Moves an Assignment one place in its lane: "earlier" for Do this first,
 * "later" for Do this later. Answers the lane in its new order, numbered
 * again, so the page can show every block in it where it now is.
 */
export async function moveAssignment(id: string, direction: 'earlier' | 'later'): Promise<Assignment[]> {
  return (await request<{ assignments: Assignment[] }>(`api/assignments/${encodeURIComponent(id)}/move`, json('POST', { direction }))).assignments;
}

/** The day Start from on `date` would copy: the latest earlier day with Assignments, or null when there is none. */
export async function fetchStartFrom(date: string): Promise<string | null> {
  return (await request<{ from: string | null }>(`api/days/${encodeURIComponent(date)}/start-from`)).from;
}

/**
 * Start from: the Worker copies the latest earlier day with Assignments onto
 * this empty day, notes and cancelled ones left behind. Refused once the day
 * has Assignments, so a copy never adds to work.
 */
export function startDayFrom(date: string): Promise<CopiedDay> {
  return request<CopiedDay>(`api/days/${encodeURIComponent(date)}/start-from`, { method: 'POST' });
}

/** Copy to: the Worker copies a day onto another that is still empty, by the same rules as Start from. */
export function copyDayTo(from: string, to: string): Promise<CopiedDay> {
  return request<CopiedDay>(`api/days/${encodeURIComponent(from)}/copy-to`, json('POST', { to }));
}

/**
 * ✕: the Worker deletes a Draft (answers null) and cancels an Assigned
 * Assignment (answers it, cancelled and kept in its place).
 */
export async function takeOffAssignment(id: string): Promise<Assignment | null> {
  // A delete answers 204 with no body, read as an empty answer.
  return (await request<{ assignment?: Assignment }>(`api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' })).assignment ?? null;
}

/** Put back: a cancelled Assignment is no longer cancelled. Answers it. */
export async function putBackAssignment(id: string): Promise<Assignment> {
  return (await request<{ assignment: Assignment }>(`api/assignments/${encodeURIComponent(id)}/put-back`, { method: 'POST' })).assignment;
}

/** Discard: Dave clears a cancelled Assignment off the Board. The Driver still sees it until he dismisses it. */
export async function discardAssignment(id: string): Promise<void> {
  await request<unknown>(`api/assignments/${encodeURIComponent(id)}/discard`, { method: 'POST' });
}

/** Dismiss: the Driver clears a cancelled Assignment off his day. The Board is unchanged. */
export async function dismissAssignment(id: string): Promise<void> {
  await request<unknown>(`api/assignments/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

/** The Driver's first day after tomorrow with an Assigned Assignment for him that is not cancelled, or null. */
export async function fetchNextAssigned(driverId: string): Promise<string | null> {
  return (await request<{ date: string | null }>(`api/drivers/${encodeURIComponent(driverId)}/next-assigned`)).date;
}

/**
 * One Driver's day for the Driver view: only his Assigned Assignments in
 * Dave's order, cancelled ones included, marked Changed (with what they were)
 * or Added; none while Dave has Assigned him nothing that day.
 */
export function fetchDriverDay(driverId: string, date: string): Promise<DriverDay> {
  return request<DriverDay>(`api/drivers/${encodeURIComponent(driverId)}/days/${encodeURIComponent(date)}`);
}

/** Each Driver's check-in on a day: his latest Inspection that day, its Truck, time and whether it needs repair. */
export async function fetchCheckIns(date: string): Promise<CheckIn[]> {
  return (await request<CheckIns>(`api/check-ins?date=${encodeURIComponent(date)}`)).checkIns;
}

/**
 * Finish: saves an Inspection for today, checking the Driver in to its Truck.
 * Sent again with the same id (a retry after a lost reply), it answers the one
 * already saved and saves nothing.
 */
export async function addInspection(inspection: NewInspection): Promise<Inspection> {
  return (await request<{ inspection: Inspection }>('api/inspections', json('POST', inspection))).inspection;
}

/**
 * Every Truck problem: open ones first, then fixed ones, each newest first.
 * With open, only the open ones; with truckId, only that Truck's.
 */
export async function fetchTruckProblems(only: { open?: boolean; truckId?: string } = {}): Promise<TruckProblem[]> {
  const query = new URLSearchParams();
  if (only.open) query.set('open', '1');
  if (only.truckId) query.set('truckId', only.truckId);
  const search = query.toString();
  return (await request<{ problems: TruckProblem[] }>(`api/truck-problems${search ? `?${search}` : ''}`)).problems;
}

/** Mark fixed: closes a Truck problem, with how it was fixed if Dave says. One already fixed is answered as it is. */
export async function fixTruckProblem(id: string, note?: string): Promise<TruckProblem> {
  return (await request<{ problem: TruckProblem }>(`api/truck-problems/${encodeURIComponent(id)}/fix`, json('POST', note ? { note } : {}))).problem;
}

/** Report a problem: a Driver reports one during the day on the Truck of his latest check-in today. */
export async function reportTruckProblem(report: { driverId: string; truckId: string; text: string }): Promise<TruckProblem> {
  return (await request<{ problem: TruckProblem }>('api/truck-problems', json('POST', report))).problem;
}

/** Imports a Fleet export's rows, read by the page (shared/fleetExport.ts): what it added, for which Truck and days. */
export async function importFleetExport(body: NewFleetImport): Promise<FleetImport> {
  return (await request<{ import: FleetImport }>('api/fleet-imports', json('POST', body))).import;
}

/**
 * Clear Fleet imports: deletes every Import and stored visit, so Imports can
 * be tested again from nothing; with `geofences`, every Geofence and its toggle too.
 */
export async function clearFleetImports(geofences: boolean): Promise<ClearedImports> {
  return (await request<{ cleared: ClearedImports }>(`api/fleet-imports${geofences ? '?geofences=1' : ''}`, { method: 'DELETE' })).cleared;
}

/** Every geofence code the app knows, by code, each with its Not considered toggle (Settings). */
export async function fetchGeofences(): Promise<Geofence[]> {
  return (await request<{ geofences: Geofence[] }>('api/geofences')).geofences;
}

/** Turns a geofence code to Not considered (its visits are skipped on every day) or back. */
export async function setNotConsidered(code: string, notConsidered: boolean): Promise<Geofence> {
  return (await request<{ geofence: Geofence }>(`api/geofences/${encodeURIComponent(code)}`, json('PATCH', { notConsidered }))).geofence;
}

/**
 * A Truck's stored day: its stored Fleet visits and the Assignments that name
 * it, through the Trip builder, as of its latest Import. `at` ("HH:MM", US
 * Eastern) sets the clock; without it a past day opens at its end, today at the latest Import.
 */
export function fetchTruckLogDay(truckId: string, date: string, at?: string): Promise<TruckLogDay> {
  return request<TruckLogDay>(`api/trucks/${encodeURIComponent(truckId)}/days/${encodeURIComponent(date)}${at ? `?at=${encodeURIComponent(at)}` : ''}`);
}

/** A day's Paper log photos, oldest first, without the ones taken off; one Driver's with driverId. */
export async function fetchPaperLogs(date: string, driverId?: string): Promise<PaperLogPhoto[]> {
  const query = new URLSearchParams({ date, ...(driverId ? { driverId } : {}) });
  return (await request<PaperLogDay>(`api/paper-logs?${query}`)).photos;
}

/** Whose Paper log photo it is and who attached it; the id is made by the phone (a UUID). */
export interface NewPaperLogPhoto {
  id: string;
  date: string;
  truckId: string;
  driverId: string;
  attachedBy: PaperLogAttacher;
}

/**
 * Attaches one Paper log photo: the picture as the body. Sent again with the
 * same id (Try again after a lost reply), it answers the photo already kept
 * and keeps nothing more.
 */
export async function attachPaperLog(photo: NewPaperLogPhoto, picture: Blob): Promise<PaperLogPhoto> {
  const query = new URLSearchParams({ ...photo });
  return (
    await request<{ photo: PaperLogPhoto }>(`api/paper-logs?${query}`, { method: 'POST', headers: { 'Content-Type': picture.type }, body: picture })
  ).photo;
}

/** Dave takes a wrong Paper log photo off: hidden from the day and kept. Again, it changes nothing. */
export async function takeOffPaperLog(id: string): Promise<PaperLogPhoto> {
  return (await request<{ photo: PaperLogPhoto }>(`api/paper-logs/${encodeURIComponent(id)}/take-off`, { method: 'POST' })).photo;
}

/** Where a Paper log photo's picture is read, through the Worker only. */
export function paperLogPictureUrl(id: string): string {
  return `${basePath()}/api/paper-logs/${encodeURIComponent(id)}/picture`;
}
