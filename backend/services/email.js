const nodemailer = require('nodemailer');

const config = require('../config');
const db = require('../db/connection');
const { PRIORITY_LABELS, STATUS_LABELS } = require('../constants');
const resend = require('./mailers/resend');

let transporter;
let warnedUnconfigured = false;

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** True when there is enough configuration to actually send mail, either way. */
const isConfigured = () => Boolean(config.resend.apiKey || (config.smtp.host && config.smtp.user));

/** Which transport is in play, for log lines and `npm run check:email`. */
const describeTransport = () => {
  if (config.resend.apiKey) return 'Resend over HTTPS';
  if (config.smtp.host) return `SMTP ${config.smtp.host}:${config.smtp.port}`;
  return 'none';
};

// Built lazily so importing this module never opens a connection, and so tests
// can run without any SMTP configuration at all.
const getTransporter = () => {
  if (!isConfigured()) return null;
  if (!transporter) {
    if (config.resend.apiKey) {
      // Resend wins when both are set. A host that needs the HTTP API is one
      // where SMTP cannot work, so falling back to it would only produce the
      // timeouts we are here to escape.
      transporter = resend.createMailer({
        apiKey: config.resend.apiKey,
        apiBase: config.resend.apiBase,
      });
      return transporter;
    }

    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },

      // Nodemailer waits two minutes on a connection by default. Where a host
      // blocks the SMTP port -- which is silence rather than a refusal -- that
      // makes the boot check appear to print nothing at all for two minutes,
      // and it is the first thing anyone looks at when mail is not arriving.
      // Ten seconds is far longer than a reachable server needs and short
      // enough that the verdict is in the log while someone is still reading.
      connectionTimeout: int(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10000),
      greetingTimeout: int(process.env.SMTP_GREETING_TIMEOUT_MS, 10000),
      socketTimeout: int(process.env.SMTP_SOCKET_TIMEOUT_MS, 30000),
    });
  }
  return transporter;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ticketUrl = (ticket) => `${config.frontendUrl}/tickets/${ticket.id}`;

const layout = (heading, bodyHtml, ticket) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
              max-width:560px;margin:0 auto;color:#1f2430;line-height:1.5">
    <h2 style="margin:0 0 4px">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 20px;color:#67707f;font-size:14px">
      ${escapeHtml(config.appName)}
    </p>
    ${bodyHtml}
    ${ticket ? `
      <p style="margin:24px 0 0">
        <a href="${ticketUrl(ticket)}"
           style="background:#2f6fed;color:#fff;text-decoration:none;
                  padding:10px 18px;border-radius:6px;display:inline-block">
          Open request ${escapeHtml(ticket.ticket_number)} to reply
        </a>
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#67707f">
        Replying there keeps your message with the request, where everyone
        working on it sees it alongside the rest of the history.
      </p>` : ''}
    <p style="margin:28px 0 0;font-size:12px;color:#8a94a6">
      Sent automatically by ${escapeHtml(config.appName)} from an address that
      is not monitored &mdash; replies to this email will not reach anyone.
      ${ticket
    ? 'Use the button above to respond.'
    : `To contact the association office, email <a href="mailto:${escapeHtml(config.mail.office)}"
           style="color:#67707f">${escapeHtml(config.mail.office)}</a>.`}
    </p>
  </div>`;

const detailRows = (ticket) => `
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:3px 16px 3px 0;color:#67707f">Ticket</td>
        <td><strong>${escapeHtml(ticket.ticket_number)}</strong></td></tr>
    <tr><td style="padding:3px 16px 3px 0;color:#67707f">Subject</td>
        <td>${escapeHtml(ticket.title)}</td></tr>
    <tr><td style="padding:3px 16px 3px 0;color:#67707f">Priority</td>
        <td>${escapeHtml(PRIORITY_LABELS[ticket.priority] || ticket.priority)}</td></tr>
    <tr><td style="padding:3px 16px 3px 0;color:#67707f">Status</td>
        <td>${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</td></tr>
  </table>`;

const infoRow = (label, value) => (value
  ? `<tr><td style="padding:3px 16px 3px 0;color:#67707f;vertical-align:top">${escapeHtml(label)}</td>
         <td>${escapeHtml(value)}</td></tr>`
  : '');

/**
 * The association is in New Jersey and the server runs in UTC, so a raw
 * timestamp reads a few hours off to everyone who receives this. Fix it here
 * rather than leaving each reader to do the arithmetic.
 */
const easternTime = (value) => (value
  ? new Date(value).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  : '');

const personRows = (user) => `
  <table style="border-collapse:collapse;font-size:14px">
    ${infoRow('Name', [user.first_name, user.last_name].filter(Boolean).join(' '))}
    ${infoRow('Email', user.email)}
    ${infoRow('Address', user.unit_number)}
    ${infoRow('Phone', user.phone)}
    ${infoRow('Role', user.role.charAt(0).toUpperCase() + user.role.slice(1))}
    ${infoRow('Registered', easternTime(user.created_at))}
  </table>`;

// Each template returns { subject, html } for a given ticket + context.
const templates = {
  ticket_created: ({ ticket }) => ({
    subject: `[${ticket.ticket_number}] Request received: ${ticket.title}`,
    html: layout('We received your request', `
      <p>Your service request has been logged and is waiting for review by the
         management team.</p>
      ${detailRows(ticket)}
      `, ticket),
  }),

  ticket_created_internal: ({ ticket, actor }) => ({
    subject: `[${ticket.ticket_number}] New ${ticket.priority} ticket: ${ticket.title}`,
    html: layout('New ticket submitted', `
      <p>${escapeHtml(actor ? `${actor.first_name} ${actor.last_name}` : 'A homeowner')}
         submitted a new request${ticket.unit_number ? ` for unit ${escapeHtml(ticket.unit_number)}` : ''}.</p>
      ${detailRows(ticket)}
      <p style="font-size:14px;white-space:pre-wrap">${escapeHtml(ticket.description)}</p>`, ticket),
  }),

  ticket_assigned: ({ ticket, assignee }) => ({
    subject: `[${ticket.ticket_number}] Assigned to you: ${ticket.title}`,
    html: layout('A ticket was assigned to you', `
      <p>Hi ${escapeHtml(assignee?.first_name || 'there')}, this request is now yours.</p>
      ${detailRows(ticket)}`, ticket),
  }),

  ticket_status_changed: ({ ticket, oldStatus }) => ({
    subject: `[${ticket.ticket_number}] Status: ${STATUS_LABELS[ticket.status] || ticket.status}`,
    html: layout('Your ticket was updated', `
      <p>Status changed from
         <strong>${escapeHtml(STATUS_LABELS[oldStatus] || oldStatus)}</strong> to
         <strong>${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</strong>.</p>
      ${detailRows(ticket)}`, ticket),
  }),

  ticket_closed: ({ ticket }) => ({
    subject: `[${ticket.ticket_number}] Closed: ${ticket.title}`,
    html: layout('Your ticket has been closed', `
      <p>Management marked this request finished and closed it.</p>
      ${ticket.resolution_notes
        ? `<p style="font-size:14px;white-space:pre-wrap"><strong>Resolution:</strong><br>
             ${escapeHtml(ticket.resolution_notes)}</p>`
        : ''}
      ${detailRows(ticket)}
      <p style="font-size:14px;color:#67707f">
        If the issue is not fixed, add a comment and we will reopen it.</p>`, ticket),
  }),

  password_reset: ({ user, resetUrl, ttlMinutes }) => ({
    subject: 'Reset your password',
    html: layout('Reset your password', `
      <p>Hi ${escapeHtml(user.first_name)}, someone asked to reset the password
         for this account.</p>
      <p style="margin:20px 0">
        <a href="${resetUrl}"
           style="background:#2f6fed;color:#fff;text-decoration:none;
                  padding:10px 18px;border-radius:6px;display:inline-block">
          Choose a new password
        </a>
      </p>
      <p style="font-size:14px;color:#67707f">
        This link works once and expires in ${ttlMinutes} minutes. If you did not
        request it, you can ignore this email -- your password will not change.</p>`),
  }),

  user_registered: ({ newUser }) => ({
    subject: `New account: ${newUser.first_name} ${newUser.last_name}`,
    html: layout('A new account was created', `
      <p>Someone has registered on the resident portal. This is a notice only
         &mdash; the account already works and there is nothing to approve.</p>
      ${personRows(newUser)}
      <p style="margin:20px 0 0;font-size:13px;color:#67707f">
        If this is not somebody who lives here, deactivate the account from the
        People page. A deactivated account is signed out immediately.</p>`),
  }),

  ticket_comment: ({ ticket, comment, author }) => ({
    subject: `[${ticket.ticket_number}] New comment on ${ticket.title}`,
    html: layout('New comment on your ticket', `
      <p><strong>${escapeHtml(author ? `${author.first_name} ${author.last_name}` : 'Someone')}</strong>
         wrote:</p>
      <blockquote style="margin:0 0 16px;padding:10px 14px;background:#f4f6fa;
                         border-left:3px solid #2f6fed;font-size:14px;white-space:pre-wrap">
        ${escapeHtml(comment.comment)}</blockquote>
      ${detailRows(ticket)}`, ticket),
  }),
};

const logEmail = async ({ ticketId, to, subject, template, status, error }) => {
  try {
    await db.query(
      `INSERT INTO email_logs (ticket_id, recipient_email, subject, template, status, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ticketId || null, to, subject ? subject.slice(0, 255) : null, template, status, error || null],
    );
  } catch (err) {
    console.error('Failed to write email log:', err.message);
  }
};

/**
 * Renders and sends one notification. Never throws: a notification failure is
 * logged to email_logs and swallowed so it can't fail the API request that
 * triggered it.
 */
const send = async (templateName, to, context = {}) => {
  const build = templates[templateName];
  if (!build) {
    console.error(`Unknown email template: ${templateName}`);
    return { status: 'failed' };
  }
  if (!to) return { status: 'skipped' };

  const { ticket } = context;
  let subject;

  try {
    const rendered = build(context);
    subject = rendered.subject;

    const mailer = getTransporter();
    if (!mailer) {
      if (!warnedUnconfigured && !config.isTest) {
        console.warn('No mail transport is configured -- notifications are logged, not sent.');
        warnedUnconfigured = true;
      }
      await logEmail({ ticketId: ticket?.id, to, subject, template: templateName, status: 'skipped' });
      return { status: 'skipped', subject };
    }

    await mailer.sendMail({ from: config.mail.from, to, subject, html: rendered.html });
    await logEmail({ ticketId: ticket?.id, to, subject, template: templateName, status: 'sent' });
    return { status: 'sent', subject };
  } catch (err) {
    console.error(`Failed to send "${templateName}" to ${to}:`, err.message);
    await logEmail({
      ticketId: ticket?.id, to, subject, template: templateName, status: 'failed', error: err.message,
    });
    return { status: 'failed', subject };
  }
};

// In-flight notifications, so shutdown (and tests) can wait them out.
const pending = new Set();

// Fire-and-forget wrapper for use inside request handlers: the caller responds
// immediately and the notification finishes on its own.
const notify = (templateName, to, context) => {
  const promise = send(templateName, to, context)
    .catch((err) => console.error('Notification error:', err))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  return promise;
};

/** Resolves once every queued notification has settled. */
const flush = async () => {
  while (pending.size) {
    // New notifications can be queued while we wait, so loop until empty.
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled([...pending]);
  }
};

// Everyone who should hear about new or escalating tickets.
const managementRecipients = async () => {
  const { rows } = await db.query(
    "SELECT email FROM users WHERE role = 'management' AND is_active",
  );
  return rows.map((r) => r.email);
};

/**
 * Management, plus whoever ADMIN_NOTIFY_EMAIL names. That address exists so
 * somebody hears about a signup at an inbox they actually watch, which is not
 * necessarily the one their management account is registered under -- and so
 * the notice still arrives before any management account exists at all.
 *
 * Deduplicated case-insensitively: addresses are case-insensitive in practice,
 * and the alternative is the same person getting two copies of everything the
 * day they set this to their own account's address.
 */
const adminRecipients = async () => {
  const recipients = await managementRecipients();
  const extra = config.mail.adminNotify;
  if (extra && !recipients.some((addr) => addr.toLowerCase() === extra.toLowerCase())) {
    recipients.push(extra);
  }
  return recipients;
};

/**
 * Fire-and-forget notification to a whole audience, skipping `exclude`
 * (typically the homeowner, who already got their own copy).
 */
const notifyEach = (recipientsFor, templateName, context, { exclude = [] } = {}) => {
  const promise = recipientsFor()
    .then((recipients) => Promise.allSettled(
      recipients
        .filter((addr) => !exclude.includes(addr))
        .map((addr) => send(templateName, addr, context)),
    ))
    .catch((err) => console.error(`Failed to send "${templateName}":`, err.message))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  return promise;
};

/** Every active manager. */
const notifyManagement = (templateName, context, options) => (
  notifyEach(managementRecipients, templateName, context, options)
);

/** Every active manager, and ADMIN_NOTIFY_EMAIL if one is set. */
const notifyAdmins = (templateName, context, options) => (
  notifyEach(adminRecipients, templateName, context, options)
);

/**
 * Proves the SMTP settings before anything depends on them. Called at boot and
 * by `npm run check:email`, so a misconfiguration surfaces immediately rather
 * than as silently missing notifications weeks later.
 */
const verify = async () => {
  if (!isConfigured()) {
    return {
      ok: false,
      configured: false,
      reason: 'No mail transport configured: set RESEND_API_KEY, or SMTP_HOST and SMTP_USER',
    };
  }
  try {
    const result = await getTransporter().verify();
    // The Resend transport returns a note when a correctly-scoped sending-only
    // key means the check could go no further. Nodemailer just returns true.
    return {
      ok: true,
      configured: true,
      ...(result && result.note ? { note: result.note } : {}),
    };
  } catch (err) {
    return { ok: false, configured: true, reason: err.message };
  }
};

/**
 * Boot-time check. Notifications are best-effort by design, which means a bad
 * password would otherwise fail invisibly -- so say so loudly, and treat it as
 * a misconfiguration in production rather than a normal state.
 */
const verifyAtStartup = async () => {
  const result = await verify();

  if (result.ok) {
    console.log(
      `Email: ready via ${describeTransport()}, sending as ${config.mail.from}`
      + (result.note ? ` (${result.note})` : ''),
    );
    return result;
  }

  if (!result.configured) {
    const message = 'Email: no mail transport is configured. Notifications will be '
      + "recorded in email_logs with status 'skipped' and never delivered.";
    if (config.isProduction) {
      console.error(
        `WARNING -- ${message}\n`
        + '          Set RESEND_API_KEY to send over HTTPS, which is the only option on a\n'
        + '          host that blocks outbound SMTP, or SMTP_HOST, SMTP_USER and SMTP_PASS\n'
        + '          where those ports are open.',
      );
    } else if (!config.isTest) {
      console.warn(message);
    }
    return result;
  }

  // Name what was attempted. Without the host and port in this line there is
  // no way to tell from a log whether a change to either actually took effect,
  // which turns every diagnosis into guesswork about the dashboard.
  if (config.resend.apiKey) {
    console.error(
      `WARNING -- Email: ${describeTransport()} is configured but failed: ${result.reason}\n`
      + '          Notifications will be recorded as failed.\n'
      + '          A 401 means RESEND_API_KEY is wrong or revoked. A rejected sender\n'
      + '          means MAIL_FROM is not on a domain verified with the provider.\n'
      + '          A timeout means outbound HTTPS to the API is blocked, which would be\n'
      + '          unusual -- the app itself is reachable over HTTPS.',
    );
    return result;
  }

  const target = `${config.smtp.host}:${config.smtp.port}`;
  const timedOut = /timeout|ETIMEDOUT|ECONNREFUSED/i.test(result.reason || '');

  console.error(
    `WARNING -- Email: cannot reach ${target} as ${config.smtp.user} -- ${result.reason}\n`
    + '          Notifications will be recorded as failed.\n'
    + (timedOut
      // A timeout is the connection never opening. Credentials are not
      // consulted at that point, so nothing about them can be the cause.
      ? `          A timeout means nothing answered on ${target}. That is the port being\n`
        + '          blocked, by this host or by the network in between -- not a wrong\n'
        + '          password, which fails as "535 authentication failed" instead.\n'
        + '          Try the other port (587 is STARTTLS, 465 is implicit TLS). If both\n'
        + '          time out, this host does not permit outbound SMTP and no mail\n'
        + '          provider or credential will change that.'
      : '          The server answered and rejected us, so the host and port are fine.\n'
        + '          Check SMTP_USER and SMTP_PASS. With IONOS the user is the full\n'
        + '          mailbox address; with Gmail the password must be an App Password.'),
  );
  return result;
};

module.exports = {
  send,
  describeTransport,
  notify,
  notifyManagement,
  notifyAdmins,
  flush,
  verify,
  verifyAtStartup,
  isConfigured,
  templates,
  managementRecipients,
  adminRecipients,
};
