/**
 * Reads the whole database into one object, the same file `npm run export`
 * writes and `npm run restore` reads back. Shared by that script and by the
 * server's own backup email, so the two can never produce different files.
 */
const db = require('../db/connection');
const config = require('../config');
const email = require('./email');

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

/** Every row and every sequence position, read at a single instant. */
const exportDatabase = async () => {
  const unlisted = await findUnlisted();
  if (unlisted.length) {
    throw new Error(`These tables exist but are not in services/backup.js: ${unlisted.join(', ')}. `
      + 'Add them to TABLES, in an order that puts each after whatever it references.');
  }

  // One repeatable-read transaction, so a ticket filed halfway through cannot
  // land in one table and be missing from the next -- which the restore would
  // then refuse on a foreign key.
  return db.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: version } = await client.query('SHOW server_version');
    const tables = {};
    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await client.query(`SELECT * FROM "${table}"`);
      tables[table] = rows;
    }
    const { rows: seqs } = await client.query(
      "SELECT sequencename AS name, last_value FROM pg_sequences WHERE schemaname = 'public'",
    );
    return {
      exportedAt: new Date().toISOString(),
      serverVersion: version[0].server_version,
      tables,
      sequences: Object.fromEntries(
        seqs.filter((r) => r.last_value !== null).map((r) => [r.name, String(r.last_value)]),
      ),
    };
  });
};

const countRows = (payload) => Object.fromEntries(
  Object.entries(payload.tables).map(([table, rows]) => [table, rows.length]),
);

const filenameFor = (payload) => (
  `tsv-${payload.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}.json`
);

/**
 * Emails one backup to ADMIN_NOTIFY_EMAIL for a given request, once.
 *
 * Runs at server start, so pushing a new request id is all it takes to send
 * a backup: the deploy boots the server and the backup goes out, with nothing
 * for anyone to click. email_logs remembers which requests were sent, so a
 * restart -- and a free instance restarts every time it wakes -- never sends
 * the same one twice. A send that failed is retried on the next start.
 *
 * Deliberately not a schedule. Each backup is asked for.
 */
const emailBackupOnce = async (requestId) => {
  const to = config.mail.adminNotify;
  if (!requestId || !to || !email.isConfigured()) return { status: 'skipped' };

  const tag = `(requested ${requestId})`;
  const { rowCount } = await db.query(
    "SELECT 1 FROM email_logs WHERE template = 'database_backup' AND status = 'sent' AND subject LIKE $1",
    [`%${tag}%`],
  );
  if (rowCount) return { status: 'already-sent' };

  const payload = await exportDatabase();
  const filename = filenameFor(payload);
  const result = await email.send('database_backup', to, {
    tag,
    filename,
    counts: countRows(payload),
    file: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`),
  });
  return { status: result.status, to, filename };
};

module.exports = {
  TABLES, findUnlisted, readSequences, exportDatabase, countRows, filenameFor, emailBackupOnce,
};
