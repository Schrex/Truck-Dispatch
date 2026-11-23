// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const setClock = (minutes: number) => fireEvent.change(screen.getByRole('slider', { name: 'Clock' }), { target: { value: String(minutes) } });
const choose = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), { target: { value } });

/** The Truck log header, as the paper's boxes: label → what is written in it. */
const truckLog = () => {
  const header = within(screen.getByRole('region', { name: 'Truck log' })).getByRole('group', { name: 'Truck log header' });
  return Object.fromEntries([...header.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
};

const A1 = 'First · J25008 Los Flamboyanes → Villager · Fill · Truck 55 (his own)';
const A2 = 'Then · Walworth Dolomite → J25008 Los Flamboyanes · 1&2 stone · Truck 55 (his own)';

describe('Simulation page: Truck 55 (MCK-55-17), Randy, Mon 16 Nov 2026', () => {
  it('shows nothing but the clock, the scenario picker, the Scheduler view and the Truck log', () => {
    render(<SimulatePage />);
    expect(screen.getAllByRole('slider').map((s) => s.getAttribute('aria-label'))).toEqual(['Clock']);
    expect(screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual(['Scenario']);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Play the day']);
    expect(within(screen.getByRole('combobox', { name: 'Scenario' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'As planned',
      'The other way round',
      'Reroute at 11:20',
    ]);
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Scheduler view', 'Truck log']);
  });

  it('opens at end of day: Randy’s lane with Truck 55, A1 4 Loads Done since 08:24, A2 2 Loads Done', () => {
    render(<SimulatePage />);
    expect(screen.getByText('end of day')).toBeTruthy();
    expect(within(scheduler()).getByRole('article', { name: 'Randy' }).querySelector('[data-lane-about]')?.textContent).toBe('Truck 55');
    expect(randy()).toEqual([`${A1} · 4 Loads · Done · since 08:24`, `${A2} · 2 Loads · Done · since 11:30`]);
  });

  it('at 10:02 shows A1 with 2 Loads and Now, and nothing new on A2', () => {
    render(<SimulatePage />);
    setClock(10 * 60 + 2);
    expect(screen.getByText('10:02')).toBeTruthy();
    expect(randy()).toEqual([`${A1} · 2 Loads · Now · since 08:24`, A2]);
  });

  it('before the Truck leaves the shop, looks like today’s board', () => {
    render(<SimulatePage />);
    setClock(6 * 60);
    expect(randy()).toEqual([A1, A2]);
  });

  it('the other way round gives A1 3 Loads', () => {
    render(<SimulatePage />);
    choose('other-way');
    expect(randy()[0]).toBe('First · Villager → J25008 Los Flamboyanes · Fill · Truck 55 (his own) · 3 Loads · Done · since 08:24');
  });

  it('the reroute at 11:20 gives A1 5 Loads, counting the ones before it, and shows A1 as it was before 11:20', () => {
    render(<SimulatePage />);
    choose('reroute');
    expect(randy()[0]).toBe('First · Changed · J25008 Los Flamboyanes → J611 Bishop Kearney · Fill · Truck 55 (his own) · 5 Loads · Done · since 08:24');
    setClock(11 * 60);
    expect(randy()[0]).toBe(`${A1} · 3 Loads · Now · since 08:24`);
  });

  it('plays the day in 10-minute steps, the rate the Worker pulls Fleet', () => {
    vi.useFakeTimers();
    render(<SimulatePage />);
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
      render(<SimulatePage />);
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
      render(<SimulatePage />);
      setClock(10 * 60 + 2);
      expect(truckLog()).toMatchObject({ 'Start time': '06:19', 'End time': '', 'Start miles': '258,050.6', 'End miles': '', Driver: 'Randy', 'Total hours': '' });
    });

    it('after ignition off, before the next morning’s reading: end time but no end miles', () => {
      render(<SimulatePage />);
      setClock(20 * 60);
      expect(truckLog()).toMatchObject({ 'End time': '16:12', 'End miles': '', 'Total hours': '9.88' });
    });
  });
});
