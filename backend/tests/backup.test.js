const http = require('http');

const { db, resetDatabase, createUser, createTicket } = require('./helpers');
const config = require('../config');
const backup = require('../services/backup');
const email = require('../services/email');

// A stand-in for api.resend.com that keeps what it was sent.
let stub;
const sent = [];
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/emails') sent.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg', data: [] }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  config.resend.apiKey = 're_test';
  config.resend.apiBase = `http://127.0.0.1:${stub.address().port}`;
  config.mail.adminNotify = 'owner@example.test';
});
afterAll(async () => {
  config.resend.apiKey = '';
  config.mail.adminNotify = '';
  await new Promise((r) => stub.close(r));
  await db.pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await email.flush();
  sent.length = 0;
});

const backups = () => sent.filter((m) => /^Backup of /.test(m.subject));
const attached = (m) => JSON.parse(Buffer.from(m.attachments[0].content, 'base64').toString());

describe('emailBackupOnce', () => {
  it('emails the whole database, as a file a restore can read', async () => {
    const homeowner = await createUser();
    const ticket = await createTicket(homeowner);
    await email.flush(); sent.length = 0;

    const result = await backup.emailBackupOnce('2026-10-13');

    expect(result.status).toBe('sent');
    expect(backups()).toHaveLength(1);
    const [message] = backups();
    expect(message.to).toEqual(['owner@example.test']);
    expect(message.subject).toMatch(/^Backup of .* — tsv-.*\.json \(requested 2026-10-13\)$/);

    const file = attached(message);
    expect(file.tables.users.map((u) => u.email)).toContain(homeowner.email);
    expect(file.tables.tickets.map((t) => t.id)).toEqual([ticket.id]);
    expect(file.tables.users[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(file.sequences.ticket_number_seq).toBeDefined();
  });

  it('sends a given request once, however often the server restarts', async () => {
    await backup.emailBackupOnce('2026-10-13');
    const again = await backup.emailBackupOnce('2026-10-13');
    expect(again.status).toBe('already-sent');
    expect(backups()).toHaveLength(1);
  });

  it('sends again for a new request', async () => {
    await backup.emailBackupOnce('2026-10-13');
    await backup.emailBackupOnce('2026-11-02');
    expect(backups()).toHaveLength(2);
  });

  it('retries a request whose send failed', async () => {
    await db.query(
      `INSERT INTO email_logs (recipient_email, template, status, subject)
       VALUES ('owner@example.test', 'database_backup', 'failed', 'Backup of x (requested 2026-10-13)')`,
    );
    expect((await backup.emailBackupOnce('2026-10-13')).status).toBe('sent');
  });

  it('does nothing with nowhere to send it', async () => {
    config.mail.adminNotify = '';
    expect((await backup.emailBackupOnce('2026-10-13')).status).toBe('skipped');
    config.mail.adminNotify = 'owner@example.test';
    expect(backups()).toHaveLength(0);
  });
});
