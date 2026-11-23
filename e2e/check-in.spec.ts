import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, TODAY } from './clock';

// Phase 2, end to end: on his phone a Driver checks in on Today, his usual
// Truck pre-selected, answering one item Needs repair with a note, and sees
// the one-line summary; then Dave's Board shows the check-in on his lane, and
// the Needs repair is a Truck problem: a red mark on his lane, listed at the top
// of his next Inspection, and in Dave's Settings, which he marks fixed, and the
// mark goes.
// The Worker's clock is fixed at 9:00 AM US Eastern.
test('a Driver checks in with one Needs repair, Dave sees it on the Board and marks the Truck problem fixed', async ({ browser }) => {
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

  // On Dave's Board, today, the Driver's lane shows the check-in and that it found something.
  const board = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await board.goto(`/truck-dispatch/?date=${TODAY}`);
  const lane = board.getByRole('article', { name: 'Sample Driver B' });
  await expect(lane.getByText(/^Truck 24 · checked in/)).toHaveText('Truck 24 · checked in 9:00 · needs repair');

  // The open problem marks his lane red; tapping the mark says what it is.
  const mark = lane.getByRole('button', { name: 'Open problems on Truck 24' });
  await mark.click();
  await expect(lane.getByRole('list', { name: 'Open problems on Truck 24' })).toHaveText('Left rear flap torn');

  // Checking in again to Truck 24, the Driver sees it before the checklist.
  await phone.getByRole('region', { name: 'Checked in' }).getByRole('button', { name: 'Check in again' }).click();
  await card.getByRole('button', { name: 'Start Inspection' }).click();
  await expect(card.getByRole('list', { name: 'Open problems on Truck 24' })).toHaveText('Left rear flap torn · reported today by Sample Driver B');
  await card.getByRole('button', { name: 'Cancel' }).click();

  // Dave sees it in Settings under Trucks, open, and marks it fixed with a note; it stays listed as fixed.
  await board.goto('/truck-dispatch/settings');
  const problems = board.getByRole('region', { name: 'Truck problems' });
  const problem = problems.getByRole('list', { name: 'Open Truck problems' }).getByRole('listitem', { name: 'Truck 24: Left rear flap torn' });
  await expect(problem).toContainText('Sample Driver B · Mon, Nov 23 9:00');
  await problem.getByRole('button', { name: 'Mark fixed' }).click();
  await problem.getByRole('textbox', { name: 'How it was fixed (optional)' }).fill('New flap fitted');
  await problem.getByRole('button', { name: 'Save' }).click();

  await expect(problems.getByText('No open Truck problems.')).toBeVisible();
  const fixed = problems.getByRole('list', { name: 'Fixed Truck problems' }).getByRole('listitem', { name: 'Truck 24: Left rear flap torn' });
  await expect(fixed).toContainText('Fixed Mon, Nov 23 9:00 · New flap fitted');

  // Fixed is the Worker's too: still there, still fixed, after a reload.
  await board.reload();
  await expect(fixed).toContainText('Fixed Mon, Nov 23 9:00 · New flap fitted');

  // Back on the Board, once it has read the open problems, the lane's red mark is gone.
  const read = board.waitForResponse((response) => response.url().includes('/api/truck-problems?open=1'));
  await board.goto(`/truck-dispatch/?date=${TODAY}`);
  await read;
  await expect(lane.getByText(/^Truck 24 · checked in/)).toBeVisible();
  await expect(mark).toHaveCount(0);
});
