// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TruckDay } from '../../shared/trips';
import { TruckLog } from './TruckLog';

afterEach(cleanup);

const truck = { id: 'trk-55', number: '55', hcssCode: 'MCK-55-17', hcssGuid: null, active: true };
const day = (over: Partial<TruckDay>): TruckDay => ({
  driver: null,
  driverCandidates: [],
  startAt: null,
  endAt: null,
  startMiles: null,
  endMiles: null,
  totalHours: null,
  ...over,
});
const driverBox = () => {
  const header = screen.getByRole('group', { name: 'Truck log header' });
  return within(header).getByText('Driver').nextElementSibling?.textContent;
};

describe('Truck log header: the Driver', () => {
  it('asks "Who was driving?" when two Drivers fit', () => {
    render(
      <TruckLog
        truck={truck}
        date="2026-11-16"
        truckDay={day({ driverCandidates: [{ id: 'drv-randy', name: 'Randy' }, { id: 'drv-sam', name: 'Sam' }] })}
      />,
    );
    expect(driverBox()).toBe('Who was driving?');
  });

  it('asks "Who was driving?" when one Driver fits but nobody checked in to the Truck', () => {
    render(<TruckLog truck={truck} date="2026-11-16" truckDay={day({ driverCandidates: [{ id: 'drv-randy', name: 'Randy' }] })} />);
    expect(driverBox()).toBe('Who was driving?');
  });

  it('names the Driver who checked in', () => {
    const randy = { id: 'drv-randy', name: 'Randy' };
    render(<TruckLog truck={truck} date="2026-11-16" truckDay={day({ driver: randy, driverCandidates: [randy] })} />);
    expect(driverBox()).toBe('Randy');
  });

  it('is blank when no Driver fits', () => {
    render(<TruckLog truck={truck} date="2026-11-16" truckDay={day({})} />);
    expect(driverBox()).toBe('');
  });
});
