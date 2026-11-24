// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TruckLogColumn, TruckLogUnplanned } from '../../shared/trips';
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
    render(<TruckLogAssignments log={{ columns: [column({ tons: 44.5 })], unplanned: [], whichAssignment: [], shopTrips: [] }} />);
    expect(tonsBox()).toBe('44.50');
  });

  it('is blank, marked "from Tickets", until then', () => {
    render(<TruckLogAssignments log={{ columns: [column({ tons: null })], unplanned: [], whichAssignment: [], shopTrips: [] }} />);
    expect(tonsBox()).toBe('from Tickets');
  });
});

describe('Truck log column: # of loads', () => {
  const loadsBox = () => within(screen.getByRole('group', { name: 'Assignment 1' })).getByText('# of loads').nextElementSibling?.textContent;

  it('writes the Loads the Truck counted', () => {
    render(<TruckLogAssignments log={{ columns: [column({ loads: 2 })], unplanned: [], whichAssignment: [], shopTrips: [] }} />);
    expect(loadsBox()).toBe('2');
  });

  it('is blank, marked "from Tickets", for an At-only Haul', () => {
    render(<TruckLogAssignments log={{ columns: [column({ loads: null, pickUp: null, dropOff: null })], unplanned: [], whichAssignment: [], shopTrips: [] }} />);
    expect(loadsBox()).toBe('from Tickets');
  });
});

describe('Truck log: Unplanned work', () => {
  const work = (over: Partial<TruckLogUnplanned> = {}): TruckLogUnplanned => ({
    id: '2026-11-16T19:15:43Z',
    places: ['Sample Site North', 'Sample Site South'],
    tripsLeftAt: ['2026-11-16T19:15:43Z', '2026-11-16T19:33:17Z'],
    truckingHours: 0.46,
    ...over,
  });

  it('is an amber box after Dave’s columns with its Places and times, never a Pick up or Drop off', () => {
    render(<TruckLogAssignments log={{ columns: [column({})], unplanned: [work()], whichAssignment: [], shopTrips: [] }} />);
    const box = screen.getByRole('group', { name: 'Unplanned work' });
    expect(box.textContent).toBe('Unplanned workSample Site North ⇄ Sample Site South · out 14:15, back 14:33 · 0.46 h');
    expect(within(box).queryByText('Pick up')).toBeNull();
    expect(within(box).queryByText('Drop off')).toBeNull();
    expect(screen.getByRole('group', { name: 'Assignment 1' }).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says only when it went out while it has one Trip', () => {
    render(<TruckLogAssignments log={{ columns: [], unplanned: [work({ tripsLeftAt: ['2026-11-16T19:15:43Z'], truckingHours: 0.14 })], whichAssignment: [], shopTrips: [] }} />);
    expect(screen.getByRole('group', { name: 'Unplanned work' }).textContent).toBe('Unplanned workSample Site North ⇄ Sample Site South · out 14:15 · 0.14 h');
  });

  it('numbers the boxes when there is more than one', () => {
    render(<TruckLogAssignments log={{ columns: [], unplanned: [work(), work({ id: 'b' })], whichAssignment: [], shopTrips: [] }} />);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Unplanned work 1', 'Unplanned work 2', 'To and from the shop']);
  });

  it('shows no box when there is none', () => {
    render(<TruckLogAssignments log={{ columns: [column({})], unplanned: [], whichAssignment: [], shopTrips: [] }} />);
    expect(screen.queryByRole('group', { name: /Unplanned work/ })).toBeNull();
  });
});
