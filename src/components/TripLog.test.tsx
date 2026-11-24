// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Trip, TripPlace } from '../../shared/trips';
import { TripLog } from './TripLog';

afterEach(cleanup);

const places: TripPlace[] = [
  { id: 'plc-north', name: 'Sample Site North', kind: 'job_site', geofenceCode: 'J1001 North' },
  { id: 'plc-plant', name: 'Sample Plant', kind: 'plant', geofenceCode: 'PLANT' },
];

describe('Trip log: an At Trip', () => {
  it('reads "at" its At as the Kind, and why it counted', () => {
    const trip: Trip = {
      fromPlaceId: 'plc-north',
      toPlaceId: 'plc-plant',
      fromCode: 'J1001 North',
      toCode: 'PLANT',
      leftAt: '2026-11-16T13:24:26Z',
      arrivedAt: '2026-11-16T13:34:37Z',
      miles: 3.39,
      match: { kind: 'at', assignmentId: 'a1', rule: 7, reason: 'Starts or ends at the Assignment’s At', atPlaceId: 'plc-north' },
    };
    render(<TripLog trips={[trip]} places={places} assignmentLabels={{ a1: 'A1' }} />);
    const [row] = within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row').slice(1);
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '08:24',
      'Sample Site North → Sample Plant',
      '3.39',
      'at Sample Site North',
      'A1',
      'Starts or ends at the Assignment’s At',
    ]);
  });
});

describe('Trip log: Move and Other', () => {
  const trip = (match: Trip['match']): Trip => ({
    fromPlaceId: 'plc-north',
    toPlaceId: 'plc-plant',
    fromCode: 'J1001 North',
    toCode: 'PLANT',
    leftAt: '2026-11-16T13:24:26Z',
    arrivedAt: '2026-11-16T13:34:37Z',
    miles: 3.39,
    match,
  });
  const cells = (t: Trip) => {
    render(<TripLog trips={[t]} places={places} assignmentLabels={{ a1: 'A1', o1: 'A2' }} />);
    const [row] = within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row').slice(1);
    return within(row).getAllByRole('cell').map((c) => c.textContent);
  };

  it('reads "move" for a Move Trip', () => {
    expect(cells(trip({ kind: 'move', assignmentId: 'a1', rule: 1, reason: 'From and To match the Move' })).slice(3)).toEqual(['move', 'A1', 'From and To match the Move']);
  });

  it('reads "not a haul" for a Trip on an Other, with the Other’s text as the Why', () => {
    expect(cells(trip({ kind: 'not_a_haul', assignmentId: 'o1', rule: 8, reason: 'Other: Shop, on deck' })).slice(3)).toEqual([
      'not a haul',
      'A2',
      'Other: Shop, on deck',
    ]);
  });
});
