import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, TODAY } from './clock';

// Phase 1, end to end: Dave adds an Assignment for a Driver on the Board and
// Assigns it; on his phone the Driver picks his name and sees it.
test('Dave Assigns an Assignment on the Board and the Driver sees it on his phone', async ({ browser }) => {
  const board = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await board.goto(`/truck-dispatch/?date=${TODAY}`);

  await board.getByRole('button', { name: 'Add an Assignment for Sample Driver A' }).click();
  const composer = board.getByRole('form', { name: 'New Assignment for Sample Driver A' });
  await composer.getByRole('group', { name: 'Pick up' }).getByRole('button', { name: 'Sample Plant' }).click();
  await composer.getByRole('group', { name: 'Drop off' }).getByRole('button', { name: 'Sample Site North' }).click();
  await composer.getByRole('group', { name: 'Hauling what?' }).getByRole('button', { name: 'Sample Stone' }).click();
  await composer.getByRole('button', { name: 'Save' }).click();

  const lane = board.getByRole('article', { name: /Sample Driver A/ });
  await lane.getByRole('button', { name: /^Assign .*Sample Plant/ }).click();
  await expect(lane.getByRole('button', { name: /^Assign / })).toHaveCount(0);

  const phone = await (await browser.newContext({ viewport: PHONE })).newPage();
  await phone.goto('/truck-dispatch/driver');
  await phone.getByRole('button', { name: 'Sample Driver A' }).click();

  const card = phone.getByRole('article', { name: 'Sample Stone' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sample Plant');
  await expect(card).toContainText('Sample Site North');
});
