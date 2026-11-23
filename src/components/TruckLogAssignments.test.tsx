// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TruckLogColumn } from '../../shared/trips';
import { TruckLogAssignments } from './TruckLogAssignments';

afterEach(cleanup);

const column = (over: Partial<TruckLogColumn>): TruckLogColumn => ({
  id: 'a1',
  job: 'J1001 North',
  pickUp: 'Sample Plant',
  dropOff: 'Sample Site North',
  material: 'Fill',
  loads: 2,
  tons: null,
  truckingHours: 1.5,
  unverified: false,
  ...over,
});
const tonsBox = () => within(screen.getByRole('group', { name: 'Assignment 1' })).getByText('# of tons').nextElementSibling?.textContent;

describe('Truck log column: # of tons', () => {
  it('writes the tons from the Tickets once there are some', () => {
    render(<TruckLogAssignments columns={[column({ tons: 44.5 })]} shopTrips={[]} />);
    expect(tonsBox()).toBe('44.50');
  });

  it('is blank, marked "from Tickets", until then', () => {
    render(<TruckLogAssignments columns={[column({ tons: null })]} shopTrips={[]} />);
    expect(tonsBox()).toBe('from Tickets');
  });
});

describe('Truck log: an extra job no Assignment explains', () => {
  it('is its own column after Dave’s, marked unverified, with Material and # of loads for Dave to decide', () => {
    render(
      <TruckLogAssignments
        columns={[column({}), column({ id: 'x', pickUp: 'Sample Site North', dropOff: 'Sample Site South', material: null, loads: null, unverified: true })]}
        shopTrips={[]}
      />,
    );
    const extra = within(screen.getByRole('group', { name: 'Assignment 2 · unverified' }));
    expect(extra.getByText('Material').nextElementSibling?.textContent).toBe('Unknown · Dave decides');
    expect(extra.getByText('# of loads').nextElementSibling?.textContent).toBe('Unknown · Dave decides');
    expect(extra.getByText('Drop off').nextElementSibling?.textContent).toBe('Sample Site South');
  });
});
