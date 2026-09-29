#!/usr/bin/env node
/**
 * Exports every row in the database to one JSON file.
 *
 *   npm run export                  -> backups/tsv-<timestamp>.json
 *   npm run export -- /path/out.json
 *
 * Restore it with `npm run restore`.
 *
 * Managers can get the identical file without a terminal, from
 * People -> Download a backup, which calls GET /api/admin/export. Both go
 * through services/backup.js, so they cannot diverge.
 *
 * Why this exists alongside `npm run backup`, which runs pg_dump:
 *
 *   pg_dump refuses to read a server newer than itself, and managed hosts run
 *   current majors. So dumping an 18 server needs PostgreSQL 18 client tools
 *   installed locally, which on Windows or an older Mac is a real obstacle at
 *   exactly the moment somebody is trying to rescue their data. This reads the
 *   rows through the same driver the app already uses, so it works from any
 *   machine that can run the app, whatever version anything is.
 *
 * What it gives up: pg_dump captures the schema too, and this does not. The
 * schema lives in db/schema.sql, so a restore is `npm run migrate` followed by
 * `npm run restore` -- which is fine here, and would not be for a database
 * whose structure had drifted from the file.
 */
const fs = require('fs');
const path = require('path');

const db = require('../db/connection');
const config = require('../config');
const backup = require('../services/backup');

async function main() {
  const payload = await backup.exportDatabase();

  console.log(`Read ${config.dbLabel} (PostgreSQL ${payload.serverVersion})\n`);
  const counts = backup.countRows(payload);
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${String(n).padStart(6)}  ${table}`);
  }

  const target = process.argv[2]
    || path.join(__dirname, '..', '..', 'backups', backup.filenameFor(payload));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);

  const kb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`\nWrote ${target} (${kb} KB)`);
  console.log('\nThis file contains resident names, addresses, phone numbers and password');
  console.log('hashes. backups/ is gitignored; keep it somewhere you would keep those.');
  console.log('\nRestore into an empty database with:');
  console.log('  npm run migrate');
  console.log(`  npm run restore -- ${target}`);
  return 0;
}

main()
  .then(async (code) => { await db.pool.end(); process.exit(code); })
  .catch(async (err) => {
    console.error('Export failed:', err.message);
    await db.pool.end();
    process.exit(1);
  });
