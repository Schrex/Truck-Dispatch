import type { Assignment, BusinessDay, EntryFields, ListName, Lists, NewAssignment } from '../../shared/types';
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

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function fetchAssignments(date: string): Promise<Assignment[]> {
  return (await request<{ assignments: Assignment[] }>(`api/assignments?date=${encodeURIComponent(date)}`)).assignments;
}

export async function addAssignment(assignment: NewAssignment): Promise<Assignment> {
  return (
    await request<{ assignment: Assignment }>('api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    })
  ).assignment;
}

/**
 * Every field of a saved Assignment, as adding or changing one takes them. A
 * field added to NewAssignment does not compile until it is set here, so a
 * duplicate never leaves one behind.
 */
export function fieldsOf(assignment: Assignment): Required<NewAssignment> {
  return {
    date: assignment.date,
    driverId: assignment.driverId,
    truckId: assignment.truckId,
    fromPlaceId: assignment.fromPlaceId,
    toPlaceId: assignment.toPlaceId,
    note: assignment.note,
  };
}

/** Replaces every field of an Assignment; one left empty is cleared. */
export async function changeAssignment(id: string, assignment: NewAssignment): Promise<Assignment> {
  return (
    await request<{ assignment: Assignment }>(`api/assignments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    })
  ).assignment;
}

/** Copies every Assignment on one day onto another, notes left empty; answers the new ones. */
export async function copyDay(from: string, to: string): Promise<Assignment[]> {
  return (
    await request<{ assignments: Assignment[] }>('api/assignments/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
  ).assignments;
}

export async function deleteAssignment(id: string): Promise<void> {
  await request(`api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
