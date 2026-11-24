import { expect, test, type Locator } from '@playwright/test';
import { PHONE } from './clock';

// Paper log, end to end on a phone: a Driver opens Yesterday, where his usual
// Truck is suggested, photographs his paper Daily Truck Log and then adds one
// from his photos; both are listed oldest first with their Truck and time, the
// picture loads through the Worker, and they are still there after a reload.
// A day to come offers no Paper log.
// The Worker's clock is fixed at 9:00 AM US Eastern on Mon 23 Nov.

/** A 1×1 PNG: small, but a real picture the browser can draw. */
const PICTURE = {
  name: 'paper-log.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
};

/** Whether the photo's picture has loaded and can be drawn. */
const loaded = (image: Locator) =>
  image.evaluate((element) => {
    const img = element as unknown as { complete: boolean; naturalWidth: number };
    return img.complete && img.naturalWidth > 0;
  });

test('a Driver attaches a Paper log photo for yesterday and sees it after a reload', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: PHONE })).newPage();
  await phone.goto('/truck-dispatch/driver');
  await phone.getByRole('button', { name: 'Sample Driver B' }).click();

  // A day to come offers no Paper log.
  await phone.getByRole('group', { name: 'Day' }).getByRole('button', { name: 'Tomorrow' }).click();
  await expect(phone.getByRole('region', { name: /^Tomorrow/ })).toBeVisible();
  await expect(phone.getByRole('region', { name: 'Paper log' })).toHaveCount(0);

  await phone.getByRole('group', { name: 'Day' }).getByRole('button', { name: 'Yesterday' }).click();
  const section = phone.getByRole('region', { name: 'Paper log' });
  // Not checked in that day: his usual Truck is suggested.
  await expect(section.getByRole('group', { name: 'Truck' }).getByRole('button', { name: 'Truck 24' })).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByRole('button', { name: 'Photograph Paper log' })).toBeEnabled();
  await expect(section.getByText('No photos yet for this day.')).toBeVisible();

  // The large button opens the camera; the hidden picker behind it takes the picture here.
  await section.getByLabel('Photo from the camera').setInputFiles(PICTURE);
  const photos = section.getByRole('list', { name: 'Paper log photos' });
  await expect(photos.getByRole('listitem')).toHaveText(['Truck 24 · attached 9:00']);

  await section.getByLabel('Photo from your photos').setInputFiles(PICTURE);
  await expect(photos.getByRole('listitem')).toHaveText(['Truck 24 · attached 9:00', 'Truck 24 · attached 9:00']);

  // They are the Worker's: still there after a reload, with the picture loaded.
  await phone.reload();
  await phone.getByRole('group', { name: 'Day' }).getByRole('button', { name: 'Yesterday' }).click();
  await expect(photos.getByRole('listitem')).toHaveCount(2);
  const first = photos.getByRole('img').first();
  await expect.poll(() => loaded(first)).toBe(true);

  // A tap opens it full size.
  await photos.getByRole('button', { name: 'Open photo 1 full size' }).click();
  const full = phone.getByRole('dialog', { name: 'Paper log · Truck 24' });
  await expect.poll(() => loaded(full.getByRole('img', { name: 'Paper log for Truck 24, full size' }))).toBe(true);
});
