/**
 * Reads the whole database into one plain object.
 *
 * Shared by `npm run export` and by GET /api/admin/export, so the file a
 * manager downloads from the browser and the file the script writes are the
 * same file, produced by the same code. Two implementations would drift, and
 * the one that drifted would be discovered during a restore.
 */
const db = require('./../db/connection');

/**
 * Parent tables first. A restore inserts in this order so a foreign key never
 * points at a row that has not been written yet.
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
 * Tables the database has that this list does not, so one added to schema.sql
 * later cannot be quietly left out of every backup taken from then on. Being
 * told is the whole point -- a backup that silently omits something is worse
 * than no backup, because it gets trusted.
 */
const findUnlisted = async (client = db) => {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  return rows.map((r) => r.table_name).filter((name) => !TABLES.includes(name));
};

/**
 * Sequence positions, so ids carry on from where they left off rather than
 * colliding with restored rows. ticket_number_seq matters most: reset to its
 * start, it hands out ticket numbers that already exist.
 */
const readSequences = async (client = db) => {
  const { rows } = await client.query(`
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

/**
 * Every row, in one object ready to be written as JSON.
 *
 * Read inside a single repeatable-read transaction so every table is seen at
 * the same instant. Without that, a ticket filed between two of these queries
 * lands in `tickets` with no matching `ticket_activity`, and the restore fails
 * on a foreign key -- rarely, and only under load, which is the worst way for
 * a backup to be wrong.
 */
const exportDatabase = async () => {
  const unlisted = await findUnlisted();
  if (unlisted.length) {
    throw new Error(
      `These tables exist but are not listed in services/backup.js: ${unlisted.join(', ')}. `
      + 'Add them to TABLES, in an order that puts each after whatever it references.',
    );
  }

  return db.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const { rows: version } = await client.query('SHOW server_version');
    const tables = {};
    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await client.query(`SELECT * FROM "${table}"`);
      tables[table] = rows;
    }

    return {
      exportedAt: new Date().toISOString(),
      serverVersion: version[0].server_version,
      tables,
      sequences: await readSequences(client),
    };
  });
};

/** `users: 6, tickets: 8, ...` for a log line or a script's output. */
const countRows = (payload) => Object.fromEntries(
  Object.entries(payload.tables).map(([table, rows]) => [table, rows.length]),
);

/** A filename that sorts chronologically and is safe on every platform. */
const filenameFor = (payload) => {
  const stamp = payload.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `tsv-${stamp}.json`;
};

module.exports = { TABLES, exportDatabase, findUnlisted, readSequences, countRows, filenameFor };
