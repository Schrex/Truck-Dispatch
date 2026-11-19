// Checks a deployed Truck Dispatch end to end, standalone and under the
// /truck-dispatch/ prefix: the page loads, its script loads, the seeded
// Drivers and Trucks (seed/fixture.sql) come back, and a day's Assignments can be read.
// Read-only: it never adds Assignments.
//
//   node scripts/smoke.mjs <base url>
//
// EXPECT_COMMIT: fail unless /api/health reports this commit (retries while the
//   new version spreads). CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET: a
//   Cloudflare Access service token, when Access protects the address.
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

/** @param {string} path */
async function get(path) {
  const response = await fetch(base + path, { headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && /cloudflareaccess\.com/.test(response.headers.get('location') ?? '')) {
    throw new Error(`${path}: redirected to Cloudflare Access sign-in; set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET`);
  }
  return response;
}

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(message);
}

/** @type {{ name: string, ok: boolean }[]} */
const results = [];
/** @param {string} name @param {() => Promise<void>} check */
async function step(name, check) {
  try {
    await check();
    results.push({ name, ok: true });
    console.log(`ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Waits up to ~30 s for the new version: a brand-new Worker's address can
// answer 404 for a few seconds, and a new version takes a moment to spread.
// Access refusals (401/403) are not waited out: retrying won't fix them.
const expected = process.env.EXPECT_COMMIT;
await step(`health${expected ? ` reports commit ${expected.slice(0, 7)}` : ''}`, async () => {
  const attempts = 10;
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const response = await get('/api/health');
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
  await step(`${where}: seeded Drivers, Trucks and tomorrow's Assignments`, async () => {
    const drivers = await get(`${prefix}/api/drivers`);
    if (!drivers.ok) fail(`drivers: ${drivers.status}`);
    const list = /** @type {{ drivers: unknown[] }} */ (await drivers.json()).drivers;
    if (list.length === 0) fail('no drivers; was seed/fixture.sql applied?');
    const trucks = await get(`${prefix}/api/trucks?include=inactive`);
    if (!trucks.ok) fail(`trucks: ${trucks.status}`);
    if (/** @type {{ trucks: unknown[] }} */ (await trucks.json()).trucks.length === 0) fail('no trucks; was seed/fixture.sql applied?');
    const today = await get(`${prefix}/api/today`);
    if (!today.ok) fail(`today: ${today.status}`);
    const { tomorrow } = /** @type {{ tomorrow: string }} */ (await today.json());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tomorrow)) fail(`today: tomorrow is ${tomorrow}`);
    const day = await get(`${prefix}/api/assignments?date=${tomorrow}`);
    if (!day.ok) fail(`assignments: ${day.status}`);
    const { assignments } = /** @type {{ assignments: unknown }} */ (await day.json());
    if (!Array.isArray(assignments)) fail('assignments: no list');
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
process.exit(failed > 0 ? 1 : 0);
