import type { Assignment, AssignmentChange, BusinessDay, ChangedAssignment, CopiedDay, Day, DriverDay, EntryFields, ListName, Lists, NewAssignment, OrderedList, TypedNames, WeekDay } from '../../shared/types';
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

/** Adds an entry to a list. There is no delete: an entry is made inactive with changeEntry. */
export async function addEntry<L extends ListName>(list: L, fields: EntryFields<L>): Promise<Lists[L]> {
  return Object.values(await request<Record<string, Lists[L]>>(`api/${list}`, json('POST', fields)))[0];
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
 * Adds an Assignment, last in its lane. A Place or Material may be given by
 * name instead of by id (typed in the composer); the Worker links or adds it.
 */
export async function addAssignment(assignment: NewAssignment & TypedNames): Promise<Assignment> {
  return (
    await request<{ assignment: Assignment }>('api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    })
  ).assignment;
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
