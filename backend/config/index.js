const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: int(process.env.PORT, 5000),
  appName: process.env.APP_NAME || 'Townsquare Village HOA',
  // Emailed links (password reset above all) have to point at the real
  // deployment, and the public URL is not known until the host has assigned
  // one. Render exports it as RENDER_EXTERNAL_URL, so the common case needs no
  // configuration; FRONTEND_URL still wins where it is set, and is required on
  // a host that exports nothing.
  frontendUrl: process.env.FRONTEND_URL
    || process.env.RENDER_EXTERNAL_URL
    || 'http://localhost:3000',

  // Managed hosts (Replit, Render, Railway, Fly, Heroku) hand over one
  // DATABASE_URL; local development uses the discrete variables. Tests always
  // use their own database, so a stray DATABASE_URL in the environment cannot
  // point the suite at something real.
  db: env === 'test' || !process.env.DATABASE_URL
    ? {
      host: process.env.DB_HOST || 'localhost',
      port: int(process.env.DB_PORT, 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: env === 'test'
        ? process.env.TEST_DB_NAME || 'tsv_test'
        : process.env.DB_NAME || 'tsv_db',
      max: int(process.env.DB_POOL_MAX, 10),
    }
    : {
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres terminates TLS with its own CA, which is not in the
      // Node trust store. Set DB_SSL=disable for a provider that does not use
      // TLS at all (a private network link, say).
      ssl: process.env.DB_SSL === 'disable' ? false : { rejectUnauthorized: false },
      max: int(process.env.DB_POOL_MAX, 10),
    },

  jwt: {
    secret: process.env.JWT_SECRET || (env === 'production' ? '' : 'dev-only-insecure-secret'),
    expiresIn: process.env.JWT_EXPIRE || '7d',
  },

  // Anyone can self-register as a homeowner. Registering as staff or management
  // requires this shared code, so the portal can bootstrap without a seed script.
  staffInviteCode: process.env.STAFF_INVITE_CODE || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Townsquare Village HOA <office@townsquarevillagenj.com>',
  },

  // Sending over HTTPS instead of SMTP. Required on a host that blocks
  // outbound mail ports -- which this one does, on every port and provider
  // tried, so no SMTP credential can work here. Used in preference to SMTP.
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    // Overridable so the tests can point at a local stand-in. No deployment
    // should set it.
    apiBase: process.env.RESEND_API_BASE || 'https://api.resend.com',
  },

  // Who notifications come from, whichever transport carries them. Falls back
  // to SMTP_FROM so an existing deployment keeps its configured sender.
  mail: {
    // Notifications go out from an address nobody reads, so that a resident's
    // reply cannot vanish into a mailbox that is not part of the workflow.
    // The request itself is where a reply belongs.
    from: process.env.MAIL_FROM
      || process.env.SMTP_FROM
      || 'Townsquare Village HOA <noreply@townsquarevillagenj.com>',

    // Where to send someone who genuinely needs a person, quoted in emails
    // that have no request to point at -- a password reset, say.
    office: process.env.OFFICE_EMAIL || 'office@townsquarevillagenj.com',

    // An extra recipient for the notices that are about running the
    // association rather than about a ticket -- a new account, so far.
    // Deliberately has no default: an address hard-coded here would keep
    // mailing somebody long after they stopped being the person who wanted it.
    adminNotify: process.env.ADMIN_NOTIFY_EMAIL || '',
  },

  bcryptRounds: int(process.env.BCRYPT_ROUNDS, env === 'test' ? 4 : 10),

  // When true the API also serves frontend/build, so the whole app runs on one
  // origin and needs no CORS configuration. Used by the devcontainer and by
  // single-service deployments.
  serveFrontend: process.env.SERVE_FRONTEND === 'true',
};

// Production must not inherit any of the conveniences that make local
// development easy. Each of these would be a real vulnerability if it shipped.
if (config.isProduction) {
  const problems = [];

  if (!config.jwt.secret) {
    problems.push('JWT_SECRET must be set');
  } else if (config.jwt.secret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  } else if (/^(dev|test|change|secret|password)/i.test(config.jwt.secret)) {
    problems.push('JWT_SECRET looks like a placeholder; generate a random one');
  }

  if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
    problems.push('Set DATABASE_URL, or DB_PASSWORD for a discrete connection');
  }

  // A guessable invite code lets anyone grant themselves management access.
  if (config.staffInviteCode && /^(demo|test|change_me|invite)/i.test(config.staffInviteCode)) {
    problems.push('STAFF_INVITE_CODE is a placeholder; set a strong value or leave it blank');
  }

  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * A name for the database being talked to, for log lines like "Applying schema
 * to ...". Discrete settings carry the name directly; a DATABASE_URL has to be
 * parsed, and deliberately not printed whole -- it carries the password, and
 * log output gets pasted into issue trackers and support threads. URL#host is
 * host:port with any credentials stripped, so this stays safe to print.
 */
const describeDatabase = (db) => {
  if (db.database) return db.database;
  try {
    const url = new URL(db.connectionString);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return name ? `${name} on ${url.host}` : url.host;
  } catch {
    // A connection string libpq accepts but WHATWG URL does not (a bare
    // "host=... dbname=..." keyword string, say). Nothing useful to name.
    return 'the configured database';
  }
};

config.dbLabel = describeDatabase(config.db);

// Exported so the no-credentials-in-the-label property can be tested against a
// connection string, which NODE_ENV=test otherwise never takes.
config.describeDatabase = describeDatabase;

module.exports = config;
