// Checks a deployed Truck Dispatch end to end, standalone and under the
// /truck-dispatch/ prefix: the page loads, its script loads, the seeded
// Drivers, Trucks, Jobs, Places, Materials and Foremen (seed/fixture.sql) come
// back, and a day's Assignments, this week's day states and a Driver's today in
// the Driver view can be read. Read-only: it never adds Assignments.
//
//   node scripts/smoke.mjs <base url>
//
// EXPECT_COMMIT: fail unless /api/health reports this commit (retries while the
//   new version spreads). Health passing does not mean every request reaches
//   the new version yet, so each API answer's X-Commit header (set by the
//   Worker) is checked too: a step that reaches the old version (another commit,
//   or no header) is retried for up to ~30 s, then fails with its last error.
//   Any other failure fails the step at once. Without EXPECT_COMMIT (e.g. a
//   local run) nothing is retried.
// CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET: a Cloudflare Access service
//   token, when Access protects the address.
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node scripts/smoke.mjs <base url>');
  process.exit(2);
}

/** @type {Record<string, string>} */
const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const expected = process.env.EXPECT_COMMIT;

/** An answer from the previous version, while the new one is still spreading. */
class OldVersion extends Error {}

/**
 * @param {string} path
 * @param {{ anyVersion?: boolean }} [options] anyVersion: don't check X-Commit
 */
async function get(path, { anyVersion = false } = {}) {
  const response = await fetch(base + path, { headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && /cloudflareaccess\.com/.test(response.headers.get('location') ?? '')) {
    throw new Error(`${path}: redirected to Cloudflare Access sign-in; set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET`);
  }
  // Only the API is checked: page files are served without the header.
  if (expected && !anyVersion && /(^|\/)api\//.test(path)) {
    const commit = response.headers.get('x-commit');
    if (commit !== expected) {
      throw new OldVersion(`${path}: answered by ${commit ? `commit ${commit.slice(0, 7)}` : 'a version without X-Commit'} (${response.status}), expected ${expected.slice(0, 7)}`);
    }
  }
  return response;
}

/**
 * The Monday a date's week starts on (weeks run Monday to Sunday), as the
 * week strip asks for it. A copy of shared/days.ts mondayOf, as this script
 * runs as plain Node without the app's TypeScript.
 * @param {string} date YYYY-MM-DD
 */
function mondayOf(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(message);
}

/** How long a step keeps retrying while it reaches the old version. */
const oldVersionWindow = 30_000;

/** @type {{ name: string, ok: boolean }[]} */
const results = [];
/**
 * Runs a check, again from the start while it reaches the old version (up to
 * oldVersionWindow); any other failure fails it at once.
 * @param {string} name @param {() => Promise<void>} check
 */
async function step(name, check) {
  const deadline = Date.now() + oldVersionWindow;
  for (let attempt = 1; ; attempt++) {
    try {
      await check();
      results.push({ name, ok: true });
      console.log(`ok    ${name}`);
      return;
    } catch (error) {
      if (error instanceof OldVersion && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      const tries = error instanceof OldVersion ? ` (still the old version after ${attempt} tries)` : '';
      results.push({ name, ok: false });
      console.error(`FAIL  ${name}: ${message}${tries}`);
      return;
    }
  }
}

// Waits up to ~30 s for the new version: a brand-new Worker's address can
// answer 404 for a few seconds, and a new version takes a moment to spread.
// Access refusals (401/403) are not waited out: retrying won't fix them.
// The body's commit decides here, not X-Commit (older versions don't send it).
await step(`health${expected ? ` reports commit ${expected.slice(0, 7)}` : ''}`, async () => {
  const attempts = 10;
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const response = await get('/api/health', { anyVersion: true });
      if (response.status === 401 || response.status === 403) {
        fail(`/api/health: ${response.status} from Cloudflare Access; check the service token and its Service Auth policy`);
      }
      if (!response.ok) {
        problem = `/api/health: ${response.status}`;
      } else {
        const health = /** @type {{ ok: boolean, commit: string | null }} */ (await response.json());
        if (!expected || health.commit === expected) return;
        problem = `live commit is ${health.commit}, expected ${expected}`;
      }
    } catch (error) {
      if (error instanceof Error && /Cloudflare Access/.test(error.message)) throw error;
      problem = error instanceof Error ? error.message : String(error);
    }
    if (attempt >= attempts) fail(`${problem} (after ${attempts} tries)`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
});

for (const prefix of ['', '/truck-dispatch']) {
  const where = prefix || '/';
  await step(`${where}: page and its script load`, async () => {
    const page = await get(`${prefix}/`);
    if (!page.ok) fail(`${prefix}/: ${page.status}`);
    const html = await page.text();
    if (!html.includes('id="root"')) fail('page has no #root');
    const script = /src="([^"]+\.js)"/.exec(html)?.[1] ?? fail('page has no script');
    const js = await get(script);
    if (!js.ok) fail(`${script}: ${js.status}`);
  });
  await step(`${where}: Settings loads directly`, async () => {
    const page = await get(`${prefix}/settings`);
    if (!page.ok) fail(`${prefix}/settings: ${page.status}`);
    if (!(await page.text()).includes('id="root"')) fail('page has no #root');
  });
  await step(`${where}: seeded Drivers, the other lists and tomorrow's Assignments`, async () => {
    const drivers = await get(`${prefix}/api/drivers`);
    if (!drivers.ok) fail(`drivers: ${drivers.status}`);
    const list = /** @type {{ drivers: unknown[] }} */ (await drivers.json()).drivers;
    if (list.length === 0) fail('no drivers; was seed/fixture.sql applied?');
    for (const list of ['trucks', 'jobs', 'places', 'materials', 'foremen']) {
      const response = await get(`${prefix}/api/${list}?include=inactive`);
      if (!response.ok) fail(`${list}: ${response.status}`);
      const entries = /** @type {Record<string, unknown[]>} */ (await response.json())[list];
      if (!Array.isArray(entries) || entries.length === 0) fail(`no ${list}; was seed/fixture.sql applied?`);
    }
    const today = await get(`${prefix}/api/today`);
    if (!today.ok) fail(`today: ${today.status}`);
    const { tomorrow } = /** @type {{ tomorrow: string }} */ (await today.json());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tomorrow)) fail(`today: tomorrow is ${tomorrow}`);
    const day = await get(`${prefix}/api/assignments?date=${tomorrow}`);
    if (!day.ok) fail(`assignments: ${day.status}`);
    const { assignments } = /** @type {{ assignments: unknown }} */ (await day.json());
    if (!Array.isArray(assignments)) fail('assignments: no list');
  });
  await step(`${where}: this week's day states`, async () => {
    const today = await get(`${prefix}/api/today`);
    if (!today.ok) fail(`today: ${today.status}`);
    const monday = mondayOf(/** @type {{ today: string }} */ (await today.json()).today);
    const week = await get(`${prefix}/api/weeks/${monday}`);
    if (!week.ok) fail(`weeks/${monday}: ${week.status}`);
    const { days } = /** @type {{ days: { date: string; state: string }[] }} */ (await week.json());
    if (!Array.isArray(days) || days.length !== 7) fail(`weeks/${monday}: expected seven days`);
    if (days[0].date !== monday) fail(`weeks/${monday}: starts on ${days[0].date}`);
    if (!days.every((d) => ['none', 'draft', 'assigned', 'changed'].includes(d.state))) fail(`weeks/${monday}: unknown state`);
  });
  await step(`${where}: a Driver's today in the Driver view`, async () => {
    const page = await get(`${prefix}/driver`);
    if (!page.ok) fail(`${prefix}/driver: ${page.status}`);
    const drivers = await get(`${prefix}/api/drivers`);
    if (!drivers.ok) fail(`drivers: ${drivers.status}`);
    const [driver] = /** @type {{ drivers: { id: string }[] }} */ (await drivers.json()).drivers;
    if (!driver) fail('no drivers; was seed/fixture.sql applied?');
    const today = await get(`${prefix}/api/today`);
    if (!today.ok) fail(`today: ${today.status}`);
    const date = /** @type {{ today: string }} */ (await today.json()).today;
    const path = `drivers/${encodeURIComponent(driver.id)}/days/${date}`;
    const day = await get(`${prefix}/api/${path}`);
    if (!day.ok) fail(`${path}: ${day.status}`);
    const body = /** @type {{ date: string; assignments?: unknown }} */ (await day.json());
    if (body.date !== date) fail(`${path}: answered ${body.date}`);
    // Only his Assigned Assignments; an empty list is "Nothing from Dave yet" (ADR 0005).
    if (!Array.isArray(body.assignments)) fail(`${path}: no list of Assigned Assignments`);
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
process.exit(failed > 0 ? 1 : 0);
