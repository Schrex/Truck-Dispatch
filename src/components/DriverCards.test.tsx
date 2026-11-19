// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Assignment } from '../../shared/types';
import { AssignmentLine } from './AssignmentLine';
import { DriverCards } from './DriverCards';

let next = 0;
const assignment = (fields: Partial<Assignment>): Assignment => ({
  id: `a${++next}`,
  date: '2026-11-20',
  driverId: null,
  driverName: null,
  truckId: null,
  truckNumber: null,
  fromPlaceId: null,
  fromPlaceName: null,
  toPlaceId: null,
  toPlaceName: null,
  materialId: null,
  materialName: null,
  foremanId: null,
  foremanName: null,
  note: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  updatedAt: '2026-11-19T20:00:00.000Z',
  ...fields,
});
const a = { driverId: 'drv-a', driverName: 'Sample Driver A' };
const b = { driverId: 'drv-b', driverName: 'Sample Driver B' };

afterEach(cleanup);

const cards = () =>
  screen.getAllByRole('article').map((card) => ({
    driver: within(card).getByRole('heading').textContent,
    lines: within(card).getAllByRole('listitem').map((line) => line.textContent),
  }));

describe('DriverCards', () => {
  it('shows one card per Driver, each Assignment as one line, in the order the day was read', () => {
    render(
      <DriverCards
        assignments={[
          assignment({ ...a, note: 'Haul stone to the job' }),
          assignment({ ...a, note: 'Move the excavator' }),
          assignment({ ...b, note: 'Topsoil run' }),
        ]}
      />,
    );
    expect(cards()).toEqual([
      { driver: 'Sample Driver A', lines: ['Haul stone to the job', 'Move the excavator'] },
      { driver: 'Sample Driver B', lines: ['Topsoil run'] },
    ]);
  });

  it('puts Assignments with no Driver on an "Unassigned" card, last', () => {
    render(<DriverCards assignments={[assignment({ ...a, note: 'Haul stone' }), assignment({ note: 'Who takes this?' }), assignment({ note: 'And this?' })]} />);
    expect(cards()).toEqual([
      { driver: 'Sample Driver A', lines: ['Haul stone'] },
      { driver: 'Unassigned', lines: ['Who takes this?', 'And this?'] },
    ]);
  });

  it('shows no "Unassigned" card when every Assignment has a Driver', () => {
    render(<DriverCards assignments={[assignment({ ...a }), assignment({ ...b })]} />);
    expect(screen.queryByRole('heading', { name: 'Unassigned' })).toBeNull();
  });
});

describe('AssignmentLine', () => {
  const line = (fields: Partial<Assignment>) => {
    render(
      <ul>
        <AssignmentLine assignment={assignment(fields)} />
      </ul>,
    );
    return screen.getByRole('listitem').textContent;
  };

  it('reads as the note', () => {
    expect(line({ ...a, note: 'Move the excavator to the shop' })).toBe('Move the excavator to the shop');
  });

  it('shows the Truck when it is set', () => {
    expect(line({ ...a, truckId: 'trk-24', truckNumber: '24', note: 'Move the excavator' })).toBe('Move the excavator · Truck 24');
  });

  it('reads as the Truck alone when nothing else is set', () => {
    expect(line({ ...a, truckId: 'trk-24', truckNumber: '24' })).toBe('Truck 24');
  });

  const from = { fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant' };
  const to = { toPlaceId: 'plc-north', toPlaceName: 'Sample Site North' };

  it('starts with From → To by the Places\' short names', () => {
    expect(line({ ...a, ...from, ...to, truckId: 'trk-24', truckNumber: '24', note: 'Haul stone' })).toBe('Sample Plant → Sample Site North · Haul stone · Truck 24');
  });

  it('shows only the From Place, with no dangling arrow, when there is no To', () => {
    expect(line({ ...a, ...from })).toBe('Sample Plant');
  });

  it('shows only the To Place, with no dangling arrow, when there is no From', () => {
    expect(line({ ...a, ...to, note: 'Drop off' })).toBe('Sample Site North · Drop off');
  });

  it('shows the same Place on both sides when it is both From and To', () => {
    expect(line({ ...a, fromPlaceId: 'plc-yard', fromPlaceName: 'Sample Yard', toPlaceId: 'plc-yard', toPlaceName: 'Sample Yard' })).toBe('Sample Yard → Sample Yard');
  });

  it('reads From → To · Material, then the Foreman, the note and the Truck', () => {
    expect(
      line({ ...a, fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', toPlaceId: 'plc-north', toPlaceName: 'Sample Site North',
        materialId: 'mat-minus', materialName: '2" minus', foremanId: 'frm-a', foremanName: 'Sample Foreman A',
        truckId: 'trk-24', truckNumber: '24', note: 'Two loads' }),
    ).toBe('Sample Plant → Sample Site North · 2" minus · Foreman Sample Foreman A · Two loads · Truck 24');
  });

  const minus = { materialId: 'mat-minus', materialName: '2" minus' };
  const foreman = { foremanId: 'frm-a', foremanName: 'Sample Foreman A' };

  it('shows the Material and the Foreman first, then the note and the Truck', () => {
    expect(line({ ...a, ...minus, ...foreman, truckId: 'trk-24', truckNumber: '24', note: 'Two loads' })).toBe(
      '2" minus · Foreman Sample Foreman A · Two loads · Truck 24',
    );
  });

  it('reads as the Material alone, or the Foreman alone, with no stray separators', () => {
    expect(line({ ...a, ...minus })).toBe('2" minus');
    cleanup();
    expect(line({ ...a, ...foreman })).toBe('Foreman Sample Foreman A');
    cleanup();
    expect(line({ ...a, ...foreman, note: 'Two loads' })).toBe('Foreman Sample Foreman A · Two loads');
  });

  it('still reads sensibly with nothing filled in yet', () => {
    expect(line({ ...a })).toBe('No details yet');
  });
});
