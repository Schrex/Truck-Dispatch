import type { Assignment, AssignmentChange, BusinessDay, Day, EntryFields, ListName, Lists, NewAssignment, TypedNames, WeekDay } from '../../shared/types';
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
 * A list's entries by display name: active ones only, or every entry with
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

/** How many days after today hold one of the Driver's Assignments, to warn before he is removed. */
export async function fetchLaterDays(driverId: string): Promise<number> {
  return (await request<{ laterDays: number }>(`api/drivers/${encodeURIComponent(driverId)}/later-days`)).laterDays;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** A day's Assignments, each marked Changed or Added since the Send, and when the day was first Sent (null for a Draft). */
export function fetchDay(date: string): Promise<Day> {
  return request<Day>(`api/assignments?date=${encodeURIComponent(date)}`);
}

/** The state of each day of the week starting on a Monday, Monday to Sunday, for the week strip. */
export async function fetchWeek(monday: string): Promise<WeekDay[]> {
  return (await request<{ days: WeekDay[] }>(`api/weeks/${encodeURIComponent(monday)}`)).days;
}

/**
 * Sends a day to the Drivers; answers when it was first Sent. Sending a Sent
 * day again changes nothing. Refused for a day with no Assignments or before today.
 */
export async function sendDay(date: string): Promise<string> {
  return (await request<{ sentAt: string }>(`api/days/${encodeURIComponent(date)}/send`, { method: 'POST' })).sentAt;
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

/** Changes only the fields given; the rest of the Assignment stays as it is. */
export async function changeAssignment(id: string, changes: AssignmentChange): Promise<Assignment> {
  return (await request<{ assignment: Assignment }>(`api/assignments/${encodeURIComponent(id)}`, json('PATCH', changes))).assignment;
}

/**
 * Moves an Assignment one place in its lane: "earlier" for Do this first,
 * "later" for Do this later. Answers the lane in its new order, numbered
 * again, so the page can show every block in it where it now is.
 */
export async function moveAssignment(id: string, direction: 'earlier' | 'later'): Promise<Assignment[]> {
  return (await request<{ assignments: Assignment[] }>(`api/assignments/${encodeURIComponent(id)}/move`, json('POST', { direction }))).assignments;
}

/**
 * Copies every Assignment on today onto a later day, notes left empty; answers
 * the new ones. The Worker decides which day is today, so a page left open past
 * midnight still copies the real today.
 */
export async function copyTodayOnto(to: string): Promise<Assignment[]> {
  return (
    await request<{ assignments: Assignment[] }>('api/assignments/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    })
  ).assignments;
}

export async function deleteAssignment(id: string): Promise<void> {
  await request(`api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
