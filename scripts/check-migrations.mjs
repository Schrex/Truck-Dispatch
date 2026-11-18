// Fails when migrations/ has a badly named file or two files with the same
// number. Two pull requests can each add "0002_..."; this catches it before
// both reach main and the shared preview and staging databases.
//
//   node scripts/check-migrations.mjs [dir]
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Each problem as a plain sentence; empty when the folder is fine.
 * @param {string[]} files
 * @returns {string[]}
 */
export function migrationProblems(files) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const file of files.filter((f) => f.endsWith('.sql')).sort()) {
    const match = NAME.exec(file);
    if (!match) {
      problems.push(`${file}: name it NNNN_lower_snake_case.sql (bunx wrangler d1 migrations create truck-dispatch <name>).`);
      continue;
    }
    const number = match[1];
    if (seen.has(number)) {
      problems.push(`${file} and ${seen.get(number)} share number ${number}: renumber yours after merging main.`);
    } else {
      seen.set(number, file);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'migrations';
  const problems = migrationProblems(readdirSync(dir));
  for (const problem of problems) console.error(`::error file=${dir}::${problem}`);
  if (problems.length === 0) console.log(`migrations: ok (${dir})`);
  process.exit(problems.length > 0 ? 1 : 0);
}
