import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, TODAY } from './clock';

// Phase 1, end to end: Dave adds an Assignment for a Driver on the Board, for
// a Customer, and Assigns it; on his phone the Driver picks his name and sees
// it, and whom it is for.
test('Dave Assigns an Assignment on the Board and the Driver sees it on his phone', async ({ browser }) => {
  const board = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await board.goto(`/truck-dispatch/?date=${TODAY}`);

  await board.getByRole('button', { name: 'Add an Assignment for Sample Driver A' }).click();
  const composer = board.getByRole('form', { name: 'New Assignment for Sample Driver A' });
  await composer.getByRole('group', { name: 'Pick up' }).getByRole('button', { name: 'Sample Plant' }).click();
  await composer.getByRole('group', { name: 'Drop off' }).getByRole('button', { name: 'Sample Site North' }).click();
  await composer.getByRole('group', { name: 'Hauling what?' }).getByRole('button', { name: 'Sample Stone' }).click();
  // For a first-time Customer: typed, so the Worker adds him to Customers.
  await composer.getByRole('group', { name: 'For', exact: true }).getByRole('button', { name: 'Or type it' }).click();
  await composer.getByRole('textbox', { name: 'For, typed' }).fill('Sample Customer A');
  await composer.getByRole('button', { name: 'Save' }).click();

  const lane = board.getByRole('article', { name: /Sample Driver A/ });
  await expect(lane.getByText('For Sample Customer A')).toBeVisible();
  await expect(lane.getByText('Customer', { exact: true })).toBeVisible();
  await lane.getByRole('button', { name: /^Assign For Sample Customer A · Customer · Sample Plant/ }).click();
  await expect(lane.getByRole('button', { name: /^Assign / })).toHaveCount(0);

  const phone = await (await browser.newContext({ viewport: PHONE })).newPage();
  await phone.goto('/truck-dispatch/driver');
  await phone.getByRole('button', { name: 'Sample Driver A' }).click();

  const card = phone.getByRole('article', { name: 'Sample Stone' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sample Plant');
  await expect(card).toContainText('Sample Site North');
  await expect(card.getByText('Haul for Sample Customer A')).toBeVisible();
  await expect(card.getByText('Customer', { exact: true })).toBeVisible();
});
