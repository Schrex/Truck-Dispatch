import { describe, expect, it } from 'vitest';
import { handle, type Env } from './app';
import { MORNING, apiOn } from './testing/api';
import { localD1 } from './testing/localD1';
import type { PaperLogDay, PaperLogPhoto } from '../../shared/types';

const d1 = localD1();
const send = apiOn(d1);

/** The tests' today (MORNING) and the days around it. */
const TODAY = '2026-11-19';
const YESTERDAY = '2026-11-18';
const TOMORROW = '2026-11-20';

/** A tiny but real JPEG start, a PNG and a WebP: what each kind of picture begins with. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

interface Attach {
  id?: string;
  date?: string;
  truckId?: string;
  driverId?: string;
  attachedBy?: string;
  type?: string;
  body?: Uint8Array;
  vars?: Partial<Env>;
}

/** Attaches a picture as the phone does: the bytes as the body, the rest as query fields. */
const attach = ({ id = crypto.randomUUID(), date = TODAY, truckId = 'trk-21', driverId = 'drv-a', attachedBy = 'driver', type = 'image/jpeg', body = JPEG, vars = {} }: Attach = {}) => {
  const query = new URLSearchParams({ id, date, truckId, driverId, attachedBy });
  return handle(
    new Request(`https://td.example/api/paper-logs?${query}`, { method: 'POST', headers: { 'Content-Type': type }, body }),
    d1.env({ NOW: MORNING, ...vars }),
  );
};
const photoOf = async (response: Response) => ((await response.json()) as { photo: PaperLogPhoto }).photo;
const day = async (date: string, driverId?: string) => {
  const response = await send('GET', `/api/paper-logs?date=${date}${driverId ? `&driverId=${driverId}` : ''}`);
  expect(response.status).toBe(200);
  return (await response.json()) as PaperLogDay;
};
const picture = (id: string) => send('GET', `/api/paper-logs/${id}/picture`);
const fields = async (response: Response) => {
  expect(response.status).toBe(400);
  return ((await response.json()) as { fields: Record<string, string> }).fields;
};

describe('attaching a Paper log photo', () => {
  it('keeps the picture for today and answers the photo with its Truck, Driver and time', async () => {
    const id = crypto.randomUUID();
    const response = await attach({ id });
    expect(response.status).toBe(201);
    expect(await photoOf(response)).toEqual({
      id, date: TODAY, truckId: 'trk-21', truckNumber: '21', driverId: 'drv-a', driverName: 'Sample Driver A',
      attachedBy: 'driver', attachedAt: MORNING, contentType: 'image/jpeg', size: JPEG.length, takenOffAt: null,
    });
  });

  it('serves back the same bytes, privately cacheable for a long time', async () => {
    const id = crypto.randomUUID();
    await attach({ id, type: 'image/png', body: PNG });
    const response = await picture(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toMatch(/^private, max-age=\d{7,}, immutable$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });
});

describe('which day a Paper log is for', () => {
  it('accepts a past day', async () => {
    const response = await attach({ date: YESTERDAY });
    expect(response.status).toBe(201);
    expect((await photoOf(response)).date).toBe(YESTERDAY);
    expect((await day(YESTERDAY)).photos).toHaveLength(1);
  });

  it('refuses a day to come and keeps nothing', async () => {
    expect(await fields(await attach({ date: TOMORROW }))).toEqual({ date: 'A Paper log is for today or a past day.' });
    expect((await day(TOMORROW)).photos).toEqual([]);
  });

  it('works out today in US Eastern time: late evening there is still that day', async () => {
    // 23:30 Eastern on the 19th is already the 20th in UTC.
    expect((await attach({ date: TOMORROW, vars: { NOW: '2026-11-20T04:30:00.000Z' } })).status).toBe(400);
  });
});

describe('a repeated attach', () => {
  it('keeps one photo for the same id and answers the first one', async () => {
    const id = crypto.randomUUID();
    const first = await photoOf(await attach({ id }));
    const again = await attach({ id, truckId: 'trk-24', type: 'image/png', body: PNG, vars: { NOW: '2026-11-19T12:00:00.000Z' } });
    expect(again.status).toBe(200);
    expect(await photoOf(again)).toEqual(first);
    expect((await day(TODAY)).photos).toEqual([first]);
    expect(new Uint8Array(await (await picture(id)).arrayBuffer())).toEqual(JPEG);
  });
});

describe('a day\'s photos', () => {
  it('lists several for one Truck and day oldest first, and one Driver\'s alone with driverId', async () => {
    const late = await photoOf(await attach({ vars: { NOW: '2026-11-19T21:05:00.000Z' } }));
    const early = await photoOf(await attach({ type: 'image/webp', body: WEBP }));
    const other = await photoOf(await attach({ driverId: 'drv-b', truckId: 'trk-24', vars: { NOW: '2026-11-19T15:00:00.000Z' } }));
    await attach({ date: YESTERDAY });
    expect(await day(TODAY)).toEqual({ date: TODAY, photos: [early, other, late] });
    expect((await day(TODAY, 'drv-a')).photos).toEqual([early, late]);
  });

  it('refuses a date that is not one', async () => {
    expect(await fields(await send('GET', '/api/paper-logs?date=19-11-2026'))).toEqual({ date: 'Pick a date.' });
  });
});

describe('what is refused', () => {
  it('refuses an unknown Truck, Driver and attacher, and keeps nothing', async () => {
    expect(await fields(await attach({ truckId: 'trk-99', driverId: 'drv-zz', attachedBy: 'someone' }))).toEqual({
      truckId: 'Pick a Truck from the list.',
      driverId: 'Pick your name again: this Driver is not in the list.',
      attachedBy: 'Say who attached it: the Driver or Dave.',
    });
    expect((await day(TODAY)).photos).toEqual([]);
  });

  it('accepts dave as the attacher', async () => {
    expect((await photoOf(await attach({ attachedBy: 'dave' }))).attachedBy).toBe('dave');
  });

  it('refuses a body that is not a JPEG, PNG or WebP', async () => {
    const message = { picture: 'Send a photo (JPEG, PNG or WebP).' };
    expect(await fields(await attach({ type: 'application/pdf', body: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }))).toEqual(message);
    expect(await fields(await attach({ type: 'image/gif', body: new Uint8Array([0x47, 0x49, 0x46, 0x38]) }))).toEqual(message);
  });

  it('refuses bytes that do not begin as the picture they are named', async () => {
    const message = { picture: 'This file is not a readable photo. Take it again.' };
    expect(await fields(await attach({ type: 'image/jpeg', body: PNG }))).toEqual(message);
    expect(await fields(await attach({ type: 'image/png', body: new TextEncoder().encode('just some text') }))).toEqual(message);
    expect(await fields(await attach({ type: 'image/webp', body: new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]) }))).toEqual(message);
  });

  it('refuses an empty body', async () => {
    expect(await fields(await attach({ body: new Uint8Array() }))).toEqual({ picture: 'The photo was empty. Take it again.' });
  });

  it('refuses a body over 5 MB and accepts one of exactly 5 MB', async () => {
    const sized = (length: number) => {
      const bytes = new Uint8Array(length);
      bytes.set(JPEG);
      return bytes;
    };
    expect(await fields(await attach({ body: sized(5 * 1024 * 1024 + 1) }))).toEqual({ picture: 'This photo is too large. Take it again.' });
    expect((await attach({ body: sized(5 * 1024 * 1024) })).status).toBe(201);
  });

  it('refuses an id that is not a UUID', async () => {
    expect(await fields(await attach({ id: 'photo-1' }))).toEqual({ id: 'Take the photo again.' });
  });

  it('accepts a Truck and a Driver removed from the lists', async () => {
    await send('PATCH', '/api/trucks/trk-27', { active: false });
    await send('PATCH', '/api/drivers/drv-c', { active: false });
    const response = await attach({ truckId: 'trk-27', driverId: 'drv-c', date: YESTERDAY });
    expect(response.status).toBe(201);
    expect(await photoOf(response)).toMatchObject({ truckNumber: '27', driverName: 'Sample Driver C' });
  });

  it('refuses with a plain message where no bucket is bound, and keeps nothing', async () => {
    const response = await attach({ vars: { PHOTOS: undefined } });
    expect(await fields(response)).toEqual({ picture: 'Photos cannot be kept here yet. Give the paper sheet to Dave.' });
    expect((await day(TODAY)).photos).toEqual([]);
  });
});

describe('reading a picture', () => {
  it('answers 404 for a photo that is not kept', async () => {
    expect((await picture(crypto.randomUUID())).status).toBe(404);
  });

  it('answers 405 to anything but a read', async () => {
    expect((await send('POST', `/api/paper-logs/${crypto.randomUUID()}/picture`, {})).status).toBe(405);
    expect((await send('DELETE', '/api/paper-logs')).status).toBe(405);
  });
});
