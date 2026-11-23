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
const driverView = () => screen.getByRole('region', { name: 'Driver view' });
/** Randy's cards on his phone, in Dave's order. */
const cards = () => within(driverView()).getAllByRole('article').map((card) => card.textContent);
const setClock = (minutes: number) => fireEvent.change(screen.getByRole('slider', { name: 'Clock' }), { target: { value: String(minutes) } });
const choose = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), { target: { value } });

const A1 = 'First · J25008 Los Flamboyanes → Villager · Fill · Truck 55 (his own)';
const A2 = 'Then · Walworth Dolomite → J25008 Los Flamboyanes · 1&2 stone · Truck 55 (his own)';

describe('Simulation page: Truck 55 (MCK-55-17), Randy, Mon 16 Nov 2026', () => {
  it('shows nothing but the clock, the scenario picker and the views', () => {
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
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Scheduler view', 'Driver view']);
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

  describe('Driver view: Randy’s Today on his phone', () => {
    const CARD_A1 = 'FillPick upJ25008 Los FlamboyanesDrop offVillager';
    const CARD_A2 = '1&2 stonePick upWalworth DolomiteDrop offJ25008 Los Flamboyanes';

    it('at end of day shows A1 with 4 loads, last 11:25, and A2 with 2 loads, last 13:54', () => {
      render(<SimulatePage />);
      expect(within(driverView()).getAllByRole('article').map((c) => c.getAttribute('aria-label'))).toEqual(['Fill', '1&2 stone']);
      expect(cards()).toEqual([`4 loads · last 11:25${CARD_A1}`, `2 loads · last 13:54${CARD_A2}`]);
    });

    it('at 10:02 shows A1 with 2 loads, marked Now, and nothing new on A2', () => {
      render(<SimulatePage />);
      setClock(10 * 60 + 2);
      expect(cards()[0]).toBe(`Now2 loads · last 09:46${CARD_A1}`);
      expect(cards()[1]).toBe(CARD_A2);
    });

    it('before the Truck leaves the shop, shows the cards as his phone does today', () => {
      render(<SimulatePage />);
      setClock(6 * 60);
      expect(cards()).toEqual([CARD_A1, CARD_A2]);
    });
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
});
