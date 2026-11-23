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
  ...over,
});
const tonsBox = () => within(screen.getByRole('group', { name: 'Assignment 1' })).getByText('# of tons').nextElementSibling?.textContent;

describe('Truck log column: # of tons', () => {
  it('writes the tons from the Tickets once there are some', () => {
    render(<TruckLogAssignments columns={[column({ tons: 44.5 })]} unexplained={[]} />);
    expect(tonsBox()).toBe('44.50');
  });

  it('is blank, marked "from Tickets", until then', () => {
    render(<TruckLogAssignments columns={[column({ tons: null })]} unexplained={[]} />);
    expect(tonsBox()).toBe('from Tickets');
  });
});
