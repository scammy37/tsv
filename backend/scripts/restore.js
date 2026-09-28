#!/usr/bin/env node
/**
 * Loads a `npm run export` file back into a database.
 *
 *   npm run migrate                       # the schema first -- this only does rows
 *   npm run restore -- backups/tsv-....json
 *   npm run restore -- <file> --force     # overwrite a database that has rows in it
 *
 * Runs in one transaction: either every table lands or none does, so a failure
 * halfway through cannot leave a half-populated database that looks restored.
 *
 * Ids are preserved rather than reassigned. Every foreign key in this schema
 * points at one, and rewriting them all correctly is a much easier thing to
 * get subtly wrong than to avoid entirely.
 */
const fs = require('fs');

const db = require('../db/connection');
const config = require('../config');

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = args.find((a) => !a.startsWith('--'));

/** Insert order is the order the export wrote, which puts parents first. */
const insertRows = async (client, table, rows) => {
  if (!rows.length) return;

  // Column names come from the database's own output, not from user input,
  // but they are quoted anyway: an identifier that needed quoting and did not
  // get it fails in a way that looks like a bug in the data.
  const columns = Object.keys(rows[0]);
  const quoted = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`;

  for (const row of rows) {
    // Sequential on purpose. These are small tables, and a failure should name
    // the row that caused it rather than arriving from somewhere in a batch.
    // eslint-disable-next-line no-await-in-loop
    await client.query(sql, columns.map((c) => row[c]));
  }
};

async function main() {
  if (!file) {
    console.error('Usage: npm run restore -- <export.json> [--force]');
    return 1;
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    return 1;
  }

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!payload.tables) {
    console.error(`${file} is not an export from \`npm run export\`.`);
    return 1;
  }

  const names = Object.keys(payload.tables);
  const total = names.reduce((n, t) => n + payload.tables[t].length, 0);
  console.log(`File    : ${file}`);
  console.log(`Taken   : ${payload.exportedAt} from PostgreSQL ${payload.serverVersion}`);
  console.log(`Contains: ${total} rows across ${names.length} tables`);
  console.log(`Target  : ${config.dbLabel}\n`);

  // Anything already here is about to be destroyed, so say so and stop. The
  // schema seeds `categories`, so its rows are expected and are not evidence
  // that this database is in use.
  const occupied = [];
  for (const table of names) {
    if (table === 'categories') continue;
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
    if (rows[0].n > 0) occupied.push(`${table} (${rows[0].n})`);
  }

  if (occupied.length && !force) {
    console.error(`This database already has rows: ${occupied.join(', ')}`);
    console.error('Restoring would replace them. Re-run with --force if that is what you want,');
    console.error('or point at an empty database created with `npm run migrate`.');
    return 1;
  }
  if (occupied.length) {
    console.log(`Replacing existing rows in: ${occupied.join(', ')}\n`);
  }

  await db.transaction(async (client) => {
    // Reverse order: children before the parents they reference.
    await client.query(`TRUNCATE ${names.map((t) => `"${t}"`).join(', ')} CASCADE`);

    for (const table of names) {
      // eslint-disable-next-line no-await-in-loop
      await insertRows(client, table, payload.tables[table]);
      console.log(`  ${String(payload.tables[table].length).padStart(6)}  ${table}`);
    }

    // Ids were inserted explicitly, which leaves every sequence still sitting
    // where an empty database left it. Without this the next signup collides
    // with a restored user, and the next ticket reuses a ticket number.
    for (const [name, value] of Object.entries(payload.sequences || {})) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('SELECT setval($1::regclass, $2::bigint, true)', [name, value]);
    }
  });

  const seqCount = Object.keys(payload.sequences || {}).length;
  console.log(`\nRestored ${total} rows and reset ${seqCount} sequences.`);
  return 0;
}

main()
  .then(async (code) => { await db.pool.end(); process.exit(code); })
  .catch(async (err) => {
    console.error('\nRestore failed, and nothing was changed:', err.message);
    await db.pool.end();
    process.exit(1);
  });
