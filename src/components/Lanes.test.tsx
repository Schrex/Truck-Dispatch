// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, Driver, Truck } from '../../shared/types';
import { AssignmentBlock } from './AssignmentBlock';
import { Lanes } from './Lanes';

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
  position: 0,
  createdAt: '2026-11-19T20:00:00.000Z',
  updatedAt: '2026-11-19T20:00:00.000Z',
  ...fields,
});
const a = { driverId: 'drv-a', driverName: 'Sample Driver A' };
const b = { driverId: 'drv-b', driverName: 'Sample Driver B' };
const x = { driverId: 'drv-x', driverName: 'Sample Driver X' };

const drivers: Driver[] = [
  { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', active: true },
  { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: null, active: true },
  { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: 'trk-24', active: false },
];
const trucks: Truck[] = [
  { id: 'trk-21', number: '21', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
];

afterEach(cleanup);

/** Each lane as Dave reads it: whose it is, what the lane says about him, and its blocks in order. */
const lanes = () =>
  screen.getAllByRole('article').map((lane) => ({
    driver: within(lane).getByRole('heading').textContent,
    about: lane.querySelector('[data-lane-about]')?.textContent ?? '',
    blocks: within(lane).queryAllByRole('listitem').map((block) => block.textContent),
  }));

describe('Lanes', () => {
  it('shows a lane for every active Driver, in the order of the list, and the Unassigned lane last, each empty one saying "Nothing planned yet"', () => {
    render(<Lanes assignments={[]} drivers={drivers} trucks={trucks} />);
    expect(lanes().map((lane) => lane.driver)).toEqual(['Sample Driver A', 'Sample Driver B', 'Unassigned']);
    for (const lane of screen.getAllByRole('article')) expect(within(lane).getByText('Nothing planned yet')).toBeTruthy();
  });

  it('shows each Driver\'s usual Truck by his name', () => {
    render(<Lanes assignments={[]} drivers={drivers} trucks={trucks} />);
    expect(lanes().map((lane) => lane.about)).toEqual(['Truck 21', '', '']);
  });

  it('marks his blocks First, then Then, in the order the day was read', () => {
    render(
      <Lanes
        assignments={[
          assignment({ ...a, note: 'Haul stone to the job' }),
          assignment({ ...a, note: 'Move the excavator' }),
          assignment({ ...a, note: 'Topsoil run' }),
          assignment({ ...b, note: 'Fill the shop' }),
          assignment({ note: 'Who takes this?' }),
        ]}
        drivers={drivers}
        trucks={trucks}
      />,
    );
    expect(lanes()).toEqual([
      { driver: 'Sample Driver A', about: 'Truck 21', blocks: ['First · Haul stone to the job · Truck 21 (his own)', 'Then · Move the excavator · Truck 21 (his own)', 'Then · Topsoil run · Truck 21 (his own)'] },
      { driver: 'Sample Driver B', about: '', blocks: ['First · Fill the shop'] },
      { driver: 'Unassigned', about: '', blocks: ['First · Who takes this?'] },
    ]);
  });

  it('gives a removed Driver a lane, marked removed, only on a day he has Assignments', () => {
    render(<Lanes assignments={[assignment({ ...x, note: 'Haul stone' })]} drivers={drivers} trucks={trucks} />);
    expect(lanes().map((lane) => [lane.driver, lane.about])).toEqual([
      ['Sample Driver A', 'Truck 21'],
      ['Sample Driver B', ''],
      ['Sample Driver X', 'Removed · Truck 24'],
      ['Unassigned', ''],
    ]);
    cleanup();
    render(<Lanes assignments={[]} drivers={drivers} trucks={trucks} />);
    expect(screen.queryByRole('article', { name: 'Sample Driver X' })).toBeNull();
  });

  it('still shows every Assignment, by its Driver\'s name, while the Drivers have not loaded', () => {
    render(<Lanes assignments={[assignment({ ...b, note: 'Fill the shop' })]} drivers={null} trucks={null} />);
    expect(lanes()).toEqual([
      { driver: 'Sample Driver B', about: '', blocks: ['First · Fill the shop'] },
      { driver: 'Unassigned', about: '', blocks: [] },
    ]);
  });

  it('shows a named Truck plainly and, when the Assignment names none, the Driver\'s usual Truck in grey as his own', () => {
    render(
      <Lanes
        assignments={[
          assignment({ ...a, note: 'Haul stone', truckId: 'trk-24', truckNumber: '24' }),
          assignment({ ...a, note: 'Topsoil run' }),
        ]}
        drivers={drivers}
        trucks={trucks}
      />,
    );
    expect(lanes()[0].blocks).toEqual(['First · Haul stone · Truck 24', 'Then · Topsoil run · Truck 21 (his own)']);
    expect(screen.getByText('Truck 24').className).not.toContain('text-muted-foreground');
    expect(screen.getByText('Truck 21', { selector: 'li span' }).className).toContain('text-muted-foreground');
  });

  it('still reads "No details yet" when his own Truck is all there is to show', () => {
    render(<Lanes assignments={[assignment({ ...a })]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} />);
    expect(lanes()[0].blocks).toEqual(['First · No details yet · Truck 21 (his own)']);
    expect(screen.getByRole('button', { name: 'Edit No details yet' })).toBeTruthy();
  });

  it('shows no Truck for his own when the Driver has no usual Truck, nor in the Unassigned lane', () => {
    render(<Lanes assignments={[assignment({ ...b, note: 'Fill the shop' }), assignment({ note: 'Who takes this?' })]} drivers={drivers} trucks={trucks} />);
    expect(lanes().map((lane) => lane.blocks)).toEqual([[], ['First · Fill the shop'], ['First · Who takes this?']]);
  });

  it('opens a block\'s Assignment through onEdit', () => {
    const onEdit = vi.fn();
    const haul = assignment({ ...a, note: 'Haul stone' });
    render(<Lanes assignments={[haul]} drivers={drivers} trucks={trucks} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Haul stone' }));
    expect(onEdit).toHaveBeenCalledWith(haul);
  });
});

describe('AssignmentBlock', () => {
  const block = (fields: Partial<Assignment>, first = true) => {
    render(
      <ul>
        <AssignmentBlock assignment={assignment(fields)} first={first} />
      </ul>,
    );
    return screen.getByRole('listitem').textContent;
  };

  const from = { fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant' };
  const to = { toPlaceId: 'plc-north', toPlaceName: 'Sample Site North' };
  const minus = { materialId: 'mat-minus', materialName: '2" minus' };
  const foreman = { foremanId: 'frm-a', foremanName: 'Sample Foreman A' };
  const truck = { truckId: 'trk-24', truckNumber: '24' };

  it('reads From → To by the Places\' short names', () => {
    expect(block({ ...a, ...from, ...to })).toBe('First · Sample Plant → Sample Site North');
  });

  it('is marked Then after the first', () => {
    expect(block({ ...a, ...from, ...to }, false)).toBe('Then · Sample Plant → Sample Site North');
  });

  it('reads as its note when it has no Places', () => {
    expect(block({ ...a, note: 'Move the excavator to the shop' })).toBe('First · Move the excavator to the shop');
  });

  it('shows only the Place set, with no dangling arrow', () => {
    expect(block({ ...a, ...from })).toBe('First · Sample Plant');
    cleanup();
    expect(block({ ...a, ...to })).toBe('First · Sample Site North');
  });

  it('shows the same Place on both sides when it is both From and To', () => {
    expect(block({ ...a, fromPlaceId: 'plc-yard', fromPlaceName: 'Sample Yard', toPlaceId: 'plc-yard', toPlaceName: 'Sample Yard' })).toBe(
      'First · Sample Yard → Sample Yard',
    );
  });

  it('adds the Material, the Foreman, the note and the Truck under From → To', () => {
    expect(block({ ...a, ...from, ...to, ...minus, ...foreman, ...truck, note: 'Two loads' })).toBe(
      'First · Sample Plant → Sample Site North · 2" minus · Foreman Sample Foreman A · Two loads · Truck 24',
    );
  });

  it('adds the Material, the Foreman and the Truck under the note when it has no Places', () => {
    expect(block({ ...a, ...minus, ...foreman, ...truck, note: 'Two loads' })).toBe('First · Two loads · 2" minus · Foreman Sample Foreman A · Truck 24');
  });

  it('reads as what is set when there are no Places and no note', () => {
    expect(block({ ...a, ...truck })).toBe('First · Truck 24');
    cleanup();
    expect(block({ ...a, ...minus, ...foreman })).toBe('First · 2" minus · Foreman Sample Foreman A');
  });

  it('still reads sensibly with nothing filled in yet', () => {
    expect(block({ ...a })).toBe('First · No details yet');
  });
});
