const express = require('express');

const config = require('../config');
const { authenticate, authorize } = require('../middleware/auth');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const backup = require('../services/backup');
const email = require('../services/email');
const { ROLES } = require('../constants');

const router = express.Router();

router.use(authenticate, authorize(ROLES.MANAGEMENT));

/**
 * GET /api/admin/export
 *
 * The whole database as one JSON file, identical to what `npm run export`
 * writes. It exists because the alternative needs the database password on
 * somebody's laptop, and the server already holds that credential -- so the
 * export runs where the credential already is, and nobody has to move it.
 *
 * This is the only route that returns password hashes, so it is worth being
 * clear about what it does and does not widen:
 *
 *   A management account can already read every resident's name, address,
 *   phone number and every ticket and comment in the system, and can take
 *   over any account by issuing it a temporary password. Compromising one is
 *   already total. What this adds is the bcrypt hashes, which are worth
 *   having offline only to attack passwords reused on other sites.
 *
 * Set DB_EXPORT=off to remove the route's usefulness once a backup is in
 * hand. It defaults to on, because a backup nobody can take is the failure
 * this is here to prevent.
 */
router.get('/export', asyncHandler(async (req, res) => {
  if (!config.allowDbExport) {
    throw AppError.forbidden('Database export is turned off (DB_EXPORT=off)');
  }

  const payload = await backup.exportDatabase();
  const counts = backup.countRows(payload);

  // Downloading the entire database is the single largest thing anyone can do
  // through this API. It should never be something that happened invisibly.
  console.log(
    `AUDIT database export by ${req.user.email} (user ${req.user.id}): `
    + Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(' '),
  );

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${backup.filenameFor(payload)}"`);
  // Never let a proxy or the browser keep a copy of this.
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(payload, null, 2));
}));

/**
 * POST /api/admin/export/email
 *
 * Sends a backup right now, ignoring the "is one overdue?" schedule.
 *
 * This is how you find out whether the automatic backups are arriving,
 * without waiting a day to discover that they are not. It reports the address
 * it used, because the commonest failure by far is ADMIN_NOTIFY_EMAIL being
 * unset or pointing somewhere forgotten -- which is indistinguishable from
 * mail being broken until something says which address it tried.
 */
router.post('/export/email', asyncHandler(async (req, res) => {
  if (!config.allowDbExport) {
    throw AppError.forbidden('Database export is turned off (DB_EXPORT=off)');
  }
  if (!config.mail.adminNotify) {
    throw AppError.badRequest(
      'No address to send to. Set ADMIN_NOTIFY_EMAIL on the server and redeploy.',
    );
  }
  if (!email.isConfigured()) {
    throw AppError.badRequest(
      'No mail transport is configured. Set RESEND_API_KEY on the server and redeploy.',
    );
  }

  const result = await backup.emailBackup();

  if (result.status !== 'sent') {
    // Notifications are best-effort everywhere else in this app, but a test
    // that answers "sent" when nothing was sent is worse than no test at all.
    throw AppError.badGateway(
      `The backup was built but could not be emailed to ${result.to}. `
      + 'The provider\'s reason is in email_logs and in the server log.',
    );
  }

  console.log(
    `AUDIT backup emailed on request by ${req.user.email} (user ${req.user.id}) to ${result.to}`,
  );

  res.json({
    sentTo: result.to,
    filename: result.filename,
    bytes: result.bytes,
    attached: result.attached,
    counts: result.counts,
  });
}));

module.exports = router;
