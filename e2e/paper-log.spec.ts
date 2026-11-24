import { expect, test, type Locator } from '@playwright/test';
import { DESKTOP, PHONE } from './clock';

// Paper log, end to end: a Driver opens Yesterday on his phone, where his usual
// Truck is suggested, photographs his paper Daily Truck Log and then adds one
// from his photos; both are listed oldest first with their Truck and time, the
// picture loads through the Worker, and they are still there after a reload.
// A day to come offers no Paper log. On Dave's Board for that day, open since
// before the Driver attached, the Driver's lane counts the photos once the
// page regains the focus; Dave opens the lane's Paper log, sees the Driver's
// photos and attaches one himself, which the Driver's page then shows "by Dave".
// An Escape right after opening a photo closes only the photo.
// The Worker's clock is fixed at 9:00 AM US Eastern on Mon 23 Nov.

/** Sun 22 Nov: Yesterday on the Driver page. */
const YESTERDAY = '2026-11-22';

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

/**
 * Taps the button and presses Escape in the very next task, as a quick hand
 * can, before the dialog it opens has taken over the Escape key.
 */
const escapeRightAfterOpening = (button: Locator) =>
  button.evaluate(
    (element) =>
      new Promise<void>((done) => {
        const page = globalThis as unknown as {
          document: { activeElement: { dispatchEvent: (event: unknown) => void } | null };
          KeyboardEvent: new (type: string, init: object) => unknown;
        };
        (element as unknown as { click: () => void }).click();
        setTimeout(() => {
          page.document.activeElement?.dispatchEvent(new page.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          done();
        }, 0);
      }),
  );

test('a Driver attaches a Paper log photo for yesterday, and Dave sees it on the Board and attaches one himself', async ({ browser }) => {
  // Dave has yesterday's Board open: nothing attached yet, and a day to come has no Paper log.
  const board = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await board.goto('/truck-dispatch/?date=2026-11-24');
  await expect(board.getByRole('article', { name: 'Sample Driver B' })).toBeVisible();
  await expect(board.getByRole('button', { name: /Paper log/ })).toHaveCount(0);
  await board.goto(`/truck-dispatch/?date=${YESTERDAY}`);
  const lane = board.getByRole('article', { name: 'Sample Driver B' });
  await expect(lane.getByRole('button', { name: 'Attach Paper log for Sample Driver B' })).toBeVisible();
  await expect(board.getByRole('article', { name: 'Unassigned' }).getByRole('button', { name: /Paper log/ })).toHaveCount(0);

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
  await phone.keyboard.press('Escape');

  // Back on the Board, without a reload: the lane counts his photos once the page regains the focus.
  await board.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(lane.getByRole('button', { name: 'Paper log for Sample Driver B · 2 photos' })).toBeVisible();

  // Dave opens the Driver's Paper log: his photos, oldest first, and the same buttons, his usual Truck suggested.
  await lane.getByRole('button', { name: 'Paper log for Sample Driver B · 2 photos' }).click();
  const dialog = board.getByRole('dialog', { name: 'Paper log · Sample Driver B' });
  const listed = dialog.getByRole('list', { name: 'Paper log photos' });
  await expect(listed.getByRole('listitem')).toHaveText(['Truck 24 · attached 9:00', 'Truck 24 · attached 9:00']);
  await expect(dialog.getByRole('group', { name: 'Truck' }).getByRole('button', { name: 'Truck 24' })).toHaveAttribute('aria-pressed', 'true');

  // He attaches the sheet the Driver handed him: it says "by Dave", and the lane's count goes up.
  await dialog.getByLabel('Photo from your photos').setInputFiles(PICTURE);
  await expect(listed.getByRole('listitem')).toHaveText(['Truck 24 · attached 9:00', 'Truck 24 · attached 9:00', 'Truck 24 · attached 9:00 · by Dave']);
  // A tap on one opens it full size, over the Paper log.
  await listed.getByRole('button', { name: 'Open photo 3 full size' }).click();
  const fullOnBoard = board.getByRole('dialog', { name: 'Paper log · Truck 24' });
  await expect(fullOnBoard.getByRole('img', { name: 'Paper log for Truck 24, full size' })).toBeVisible();
  await expect(fullOnBoard.getByText('Attached 9:00 by Dave')).toBeVisible();
  await board.keyboard.press('Escape');
  await expect(fullOnBoard).toHaveCount(0);
  // An Escape straight after opening a photo, before the page has settled, closes only the photo.
  await escapeRightAfterOpening(listed.getByRole('button', { name: 'Open photo 3 full size' }));
  await expect(fullOnBoard).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lane.getByRole('button', { name: 'Paper log for Sample Driver B · 3 photos' })).toBeVisible();

  // The Driver's page shows the photo Dave attached for him.
  await phone.reload();
  await phone.getByRole('group', { name: 'Day' }).getByRole('button', { name: 'Yesterday' }).click();
  await expect(photos.getByRole('listitem')).toHaveText(['Truck 24 · attached 9:00', 'Truck 24 · attached 9:00', 'Truck 24 · attached 9:00 · by Dave']);
});
