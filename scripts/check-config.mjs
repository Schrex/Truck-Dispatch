// Fails early, with a plain message, while a Wrangler config still has the
// placeholder database_id (docs/deployment.md, "One-time Cloudflare setup").
//
//   node scripts/check-config.mjs <built wrangler.json>
import { readFileSync } from 'node:fs';

const PLACEHOLDER = 'REPLACE_WITH_DATABASE_ID';
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-config.mjs <wrangler.json>');
  process.exit(2);
}
/** @type {{ name: string, d1_databases?: { binding: string, database_name: string, database_id: string }[] }} */
const config = JSON.parse(readFileSync(file, 'utf8'));
const missing = (config.d1_databases ?? []).filter((db) => db.database_id === PLACEHOLDER);
for (const db of missing) {
  console.error(
    `::error::${config.name}: D1 "${db.database_name}" still has the placeholder id in wrangler.jsonc. ` +
      `Create it (bunx wrangler d1 create ${db.database_name}) and put its id there; see docs/deployment.md.`,
  );
}
process.exit(missing.length > 0 ? 1 : 0);
