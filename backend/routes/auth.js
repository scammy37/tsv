const express = require('express');
const bcrypt = require('bcryptjs');

const config = require('../config');
const db = require('../db/connection');
const schemas = require('../validators');
const validate = require('../middleware/validate');
const { signToken, authenticate } = require('../middleware/auth');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { publicUser } = require('../utils/serialize');
const { ROLES } = require('../constants');
const emailService = require('../services/email');
const passwordReset = require('../services/passwordReset');

const router = express.Router();

/**
 * POST /api/auth/register
 * Self-service signup for homeowners. Requesting a staff or management role
 * requires STAFF_INVITE_CODE, which is how the first manager account is made.
 */
router.post('/register', validate(schemas.register), asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, unitNumber, phone, role, staffInviteCode } = req.body;

  if (role !== ROLES.HOMEOWNER) {
    if (!config.staffInviteCode) {
      throw AppError.forbidden('Staff registration is disabled; set STAFF_INVITE_CODE to enable it');
    }
    if (staffInviteCode !== config.staffInviteCode) {
      throw AppError.forbidden('Invalid staff invite code');
    }
  }

  const existing = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rowCount > 0) {
    throw AppError.conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, unit_number, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [email, passwordHash, firstName, lastName, role, unitNumber || null, phone || null],
  );

  const user = rows[0];

  // Fire-and-forget, like every other notification: whoever watches signups
  // hears about this, and a mail failure never costs the resident their
  // account. `email` is shadowed by the address in scope here, hence the
  // module being reached through its own name.
  emailService.notifyAdmins('user_registered', { newUser: user });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

/** POST /api/auth/login */
router.post('/login', validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];

  // Compare against a dummy hash when the user is unknown so a missing account
  // and a wrong password take the same amount of time to reject.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await bcrypt.compare(password, hash);

  if (!user || !matches) throw AppError.unauthorized('Incorrect email or password');
  if (!user.is_active) throw AppError.forbidden('This account has been deactivated');

  res.json({ token: signToken(user), user: publicUser(user) });
}));

/**
 * POST /api/auth/forgot-password
 * Always answers the same way, whether or not the address is registered:
 * a differing response here is an account-enumeration oracle.
 */
router.post('/forgot-password', validate(schemas.requestPasswordReset), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE lower(email) = lower($1) AND is_active',
    [req.body.email],
  );
  const user = rows[0];

  if (user) {
    const { token } = await passwordReset.issue(user.id);
    const resetUrl = `${config.publicUrl}/reset-password?token=${token}`;
    emailService.notify('password_reset', user.email, {
      user,
      resetUrl,
      ttlMinutes: passwordReset.TOKEN_TTL_MINUTES,
    });
  }

  res.json({
    message: 'If that email is registered, a reset link is on its way.',
  });
}));

/**
 * POST /api/auth/reset-password
 * Consumes the token and sets the new password. Tokens are single use, so a
 * link that has already been followed fails here even within its lifetime.
 */
router.post('/reset-password', validate(schemas.resetPassword), asyncHandler(async (req, res) => {
  const user = await passwordReset.consume(req.body.token);
  if (!user) {
    throw AppError.badRequest('That reset link is invalid or has expired. Request a new one.');
  }

  const passwordHash = await bcrypt.hash(req.body.password, config.bcryptRounds);
  const { rows } = await db.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = false, password_changed_at = now(),
         token_version = token_version + 1
     WHERE id = $2
     RETURNING *`,
    [passwordHash, user.id],
  );

  // Signing in immediately saves a round trip and proves the reset worked. The
  // new token postdates password_changed_at, so it survives while every session
  // opened before the reset is rejected from here on.
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

/** GET /api/auth/me */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/**
 * PATCH /api/auth/me
 *
 * The email address is the login, so changing it is a credential change rather
 * than a detail edit, and it is treated like one: the current password has to
 * come with it, and every other session is signed out. Without the password an
 * open session left on a shared machine would be enough to move the account to
 * an address its owner does not hold.
 *
 * The new address is not verified -- a confirmation link is only worth building
 * once mail actually leaves this deployment. Until then a typo is recoverable
 * because management can set the address back from the People page.
 */
router.patch('/me', authenticate, validate(schemas.updateProfile), asyncHandler(async (req, res) => {
  const fieldMap = {
    firstName: 'first_name',
    lastName: 'last_name',
    unitNumber: 'unit_number',
    phone: 'phone',
  };

  // Joi has already lowercased and trimmed it, which is what the unique index
  // on lower(email) compares, so this is a real no-op check and not a near one.
  const newEmail = req.body.email !== undefined && req.body.email !== req.user.email
    ? req.body.email
    : null;

  if (newEmail) {
    if (!req.body.currentPassword) {
      throw AppError.badRequest('Enter your current password to change your email address');
    }
    const matches = await bcrypt.compare(req.body.currentPassword, req.user.password_hash);
    if (!matches) throw AppError.badRequest('Current password is incorrect');
  }

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(fieldMap)) {
    if (req.body[key] !== undefined) {
      values.push(req.body[key] === '' ? null : req.body[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  if (newEmail) {
    values.push(newEmail);
    sets.push(`email = $${values.length}`);
    // Signs out everywhere else, as a password change does: whoever holds an
    // old session should not keep it across a change of the login itself.
    sets.push('token_version = token_version + 1');
  }

  if (!sets.length) return res.json({ user: publicUser(req.user) });

  values.push(req.user.id);
  let rows;
  try {
    ({ rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    ));
  } catch (err) {
    // The generic handler calls this "That record already exists", which says
    // nothing about which field or what to do.
    if (err.code === '23505') {
      throw AppError.conflict('That email address is already registered to another account');
    }
    throw err;
  }

  // Bumping token_version invalidated the caller's own token too, so hand back
  // a fresh one or the change would log them out of the session that made it.
  return res.json({
    user: publicUser(rows[0]),
    ...(newEmail ? { token: signToken(rows[0]) } : {}),
  });
}));

/** POST /api/auth/change-password */
router.post('/change-password', authenticate, validate(schemas.changePassword), asyncHandler(async (req, res) => {
  const matches = await bcrypt.compare(req.body.currentPassword, req.user.password_hash);
  if (!matches) throw AppError.badRequest('Current password is incorrect');

  const passwordHash = await bcrypt.hash(req.body.newPassword, config.bcryptRounds);
  const { rows } = await db.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = false, password_changed_at = now(),
         token_version = token_version + 1
     WHERE id = $2
     RETURNING *`,
    [passwordHash, req.user.id],
  );

  // Changing a password signs out every other session. A fresh token keeps the
  // one doing the changing alive -- without it the caller would be logged out
  // by their own successful request.
  res.json({ message: 'Password updated', token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

module.exports = router;
