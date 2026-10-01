#!/usr/bin/env node
/**
 * Proves the SMTP configuration, and optionally sends a real test message:
 *
 *   npm run check:email
 *   npm run check:email -- you@example.com
 *
 * Run this before go-live. Until it passes, no notification this app reports
 * as sent has actually left the building.
 */
const config = require('../config');
const email = require('../services/email');
const db = require('../db/connection');

async function main() {
  const recipient = process.argv[2];

  console.log(`Transport: ${email.describeTransport()}`);
  console.log(`From:      ${config.mail.from}`);
  console.log('');

  const result = await email.verify();

  if (!result.configured) {
    console.log('SMTP is not configured.');
    console.log("Notifications are recorded in email_logs with status 'skipped' and never sent.");
    console.log('Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to enable delivery.');
    return 1;
  }

  if (!result.ok) {
    console.error(`Connection failed: ${result.reason}`);
    console.error('For Gmail, SMTP_PASS must be an App Password, not the account password.');
    return 1;
  }

  console.log('Connection OK.');

  if (!recipient) {
    console.log('\nPass an address to send a real test message:');
    console.log('  npm run check:email -- you@example.com');
    return 0;
  }

  console.log(`\nSending a test message to ${recipient}...`);
  const sent = await email.send('password_reset', recipient, {
    user: { first_name: 'there' },
    resetUrl: `${config.publicUrl}/login`,
    ttlMinutes: 60,
  });

  if (sent.status === 'sent') {
    console.log('Sent. Check the inbox (and the spam folder).');
    return 0;
  }
  console.error(`Send reported: ${sent.status}`);
  return 1;
}

main()
  .then(async (code) => { await db.pool.end(); process.exit(code); })
  .catch(async (err) => {
    console.error('Check failed:', err.message);
    await db.pool.end();
    process.exit(1);
  });
