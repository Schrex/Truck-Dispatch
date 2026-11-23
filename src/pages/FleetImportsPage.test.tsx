// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
// The pages load lazily in the app (App.tsx); importing it here compiles it
// before the first test, so a cold run never waits on that inside a test.
import './FleetImportsPage';
import type { FleetImport, NewFleetImport } from '../../shared/types';
// The 16 Nov export pulled at 15:02, as Dave downloads it from HCSS Fleet.
import EXPORT_1502 from '../../shared/fixtures/fleet/2026-11-16-1502.json?raw';


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
  return answer({ error: 'not_found' }, 404);
});

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

  it('shows the Worker\'s reason when it refuses the Import', async () => {
    refusal = { status: 400, body: { error: 'unknown_truck', message: 'No Truck has the HCSS code MCK-55-17. Set it in Settings.' } };
    await openPage();
    drop(new File([EXPORT_1502], 'EntryExit-1502.json', { type: 'application/json' }));
    expect(await screen.findByText('No Truck has the HCSS code MCK-55-17. Set it in Settings.')).toBeTruthy();
  });
});
