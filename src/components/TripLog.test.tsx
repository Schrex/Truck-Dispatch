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
