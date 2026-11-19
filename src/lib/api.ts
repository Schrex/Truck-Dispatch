import type { Assignment, BusinessDay, Driver, NewAssignment } from '../../shared/types';
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

export async function fetchDrivers(): Promise<Driver[]> {
  return (await request<{ drivers: Driver[] }>('api/drivers')).drivers;
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

export async function deleteAssignment(id: string): Promise<void> {
  await request(`api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
