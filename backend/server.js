const config = require('./config');
const app = require('./app');
const { pool } = require('./db/connection');
const email = require('./services/email');
const backup = require('./services/backup');

// The most recent backup requested by email. See RESTORE.md.
const BACKUP_REQUEST = '2026-10-13';

const server = app.listen(config.port, () => {
  console.log(`${config.appName} API listening on port ${config.port} (${config.env})`);
  // Reports the state of email rather than letting it fail silently later.
  email.verifyAtStartup().catch((err) => console.error('Email check failed:', err.message));

  // A backup asked for by date. Changing this and deploying sends one more,
  // once; see backup.emailBackupOnce. Not a schedule.
  backup.emailBackupOnce(BACKUP_REQUEST)
    .then((r) => r.status === 'sent' && console.log(`Backup: emailed ${r.filename} to ${r.to}`))
    .catch((err) => console.error('Backup email failed:', err.message));
});

// Finish in-flight requests and close the pool before exiting.
const shutdown = (signal) => {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    // Let queued notifications finish before dropping the connection pool.
    await email.flush();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

module.exports = server;
