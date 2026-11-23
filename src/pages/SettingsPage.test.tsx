// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { TruckProblem } from '../../shared/types';

/** When the Worker marks a problem fixed in these tests: Thursday 19 Nov 2026, 10:00 AM US Eastern. */
const FIXED_AT = '2026-11-19T15:00:00.000Z';
/** An open Truck problem on Truck 21 from Sample Driver A's Inspection at 6:42 on Thursday 19 Nov, unless given otherwise. */
const problem = (fields: Partial<TruckProblem>): TruckProblem => ({
  id: 'tp', truckId: 'trk-21', truckNumber: '21', reportedByDriverId: 'drv-a', reportedByName: 'Sample Driver A', reportedAt: '2026-11-19T11:42:00.000Z',
  text: 'Something', inspectionId: 'insp-x', fixedAt: null, fixedNote: null, ...fields,
});

/**
 * The list API as Settings sees it: every list keeps what is added and
 * changed, refuses a name already used (ignoring case) and has no delete. A
 * Driver answers how many later days hold his Assignments. Drivers, Places and
 * Materials and the Inspection checklist take a whole new order, the ids
 * first to last, the rest after.
 */
type Entry = Record<string, unknown> & { id: string; active: boolean };
const NAME: Record<string, string> = { drivers: 'name', trucks: 'number', jobs: 'name', places: 'shortName', materials: 'name', foremen: 'name', 'inspection-items': 'label' };
let lists: Record<string, Entry[]>;
const sent: { method: string; path: string; body: unknown }[] = [];
/** A list whose GET fails, if any. */
let failing: string | null = null;
/** Whether every save fails as if the connection dropped. */
let saveFails = false;
/** Each Driver's later days with Assignments, as the Worker would count them. */
let laterDays: Record<string, number>;
/** The Truck problems, in the Worker's order: open first, then fixed, newest first. Fixing one moves it to the top of the fixed ones. */
let problems: TruckProblem[];

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const later = /\/api\/drivers\/([^/]+)\/later-days$/.exec(url.pathname);
  if (later) return answer({ laterDays: laterDays[later[1]] ?? 0 });
  if (url.pathname.endsWith('/api/truck-problems')) {
    return failing === 'truck-problems' ? answer({ error: 'oops' }, 500) : answer({ problems });
  }
  const fixing = /\/api\/truck-problems\/([^/]+)\/fix$/.exec(url.pathname);
  if (fixing && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    sent.push({ method: 'POST', path: url.pathname, body });
    if (saveFails) return answer({ error: 'oops' }, 500);
    const problem = problems.find((p) => p.id === fixing[1]);
    if (!problem) return answer({ error: 'not_found' }, 404);
    const closed = problem.fixedAt ? problem : { ...problem, fixedAt: FIXED_AT, fixedNote: (body.note ?? '').trim() || null };
    problems = [...problems.filter((p) => p.id !== closed.id && !p.fixedAt), closed, ...problems.filter((p) => p.id !== closed.id && p.fixedAt)];
    return answer({ problem: closed });
  }
  const [, list, id] = /\/api\/(drivers|trucks|jobs|places|materials|foremen|inspection-items)(?:\/([^/]+))?$/.exec(url.pathname) ?? [];
  if (!list) return answer({ error: 'not_found' }, 404);
  const method = init?.method ?? 'GET';
  if (method === 'GET' && list === failing) return answer({ error: 'oops' }, 500);
  const entries = lists[list];
  if (method === 'GET') {
    return answer({ [list]: url.searchParams.get('include') === 'inactive' ? entries : entries.filter((e) => e.active) });
  }
  const body = JSON.parse(String(init?.body));
  sent.push({ method, path: url.pathname, body });
  if (saveFails) return answer({ error: 'oops' }, 500);
  if (method === 'PUT' && id === 'order' && ['drivers', 'places', 'materials', 'inspection-items'].includes(list)) {
    const rank = (e: Entry) => ((body.order as string[]).indexOf(e.id) + 1 || Infinity);
    lists[list] = [...entries].sort((a, b) => rank(a) - rank(b));
    return answer({ [list]: lists[list] });
  }
  const name = NAME[list];
  const one = list.slice(0, -1);
  // Like the Worker, a Place that stops being a job site loses its usual Foreman.
  const dropped = list === 'places' && 'kind' in body && body.kind !== 'job_site' ? { usualForemanId: null } : {};
  if (name in body && entries.some((e) => e.id !== id && String(e[name]).toLowerCase() === String(body[name]).toLowerCase())) {
    return answer({ error: 'invalid', fields: { [name]: 'That one is already in the list.' } }, 400);
  }
  if (method === 'POST') {
    const entry = { id: `new-${entries.length}`, active: true, ...(list === 'places' ? { onTruckMap: false } : {}), ...body };
    entries.push(entry);
    return answer({ [one]: entry }, 201);
  }
  if (method === 'PATCH') {
    const entry = entries.find((e) => e.id === id)!;
    Object.assign(entry, body, dropped);
    return answer({ [one]: entry });
  }
  return answer({ error: 'method_not_allowed' }, 405);
});

beforeEach(() => {
  lists = {
    drivers: [
      { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', active: true },
      { id: 'drv-c', name: 'Sample Driver C', defaultTruckId: null, active: true },
      { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: null, active: false },
    ],
    trucks: [
      { id: 'trk-21', number: '21', hcssCode: 'SAMPLE-21', hcssGuid: '7f1c', active: true },
      { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
      { id: 'trk-99', number: '99', hcssCode: null, hcssGuid: null, active: false },
    ],
    places: [
      { id: 'plc-plant', shortName: 'Sample Plant', fullName: null, kind: 'plant', jobId: null, onTruckMap: true, active: true },
      { id: 'plc-north', shortName: 'Sample Site North', fullName: 'Sample Job North site', kind: 'job_site', jobId: 'job-n', usualForemanId: null, onTruckMap: false, active: true },
      { id: 'plc-yard', shortName: 'Sample Yard', fullName: null, kind: 'yard', jobId: null, onTruckMap: false, active: true },
      { id: 'plc-x', shortName: 'Sample Old Pit', fullName: null, kind: null, jobId: null, onTruckMap: false, active: false },
    ],
    materials: [
      { id: 'mat-minus', name: '2" minus', active: true },
      { id: 'mat-old', name: 'Sample Old Fill', active: false },
    ],
    jobs: [
      { id: 'job-n', name: 'Sample Job North', jobNumber: 'S-1001', active: true },
      { id: 'job-x', name: 'Sample Job Old', jobNumber: null, active: false },
    ],
    foremen: [
      { id: 'frm-a', name: 'Sample Foreman A', active: true },
      { id: 'frm-x', name: 'Sample Foreman X', active: false },
    ],
    'inspection-items': [
      { id: 'insp-01', label: 'Dump box clean', optional: false, active: true },
      { id: 'insp-07', label: 'Lights', optional: false, active: true },
      { id: 'insp-11', label: 'Air tank (drain)', optional: true, active: true },
      { id: 'insp-x', label: 'Sample Old Item', optional: false, active: false },
    ],
  };
  sent.length = 0;
  failing = null;
  saveFails = false;
  laterDays = {};
  problems = [
    problem({ id: 'tp-3', truckId: 'trk-24', truckNumber: '24', reportedByDriverId: 'drv-c', reportedByName: 'Sample Driver C', reportedAt: '2026-11-19T12:30:00.000Z', text: 'Tarp ripped' }),
    problem({ id: 'tp-1', text: 'Left marker out' }),
    problem({ id: 'tp-0', reportedAt: '2026-11-17T21:05:00.000Z', text: 'Flap torn', fixedAt: '2026-11-18T14:00:00.000Z', fixedNote: 'New flap' }),
  ];
  api.mockClear();
  vi.stubGlobal('fetch', api);
  // Every browser has it; jsdom does not, and the Optional switch measures itself with it.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Title = 'Drivers' | 'Trucks' | 'Places' | 'Materials' | 'Jobs' | 'Foremen' | 'Inspection checklist';

/** Opens Settings and waits until every section has its chips. */
const settings = async () => {
  window.history.pushState(null, '', '/settings');
  render(<App />);
  // The page's code loads on its own (App.tsx), then each list.
  await screen.findByRole('heading', { name: 'Settings', level: 1 });
  await waitFor(() => expect(screen.queryAllByText(/^Loading/)).toEqual([]));
};
const section = (title: Title) => screen.getByRole('region', { name: title });
/** The chips listed in use, by name. */
const chips = (title: Title) => {
  const list = within(section(title)).queryByRole('list', { name: title });
  return list ? within(list).getAllByRole('listitem').map((chip) => chip.getAttribute('aria-label')) : [];
};
const chip = (title: Title, name: string) => within(section(title)).getByRole('listitem', { name });
/** Taps a chip and answers its edit panel. */
const open = (title: Title, name: string) => {
  fireEvent.click(within(chip(title, name)).getAllByRole('button')[0]);
  return screen.getByRole('dialog', { name });
};
const add = (title: Title, noun: string) => {
  fireEvent.click(within(section(title)).getByRole('button', { name: `Add ${noun}` }));
  return screen.getByRole('dialog', { name: `New ${noun}` });
};
const type = (panel: HTMLElement, label: string | RegExp, value: string) => fireEvent.change(within(panel).getByLabelText(label), { target: { value } });
const pick = (panel: HTMLElement, key: string) => panel.querySelector(`select[name="${key}"]`) as HTMLSelectElement;
const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);
const done = (panel: HTMLElement) => fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));

describe('Settings', () => {
  it('is one page with a section for each list, with no tabs', async () => {
    await settings();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Drivers',
      'Trucks',
      'Truck problems',
      'Places',
      'Materials',
      'Jobs',
      'Foremen',
      'Inspection checklist',
    ]);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows each entry in use as a chip with its key detail, and no removed entries or Bring back at all', async () => {
    await settings();
    expect(chips('Drivers')).toEqual(['Sample Driver A', 'Sample Driver C']);
    expect(screen.queryByText('Sample Driver X')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Removed' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bring back/ })).toBeNull();
    expect(chip('Drivers', 'Sample Driver A').textContent).toContain('Truck 21');

    expect(chip('Trucks', '21').textContent).toBe('21');

    expect(chip('Places', 'Sample Plant').textContent).toContain('Plant');
    expect(chip('Places', 'Sample Site North').textContent).toContain('Job site');
    expect(chip('Places', 'Sample Yard').textContent).toContain('Shop or yard');

    expect(chip('Jobs', 'Sample Job North').textContent).toContain('S-1001');
    expect(chips('Materials')).toEqual(['2" minus']);
    expect(chips('Foremen')).toEqual(['Sample Foreman A']);

    expect(chips('Inspection checklist')).toEqual(['Dump box clean', 'Lights', 'Air tank (drain)']);
    expect(chip('Inspection checklist', 'Air tank (drain)').textContent).toContain('Optional');
    expect(chip('Inspection checklist', 'Lights').textContent).not.toContain('Optional');
  });

  it('says so when a list cannot be loaded, and still shows the others', async () => {
    failing = 'materials';
    await settings();
    expect(within(section('Materials')).getByText('Could not load the Materials. Reload the page to try again.')).toBeTruthy();
    expect(chips('Foremen')).toEqual(['Sample Foreman A']);
  });

  describe('the edit panel', () => {
    it('saves a rename as Dave types, and the chip follows', async () => {
      await settings();
      const panel = open('Trucks', '24');
      expect((within(panel).getByLabelText('Number') as HTMLInputElement).value).toBe('24');
      type(panel, 'Number', '124');
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/trucks/trk-24', body: { number: '124' } }]));
      expect(await within(panel).findByText('Saved')).toBeTruthy();
      done(panel);
      expect(chips('Trucks')).toEqual(['21', '124']);
    });

    it('saves only the last of quick keystrokes, once', async () => {
      await settings();
      const panel = open('Jobs', 'Sample Job North');
      type(panel, /Job number/, 'S-1');
      type(panel, /Job number/, 'S-10');
      type(panel, /Job number/, 'S-1002');
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual({ method: 'PATCH', path: '/api/jobs/job-n', body: { jobNumber: 'S-1002' } });
    });

    it('saves what is still being typed when it is closed', async () => {
      await settings();
      const panel = open('Materials', '2" minus');
      type(panel, 'Name', '3/4" minus');
      done(panel);
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/materials/mat-minus', body: { name: '3/4" minus' } }]));
      expect(chips('Materials')).toEqual(['3/4" minus']);
    });

    it('saves a picked usual Truck at once, offering the active Trucks', async () => {
      await settings();
      const panel = open('Drivers', 'Sample Driver C');
      expect(options(pick(panel, 'defaultTruckId'))).toEqual(['No usual Truck', '21', '24']);
      fireEvent.change(pick(panel, 'defaultTruckId'), { target: { value: 'trk-24' } });
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/drivers/drv-c', body: { defaultTruckId: 'trk-24' } }]));
      done(panel);
      expect(chip('Drivers', 'Sample Driver C').textContent).toContain('Truck 24');
    });

    it('shows the message for a name already in the list next to that field, and keeps the old name on the chip', async () => {
      await settings();
      const panel = open('Drivers', 'Sample Driver C');
      type(panel, 'Name', 'sample driver a');
      const message = await within(panel).findByText('That one is already in the list.');
      expect(message.closest('div')?.querySelector('input')).toBe(within(panel).getByLabelText('Name'));
      done(panel);
      expect(chips('Drivers')).toEqual(['Sample Driver A', 'Sample Driver C']);
    });

    it('says so when a save fails', async () => {
      saveFails = true;
      await settings();
      const panel = open('Foremen', 'Sample Foreman A');
      type(panel, 'Name', 'Sample Foreman B');
      expect(await within(panel).findByText('Could not save. Check the connection and try again.')).toBeTruthy();
    });

    it('says so when the list a picker offers cannot be loaded, rather than loading forever', async () => {
      failing = 'trucks';
      await settings();
      const panel = open('Drivers', 'Sample Driver A');
      expect(within(panel).getByText('Could not load the Trucks.')).toBeTruthy();
      expect(within(panel).queryByText('Loading…')).toBeNull();
    });
  });

  describe('a Truck', () => {
    it('says nothing about HCSS and asks for no HCSS code or id, which come from HCSS later', async () => {
      await settings();
      const panel = open('Trucks', '24');
      expect(within(panel).queryByText(/HCSS/)).toBeNull();
      expect(within(panel).queryByText(/linked/i)).toBeNull();
      expect(screen.queryByText(/HCSS/)).toBeNull();
    });
  });

  describe('a Place', () => {
    it('offers its kind as Job site, Plant and Shop or yard, and saves Shop or yard as shop', async () => {
      await settings();
      const panel = open('Places', 'Sample Plant');
      expect(options(pick(panel, 'kind'))).toEqual(['No kind', 'Job site', 'Plant', 'Shop or yard']);
      fireEvent.change(pick(panel, 'kind'), { target: { value: 'shop' } });
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/places/plc-plant', body: { kind: 'shop' } }]));
    });

    it('shows a saved yard as Shop or yard, and leaves it a yard until the kind is changed', async () => {
      await settings();
      const panel = open('Places', 'Sample Yard');
      expect(pick(panel, 'kind').value).toBe('shop');
      type(panel, /Full name/, 'Sample Equipment Yard');
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/places/plc-yard', body: { fullName: 'Sample Equipment Yard' } }]));
    });

    it('says whether it is on the truck map, and asks for no geofence code', async () => {
      await settings();
      expect(within(open('Places', 'Sample Plant')).getByText('On the truck map')).toBeTruthy();
      done(screen.getByRole('dialog'));
      const north = open('Places', 'Sample Site North');
      expect(within(north).getByText('Not on the truck map yet')).toBeTruthy();
      expect(north.textContent).not.toMatch(/geofence/i);
    });

    it('as a job site, picks its usual Foreman from the Foremen in use, saves it at once, and the chip shows him', async () => {
      await settings();
      const panel = open('Places', 'Sample Site North');
      expect(options(pick(panel, 'usualForemanId'))).toEqual(['No usual Foreman', 'Sample Foreman A']);
      fireEvent.change(pick(panel, 'usualForemanId'), { target: { value: 'frm-a' } });
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/places/plc-north', body: { usualForemanId: 'frm-a' } }]));
      done(panel);
      expect(chip('Places', 'Sample Site North').textContent).toBe('Sample Site NorthJob site · Sample Foreman A');
    });

    it('asks for a usual Foreman only once it is a job site', async () => {
      await settings();
      const panel = open('Places', 'Sample Plant');
      expect(pick(panel, 'usualForemanId')).toBeNull();
      expect(within(panel).queryByText('Usual Foreman')).toBeNull();
      fireEvent.change(pick(panel, 'kind'), { target: { value: 'job_site' } });
      expect(pick(panel, 'usualForemanId').value).toBe('none');
    });

    it('loses its usual Foreman when it stops being a job site', async () => {
      lists.places[1].usualForemanId = 'frm-a';
      await settings();
      const panel = open('Places', 'Sample Site North');
      expect(pick(panel, 'usualForemanId').value).toBe('frm-a');
      fireEvent.change(pick(panel, 'kind'), { target: { value: 'plant' } });
      await waitFor(() => expect(within(panel).getByText('Saved')).toBeTruthy());
      expect(pick(panel, 'usualForemanId')).toBeNull();
      fireEvent.change(pick(panel, 'kind'), { target: { value: 'job_site' } });
      expect(pick(panel, 'usualForemanId').value).toBe('none');
      done(panel);
      expect(chip('Places', 'Sample Site North').textContent).not.toContain('Sample Foreman A');
    });

    it('picks its Job from the active Jobs', async () => {
      await settings();
      const panel = open('Places', 'Sample Plant');
      expect(options(pick(panel, 'jobId'))).toEqual(['No Job', 'Sample Job North']);
    });
  });

  describe('an Inspection item', () => {
    const optional = (panel: HTMLElement) => within(panel).getByRole('switch', { name: 'Optional' });

    it('is marked optional, and back, at once, and the chip says so', async () => {
      await settings();
      const panel = open('Inspection checklist', 'Lights');
      expect(optional(panel).getAttribute('aria-checked')).toBe('false');
      expect(within(panel).getByText(/new wording is used from the next Inspection on/)).toBeTruthy();
      fireEvent.click(optional(panel));
      await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/inspection-items/insp-07', body: { optional: true } }]));
      expect(optional(panel).getAttribute('aria-checked')).toBe('true');
      done(panel);
      expect(chip('Inspection checklist', 'Lights').textContent).toContain('Optional');

      const again = open('Inspection checklist', 'Lights');
      expect(optional(again).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(optional(again));
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1].body).toEqual({ optional: false });
      done(again);
      expect(chip('Inspection checklist', 'Lights').textContent).not.toContain('Optional');
    });

    it('is added optional when marked so before it has its wording', async () => {
      await settings();
      const panel = add('Inspection checklist', 'Inspection item');
      fireEvent.click(optional(panel));
      type(panel, 'Item', 'Horn');
      await waitFor(() => expect(sent).toEqual([{ method: 'POST', path: '/api/inspection-items', body: { label: 'Horn', optional: true } }]));
      done(panel);
      expect(chips('Inspection checklist').at(-1)).toBe('Horn');
    });
  });

  describe('+ Add', () => {
    it.each([
      ['Drivers', 'Driver', 'Name', 'Sample Driver D', '/api/drivers', { name: 'Sample Driver D' }],
      ['Trucks', 'Truck', 'Number', '30', '/api/trucks', { number: '30' }],
      ['Places', 'Place', 'Short name', 'Sample Pit', '/api/places', { shortName: 'Sample Pit' }],
      ['Materials', 'Material', 'Name', 'Sample Fill', '/api/materials', { name: 'Sample Fill' }],
      ['Jobs', 'Job', 'Name', 'Sample Job East', '/api/jobs', { name: 'Sample Job East' }],
      ['Foremen', 'Foreman', 'Name', 'Sample Foreman D', '/api/foremen', { name: 'Sample Foreman D' }],
      ['Inspection checklist', 'Inspection item', 'Item', 'Horn', '/api/inspection-items', { label: 'Horn' }],
    ] as const)('adds to %s once a name is typed, last in the section', async (title, noun, label, name, path, body) => {
      await settings();
      const panel = add(title, noun);
      type(panel, label, name);
      await waitFor(() => expect(sent).toEqual([{ method: 'POST', path, body }]));
      done(panel);
      expect(chips(title).at(-1)).toBe(name);
    });

    it('keeps saving the new entry as Dave goes on typing, rather than adding it twice', async () => {
      await settings();
      const panel = add('Jobs', 'Job');
      type(panel, 'Name', 'Sample Job 30');
      await waitFor(() => expect(sent).toHaveLength(1));
      type(panel, /Job number/, 'J-30');
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1]).toEqual({ method: 'PATCH', path: expect.stringMatching(/^\/api\/jobs\//), body: { jobNumber: 'J-30' } });
    });

    it('saves nothing until there is a name', async () => {
      await settings();
      const panel = add('Places', 'Place');
      type(panel, /Full name/, 'Sample Aggregate Pit');
      done(panel);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(sent).toEqual([]);
      expect(chips('Places')).toEqual(['Sample Plant', 'Sample Site North', 'Sample Yard']);
    });
  });

  describe('Remove', () => {
    it('makes an entry inactive after asking, and it leaves the page', async () => {
      await settings();
      fireEvent.click(within(open('Materials', '2" minus')).getByRole('button', { name: 'Remove' }));
      const asking = screen.getByRole('alertdialog', { name: 'Remove 2" minus?' });
      fireEvent.click(within(asking).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(chips('Materials')).toEqual([]));
      expect(screen.queryByText('2" minus')).toBeNull();
      expect(sent).toEqual([{ method: 'PATCH', path: '/api/materials/mat-minus', body: { active: false } }]);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('changes nothing when Dave keeps the entry', async () => {
      await settings();
      const panel = open('Foremen', 'Sample Foreman A');
      fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      done(panel);
      expect(sent).toEqual([]);
      expect(chips('Foremen')).toEqual(['Sample Foreman A']);
    });

    it('warns how many later days still hold a Driver\'s Assignments', async () => {
      laterDays = { 'drv-a': 2 };
      await settings();
      fireEvent.click(within(open('Drivers', 'Sample Driver A')).getByRole('button', { name: 'Remove' }));
      const asking = screen.getByRole('alertdialog');
      expect(await within(asking).findByText('Sample Driver A has Assignments on 2 later days.')).toBeTruthy();
    });

    it('says one later day in the singular, and nothing about later days for a Driver with none', async () => {
      laterDays = { 'drv-a': 1 };
      await settings();
      fireEvent.click(within(open('Drivers', 'Sample Driver A')).getByRole('button', { name: 'Remove' }));
      expect(await within(screen.getByRole('alertdialog')).findByText('Sample Driver A has Assignments on 1 later day.')).toBeTruthy();
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep' }));
      done(screen.getByRole('dialog'));

      fireEvent.click(within(open('Drivers', 'Sample Driver C')).getByRole('button', { name: 'Remove' }));
      const asking = screen.getByRole('alertdialog');
      await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('/api/drivers/drv-c/later-days'), expect.anything()));
      expect(asking.textContent).not.toMatch(/later day/);
    });

    it('offers no way to delete an entry', async () => {
      await settings();
      open('Drivers', 'Sample Driver A');
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    });
  });

  describe('Dave\'s own order', () => {
    const move = (title: Title, name: string, way: 'up' | 'down') =>
      fireEvent.click(within(chip(title, name)).getByRole('button', { name: `Move ${name} ${way}` }));

    it('moves an Inspection item one place with ▲▼, saving the whole checklist\'s order', async () => {
      await settings();
      move('Inspection checklist', 'Air tank (drain)', 'up');
      expect(chips('Inspection checklist')).toEqual(['Dump box clean', 'Air tank (drain)', 'Lights']);
      await waitFor(() => expect(sent).toEqual([{ method: 'PUT', path: '/api/inspection-items/order', body: { order: ['insp-01', 'insp-11', 'insp-07'] } }]));
    });

    it('moves a Driver, Place or Material one place with ▲▼, saving the whole list\'s order in one request', async () => {
      await settings();
      move('Drivers', 'Sample Driver C', 'up');
      expect(chips('Drivers')).toEqual(['Sample Driver C', 'Sample Driver A']);
      move('Places', 'Sample Plant', 'down');
      expect(chips('Places')).toEqual(['Sample Site North', 'Sample Plant', 'Sample Yard']);
      await waitFor(() =>
        expect(sent).toEqual([
          { method: 'PUT', path: '/api/drivers/order', body: { order: ['drv-c', 'drv-a'] } },
          { method: 'PUT', path: '/api/places/order', body: { order: ['plc-north', 'plc-plant', 'plc-yard'] } },
        ]),
      );
    });

    it('offers no ▲ on the first entry and no ▼ on the last', async () => {
      await settings();
      const buttons = (title: Title, name: string) =>
        within(chip(title, name)).queryAllByRole('button', { name: /^Move/ }).map((b) => b.getAttribute('aria-label'));
      expect(buttons('Places', 'Sample Plant')).toEqual(['Move Sample Plant down']);
      expect(buttons('Places', 'Sample Site North')).toEqual(['Move Sample Site North up', 'Move Sample Site North down']);
      expect(buttons('Places', 'Sample Yard')).toEqual(['Move Sample Yard up']);
      expect(buttons('Materials', '2" minus')).toEqual([]);
    });

    it('is not offered for Trucks, Jobs or Foremen', async () => {
      await settings();
      for (const title of ['Trucks', 'Jobs', 'Foremen'] as const) {
        expect(within(section(title)).queryAllByRole('button', { name: /^Move/ })).toEqual([]);
      }
    });

    it('puts the entry back where it was, and says so, when the order cannot be saved', async () => {
      saveFails = true;
      await settings();
      move('Drivers', 'Sample Driver A', 'down');
      expect(await screen.findByText('Could not move Sample Driver A')).toBeTruthy();
      expect(chips('Drivers')).toEqual(['Sample Driver A', 'Sample Driver C']);
    });

  });

  describe('Truck problems', () => {
    const problemsSection = () => screen.getByRole('region', { name: 'Truck problems' });
    /** Each problem's line in the Open or Fixed list, as it reads. */
    const lines = (which: 'Open' | 'Fixed') => {
      const list = within(problemsSection()).queryByRole('list', { name: `${which} Truck problems` });
      return list ? within(list).getAllByRole('listitem').map((item) => item.textContent) : [];
    };
    const item = (name: string) => within(problemsSection()).getByRole('listitem', { name });

    it('lists open ones first, then fixed ones, each with its Truck, note, reporter and time, under Trucks', async () => {
      await settings();
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings.indexOf('Truck problems')).toBe(headings.indexOf('Trucks') + 1);
      expect(lines('Open')).toEqual([
        'Truck 24Tarp rippedSample Driver C · Thu, Nov 19 7:30 Mark fixed',
        'Truck 21Left marker outSample Driver A · Thu, Nov 19 6:42 Mark fixed',
      ]);
      expect(lines('Fixed')).toEqual(['Truck 21Flap tornSample Driver A · Tue, Nov 17 16:05Fixed Wed, Nov 18 9:00 · New flap']);
    });

    it('marks one a Driver reported during the day, rather than from an Inspection', async () => {
      problems = [problem({ id: 'tp-4', reportedAt: '2026-11-19T16:05:00.000Z', text: 'Hydraulics leaking', inspectionId: null }), ...problems];
      await settings();
      expect(lines('Open')[0]).toBe('Truck 21Hydraulics leakingSample Driver A · Thu, Nov 19 11:05 · reported during the day Mark fixed');
      expect(lines('Open')[1]).toBe('Truck 24Tarp rippedSample Driver C · Thu, Nov 19 7:30 Mark fixed');
    });

    it('says when none are open, and when they cannot be loaded', async () => {
      problems = problems.filter((p) => p.fixedAt);
      await settings();
      expect(within(problemsSection()).getByText('No open Truck problems.')).toBeTruthy();
      expect(lines('Fixed')).toHaveLength(1);
      cleanup();

      failing = 'truck-problems';
      await settings();
      expect(within(problemsSection()).getByText('Could not load the Truck problems. Reload the page to try again.')).toBeTruthy();
    });

    it('Mark fixed takes an optional note, closes the problem and keeps it, listed first among the fixed', async () => {
      await settings();
      fireEvent.click(within(item('Truck 21: Left marker out')).getByRole('button', { name: 'Mark fixed' }));
      type(item('Truck 21: Left marker out'), 'How it was fixed (optional)', 'New bulb');
      fireEvent.click(within(item('Truck 21: Left marker out')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lines('Open')).toEqual(['Truck 24Tarp rippedSample Driver C · Thu, Nov 19 7:30 Mark fixed']));
      expect(sent).toEqual([{ method: 'POST', path: '/api/truck-problems/tp-1/fix', body: { note: 'New bulb' } }]);
      expect(lines('Fixed')).toEqual([
        'Truck 21Left marker outSample Driver A · Thu, Nov 19 6:42Fixed Thu, Nov 19 10:00 · New bulb',
        'Truck 21Flap tornSample Driver A · Tue, Nov 17 16:05Fixed Wed, Nov 18 9:00 · New flap',
      ]);
    });

    it('marks one fixed with no note, and Cancel leaves it open', async () => {
      await settings();
      fireEvent.click(within(item('Truck 24: Tarp ripped')).getByRole('button', { name: 'Mark fixed' }));
      fireEvent.click(within(item('Truck 24: Tarp ripped')).getByRole('button', { name: 'Cancel' }));
      expect(within(item('Truck 24: Tarp ripped')).queryByRole('textbox')).toBeNull();
      expect(sent).toEqual([]);

      fireEvent.click(within(item('Truck 24: Tarp ripped')).getByRole('button', { name: 'Mark fixed' }));
      fireEvent.click(within(item('Truck 24: Tarp ripped')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lines('Fixed')[0]).toBe('Truck 24Tarp rippedSample Driver C · Thu, Nov 19 7:30Fixed Thu, Nov 19 10:00'));
      expect(sent).toEqual([{ method: 'POST', path: '/api/truck-problems/tp-3/fix', body: {} }]);
    });

    it('says so and leaves it open when it cannot be marked fixed', async () => {
      saveFails = true;
      await settings();
      fireEvent.click(within(item('Truck 21: Left marker out')).getByRole('button', { name: 'Mark fixed' }));
      fireEvent.click(within(item('Truck 21: Left marker out')).getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Could not mark Truck 21: Left marker out fixed')).toBeTruthy();
      expect(lines('Open')).toHaveLength(2);
    });

    it('offers no way for Dave to add one', async () => {
      await settings();
      expect(within(problemsSection()).queryByRole('button', { name: /Add/ })).toBeNull();
    });
  });
});
