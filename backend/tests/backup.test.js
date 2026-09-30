const http = require('http');

const { db, resetDatabase, createUser, createTicket } = require('./helpers');
const config = require('../config');
const backup = require('../services/backup');
const email = require('../services/email');

/**
 * A stand-in for api.resend.com, so the scheduled backup is exercised over a
 * real HTTP request with a real attachment -- without a key, and without
 * mailing anybody.
 */
const startStub = () => new Promise((resolve) => {
  const sent = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/emails') sent.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `msg_${sent.length}` }));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({
    sent,
    apiBase: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((d) => server.close(d)),
  }));
});

let stub;

beforeAll(async () => {
  stub = await startStub();
  config.resend.apiKey = 're_test_key';
  config.resend.apiBase = stub.apiBase;
  config.mail.adminNotify = 'backups@example.test';
});

afterAll(async () => {
  config.resend.apiKey = '';
  config.mail.adminNotify = '';
  await stub.close();
  await db.pool.end();
});

beforeEach(async () => {
  await resetDatabase();
  await email.flush();
  stub.sent.length = 0;
  config.backupEmailDays = 1;
  config.backupMaxAttachmentBytes = 8 * 1024 * 1024;
});

/**
 * Only the backup messages. Registering the fixtures also mails this address
 * -- a new account notifies ADMIN_NOTIFY_EMAIL -- so the stub sees more than
 * what is under test here.
 */
const backupsSent = () => stub.sent.filter((m) => /^Backup of/.test(m.subject || ''));

/** The JSON the stub received back as the object a restore would read. */
const attachedExport = (message) => JSON.parse(
  Buffer.from(message.attachments[0].content, 'base64').toString('utf8'),
);

describe('scheduled database backup', () => {
  it('emails the database as an attachment when none has been sent', async () => {
    const homeowner = await createUser();
    await createTicket(homeowner);
    await email.flush();

    const result = await backup.maybeEmailBackup();

    expect(result.status).toBe('sent');
    expect(backupsSent()).toHaveLength(1);

    const message = backupsSent()[0];
    expect(message.to).toEqual(['backups@example.test']);
    expect(message.attachments[0].filename).toMatch(/^tsv-.*\.json$/);
  });

  it('attaches a file a restore could actually read', async () => {
    const homeowner = await createUser();
    const ticket = await createTicket(homeowner);
    await email.flush();

    await backup.maybeEmailBackup();
    const payload = attachedExport(backupsSent()[0]);

    expect(payload.tables.users.map((u) => u.email)).toContain(homeowner.email);
    expect(payload.tables.tickets.map((t) => t.id)).toEqual([ticket.id]);
    // The hashes and the sequence are what make it a restore rather than a
    // report: without them nobody can sign in, and ticket numbers repeat.
    expect(payload.tables.users[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(payload.sequences.ticket_number_seq).toBeDefined();
  });

  it('does not send a second one inside the window', async () => {
    await backup.maybeEmailBackup();
    expect(backupsSent()).toHaveLength(1);

    const again = await backup.maybeEmailBackup();
    expect(again.status).toBe('not-due');
    expect(backupsSent()).toHaveLength(1);
  });

  it('sends again once the last one has aged past the window', async () => {
    await backup.maybeEmailBackup();
    await db.query(
      "UPDATE email_logs SET sent_at = now() - interval '2 days' WHERE template = 'database_backup'",
    );

    const result = await backup.maybeEmailBackup();

    expect(result.status).toBe('sent');
    expect(backupsSent()).toHaveLength(2);
  });

  it('only counts a backup that actually went out', async () => {
    // A send that failed leaves a row too. Treating it as "done" would mean
    // one bad day silently costs a whole window's backups.
    await db.query(
      `INSERT INTO email_logs (recipient_email, template, status, subject)
       VALUES ('backups@example.test', 'database_backup', 'failed', 'nope')`,
    );

    const result = await backup.maybeEmailBackup();

    expect(result.status).toBe('sent');
    expect(backupsSent()).toHaveLength(1);
  });

  it('still writes the log row it reads back, so the next run knows', async () => {
    await backup.maybeEmailBackup();

    const { rows } = await db.query(
      "SELECT recipient_email, status FROM email_logs WHERE template = 'database_backup'",
    );
    expect(rows).toEqual([{ recipient_email: 'backups@example.test', status: 'sent' }]);
    expect(await backup.lastBackupEmailAt()).not.toBeNull();
  });

  it('sends the email without the file when the file is too large', async () => {
    config.backupMaxAttachmentBytes = 50;

    const result = await backup.maybeEmailBackup();

    // The point is that something still arrives. A backup that quietly
    // stopped being sent is the failure this whole thing exists to prevent.
    expect(result.status).toBe('sent');
    expect(result.attached).toBe(false);
    expect(backupsSent()[0].attachments).toBeUndefined();
    expect(backupsSent()[0].html).toMatch(/too large to attach/);
  });

  it('does nothing when no address has been given to send to', async () => {
    config.mail.adminNotify = '';

    const result = await backup.maybeEmailBackup();

    expect(result.status).toBe('skipped');
    expect(backupsSent()).toHaveLength(0);
    config.mail.adminNotify = 'backups@example.test';
  });

  it('does nothing when no mail transport is configured', async () => {
    const key = config.resend.apiKey;
    config.resend.apiKey = '';
    email.__resetTransportForTests();

    const result = await backup.maybeEmailBackup();

    expect(result.status).toBe('skipped');
    expect(backupsSent()).toHaveLength(0);

    config.resend.apiKey = key;
    email.__resetTransportForTests();
  });
});
