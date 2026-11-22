// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SimulatePage } from './SimulatePage';

afterEach(cleanup);

const block = (label: string) => screen.getByRole('article', { name: `Board block ${label}` });
const card = (label: string) => screen.getByRole('article', { name: `Driver card ${label}` });
const setClock = (minutes: number) => fireEvent.change(screen.getByRole('slider', { name: 'Clock' }), { target: { value: String(minutes) } });

describe('Simulation page', () => {
  it('opens on the whole fake day: A1 4 loads and Done, A2 2 loads, South for Dave', () => {
    render(<SimulatePage />);
    expect(within(block('A1')).getByText(/4 loads · since 08:24/)).toBeTruthy();
    expect(within(block('A1')).getByText('Done')).toBeTruthy();
    expect(within(block('A2')).getByText(/2 loads/)).toBeTruthy();
    expect(within(card('A1')).getByText('4 loads · last 11:25')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/For Dave next morning: 14:15 Sample Site North → Sample Site South/);
    expect(screen.getByText(/vs meter 161.61: OK/)).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row')).toHaveLength(16);
  });

  it('shows the day as the Worker knows it when the clock moves back', () => {
    render(<SimulatePage />);
    setClock(10 * 60 + 2);
    expect(screen.getByText('10:02')).toBeTruthy();
    expect(within(block('A1')).getByText(/2 loads/)).toBeTruthy();
    expect(within(block('A1')).getByText('Now')).toBeTruthy();
    expect(within(block('A2')).getByText('No loads yet')).toBeTruthy();
    expect(screen.getByText(/the day’s meter reading comes at 4 AM/)).toBeTruthy();
  });

  it('matches against the Assignment as it was before a reroute', () => {
    render(<SimulatePage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), { target: { value: 'reroute' } });
    expect(within(block('A1')).getByText(/5 loads/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('changes the counts when Dave’s Assignment changes', () => {
    render(<SimulatePage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'A1 To' }), { target: { value: 'plc-south' } });
    expect(within(block('A1')).getByText(/1 load ·/)).toBeTruthy();
  });

  it('lists a geofence code with no Place when a Place leaves the truck map', () => {
    render(<SimulatePage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sample Site South on the truck map' }));
    expect(screen.getByText(/Geofence codes with no Place .*: J1002 South/)).toBeTruthy();
  });
});
