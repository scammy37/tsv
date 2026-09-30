const config = require('./config');
const app = require('./app');
const { pool } = require('./db/connection');
const email = require('./services/email');

const server = app.listen(config.port, () => {
  console.log(`${config.appName} API listening on port ${config.port} (${config.env})`);
  // Reports the state of email rather than letting it fail silently later.
  email.verifyAtStartup().catch((err) => console.error('Email check failed:', err.message));
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
