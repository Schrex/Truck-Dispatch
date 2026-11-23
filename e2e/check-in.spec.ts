import { expect, test } from '@playwright/test';
import { PHONE } from './clock';

// Phase 2, end to end: on his phone a Driver checks in on Today, his usual
// Truck pre-selected, answering one item Needs repair with a note, and sees
// the one-line summary. The Worker's clock is fixed at 9:00 AM US Eastern.
test('a Driver checks in with one Needs repair and sees the summary line', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: PHONE })).newPage();
  await phone.goto('/truck-dispatch/driver');
  await phone.getByRole('button', { name: 'Sample Driver B' }).click();

  const card = phone.getByRole('region', { name: 'Check in' });
  await expect(card.getByRole('group', { name: 'Truck' }).getByRole('button', { name: 'Truck 24' })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Start Inspection' }).click();

  const items = await card.getByRole('group').filter({ has: phone.getByRole('button', { name: 'Needs repair' }) }).all();
  expect(items).toHaveLength(12);
  for (const item of items) await item.getByRole('button', { name: 'OK' }).click();
  await card.getByRole('group', { name: 'Mud flaps' }).getByRole('button', { name: 'Needs repair' }).click();
  await expect(card.getByRole('button', { name: 'Finish' })).toBeDisabled();
  await card.getByRole('textbox', { name: 'What needs repair: Mud flaps' }).fill('Left rear flap torn');
  await card.getByRole('button', { name: 'Finish' }).click();

  await expect(phone.getByRole('region', { name: 'Checked in' })).toHaveText('Truck 24 · checked in 9:00 · Check in again');
  await expect(card).toHaveCount(0);

  // The check-in is the Worker's: it is there after a reload.
  await phone.reload();
  await expect(phone.getByRole('region', { name: 'Checked in' })).toHaveText('Truck 24 · checked in 9:00 · Check in again');
});
