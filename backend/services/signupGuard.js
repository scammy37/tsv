/**
 * Turns away automated sign-ups without asking real people to do anything.
 *
 * Three checks, all invisible to a resident:
 *
 *   - A honeypot: a field kept off-screen that people never see, so never
 *     fill. Form-filling bots fill every input they find, and give
 *     themselves away.
 *   - A minimum fill time, measured by the page from when it rendered. Nobody
 *     types a name, email, password and address in under three seconds; a
 *     script does it in a fraction of one.
 *   - A form ticket: a signed timestamp the page fetches when it loads. A bot
 *     that skips the page and posts straight to the API has none.
 *
 * Email confirmation was deliberately not used. The bots hitting this site
 * sign up with real people's Gmail addresses with dots inserted, which Gmail
 * ignores, so a confirmation email would land in a stranger's inbox -- doing
 * the bot's work for it.
 */
const crypto = require('crypto');

const config = require('../config');

const MIN_FILL_MS = 3000;
// Long enough for someone to open the page, get called away and come back.
const MAX_TICKET_AGE_MS = 6 * 60 * 60 * 1000;

const sign = (issuedAt) => crypto
  .createHmac('sha256', `signup-ticket:${config.jwt.secret}`)
  .update(String(issuedAt))
  .digest('base64url');

/** A ticket the sign-up page fetches when it loads. */
const issueTicket = (now = Date.now()) => `${now}.${sign(now)}`;

/** True when the ticket was issued here, not too long ago. */
const ticketIsValid = (ticket, now = Date.now()) => {
  if (typeof ticket !== 'string') return false;
  const [issuedAt, signature] = ticket.split('.');
  if (!/^\d+$/.test(issuedAt || '') || !signature) return false;

  const expected = Buffer.from(sign(issuedAt));
  const given = Buffer.from(signature);
  // Compared in constant time, so the signature cannot be guessed a character
  // at a time from how long each wrong guess takes to refuse.
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;

  const age = now - Number(issuedAt);
  return age >= 0 && age <= MAX_TICKET_AGE_MS;
};

/**
 * Why a sign-up looks automated, or null when it looks like a person.
 * The reason is for the server log only; the visitor is never told which
 * check failed, so a bot learns nothing about what to change.
 */
const reasonToBlock = ({ website, formToken, elapsedMs } = {}, now = Date.now()) => {
  if (!config.signupGuard) return null;
  if (website) return 'filled the hidden field';
  if (!ticketIsValid(formToken, now)) return 'no valid form ticket';
  if (!(Number(elapsedMs) >= MIN_FILL_MS)) return `submitted ${Number(elapsedMs) || 0}ms after the page loaded`;
  return null;
};

module.exports = { issueTicket, ticketIsValid, reasonToBlock, MIN_FILL_MS, MAX_TICKET_AGE_MS };
