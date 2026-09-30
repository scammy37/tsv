#!/usr/bin/env node
/**
 * Exports every row in the database to one JSON file.
 *
 *   npm run export                  -> backups/tsv-<timestamp>.json
 *   npm run export -- /path/out.json
 *
 * Restore it with `npm run restore`.
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

/**
 * Parent tables first. The restore inserts in this order so a foreign key
 * never points at a row that has not been written yet.
 */
const TABLES = [
  'categories',
  'users',
  'tickets',
  'ticket_comments',
  'ticket_activity',
  'email_logs',
  'password_reset_tokens',
];

/**
 * Every table the database actually has, so a table added to schema.sql later
 * cannot be quietly left out of every backup taken from then on. Being told
 * about it is the whole point -- a backup that silently omits something is
 * worse than no backup, because it is trusted.
 */
const findUnlisted = async () => {
  const { rows } = await db.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  return rows.map((r) => r.table_name).filter((name) => !TABLES.includes(name));
};

/**
 * Sequence positions, so ids carry on from where they left off rather than
 * colliding with restored rows. ticket_number_seq matters most: reset to 1 it
 * would hand out ticket numbers that already exist.
 */
const readSequences = async () => {
  const { rows } = await db.query(`
    SELECT sequencename AS name, last_value
      FROM pg_sequences WHERE schemaname = 'public'`);
  return Object.fromEntries(
    rows
      // A sequence never drawn from has no last_value; there is nothing to
      // restore, and setval would move it forward for no reason.
      .filter((r) => r.last_value !== null)
      .map((r) => [r.name, String(r.last_value)]),
  );
};

async function main() {
  const unlisted = await findUnlisted();
  if (unlisted.length) {
    console.error(`These tables exist but are not in this script: ${unlisted.join(', ')}`);
    console.error('Add them to TABLES, in an order that puts each after whatever it references.');
    return 1;
  }

  const { rows: version } = await db.query('SHOW server_version');
  console.log(`Reading ${config.dbLabel} (PostgreSQL ${version[0].server_version})\n`);

  const tables = {};
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(`SELECT * FROM ${table}`);
    tables[table] = rows;
    console.log(`  ${String(rows.length).padStart(6)}  ${table}`);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    serverVersion: version[0].server_version,
    tables,
    sequences: await readSequences(),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const target = process.argv[2]
    || path.join(__dirname, '..', '..', 'backups', `tsv-${stamp}.json`);
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
