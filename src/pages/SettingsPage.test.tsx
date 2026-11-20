// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

/**
 * The list API as Settings sees it: every list keeps what is added and
 * changed, refuses a name already used (ignoring case) and has no delete.
 */
type Entry = Record<string, unknown> & { id: string; active: boolean };
const NAME: Record<string, string> = { drivers: 'name', trucks: 'number', jobs: 'name', places: 'shortName', materials: 'name', foremen: 'name' };
let lists: Record<string, Entry[]>;
const sent: { method: string; path: string; body: unknown }[] = [];
/** A list whose GET fails, if any. */
let failing: string | null = null;

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const [, list, id] = /\/api\/(drivers|trucks|jobs|places|materials|foremen)(?:\/([^/]+))?$/.exec(url.pathname) ?? [];
  if (!list) return answer({ error: 'not_found' }, 404);
  const method = init?.method ?? 'GET';
  if (method === 'GET' && list === failing) return answer({ error: 'oops' }, 500);
  const entries = lists[list];
  if (method === 'GET') {
    return answer({ [list]: url.searchParams.get('include') === 'inactive' ? entries : entries.filter((e) => e.active) });
  }
  const body = JSON.parse(String(init?.body));
  sent.push({ method, path: url.pathname, body });
  const name = NAME[list];
  const one = list.slice(0, -1);
  if (name in body && entries.some((e) => e.id !== id && String(e[name]).toLowerCase() === String(body[name]).toLowerCase())) {
    return answer({ error: 'invalid', fields: { [name]: 'That one is already in the list.' } }, 400);
  }
  if (method === 'POST') {
    const entry = { id: `new-${entries.length}`, active: true, ...body };
    entries.push(entry);
    return answer({ [one]: entry }, 201);
  }
  if (method === 'PATCH') {
    const entry = entries.find((e) => e.id === id)!;
    Object.assign(entry, body);
    return answer({ [one]: entry });
  }
  return answer({ error: 'method_not_allowed' }, 405);
});

beforeEach(() => {
  lists = {
    drivers: [
      { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', active: true },
      { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: null, active: false },
    ],
    trucks: [
      { id: 'trk-21', number: '21', hcssCode: 'SAMPLE-21', hcssGuid: null, active: true },
      { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
      { id: 'trk-99', number: '99', hcssCode: null, hcssGuid: null, active: false },
    ],
    jobs: [
      { id: 'job-n', name: 'Sample Job North', jobNumber: 'S-1001', active: true },
      { id: 'job-x', name: 'Sample Job Old', jobNumber: null, active: false },
    ],
    places: [
      { id: 'plc-north', shortName: 'Sample Site North', fullName: 'Sample Job North site', kind: 'job_site', jobId: 'job-n', active: true },
      { id: 'plc-x', shortName: 'Sample Old Pit', fullName: null, kind: null, jobId: null, active: false },
    ],
    materials: [
      { id: 'mat-minus', name: '2" minus', active: true },
      { id: 'mat-old', name: 'Sample Old Fill', active: false },
    ],
    foremen: [
      { id: 'frm-a', name: 'Sample Foreman A', active: true },
      { id: 'frm-x', name: 'Sample Foreman X', active: false },
    ],
  };
  sent.length = 0;
  failing = null;
  api.mockClear();
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = async (tab: 'Drivers' | 'Trucks' | 'Jobs' | 'Places' | 'Materials' | 'Foremen' = 'Drivers') => {
  window.history.pushState(null, '', '/settings');
  render(<App />);
  if (tab !== 'Drivers') fireEvent.mouseDown(await screen.findByRole('tab', { name: tab }));
  await waitFor(() => expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem').length).toBeGreaterThan(0));
  return screen.getByRole('tabpanel');
};
const rows = (panel: HTMLElement) => within(panel).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
const row = (panel: HTMLElement, name: string) => within(panel).getByRole('listitem', { name });
const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));

describe('Settings', () => {
  it('has a Drivers and a Trucks tab, each listing its entries with inactive ones marked', async () => {
    const drivers = await settings();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Drivers', 'Trucks', 'Jobs', 'Places', 'Materials', 'Foremen']);
    expect(rows(drivers)).toEqual(['Sample Driver A', 'Sample Driver X']);
    expect(row(drivers, 'Sample Driver A').textContent).toContain('Usual Truck 21');
    expect(row(drivers, 'Sample Driver X').textContent).toContain('Inactive');
    expect(row(drivers, 'Sample Driver A').textContent).not.toContain('Inactive');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Trucks' }));
    await waitFor(() => expect(rows(screen.getByRole('tabpanel'))).toEqual(['21', '24', '99']));
    const trucks = screen.getByRole('tabpanel');
    expect(row(trucks, '21').textContent).toContain('HCSS code SAMPLE-21');
    expect(row(trucks, '99').textContent).toContain('Inactive');
  });

  it.each([
    ['Materials', 'Material', ['2" minus', 'Sample Old Fill'], 'Sample Fill', '/api/materials'],
    ['Foremen', 'Foreman', ['Sample Foreman A', 'Sample Foreman X'], 'Sample Foreman D', '/api/foremen'],
  ] as const)('has a %s tab listing its entries with inactive ones marked, and adds one with a name', async (tab, noun, listed, fresh, path) => {
    const panel = await settings(tab);
    expect(rows(panel)).toEqual(listed);
    expect(row(panel, listed[1]).textContent).toContain('Inactive');
    expect(row(panel, listed[0]).textContent).not.toContain('Inactive');

    fireEvent.click(within(panel).getByRole('button', { name: `Add ${noun}` }));
    const dialog = screen.getByRole('dialog', { name: `Add ${noun}` });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: fresh } });
    save(dialog);
    expect(await within(panel).findByRole('listitem', { name: fresh })).toBeTruthy();
    expect(sent).toEqual([{ method: 'POST', path, body: { name: fresh } }]);
  });

  it('adds a Truck with a number, HCSS code and HCSS id', async () => {
    const trucks = await settings('Trucks');
    fireEvent.click(within(trucks).getByRole('button', { name: 'Add Truck' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Truck' });
    fireEvent.change(within(dialog).getByLabelText('Number'), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText(/HCSS code/), { target: { value: 'T30' } });
    fireEvent.change(within(dialog).getByLabelText(/HCSS id/), { target: { value: '7f1c' } });
    save(dialog);

    expect(await within(trucks).findByRole('listitem', { name: '30' })).toBeTruthy();
    expect(sent).toEqual([{ method: 'POST', path: '/api/trucks', body: { number: '30', hcssCode: 'T30', hcssGuid: '7f1c' } }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds a Driver with a usual Truck, picked from the active Trucks', async () => {
    const drivers = await settings();
    fireEvent.click(within(drivers).getByRole('button', { name: 'Add Driver' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Driver' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sample Driver D' } });
    const truck = dialog.querySelector('select[name="defaultTruckId"]') as HTMLSelectElement;
    await waitFor(() => expect([...truck.options].map((o) => o.textContent)).toEqual(['No usual Truck', '21', '24']));
    fireEvent.change(truck, { target: { value: 'trk-24' } });
    save(dialog);

    const added = await within(drivers).findByRole('listitem', { name: 'Sample Driver D' });
    expect(added.textContent).toContain('Usual Truck 24');
    expect(sent[0].body).toEqual({ name: 'Sample Driver D', defaultTruckId: 'trk-24' });
  });

  it('says so when the list a picker offers cannot be loaded, rather than loading forever', async () => {
    failing = 'trucks';
    const drivers = await settings();
    expect(await within(drivers).findByText('Could not load the Trucks to pick from. Reload the page to try again.')).toBeTruthy();

    fireEvent.click(within(drivers).getByRole('button', { name: 'Add Driver' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Driver' });
    expect(within(dialog).getByText('Could not load the Trucks.')).toBeTruthy();
    expect(within(dialog).queryByText('Loading…')).toBeNull();
  });

  it('has a Jobs tab listing each Job with its job number, inactive ones marked', async () => {
    const jobs = await settings('Jobs');
    expect(rows(jobs)).toEqual(['Sample Job North', 'Sample Job Old']);
    expect(row(jobs, 'Sample Job North').textContent).toContain('Job number S-1001');
    expect(row(jobs, 'Sample Job Old').textContent).toContain('Inactive');
  });

  it('adds a Job with a name and a job number', async () => {
    const jobs = await settings('Jobs');
    fireEvent.click(within(jobs).getByRole('button', { name: 'Add Job' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Job' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sample Job East' } });
    fireEvent.change(within(dialog).getByLabelText(/Job number/), { target: { value: 'S-1003' } });
    save(dialog);

    expect(await within(jobs).findByRole('listitem', { name: 'Sample Job East' })).toBeTruthy();
    expect(sent).toEqual([{ method: 'POST', path: '/api/jobs', body: { name: 'Sample Job East', jobNumber: 'S-1003' } }]);
  });

  it('has a Places tab listing each Place with its full name, kind and Job, inactive ones marked, and no geofence code', async () => {
    const places = await settings('Places');
    expect(rows(places)).toEqual(['Sample Site North', 'Sample Old Pit']);
    const north = row(places, 'Sample Site North').textContent;
    expect(north).toContain('Full name Sample Job North site');
    expect(north).toContain('Kind Job site');
    expect(north).toContain('Job Sample Job North');
    expect(row(places, 'Sample Old Pit').textContent).toContain('Inactive');
    expect(places.textContent).not.toMatch(/geofence/i);
  });

  it('adds a Place with a short name, full name, kind and a Job picked from the active Jobs; no geofence code is asked for', async () => {
    const places = await settings('Places');
    fireEvent.click(within(places).getByRole('button', { name: 'Add Place' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Place' });
    expect(dialog.textContent).not.toMatch(/geofence/i);
    fireEvent.change(within(dialog).getByLabelText('Short name'), { target: { value: 'Sample Plant' } });
    fireEvent.change(within(dialog).getByLabelText(/Full name/), { target: { value: 'Sample Aggregate Plant' } });
    const kind = dialog.querySelector('select[name="kind"]') as HTMLSelectElement;
    expect([...kind.options].map((o) => o.textContent)).toEqual(['No kind', 'Plant', 'Job site', 'Shop', 'Yard']);
    fireEvent.change(kind, { target: { value: 'plant' } });
    const job = dialog.querySelector('select[name="jobId"]') as HTMLSelectElement;
    await waitFor(() => expect([...job.options].map((o) => o.textContent)).toEqual(['No Job', 'Sample Job North']));
    fireEvent.change(job, { target: { value: 'job-n' } });
    save(dialog);

    const added = await within(places).findByRole('listitem', { name: 'Sample Plant' });
    expect(added.textContent).toContain('Kind Plant');
    expect(sent[0].body).toEqual({ shortName: 'Sample Plant', fullName: 'Sample Aggregate Plant', kind: 'plant', jobId: 'job-n' });
  });

  it('adds a Place with only a short name', async () => {
    const places = await settings('Places');
    fireEvent.click(within(places).getByRole('button', { name: 'Add Place' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Place' });
    fireEvent.change(within(dialog).getByLabelText('Short name'), { target: { value: 'Sample Pit' } });
    save(dialog);
    expect(await within(places).findByRole('listitem', { name: 'Sample Pit' })).toBeTruthy();
    expect(sent[0].body).toEqual({ shortName: 'Sample Pit', fullName: null, kind: null, jobId: null });
  });

  it('renames an entry', async () => {
    const trucks = await settings('Trucks');
    fireEvent.click(within(row(trucks, '24')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Truck' });
    expect((within(dialog).getByLabelText('Number') as HTMLInputElement).value).toBe('24');
    fireEvent.change(within(dialog).getByLabelText('Number'), { target: { value: '124' } });
    save(dialog);

    expect(await within(trucks).findByRole('listitem', { name: '124' })).toBeTruthy();
    expect(within(trucks).queryByRole('listitem', { name: '24' })).toBeNull();
    expect(sent).toEqual([expect.objectContaining({ method: 'PATCH', path: '/api/trucks/trk-24', body: expect.objectContaining({ number: '124' }) })]);
  });

  it('makes an entry inactive and active again', async () => {
    const drivers = await settings();
    const active = within(row(drivers, 'Sample Driver A')).getByRole('switch', { name: 'Active' });
    expect(active.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(active);
    await waitFor(() => expect(row(drivers, 'Sample Driver A').textContent).toContain('Inactive'));
    expect(sent).toEqual([{ method: 'PATCH', path: '/api/drivers/drv-a', body: { active: false } }]);

    fireEvent.click(within(row(drivers, 'Sample Driver A')).getByRole('switch', { name: 'Active' }));
    await waitFor(() => expect(row(drivers, 'Sample Driver A').textContent).not.toContain('Inactive'));
    expect(sent[1]).toEqual({ method: 'PATCH', path: '/api/drivers/drv-a', body: { active: true } });
  });

  it('shows the message for a name already in the list next to that field, and keeps the dialog open', async () => {
    const drivers = await settings();
    fireEvent.click(within(drivers).getByRole('button', { name: 'Add Driver' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Driver' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'sample driver a' } });
    save(dialog);

    const message = await within(dialog).findByText('That one is already in the list.');
    expect(message.closest('div')?.querySelector('input')).toBe(within(dialog).getByLabelText('Name'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers no way to delete an entry', async () => {
    const drivers = await settings();
    fireEvent.click(within(row(drivers, 'Sample Driver A')).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
  });
});
