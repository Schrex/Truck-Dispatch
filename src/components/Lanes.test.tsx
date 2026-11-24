// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, Driver, Truck } from '../../shared/types';
import { AssignmentBlock } from './AssignmentBlock';
import { Lanes } from './Lanes';

let next = 0;
/** An Assignment as the board reads it; Assigned unless a test makes it a Draft, so its block shows no Draft mark. */
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
  atPlaceId: null,
  atPlaceName: null,
  materialId: null,
  materialName: null,
  foremanId: null,
  foremanName: null,
  customerId: null,
  customerName: null,
  note: null,
  work: 'haul',
  machine: null,
  position: 0,
  createdAt: '2026-11-19T20:00:00.000Z',
  updatedAt: '2026-11-19T20:00:00.000Z',
  changedAt: null,
  cancelledAt: null,
  assignedAt: '2026-11-19T21:15:00.000Z',
  handedFromId: null,
  sinceSent: null,
  ...fields,
});
const a = { driverId: 'drv-a', driverName: 'Sample Driver A' };
const b = { driverId: 'drv-b', driverName: 'Sample Driver B' };
const x = { driverId: 'drv-x', driverName: 'Sample Driver X' };

const drivers: Driver[] = [
  { id: 'drv-a', name: 'Sample Driver A', defaultTruckId: 'trk-21', sortOrder: 1, active: true },
  { id: 'drv-b', name: 'Sample Driver B', defaultTruckId: null, sortOrder: 2, active: true },
  { id: 'drv-x', name: 'Sample Driver X', defaultTruckId: 'trk-24', sortOrder: null, active: false },
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

  it('keeps the Drivers in Dave\'s own order as the list gives it, not by name', () => {
    render(<Lanes assignments={[]} drivers={[...drivers].reverse()} trucks={trucks} />);
    expect(lanes().map((lane) => lane.driver)).toEqual(['Sample Driver B', 'Sample Driver A', 'Unassigned']);
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
          assignment({ ...a, note: 'Topsoil haul' }),
          assignment({ ...b, note: 'Fill the shop' }),
          assignment({ note: 'Who takes this?' }),
        ]}
        drivers={drivers}
        trucks={trucks}
      />,
    );
    expect(lanes()).toEqual([
      { driver: 'Sample Driver A', about: 'Truck 21', blocks: ['First · Haul · Haul stone to the job · Truck 21 (his own)', 'Then · Haul · Move the excavator · Truck 21 (his own)', 'Then · Haul · Topsoil haul · Truck 21 (his own)'] },
      { driver: 'Sample Driver B', about: '', blocks: ['First · Haul · Fill the shop'] },
      { driver: 'Unassigned', about: '', blocks: ['First · Haul · Who takes this?'] },
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

  it('offers a + on every lane but a removed Driver\'s, naming whose lane it adds to, and opens the composer in the lane it names', () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <Lanes assignments={[assignment({ ...x, note: 'Haul stone' })]} drivers={drivers} trucks={trucks} onAdd={onAdd} composer={<p>The composer</p>} />,
    );
    expect(screen.getAllByRole('button', { name: /^Add an Assignment/ }).map((add) => add.getAttribute('aria-label'))).toEqual([
      'Add an Assignment for Sample Driver A',
      'Add an Assignment for Sample Driver B',
      'Add an Assignment for Unassigned',
    ]);
    expect(screen.queryByText('The composer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add an Assignment for Unassigned' }));
    expect(onAdd).toHaveBeenCalledWith(null);

    rerender(<Lanes assignments={[]} drivers={drivers} trucks={trucks} onAdd={onAdd} composingFor="drv-b" composer={<p>The composer</p>} />);
    expect(within(screen.getByRole('article', { name: 'Sample Driver B' })).getByText('The composer')).toBeTruthy();
    expect(screen.getAllByText('The composer')).toHaveLength(1);
    // The open lane's + is a × that closes it: onAdd with that lane again.
    fireEvent.click(screen.getByRole('button', { name: 'Close the composer for Sample Driver B' }));
    expect(onAdd).toHaveBeenLastCalledWith('drv-b');
  });

  it('offers Assign on a Draft in an active Driver\'s lane, never in a removed Driver\'s, whom no one would reach', () => {
    render(
      <Lanes
        assignments={[assignment({ ...a, note: 'Haul stone', assignedAt: null }), assignment({ ...x, note: 'Fill the shop', assignedAt: null })]}
        drivers={drivers}
        trucks={trucks}
        onEdit={vi.fn()}
        onAssign={vi.fn()}
      />,
    );
    expect(within(screen.getByRole('article', { name: 'Sample Driver A' })).queryAllByRole('button', { name: /^Assign/ })).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'Sample Driver X' })).queryAllByRole('button', { name: /^Assign/ })).toHaveLength(0);
  });

  it('still shows every Assignment, by its Driver\'s name, while the Drivers have not loaded', () => {
    render(<Lanes assignments={[assignment({ ...b, note: 'Fill the shop' })]} drivers={null} trucks={null} />);
    expect(lanes()).toEqual([
      { driver: 'Sample Driver B', about: '', blocks: ['First · Haul · Fill the shop'] },
      { driver: 'Unassigned', about: '', blocks: [] },
    ]);
  });

  it('shows a named Truck plainly and, when the Assignment names none, the Driver\'s usual Truck in grey as his own', () => {
    render(
      <Lanes
        assignments={[
          assignment({ ...a, note: 'Haul stone', truckId: 'trk-24', truckNumber: '24' }),
          assignment({ ...a, note: 'Topsoil haul' }),
        ]}
        drivers={drivers}
        trucks={trucks}
      />,
    );
    expect(lanes()[0].blocks).toEqual(['First · Haul · Haul stone · Truck 24', 'Then · Haul · Topsoil haul · Truck 21 (his own)']);
    expect(screen.getByText('Truck 24').className).not.toContain('text-muted-foreground');
    expect(screen.getByText('Truck 21', { selector: 'li span' }).className).toContain('text-muted-foreground');
  });

  it('still reads "No details yet" when his own Truck is all there is to show', () => {
    render(<Lanes assignments={[assignment({ ...a })]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} />);
    expect(lanes()[0].blocks).toEqual(['First · Haul · No details yet · Truck 21 (his own)']);
    expect(screen.getByRole('button', { name: 'Edit No details yet' })).toBeTruthy();
  });

  it('shows no Truck for his own when the Driver has no usual Truck, nor in the Unassigned lane', () => {
    render(<Lanes assignments={[assignment({ ...b, note: 'Fill the shop' }), assignment({ note: 'Who takes this?' })]} drivers={drivers} trucks={trucks} />);
    expect(lanes().map((lane) => lane.blocks)).toEqual([[], ['First · Haul · Fill the shop'], ['First · Haul · Who takes this?']]);
  });

  it('leads each block with whom it is for, and names it in its edit button', () => {
    const haul = assignment({ ...a, toPlaceId: 'plc-north', toPlaceName: 'Sample Site North', foremanId: 'frm-a', foremanName: 'Sample Foreman A' });
    render(<Lanes assignments={[haul]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} />);
    expect(lanes()[0].blocks).toEqual(['First · Haul · For Sample Foreman A · Sample Site North · Truck 21 (his own)']);
    expect(screen.getByRole('button', { name: 'Edit For Sample Foreman A · Sample Site North' })).toBeTruthy();
  });

  it('shows the open block pressed and its editor in its own lane, saying whether it is first or last there', () => {
    const haul = assignment({ ...a, note: 'Haul stone' });
    const topsoil = assignment({ ...a, note: 'Topsoil haul' });
    const editor = vi.fn((open: Assignment, { first, last }: { first: boolean; last: boolean }) => <p>Open: {open.note} {String(first)} {String(last)}</p>);
    render(<Lanes assignments={[haul, topsoil, assignment({ ...b, note: 'Fill the shop' })]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} openId={topsoil.id} editor={editor} />);
    expect(within(screen.getByRole('article', { name: 'Sample Driver A' })).getByText('Open: Topsoil haul false true')).toBeTruthy();
    expect(screen.getAllByText(/^Open:/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Edit Topsoil haul/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /^Edit Haul stone/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves cancelled ones out when saying whether the open one is first or last in its lane', () => {
    const haul = assignment({ ...a, note: 'Haul stone' });
    const off = assignment({ ...a, note: 'Topsoil haul', cancelledAt: '2026-11-19T21:30:00.000Z' });
    const shop = assignment({ ...a, note: 'Fill the shop' });
    const editor = (open: Assignment, { first, last }: { first: boolean; last: boolean }) => <p>Open: {open.note} {String(first)} {String(last)}</p>;
    const { rerender } = render(<Lanes assignments={[haul, off]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} openId={haul.id} editor={editor} />);
    expect(screen.getByText('Open: Haul stone true true')).toBeTruthy();
    rerender(<Lanes assignments={[off, shop]} drivers={drivers} trucks={trucks} onEdit={vi.fn()} openId={shop.id} editor={editor} />);
    expect(screen.getByText('Open: Fill the shop true true')).toBeTruthy();
  });

  it('opens a block\'s Assignment through onEdit', () => {
    const onEdit = vi.fn();
    const haul = assignment({ ...a, note: 'Haul stone' });
    render(<Lanes assignments={[haul]} drivers={drivers} trucks={trucks} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Haul stone' }));
    expect(onEdit).toHaveBeenCalledWith(haul);
  });
});

describe('Unplanned work on a lane', () => {
  it('shows "1 Unplanned work" after the Driver’s Assignments, in his lane only', () => {
    render(<Lanes assignments={[assignment({ ...a, toPlaceName: 'Sample Site North' })]} drivers={drivers} trucks={trucks} unplanned={{ 'drv-a': 1 }} />);
    const [laneA, laneB] = screen.getAllByRole('article');
    const marker = within(laneA).getByText('1 Unplanned work');
    // After the blocks, and not one of them.
    expect(within(laneA).getAllByRole('listitem')).toHaveLength(1);
    expect(within(laneA).getByRole('list').compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(laneB).queryByText(/Unplanned work/)).toBeNull();
  });

  it('shows it in place of "Nothing planned yet" when the Driver has no Assignments that day', () => {
    render(<Lanes assignments={[]} drivers={drivers} trucks={trucks} unplanned={{ 'drv-b': 2 }} />);
    const laneB = screen.getAllByRole('article')[1];
    expect(within(laneB).getByText('2 Unplanned work')).toBeTruthy();
    expect(within(laneB).queryByText('Nothing planned yet')).toBeNull();
  });

  it('leaves the lane exactly as it is when there is none', () => {
    const day = [assignment({ ...a, toPlaceName: 'Sample Site North' })];
    const { container: without } = render(<Lanes assignments={day} drivers={drivers} trucks={trucks} />);
    const { container: none } = render(<Lanes assignments={day} drivers={drivers} trucks={trucks} unplanned={{ 'drv-a': 0 }} />);
    expect(none.innerHTML).toBe(without.innerHTML);
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
  const jaus = { customerId: 'cus-jaus', customerName: 'Sample Customer Jaus' };
  const truck = { truckId: 'trk-24', truckNumber: '24' };

  it('reads From → To by the Places\' short names', () => {
    expect(block({ ...a, ...from, ...to })).toBe('First · Haul · Sample Plant → Sample Site North');
  });

  it('is marked Then after the first', () => {
    expect(block({ ...a, ...from, ...to }, false)).toBe('Then · Haul · Sample Plant → Sample Site North');
  });

  it('reads as its note when it has no Places', () => {
    expect(block({ ...a, note: 'Move the excavator to the shop' })).toBe('First · Haul · Move the excavator to the shop');
  });

  it('shows only the Place set, with no dangling arrow', () => {
    expect(block({ ...a, ...from })).toBe('First · Haul · Sample Plant');
    cleanup();
    expect(block({ ...a, ...to })).toBe('First · Haul · Sample Site North');
  });

  it('shows the same Place on both sides when it is both From and To', () => {
    expect(block({ ...a, fromPlaceId: 'plc-yard', fromPlaceName: 'Sample Yard', toPlaceId: 'plc-yard', toPlaceName: 'Sample Yard' })).toBe(
      'First · Haul · Sample Yard → Sample Yard',
    );
  });

  it('adds the Material, the note and the Truck under From → To', () => {
    expect(block({ ...a, ...from, ...to, ...minus, ...truck, note: 'Two loads' })).toBe('First · Haul · Sample Plant → Sample Site North · 2" minus · Two loads · Truck 24');
  });

  it('adds the Material and the Truck under the note when it has no Places', () => {
    expect(block({ ...a, ...minus, ...truck, note: 'Two loads' })).toBe('First · Haul · Two loads · 2" minus · Truck 24');
  });

  it('reads as what is set when there are no Places and no note', () => {
    expect(block({ ...a, ...truck })).toBe('First · Haul · Truck 24');
    cleanup();
    expect(block({ ...a, ...minus })).toBe('First · Haul · 2" minus');
  });

  it('still reads sensibly with nothing filled in yet', () => {
    expect(block({ ...a })).toBe('First · Haul · No details yet');
  });

  describe('For', () => {
    it('leads with "For" and the Foreman, in bold, before From → To and the rest', () => {
      expect(block({ ...a, ...from, ...to, ...minus, ...foreman, ...truck, note: 'Two loads' })).toBe(
        'First · Haul · For Sample Foreman A · Sample Plant → Sample Site North · 2" minus · Two loads · Truck 24',
      );
      expect(screen.getByText('For Sample Foreman A').className).toContain('font-bold');
    });

    it('tags a Customer with a light grey filled Customer tag', () => {
      expect(block({ ...a, ...to, ...jaus })).toBe('First · Haul · For Sample Customer Jaus · Customer · Sample Site North');
      const tag = screen.getByText('Customer');
      expect(tag.className).toContain('bg-foreground/10');
      expect(tag.className).not.toContain('border');
    });

    it('needs nothing else: For alone is details enough, with "No place yet" in grey', () => {
      expect(block({ ...a, ...jaus, note: 'Until someone else needs a truck' })).toBe(
        'First · Haul · For Sample Customer Jaus · Customer · No place yet · Until someone else needs a truck',
      );
      expect(screen.getByText('No place yet').className).toContain('text-muted-foreground');
      cleanup();
      expect(block({ ...a, ...foreman })).toBe('First · Haul · For Sample Foreman A · No place yet');
      cleanup();
      expect(block({ ...a, ...foreman, ...minus })).toBe('First · Haul · For Sample Foreman A · No place yet · 2" minus');
    });
  });

  describe('At', () => {
    const cobblestone = { atPlaceId: 'plc-cobble', atPlaceName: 'Cobblestone' };

    it('reads "at Cobblestone · CR2" under the For line', () => {
      expect(block({ ...a, ...foreman, ...cobblestone, materialId: 'mat-cr2', materialName: 'CR2', note: 'Show up with CR2 on' })).toBe(
        'First · Haul · For Sample Foreman A · at Cobblestone · CR2 · Show up with CR2 on',
      );
      expect(screen.queryByText('No place yet')).toBeNull();
    });

    it('reads "at TIUNY · Asphalt · → Villager", showing only the parts that are set', () => {
      const tiuny = { atPlaceId: 'plc-tiuny', atPlaceName: 'TIUNY' };
      const villager = { toPlaceId: 'plc-villager', toPlaceName: 'Villager' };
      const asphalt = { materialId: 'mat-asphalt', materialName: 'Asphalt' };
      expect(block({ ...a, ...foreman, ...tiuny, ...asphalt, ...villager, ...truck })).toBe('First · Haul · For Sample Foreman A · at TIUNY · Asphalt · → Villager · Truck 24');
      cleanup();
      expect(block({ ...a, ...tiuny, ...from })).toBe('First · Haul · at TIUNY · Sample Plant →');
      cleanup();
      expect(block({ ...a, ...tiuny, ...from, ...to })).toBe('First · Haul · at TIUNY · Sample Plant → Sample Site North');
    });

    it('names the At in the edit button', () => {
      render(
        <ul>
          <AssignmentBlock assignment={assignment({ ...a, ...cobblestone })} first onEdit={vi.fn()} />
        </ul>,
      );
      expect(screen.getByRole('button', { name: 'Edit at Cobblestone' })).toBeTruthy();
    });
  });

  describe('the kind pill', () => {
    const d6 = { work: 'move' as const, machine: 'D6', fromPlaceId: 'plc-winter', fromPlaceName: 'Wintergarden', toPlaceId: 'plc-bk', toPlaceName: 'BK' };

    it('starts a Haul\'s block with a black HAUL pill beside First', () => {
      expect(block({ ...a, ...from, ...to })).toBe('First · Haul · Sample Plant → Sample Site North');
      const pill = screen.getByText('Haul');
      expect(pill.className).toContain('bg-foreground');
      expect(pill.className).toContain('uppercase');
    });

    it('reads a Move as a blue MOVE pill, the machine in bold, then From → To', () => {
      expect(block({ ...a, ...d6, ...truck, note: 'Lowboy' })).toBe('First · Move · D6 · Wintergarden → BK · Lowboy · Truck 24');
      expect(screen.getByText('Move').className).toContain('bg-move');
      expect(screen.getByText('D6').className).toContain('font-bold');
    });

    it('names the Move in the edit button', () => {
      render(
        <ul>
          <AssignmentBlock assignment={assignment({ ...a, ...d6 })} first onEdit={vi.fn()} />
        </ul>,
      );
      expect(screen.getByRole('button', { name: 'Edit Move · D6 · Wintergarden → BK' })).toBeTruthy();
    });

    it('never takes the place of a state colour: a Draft Move keeps its dashed outline, a Changed one its amber mark', () => {
      render(
        <ul>
          <AssignmentBlock assignment={assignment({ ...a, ...d6, assignedAt: null })} first onEdit={vi.fn()} />
          <AssignmentBlock assignment={assignment({ ...a, ...d6, sinceSent: 'changed' })} first={false} onEdit={vi.fn()} />
        </ul>,
      );
      expect(screen.getByRole('button', { name: /· Draft$/ }).className).toContain('border-dashed');
      expect(screen.getByText('Changed').className).toContain('bg-warning');
      expect(screen.getAllByText('Move').every((pill) => pill.className.includes('bg-move'))).toBe(true);
    });

    it('reads an Other as a grey OTHER pill and its text in bold, then the Truck, and names it in the edit button', () => {
      const shop = { ...a, work: 'other' as const, note: 'Shop, on deck' };
      expect(block({ ...shop, ...truck })).toBe('First · Other · Shop, on deck · Truck 24');
      expect(screen.getByText('Other').className).toContain('bg-foreground/10');
      expect(screen.getByText('Shop, on deck').className).toContain('font-bold');
      cleanup();
      render(
        <ul>
          <AssignmentBlock assignment={assignment({ ...shop, sinceSent: 'changed' })} first onEdit={vi.fn()} />
        </ul>,
      );
      expect(screen.getByRole('button', { name: 'Edit Other · Shop, on deck · Changed' })).toBeTruthy();
      expect(screen.getByText('Changed').className).toContain('bg-warning');
    });
  });
});

describe('Changed and Added marks', () => {
  const haul = { ...a, fromPlaceId: 'plc-plant', fromPlaceName: 'Sample Plant', note: 'Haul stone' };

  it.each([
    ['Changed', 'changed'],
    ['Added', 'added'],
  ] as const)('mark a block %s since it was Assigned, also in the name of its edit button', (word, sinceSent) => {
    render(
      <ul>
        <AssignmentBlock assignment={assignment({ ...haul, sinceSent })} first onEdit={vi.fn()} />
      </ul>,
    );
    expect(screen.getByRole('listitem').textContent).toBe(`First · Haul · ${word} · Sample Plant · Haul stone`);
    expect(screen.getByRole('button', { name: `Edit Sample Plant · Haul stone · ${word}` })).toBeTruthy();
  });

  it('mark a Draft with a dashed outline and the word Draft, and offer Assign on it only with a Driver', () => {
    const onAssign = vi.fn(async () => {});
    render(
      <ul>
        <AssignmentBlock assignment={assignment({ ...haul, assignedAt: null })} first onEdit={vi.fn()} onAssign={onAssign} />
        <AssignmentBlock assignment={assignment({ ...haul, driverId: null, driverName: null, note: 'Unplanned', assignedAt: null })} first onEdit={vi.fn()} onAssign={onAssign} />
      </ul>,
    );
    const edit = screen.getByRole('button', { name: 'Edit Sample Plant · Haul stone · Draft' });
    expect(edit.textContent).toBe('First · Haul · Draft · Sample Plant · Haul stone');
    expect(edit.className).toMatch(/border-dashed/);
    expect(screen.getAllByRole('button', { name: /^Assign / }).map((button) => button.getAttribute('aria-label'))).toEqual(['Assign Sample Plant · Haul stone']);
    fireEvent.click(screen.getByRole('button', { name: 'Assign Sample Plant · Haul stone' }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ note: 'Haul stone', driverId: 'drv-a' }));
  });

  it('mark nothing on a block that is neither', () => {
    render(
      <ul>
        <AssignmentBlock assignment={assignment(haul)} first={false} />
      </ul>,
    );
    expect(screen.getByRole('listitem').textContent).toBe('Then · Haul · Sample Plant · Haul stone');
  });
});

describe('The Trip part on a block', () => {
  const haul = { ...a, fromPlaceName: 'Sample Site North', toPlaceName: 'Sample Plant', materialName: 'Fill' };
  const part = (fields: Partial<NonNullable<Assignment['trips']>>): Assignment['trips'] => ({
    loads: 0,
    tons: null,
    status: 'none',
    since: null,
    lastLoadAt: null,
    truckingHours: null,
    ...fields,
  });
  /** The block's HTML as rendered: compared whole, so "exactly as today" means byte for byte. */
  const html = (fields: Partial<Assignment>) => {
    render(
      <ul>
        <AssignmentBlock assignment={assignment({ ...haul, ...fields })} first />
      </ul>,
    );
    const shown = { text: screen.getByRole('listitem').textContent, html: screen.getByRole('list').innerHTML };
    cleanup();
    return shown;
  };

  it('shows its Loads, Now and since when the Truck is on it', () => {
    expect(html({ trips: part({ loads: 2, status: 'now', since: '2026-11-16T13:24:26Z' }) }).text).toBe(
      'First · Haul · Sample Site North → Sample Plant · Fill · 2 Loads · Now · since 08:24',
    );
  });

  it('says Done once the Truck has moved on, and 1 Load for one', () => {
    expect(html({ trips: part({ loads: 1, status: 'done', since: '2026-11-16T16:30:53Z' }) }).text).toBe(
      'First · Haul · Sample Site North → Sample Plant · Fill · 1 Load · Done · since 11:30',
    );
  });

  it('shows Loads blank, from Tickets, for an At-only Haul: the Truck cannot tell which way material went', () => {
    expect(html({ fromPlaceName: null, toPlaceName: null, trips: part({ loads: null, status: 'done', since: '2026-11-16T13:24:26Z' }) }).text).toBe(
      'First · Haul · Fill · Loads from Tickets · Done · since 08:24',
    );
  });

  const d6 = { work: 'move' as const, machine: 'D6', materialName: null, fromPlaceName: 'Wintergarden', toPlaceName: 'BK' };

  it('shows a Move with no Loads: Now and since while the Truck is on it, then Done at the time the machine got there', () => {
    expect(html({ ...d6, trips: part({ status: 'now', since: '2026-11-16T12:40:00Z', movedAt: null }) }).text).toMatch(/· Now · since 07:40$/);
    const done = html({ ...d6, trips: part({ status: 'done', since: '2026-11-16T12:40:00Z', movedAt: '2026-11-16T13:15:00Z' }) }).text;
    expect(done).toMatch(/· Done 08:15$/);
    expect(done).not.toContain('Load');
  });

  it('shows an Other with its Trucking hours, never Loads', () => {
    const shop = { work: 'other' as const, materialName: null, fromPlaceName: null, toPlaceName: null, note: 'Shop, on deck' };
    const { text } = html({ ...shop, trips: part({ status: 'done', since: '2026-11-16T12:40:00Z', truckingHours: 3.02 }) });
    expect(text).toMatch(/Shop, on deck · Done · 3\.0 h$/);
    expect(text).not.toContain('Load');
  });

  it('looks exactly as it does without a Trip part while it has no Trips yet', () => {
    expect(html({ trips: part({}) }).html).toBe(html({}).html);
    expect(html({}).text).toBe('First · Haul · Sample Site North → Sample Plant · Fill');
  });
});
