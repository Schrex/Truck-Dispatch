// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SimulatePage } from './SimulatePage';

afterEach(cleanup);

const block = (label: string) => screen.getByRole('article', { name: `Board block ${label}` });
const card = (label: string) => screen.getByRole('article', { name: `Driver card ${label}` });
const setClock = (minutes: number) => fireEvent.change(screen.getByRole('slider', { name: 'Clock' }), { target: { value: String(minutes) } });
const choose = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

describe('Simulation page on the real day (MCK-55-17, 16 Nov)', () => {
  it('opens on the real HCSS day: A1 4 loads and Done, A2 2 loads, Bishop Kearney for Dave', () => {
    render(<SimulatePage />);
    expect(screen.getByText(/MCK-55-17 · 2017 Mack Granite - 55 · 2026-11-16/)).toBeTruthy();
    expect(within(block('A1')).getByText(/J25008 Los Flamboyanes → VILLAGER/)).toBeTruthy();
    expect(within(block('A1')).getByText(/4 loads · since 08:24/)).toBeTruthy();
    expect(within(block('A1')).getByText('Done')).toBeTruthy();
    expect(within(block('A2')).getByText(/2 loads/)).toBeTruthy();
    expect(within(card('A1')).getByText('4 loads · last 11:25')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/For Dave next morning: 14:15 J25008 Los Flamboyanes → J611 Bishop Kearney/);
    expect(screen.getByText(/vs meter 161.61: OK/)).toBeTruthy();
    expect(screen.getByText(/Ignition On 06:19:40, Ignition Off 16:12:45/)).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row')).toHaveLength(16);
  });

  it('shows the day as the Worker knows it when the clock moves back', () => {
    render(<SimulatePage />);
    setClock(10 * 60 + 2);
    expect(screen.getByText('10:02')).toBeTruthy();
    expect(within(block('A1')).getByText(/2 loads/)).toBeTruthy();
    expect(within(block('A1')).getByText('Now')).toBeTruthy();
    expect(within(block('A2')).getByText('No loads yet')).toBeTruthy();
    expect(screen.getByText(/the day’s meter reading comes at 4 AM/)).toBeTruthy();
  });

  it('flips which Trips are Loads when Villager is the pickup', () => {
    render(<SimulatePage />);
    choose('Scenario', 'other-way');
    expect(within(block('A1')).getByText(/3 loads/)).toBeTruthy();
  });

  it('matches against the Assignment as it was before a reroute', () => {
    render(<SimulatePage />);
    choose('Scenario', 'reroute');
    expect(within(block('A1')).getByText(/5 loads/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('changes the counts when Dave’s Assignment changes', () => {
    render(<SimulatePage />);
    choose('A1 To', 'geo:J611 Bishop Kearney');
    expect(within(block('A1')).getByText(/1 load ·/)).toBeTruthy();
  });

  it('lists a geofence code with no Place when a Place leaves the truck map', () => {
    render(<SimulatePage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'J611 Bishop Kearney on the truck map' }));
    expect(screen.getByText(/Geofence codes with no Place .*: J611 Bishop Kearney/)).toBeTruthy();
  });
});

describe('Simulation page with other days', () => {
  it('runs the made-up day the tests use', () => {
    render(<SimulatePage />);
    choose('Day', 'fake');
    expect(within(block('A1')).getByText(/Sample Site North → Sample Plant/)).toBeTruthy();
    expect(within(block('A1')).getByText(/4 loads/)).toBeTruthy();
  });

  it('runs an uploaded HCSS entry/exit export, with no Assignments until some are added', async () => {
    render(<SimulatePage />);
    const exportJson = {
      Result: [
        { EquipmentCode: 'TRK-9', GeofenceCode: 'YARD', GeofenceType: 'Other', EntryDateTime: '2026-11-18T05:00:00+00:00', ExitDateTime: '2026-11-18T12:00:00+00:00', EntryOdometer: 100, ExitOdometer: 100.2 },
        { EquipmentCode: 'TRK-9', GeofenceCode: 'PIT', GeofenceType: 'Plant', EntryDateTime: '2026-11-18T12:30:00+00:00', ExitDateTime: '2026-11-18T12:45:00+00:00', EntryOdometer: 110, ExitOdometer: 110.1 },
        { EquipmentCode: 'TRK-9', GeofenceCode: 'J9 Site', GeofenceType: 'Job', EntryDateTime: '2026-11-18T13:10:00+00:00', ExitDateTime: null, EntryOdometer: 120, ExitOdometer: 125 },
      ],
    };
    const file = new File([JSON.stringify(exportJson)], 'trk-9.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Upload an HCSS Fleet entry/exit JSON'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/TRK-9 · 2026-11-18/)).toBeTruthy());
    expect(screen.getByText(/trk-9.json: HCSS Fleet entry\/exit, 3 rows/)).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Trips' })).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('No meter readings for this day: the miles check is skipped.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Assignment/ }));
    choose('A1 From', 'geo:PIT');
    choose('A1 To', 'geo:J9 Site');
    expect(within(block('A1')).getByText(/1 load/)).toBeTruthy();
  });

  it('says so when an uploaded file is not an entry/exit export', async () => {
    render(<SimulatePage />);
    const file = new File(['{"hello": 1}'], 'other.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Upload an HCSS Fleet entry/exit JSON'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not read other.json: No entry\/exit rows found/));
  });
});
