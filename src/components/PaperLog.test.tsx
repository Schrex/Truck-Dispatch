// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperLogPhoto, Truck } from '../../shared/types';
import { PaperLog, type PaperLogProps } from './PaperLog';
import { forgetPaperLogs } from '@/lib/paperLogStore';

const DATE = '2026-11-19';
const trucks: Truck[] = [
  { id: 'trk-21', number: '21', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-24', number: '24', hcssCode: null, hcssGuid: null, active: true },
  { id: 'trk-27', number: '27', hcssCode: null, hcssGuid: null, active: true },
];

let made = 0;
/** A photo as the Worker answers it, for Driver A on DATE. */
const photo = (truckId: string, attachedBy: PaperLogPhoto['attachedBy'] = 'driver'): PaperLogPhoto => ({
  id: crypto.randomUUID(),
  date: DATE,
  truckId,
  truckNumber: trucks.find((t) => t.id === truckId)!.number,
  driverId: 'drv-a',
  driverName: 'Sample Driver A',
  attachedBy,
  attachedAt: `2026-11-19T1${++made % 10}:00:00.000Z`,
  contentType: 'image/png',
  size: 9,
  takenOffAt: null,
});

/**
 * The Worker as the Paper log sees it: each read answers what `server` holds
 * when it is answered, unless a test holds it; an attach keeps the photo.
 */
let server: PaperLogPhoto[] = [];
let holdReads: Promise<void> | null = null;
const takenOff: string[] = [];
const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://td.example');
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const takeOff = /\/api\/paper-logs\/([^/]+)\/take-off$/.exec(url.pathname);
  if (takeOff) {
    takenOff.push(takeOff[1]);
    const kept = server.find((p) => p.id === takeOff[1])!;
    server = server.filter((p) => p.id !== kept.id);
    return answer({ photo: { ...kept, takenOffAt: '2026-11-19T20:00:00.000Z' } });
  }
  if (url.pathname.endsWith('/api/paper-logs') && init?.method === 'POST') {
    const kept = { ...photo(url.searchParams.get('truckId')!, 'dave'), id: url.searchParams.get('id')! };
    server = [...server, kept];
    return answer({ photo: kept }, 201);
  }
  if (url.pathname.endsWith('/api/paper-logs')) {
    const held = holdReads;
    await held;
    return answer({ date: DATE, photos: server });
  }
  return answer({ error: 'not_found' }, 404);
});

beforeEach(() => {
  server = [];
  holdReads = null;
  takenOff.length = 0;
  vi.stubGlobal('fetch', api);
  forgetPaperLogs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props: PaperLogProps = { date: DATE, driverId: 'drv-a', attacher: 'dave', trucks, suggestedTruckId: 'trk-21' };
/** The photos listed, read even while a full-size photo hides the page from a screen reader. */
const listed = async () =>
  within(await screen.findByRole('list', { name: 'Paper log photos', hidden: true }))
    .getAllByRole('listitem', { hidden: true })
    .map((item) => item.textContent);
const photograph = () =>
  fireEvent.change(screen.getByLabelText('Photo from the camera'), {
    target: { files: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], 'sheet.png', { type: 'image/png' })] },
  });

describe('the photo opened full size', () => {
  it('stays the one tapped when a read moves the list, so Take off hides that one', async () => {
    const [first, second, third] = [photo('trk-21'), photo('trk-24'), photo('trk-27')];
    server = [first, second, third];
    const { rerender } = render(<PaperLog {...props} refreshes={0} />);
    await waitFor(async () => expect(await listed()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 2 full size' }));
    expect(await screen.findByRole('heading', { name: 'Paper log · Truck 24' })).toBeTruthy();

    // The first photo is taken off elsewhere; the page reads the day again.
    server = [second, third];
    rerender(<PaperLog {...props} refreshes={1} />);
    await waitFor(async () => expect(await listed()).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Paper log · Truck 24' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Take off' }));
    await waitFor(() => expect(takenOff).toEqual([second.id]));
  });
});

describe('a read that crosses an attach', () => {
  it('keeps the photo attached while it was on its way', async () => {
    const { rerender } = render(<PaperLog {...props} refreshes={0} />);
    await screen.findByText('No photos yet for this day.');

    // Back from the camera: the page reads again, and that read is slow.
    let release = () => {};
    holdReads = new Promise<void>((resolve) => (release = resolve));
    rerender(<PaperLog {...props} refreshes={1} />);
    const before = server;
    photograph();
    expect(await listed()).toEqual([expect.stringMatching(/^Truck 21 · attached/)]);

    // The read answers what the Worker held when it read, before the attach.
    server = before;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await listed()).toEqual([expect.stringMatching(/^Truck 21 · attached/)]);
  });
});
