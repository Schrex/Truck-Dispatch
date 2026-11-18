// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Order } from '../../shared/types';
import { OrderCard } from './OrderCard';

const order: Order = {
  id: 'o1',
  workDate: '2026-11-18',
  startTime: '07:30',
  job: 'Sample Job 100',
  work: 'Haul #57 stone',
  pickup: 'Sample Quarry',
  dropoff: 'Sample Job site',
  driverId: 'drv-a',
  driverName: 'Sample Driver A',
  truckNumber: 'T-101',
  notes: '',
  createdAt: '2026-11-18T12:00:00Z',
};

afterEach(cleanup);

describe('OrderCard', () => {
  it('shows the job, work, start time, driver, truck and route', () => {
    render(<OrderCard order={order} />);
    for (const text of ['Sample Job 100', 'Haul #57 stone', '7:30 AM', 'Sample Driver A', 'T-101', 'Sample Quarry → Sample Job site']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it('says when no truck is attached', () => {
    render(<OrderCard order={{ ...order, truckNumber: null, startTime: null }} />);
    expect(screen.getByText('No truck')).toBeTruthy();
    expect(screen.queryByText('7:30 AM')).toBeNull();
  });
});
