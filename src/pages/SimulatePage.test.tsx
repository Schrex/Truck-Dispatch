// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SimulatePage } from './SimulatePage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const scheduler = () => screen.getByRole('region', { name: 'Scheduler view' });
/** Randy's blocks as Dave reads them, in Dave's order. */
const randy = () =>
  within(within(scheduler()).getByRole('article', { name: 'Randy' }))
    .getAllByRole('listitem')
    .map((block) => block.textContent);
const driverView = () => screen.getByRole('region', { name: 'Driver view' });
/** Randy's cards on his phone, in Dave's order. */
const cards = () => within(driverView()).getAllByRole('article').map((card) => card.textContent);
const setClock = (minutes: number) => fireEvent.change(screen.getByRole('slider', { name: 'Clock' }), { target: { value: String(minutes) } });
const choose = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), { target: { value } });

/** The Truck log header, as the paper's boxes: label → what is written in it. */
const truckLog = () => {
  const header = within(screen.getByRole('region', { name: 'Truck log' })).getByRole('group', { name: 'Truck log header' });
  return Object.fromEntries([...header.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
};
/** The Truck log's Assignment columns, in Dave's order: each as label → what is written in it. */
const columns = () =>
  within(screen.getByRole('region', { name: 'Truck log' }))
    .getAllByRole('group', { name: /^Assignment \d/ })
    .map((col) => Object.fromEntries([...col.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));
/** The Truck log's names for its Assignment columns, in Dave's order. */
const columnNames = () =>
  within(screen.getByRole('region', { name: 'Truck log' }))
    .getAllByRole('group', { name: /^Assignment \d/ })
    .map((col) => col.getAttribute('aria-label'));
/** The drives to and from the shop, as listed under the columns. */
/** The Truck log's Unplanned work boxes, after the columns: what each reads. */
const unplannedLog = () =>
  within(screen.getByRole('region', { name: 'Truck log' }))
    .queryAllByRole('group', { name: /^Unplanned work/ })
    .map((box) => box.querySelector('p')?.textContent);
/** What Randy's lane says about his Unplanned work, after his blocks; null when it says nothing. */
const laneUnplanned = () => within(within(scheduler()).getByRole('article', { name: 'Randy' })).queryByText(/Unplanned work$/)?.textContent ?? null;
const shopLog = () =>
  within(within(screen.getByRole('region', { name: 'Truck log' })).getByRole('group', { name: 'To and from the shop' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);

const A1 = 'First · J25008 Los Flamboyanes → Villager · Fill · Truck 55 (his own)';
const A2 = 'Then · Walworth Dolomite → J25008 Los Flamboyanes · 1&2 stone · Truck 55 (his own)';

/** The Trip log's rows: Left, From → To, Miles, Kind, Assignment, Why. */
const tripLog = () =>
  within(within(screen.getByRole('region', { name: 'Trip log' })).getByRole('table', { name: 'Trips' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent));

describe('Simulation page: Truck 55 (MCK-55-17), Randy, Mon 16 Nov 2026', () => {
  it('shows nothing but the clock, the scenario picker and the views', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    expect(screen.getAllByRole('slider').map((s) => s.getAttribute('aria-label'))).toEqual(['Clock']);
    expect(screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Scenario']);
    // And the Unplanned work's, to answer it from Randy's lane or from the Truck log.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Play the day', '1 Unplanned work', 'Answer']);
    // Its way back is the Board button, as from Settings; "← Hub" top left, as on every page.
    expect(screen.getAllByRole('link').map((l) => l.textContent?.trim())).toEqual(['← Hub', 'Board']);
    expect(within(screen.getByRole('combobox', { name: 'Scenario' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'As planned',
      'The other way round',
      'Reroute at 11:20',
    ]);
    expect(screen.getAllByRole('table').map((t) => t.getAttribute('aria-label'))).toEqual(['Trips']);
    expect(document.querySelector('input[type=file]')).toBeNull();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Scheduler view', 'Driver view', 'Trip log', 'Truck log']);
  });

  it('opens at end of day: Randy’s lane with Truck 55, A1 4 Loads Done since 08:24, A2 2 Loads Done', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    expect(screen.getByText('end of day')).toBeTruthy();
    expect(within(scheduler()).getByRole('article', { name: 'Randy' }).querySelector('[data-lane-about]')?.textContent).toBe('Truck 55');
    expect(randy()).toEqual([`${A1} · 4 Loads · Done · since 08:24`, `${A2} · 2 Loads · Done · since 11:30`]);
  });

  it('at 10:02 shows A1 with 2 Loads and Now, and nothing new on A2', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    setClock(10 * 60 + 2);
    expect(screen.getByText('10:02')).toBeTruthy();
    expect(randy()).toEqual([`${A1} · 2 Loads · Now · since 08:24`, A2]);
  });

  it('before the Truck leaves the shop, looks like today’s board', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    setClock(6 * 60);
    expect(randy()).toEqual([A1, A2]);
  });

  it('the other way round gives A1 3 Loads', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    choose('other-way');
    expect(randy()[0]).toBe('First · Villager → J25008 Los Flamboyanes · Fill · Truck 55 (his own) · 3 Loads · Done · since 08:24');
  });

  it('the reroute at 11:20 gives A1 5 Loads, counting the ones before it, and shows A1 as it was before 11:20', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    choose('reroute');
    expect(randy()[0]).toBe('First · Changed · J25008 Los Flamboyanes → J611 Bishop Kearney · Fill · Truck 55 (his own) · 5 Loads · Done · since 08:24');
    setClock(11 * 60);
    expect(randy()[0]).toBe(`${A1} · 3 Loads · Now · since 08:24`);
  });

  describe('Driver view: Randy’s Today on his phone', () => {
    const CARD_A1 = 'FillPick upJ25008 Los FlamboyanesDrop offVillager';
    const CARD_A2 = '1&2 stonePick upWalworth DolomiteDrop offJ25008 Los Flamboyanes';

    it('at end of day shows A1 with 4 Loads, last 11:25, and A2 with 2 Loads, last 13:54', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      expect(within(driverView()).getAllByRole('article').map((c) => c.getAttribute('aria-label'))).toEqual(['Fill', '1&2 stone']);
      expect(cards()).toEqual([`4 Loads · last 11:25${CARD_A1}`, `2 Loads · last 13:54${CARD_A2}`]);
    });

    it('at 10:02 shows A1 with 2 Loads, marked Now, and nothing new on A2', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(10 * 60 + 2);
      expect(cards()[0]).toBe(`Now2 Loads · last 09:46${CARD_A1}`);
      expect(cards()[1]).toBe(CARD_A2);
    });

    it('before the Truck leaves the shop, shows the cards as his phone does today', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(6 * 60);
      expect(cards()).toEqual([CARD_A1, CARD_A2]);
    });
  });

  it('plays the day in 10-minute steps, the rate the Worker pulls Fleet', () => {
    vi.useFakeTimers();
    render(<SimulatePage />, { wrapper: MemoryRouter });
    setClock(10 * 60);
    fireEvent.click(screen.getByRole('button', { name: 'Play the day' }));
    act(() => {
      vi.advanceTimersToNextTimer();
    });
    expect(screen.getByText('10:10')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  describe('Truck log header', () => {
    it('at end of day reads like the paper, filled in: Truck, date, times, miles, Driver, Total hours', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      expect(truckLog()).toEqual({
        Truck: '55 (MCK-55-17)',
        Date: 'Mon 16 Nov 2026',
        'Start time': '06:19',
        'End time': '16:12',
        'Start miles': '258,050.6',
        'End miles': '258,212.2',
        Driver: 'Randy',
        'Total hours': '9.88',
      });
    });

    it('at 10:02 shows what is known by then: started 06:19, no end time, end miles or Total hours yet', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(10 * 60 + 2);
      expect(truckLog()).toMatchObject({ 'Start time': '06:19', 'End time': '', 'Start miles': '258,050.6', 'End miles': '', Driver: 'Randy', 'Total hours': '' });
    });

    it('after ignition off, before the next morning’s reading: end time but no end miles', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(20 * 60);
      expect(truckLog()).toMatchObject({ 'End time': '16:12', 'End miles': '', 'Total hours': '9.88' });
    });

    it('shows end miles from 22:12, when that evening’s reading was taken', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(22 * 60 + 11);
      expect(truckLog()['End miles']).toBe('');
      setClock(22 * 60 + 12);
      expect(truckLog()['End miles']).toBe('258,212.2');
    });
  });

  describe('Truck log columns: one per Assignment, then the Unplanned work, and the drives to and from the shop', () => {
    it('at end of day: A1 and A2 as Assignment 1 and 2, tons from Tickets, and no column for the Bishop Kearney stop', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      expect(columns()).toEqual([
        {
          Job: 'J25008 Los Flamboyanes',
          'Pick up': 'J25008 Los Flamboyanes',
          'Drop off': 'Villager',
          Material: 'Fill',
          '# of loads': '4',
          '# of tons': 'from Tickets',
          'Trucking hours': '3.02',
        },
        {
          Job: 'J25008 Los Flamboyanes',
          'Pick up': 'Walworth Dolomite',
          'Drop off': 'J25008 Los Flamboyanes',
          Material: '1&2 stone',
          '# of loads': '2',
          '# of tons': 'from Tickets',
          'Trucking hours': '2.40',
        },
      ]);
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
    });

    it('at end of day logs the drive out of the shop in the morning and the drive back to it', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      expect(shopLog()).toEqual([
        '06:24–07:02 · Shop → J25008 Los Flamboyanes · 20.59 mi · empty',
        '15:41–16:03 · J25008 Los Flamboyanes → Shop · 18.39 mi · empty',
      ]);
      setClock(15 * 60 + 50);
      expect(shopLog()).toEqual(['06:24–07:02 · Shop → J25008 Los Flamboyanes · 20.59 mi · empty']);
      setClock(6 * 60);
      expect(within(screen.getByRole('group', { name: 'To and from the shop' })).getByText('None yet')).toBeTruthy();
    });

    it('with the reroute at 11:20 the Bishop Kearney Trip counts on A1', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      choose('reroute');
      expect(columns()[0]).toMatchObject({ Job: 'J611 Bishop Kearney', 'Drop off': 'J611 Bishop Kearney', '# of loads': '5' });
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
    });

    it('at 10:02 shows what is known by then: A1 2 loads and its hours so far, A2 nothing yet', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(10 * 60 + 2);
      expect(columns().map((o) => [o['# of loads'], o['Trucking hours']])).toEqual([
        ['2', '1.59'],
        ['0', ''],
      ]);
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
    });
  });

  describe('Unplanned work: the drive to Bishop Kearney and back, which Dave never Assigned', () => {
    it('at end of day: an amber box after Dave’s columns with its Places and times, and "1 Unplanned work" after Randy’s blocks', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      expect(unplannedLog()).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h']);
      expect(within(screen.getByRole('group', { name: 'Unplanned work' })).queryByText(/Pick up|Drop off/)).toBeNull();
      expect(laneUnplanned()).toBe('1 Unplanned work');
      // His blocks are as before: the marker is not one of them.
      expect(randy()).toEqual([`${A1} · 4 Loads · Done · since 08:24`, `${A2} · 2 Loads · Done · since 11:30`]);
    });

    it('with the reroute at 11:20 there is none: no box, nothing on the lane', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      choose('reroute');
      expect(unplannedLog()).toEqual([]);
      expect(laneUnplanned()).toBeNull();
    });

    it('before 14:23 there is none; from then it grows as the Trips are written', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      setClock(14 * 60 + 22);
      expect(unplannedLog()).toEqual([]);
      expect(laneUnplanned()).toBeNull();
      setClock(14 * 60 + 25);
      expect(unplannedLog()).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15 · 0.14 h']);
      expect(laneUnplanned()).toBe('1 Unplanned work');
      setClock(14 * 60 + 45);
      expect(unplannedLog()).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h']);
    });

    it('in the Trip log both Trips are for Dave and neither is an Assignment’s', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      const rows = tripLog();
      expect(rows.filter((r) => r[0] === '14:15' || r[0] === '14:33').map((r) => [r[0], r[3], r[4]])).toEqual([
        ['14:15', 'for Dave', '–'],
        ['14:33', 'for Dave', '–'],
      ]);
    });
  });

  describe('Make an Assignment: Dave answers the Unplanned work', () => {
    const answer = () => screen.getByRole('dialog', { name: 'Unplanned work' });
    const tap = (name: string, inside: HTMLElement = answer()) => fireEvent.click(within(inside).getByRole('button', { name }));
    const row = (name: string) => within(answer()).getByRole('group', { name });
    const save = () => within(answer()).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    /** Open the answer from the Truck log's Unplanned work box, and choose Make an Assignment. */
    const openFromTruckLog = () => {
      tap('Answer', screen.getByRole('group', { name: 'Unplanned work' }));
      tap('Make an Assignment');
    };
    const A3_COLUMN = {
      Job: 'J25008 Los Flamboyanes',
      'Pick up': 'J611 Bishop Kearney',
      'Drop off': 'J25008 Los Flamboyanes',
      Material: 'Top soil',
      '# of loads': '1',
      '# of tons': 'from Tickets',
      'Trucking hours': '0.46',
    };

    it('asks where he loaded, one tap per Place of the piece, and the Material from the list or typed', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      expect(within(answer()).getByText('J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h')).toBeTruthy();
      expect(within(row('Where did he load?')).getAllByRole('button').map((b) => b.textContent)).toEqual(['J25008 Los Flamboyanes', 'J611 Bishop Kearney']);
      expect(within(row('Material')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Fill', '1&2 stone', 'Top soil', 'Or type it']);
    });

    it('as planned, "loaded at J611 Bishop Kearney" and "Top soil" make Assignment 3, From the Truck, and the Unplanned work is gone', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      tap('J611 Bishop Kearney');
      tap('Top soil');
      fireEvent.click(save());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(unplannedLog()).toEqual([]);
      expect(laneUnplanned()).toBeNull();
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2', 'Assignment 3 · From the Truck']);
      expect(columns()[2]).toEqual(A3_COLUMN);
      // Assigned, not Added: on the lane it is marked From the Truck and nothing else.
      expect(randy()[2]).toBe('Then · From the Truck · J611 Bishop Kearney → J25008 Los Flamboyanes · Top soil · Truck 55 (his own) · 1 Load · Done · since 14:15');
      expect(within(scheduler()).queryByText('Added')).toBeNull();
      // Randy gets no notice: it is not on his phone.
      expect(cards()).toHaveLength(2);
    });

    it('after that answer the Trip log reads 14:15 empty, to its pickup, and 14:33 the Load, both A3’s', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      tap('J611 Bishop Kearney');
      tap('Top soil');
      fireEvent.click(save());
      expect(tripLog().filter((r) => r[0] === '14:15' || r[0] === '14:33').map((r) => [r[0], r[3], r[4], r[5]])).toEqual([
        ['14:15', 'empty', 'A3', 'Going to the Assignment’s pickup'],
        ['14:33', 'load', 'A3', 'From and To match the Assignment'],
      ]);
    });

    it('"loaded at J25008", from the lane, gives the opposite route, and 14:15 becomes the Load', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      tap('1 Unplanned work', scheduler());
      tap('Make an Assignment');
      tap('J25008 Los Flamboyanes');
      tap('Top soil');
      fireEvent.click(save());
      expect(columns()[2]).toMatchObject({ Job: 'J611 Bishop Kearney', 'Pick up': 'J25008 Los Flamboyanes', 'Drop off': 'J611 Bishop Kearney', '# of loads': '1' });
      expect(tripLog().filter((r) => r[0] === '14:15' || r[0] === '14:33').map((r) => [r[0], r[3], r[4]])).toEqual([
        ['14:15', 'load', 'A3'],
        ['14:33', 'empty', 'A3'],
      ]);
    });

    it('cannot be saved without both the load Place and the Material', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      expect(save().disabled).toBe(true);
      tap('J611 Bishop Kearney');
      expect(save().disabled).toBe(true);
      tap('J611 Bishop Kearney');
      tap('Top soil');
      expect(save().disabled).toBe(true);
      tap('Or type it');
      expect(save().disabled).toBe(true);
      tap('J25008 Los Flamboyanes');
      fireEvent.change(within(answer()).getByRole('textbox', { name: 'Material, typed' }), { target: { value: '  ' } });
      expect(save().disabled).toBe(true);
      fireEvent.change(within(answer()).getByRole('textbox', { name: 'Material, typed' }), { target: { value: 'Mulch' } });
      expect(save().disabled).toBe(false);
      fireEvent.click(save());
      expect(columns()[2]).toMatchObject({ 'Pick up': 'J25008 Los Flamboyanes', Material: 'Mulch' });
    });

    it('Cancel leaves the Unplanned work as it was', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      tap('J611 Bishop Kearney');
      tap('Cancel');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(unplannedLog()).toHaveLength(1);
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
    });

    it('changing the scenario resets the answer', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      openFromTruckLog();
      tap('J611 Bishop Kearney');
      tap('Top soil');
      fireEvent.click(save());
      choose('other-way');
      choose('planned');
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
      expect(unplannedLog()).toEqual(['J25008 Los Flamboyanes ⇄ J611 Bishop Kearney · out 14:15, back 14:33 · 0.46 h']);
    });
  });

  describe('Link to an Assignment and Not a haul: the other answers', () => {
    const answer = () => screen.getByRole('dialog', { name: 'Unplanned work' });
    const tap = (name: string, inside: HTMLElement = answer()) => fireEvent.click(within(inside).getByRole('button', { name }));
    const row = (name: string) => within(answer()).getByRole('group', { name });
    const save = () => within(answer()).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const open = (way: string) => {
      tap('Answer', screen.getByRole('group', { name: 'Unplanned work' }));
      tap(way);
    };
    const run = () => tripLog().filter((r) => r[0] === '14:15' || r[0] === '14:33');

    it('offers all three ways', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      tap('Answer', screen.getByRole('group', { name: 'Unplanned work' }));
      expect(within(row('How does Dave answer?')).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Make an Assignment',
        'Link to an Assignment',
        'Not a haul',
      ]);
    });

    it('linking offers only Randy’s Assignments on 16 Nov, and asks where he loaded', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      open('Link to an Assignment');
      expect(within(row('Which Assignment?')).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'A1 · J25008 Los Flamboyanes → Villager',
        'A2 · Walworth Dolomite → J25008 Los Flamboyanes',
      ]);
      expect(within(row('Where did he load?')).getAllByRole('button').map((b) => b.textContent)).toEqual(['J25008 Los Flamboyanes', 'J611 Bishop Kearney']);
      expect(save().disabled).toBe(true);
      tap('A2 · Walworth Dolomite → J25008 Los Flamboyanes');
      expect(save().disabled).toBe(true);
    });

    it('as planned, linked to A2 loaded at J611: A2 is rerouted at 14:15, shows Changed, has 3 Loads and runs 11:30 to 14:43', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      open('Link to an Assignment');
      tap('A2 · Walworth Dolomite → J25008 Los Flamboyanes');
      tap('J611 Bishop Kearney');
      fireEvent.click(save());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(unplannedLog()).toEqual([]);
      expect(laneUnplanned()).toBeNull();
      expect(randy()).toEqual([
        `${A1} · 4 Loads · Done · since 08:24`,
        'Then · Changed · J611 Bishop Kearney → J25008 Los Flamboyanes · 1&2 stone · Truck 55 (his own) · 3 Loads · Done · since 11:30',
      ]);
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
      expect(columns()[1]).toMatchObject({ 'Pick up': 'J611 Bishop Kearney', 'Drop off': 'J25008 Los Flamboyanes', '# of loads': '3', 'Trucking hours': '3.21' });
      expect(run().map((r) => [r[0], r[3], r[4]])).toEqual([
        ['14:15', 'empty', 'A2'],
        ['14:33', 'load', 'A2'],
      ]);
      // Before 14:15 A2 is as Dave planned it.
      setClock(14 * 60);
      expect(randy()[1]).toBe(`${A2} · 2 Loads · Now · since 11:30`);
    });

    it('after "Not a haul" with the note "fuel": no Unplanned work, both Trips marked not a haul, and Total hours still 9.88', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      open('Not a haul');
      expect(save().disabled).toBe(false);
      fireEvent.change(within(answer()).getByRole('textbox', { name: 'Note' }), { target: { value: 'fuel' } });
      fireEvent.click(save());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(unplannedLog()).toEqual([]);
      expect(laneUnplanned()).toBeNull();
      expect(run().map((r) => [r[0], r[3], r[4], r[5]])).toEqual([
        ['14:15', 'not a haul', '–', 'Not a haul: fuel'],
        ['14:33', 'not a haul', '–', 'Not a haul: fuel'],
      ]);
      expect(truckLog()['Total hours']).toBe('9.88');
      expect(columnNames()).toEqual(['Assignment 1', 'Assignment 2']);
      expect(randy()).toEqual([`${A1} · 4 Loads · Done · since 08:24`, `${A2} · 2 Loads · Done · since 11:30`]);
    });

    it('"Not a haul" saves with no note', () => {
      render(<SimulatePage />, { wrapper: MemoryRouter });
      open('Not a haul');
      fireEvent.click(save());
      expect(unplannedLog()).toEqual([]);
      expect(run().map((r) => r[5])).toEqual(['Not a haul', 'Not a haul']);
    });
  });

  it('logs every Trip the Truck made, down to the last drive from the job site back to the shop', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    const rows = tripLog();
    expect(rows[0].slice(0, 2)).toEqual(['06:24', 'Shop → J25008 Los Flamboyanes']);
    expect(rows.at(-1)!.slice(0, 5)).toEqual(['15:41', 'J25008 Los Flamboyanes → Shop', '18.39', 'empty', '–']);
    expect(rows.at(-1)![5]).toContain('To or from the shop or a yard');
    expect(rows.find((r) => r[1] === 'J25008 Los Flamboyanes → J611 Bishop Kearney')!.slice(3, 5)).toEqual(['for Dave', '–']);
    expect(rows.filter((r) => r[3] === 'load' && r[4] === 'A1')).toHaveLength(4);
  });

  it('logs only the Trips known at the clock’s time, and follows the scenario', () => {
    render(<SimulatePage />, { wrapper: MemoryRouter });
    setClock(10 * 60 + 2);
    expect(tripLog().map((r) => r[0])).toEqual(['06:24', '08:24', '08:43', '09:35', '09:50']);
    setClock(6 * 60);
    expect(within(screen.getByRole('region', { name: 'Trip log' })).getByText('No Trips yet at this time.')).toBeTruthy();
    choose('reroute');
    expect(screen.queryByText('No Trips yet at this time.')).toBeTruthy();
  });
});
