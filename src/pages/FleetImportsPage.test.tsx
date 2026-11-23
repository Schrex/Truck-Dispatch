// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
// The pages load lazily in the app (App.tsx); importing it here compiles it
// before the first test, so a cold run never waits on that inside a test.
import './FleetImportsPage';
import type { FleetImport, NewFleetImport, Truck } from '../../shared/types';
// The 16 Nov export pulled at 15:02, as Dave downloads it from HCSS Fleet.
import EXPORT_1502 from '../../shared/fixtures/fleet/2026-11-16-1502.json?raw';
// The 16 Nov xlsx, the whole day, as a data URL.
import XLSX from '../../shared/fixtures/fleet/2026-11-16-EntryExitReport.xlsx?inline';


/** What each Import the page sent was. */
let sent: NewFleetImport[];
/** What the Worker answers an Import with, when not the stored one. */
let refusal: { status: number; body: unknown } | null;

/** The Import route as the page sees it: every visit sent is new, on Truck 55. */
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/api/fleet-imports') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as NewFleetImport;
    sent.push(body);
    if (refusal) return answer(refusal.body, refusal.status);
    return answer({
      import: { id: 'imp-1', truckId: 'trk-55', truckNumber: '55', fileName: body.fileName, format: body.format, importedAt: '2026-11-16T20:05:00.000Z', added: body.rows.length, closed: 0, unchanged: 0, days: ['2026-11-16'] } satisfies FleetImport,
    }, 201);
  }
  if (url.pathname.endsWith('/api/trucks')) return answer({ trucks: TRUCKS });
  return answer({ error: 'not_found' }, 404);
});

/** The active Trucks: 55 has its HCSS code, 12 has none yet. */
const TRUCKS: Truck[] = [
  { id: 'trk-12', number: '12', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-55', number: '55', hcssCode: 'MCK-55-17', hcssGuid: null, active: true },
];

beforeEach(() => {
  sent = [];
  refusal = null;
  api.mockClear();
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openPage = async () => {
  window.history.pushState(null, '', '/fleet-imports');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Fleet imports' });
};

const drop = (file: File) => fireEvent.drop(screen.getByRole('button', { name: /drop a fleet export/i }), { dataTransfer: { files: [file], types: ['Files'] } });

describe('The Fleet imports page', () => {
  it('says "18 new · 0 closed · 0 already stored" when the 16 Nov JSON is dropped, having sent its 18 rows', async () => {
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));

    expect(await screen.findByText('18 new · 0 closed · 0 already stored')).toBeTruthy();
    expect(screen.getByText(/EntryExit-1502\.json · Truck 55/)).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ fileName: 'EntryExit-1502.json', format: 'json' });
    expect(sent[0].rows).toHaveLength(18);
    expect(sent[0].rows.at(-1)).toMatchObject({ equipmentCode: 'MCK-55-17', geofenceCode: 'J25008 Los Flamboyanes', exitedAt: null });
  });

  it('takes a file picked instead of dropped', async () => {
    await openPage();
    fireEvent.change(screen.getByLabelText('Pick a file'), { target: { files: [new File([EXPORT_1502], 'pick.json', { type: 'application/json' })] } });
    expect(await screen.findByText('18 new · 0 closed · 0 already stored')).toBeTruthy();
  });

  it('says why a file that is not a Fleet export was not imported, and sends nothing', async () => {
    await openPage();
    drop(new File(['{"hello":1}'], 'notes.json', { type: 'application/json' }));
    expect(await screen.findByText(/no entry\/exit rows/i)).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it.each([
    [400, 'unknown_truck', 'No Truck has the HCSS code MCK-55-17. Set it in Settings.'],
    [400, 'more_than_one_truck', 'The file must hold one Truck.'],
    [400, 'not_a_fleet_export', 'This is not a Fleet export. Export the entry/exit report from HCSS Fleet and drop that.'],
    [403, 'imports_not_allowed', 'Fleet imports are allowed only on local, preview and staging.'],
  ])('shows the Worker\'s reason when it refuses the Import (%i %s)', async (status, error, message) => {
    refusal = { status, body: { error, message } };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('EntryExit-1502.json was not imported')).toBeTruthy();
    expect(screen.queryByText(/new · .* closed/)).toBeNull();
  });
});

describe('Dropping an xlsx Fleet export', () => {
  /** The real 16 Nov xlsx, as Dave downloads it from HCSS Fleet. */
  const xlsx = () =>
    new File([Uint8Array.from(atob(XLSX.split(',')[1]), (c) => c.charCodeAt(0))], 'EntryExitReport.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

  it('asks which Truck it is for, offering only Trucks with an HCSS code, and imports its 20 rows for the one picked', async () => {
    await openPage();
    drop(xlsx());

    const pick = await screen.findByRole('button', { name: 'Truck 55 (MCK-55-17)' }, { timeout: 5000 });
    expect(screen.getByText(/which truck/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Truck 12/ })).toBeNull();
    expect(sent).toEqual([]);

    fireEvent.click(pick);
    expect(await screen.findByText('20 new · 0 closed · 0 already stored')).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ fileName: 'EntryExitReport.xlsx', format: 'xlsx' });
    expect(new Set(sent[0].rows.map((r) => r.equipmentCode))).toEqual(new Set(['MCK-55-17']));
    expect(sent[0].rows.at(-1)).toMatchObject({ geofenceCode: 'SHOP', enteredAt: '2026-11-16T21:03:25.000Z', exitedAt: null });
  });

  it('says why an xlsx that is not the entry/exit report was not imported, and asks for no Truck', async () => {
    await openPage();
    drop(new File([new Uint8Array([1, 2, 3])], 'notes.xlsx'));
    expect(await screen.findByText(/not an xlsx spreadsheet/i, undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(/which truck/i)).toBeNull();
    expect(sent).toEqual([]);
  });
});
