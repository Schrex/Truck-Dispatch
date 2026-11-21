// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

/**
 * The list API as Settings sees it: every list keeps what is added and
 * changed, refuses a name already used (ignoring case) and has no delete. A
 * Driver answers how many later days hold his Assignments.
 */
type Entry = Record<string, unknown> & { id: string; active: boolean };
const NAME: Record<string, string> = { drivers: 'name', trucks: 'number', jobs: 'name', places: 'shortName', materials: 'name', foremen: 'name' };
let lists: Record<string, Entry[]>;
const sent: { method: string; path: string; body: unknown }[] = [];
/** A list whose GET fails, if any. */
let failing: string | null = null;
/** Whether every save fails as if the connection dropped. */
let saveFails = false;
/** Each Driver's later days with Assignments, as the Worker would count them. */
let laterDays: Record<string, number>;

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const later = /\/api\/drivers\/([^/]+)\/later-days$/.exec(url.pathname);
  if (later) return answer({ laterDays: laterDays[later[1]] ?? 0 });
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
  if (saveFails) return answer({ error: 'oops' }, 500);
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
  };
  sent.length = 0;
  failing = null;
  saveFails = false;
  laterDays = {};
  api.mockClear();
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Title = 'Drivers' | 'Trucks' | 'Places' | 'Materials' | 'Jobs' | 'Foremen';

/** Opens Settings and waits until every section has its chips. */
const settings = async () => {
  window.history.pushState(null, '', '/settings');
  render(<App />);
  await waitFor(() => expect(screen.queryAllByText(/^Loading/)).toEqual([]));
};
const section = (title: Title) => screen.getByRole('region', { name: title });
/** The chips listed in use, or listed apart as removed, by name. */
const chips = (title: Title, which: 'in use' | 'removed' = 'in use') => {
  const list = within(section(title)).queryByRole('list', { name: which === 'in use' ? title : `Removed ${title}` });
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
      'Places',
      'Materials',
      'Jobs',
      'Foremen',
    ]);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows each entry as a chip with its key detail, and inactive entries listed apart as removed', async () => {
    await settings();
    expect(chips('Drivers')).toEqual(['Sample Driver A', 'Sample Driver C']);
    expect(chips('Drivers', 'removed')).toEqual(['Sample Driver X']);
    expect(chip('Drivers', 'Sample Driver A').textContent).toContain('Truck 21');

    expect(chip('Trucks', '21').textContent).toContain('Linked to HCSS Fleet');
    expect(chip('Trucks', '24').textContent).toContain('Not linked yet');
    expect(chips('Trucks', 'removed')).toEqual(['99']);

    expect(chip('Places', 'Sample Plant').textContent).toContain('Plant');
    expect(chip('Places', 'Sample Site North').textContent).toContain('Job site');
    expect(chip('Places', 'Sample Yard').textContent).toContain('Shop or yard');
    expect(chips('Places', 'removed')).toEqual(['Sample Old Pit']);

    expect(chip('Jobs', 'Sample Job North').textContent).toContain('S-1001');
    expect(chips('Materials')).toEqual(['2" minus']);
    expect(chips('Materials', 'removed')).toEqual(['Sample Old Fill']);
    expect(chips('Foremen')).toEqual(['Sample Foreman A']);
    expect(chips('Foremen', 'removed')).toEqual(['Sample Foreman X']);
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
    it('keeps its HCSS code and id editable, and says whether it is linked to HCSS Fleet', async () => {
      await settings();
      const panel = open('Trucks', '24');
      expect(within(panel).getByText('Not linked yet')).toBeTruthy();
      type(panel, /HCSS code/, 'T24');
      type(panel, /HCSS id/, '9a2b');
      await waitFor(() => expect(within(panel).getByText('Linked to HCSS Fleet')).toBeTruthy());
      expect(sent).toEqual([
        { method: 'PATCH', path: '/api/trucks/trk-24', body: { hcssCode: 'T24' } },
        { method: 'PATCH', path: '/api/trucks/trk-24', body: { hcssGuid: '9a2b' } },
      ]);
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
      expect(chip('Places', 'Sample Site North').textContent).toBe('Sample Site NorthSample Foreman A');
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

  describe('+ Add', () => {
    it.each([
      ['Drivers', 'Driver', 'Name', 'Sample Driver D', '/api/drivers', { name: 'Sample Driver D' }],
      ['Trucks', 'Truck', 'Number', '30', '/api/trucks', { number: '30' }],
      ['Places', 'Place', 'Short name', 'Sample Pit', '/api/places', { shortName: 'Sample Pit' }],
      ['Materials', 'Material', 'Name', 'Sample Fill', '/api/materials', { name: 'Sample Fill' }],
      ['Jobs', 'Job', 'Name', 'Sample Job East', '/api/jobs', { name: 'Sample Job East' }],
      ['Foremen', 'Foreman', 'Name', 'Sample Foreman D', '/api/foremen', { name: 'Sample Foreman D' }],
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
      const panel = add('Trucks', 'Truck');
      type(panel, 'Number', '30');
      await waitFor(() => expect(sent).toHaveLength(1));
      type(panel, /HCSS code/, 'T30');
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1]).toEqual({ method: 'PATCH', path: '/api/trucks/new-3', body: { hcssCode: 'T30' } });
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
    it('makes an entry inactive after asking, and lists it apart', async () => {
      await settings();
      fireEvent.click(within(open('Materials', '2" minus')).getByRole('button', { name: 'Remove' }));
      const asking = screen.getByRole('alertdialog', { name: 'Remove 2" minus?' });
      fireEvent.click(within(asking).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(chips('Materials', 'removed')).toEqual(['2" minus', 'Sample Old Fill']));
      expect(chips('Materials')).toEqual([]);
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

  describe('a removed entry', () => {
    it('comes back with one tap', async () => {
      await settings();
      fireEvent.click(within(chip('Drivers', 'Sample Driver X')).getByRole('button', { name: 'Bring back' }));
      await waitFor(() => expect(chips('Drivers')).toEqual(['Sample Driver A', 'Sample Driver C', 'Sample Driver X']));
      expect(chips('Drivers', 'removed')).toEqual([]);
      expect(sent).toEqual([{ method: 'PATCH', path: '/api/drivers/drv-x', body: { active: true } }]);
    });

    it('can be opened, and brought back from its panel', async () => {
      await settings();
      const panel = open('Places', 'Sample Old Pit');
      expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull();
      fireEvent.click(within(panel).getByRole('button', { name: 'Bring back' }));
      expect(await within(panel).findByRole('button', { name: 'Remove' })).toBeTruthy();
      done(panel);
      expect(chips('Places')).toContain('Sample Old Pit');
    });
  });
});
