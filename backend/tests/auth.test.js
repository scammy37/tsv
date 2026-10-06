const { app, db, request, uniqueEmail, resetDatabase, createUser } = require('./helpers');

beforeEach(resetDatabase);
afterAll(() => db.pool.end());

describe('POST /api/auth/register', () => {
  it('registers a homeowner and returns a usable token', async () => {
    const email = uniqueEmail('homeowner');
    const res = await request(app).post('/api/auth/register').send({
      email,
      password: 'Password123!',
      firstName: 'Dana',
      lastName: 'Reyes',
      unitNumber: '4B',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: 'homeowner', unitNumber: '4B' });
    expect(res.body.user).not.toHaveProperty('password_hash');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/register').send({
      email: user.email.toUpperCase(),
      password: 'Password123!',
      firstName: 'Copy',
      lastName: 'Cat',
    });

    expect(res.status).toBe(409);
  });

  it('rejects a short password with field-level detail', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: uniqueEmail(), password: 'short', firstName: 'A', lastName: 'B',
    });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('password');
  });

  it('refuses a management role without the invite code', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: uniqueEmail('mgmt'),
      password: 'Password123!',
      firstName: 'Mal',
      lastName: 'Ory',
      role: 'management',
      staffInviteCode: 'wrong-code',
    });

    expect(res.status).toBe(403);
  });

  it('allows a management role with the correct invite code', async () => {
    const manager = await createUser({ role: 'management' });
    expect(manager.role).toBe('management');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for correct credentials', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('rejects a wrong password', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: 'NotThePassword1!' });

    expect(res.status).toBe(401);
  });

  it('gives the same answer for an unknown account as for a wrong password', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect email or password');
  });

  it('refuses a deactivated account', async () => {
    const user = await createUser();
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(403);
  });
});

describe('authentication middleware', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('stops working as soon as the account is deactivated', async () => {
    const user = await createUser();
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await request(app).get('/api/auth/me').set('Authorization', user.auth());
    expect(res.status).toBe(403);
  });
});

describe('profile management', () => {
  it('updates the caller profile', async () => {
    const user = await createUser();
    const res = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ phone: '555-0100', unitNumber: '12C' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone: '555-0100', unitNumber: '12C' });
  });

  it('changes the password and invalidates the old one', async () => {
    const user = await createUser();
    const change = await request(app).post('/api/auth/change-password')
      .set('Authorization', user.auth())
      .send({ currentPassword: user.password, newPassword: 'BrandNewPass1!' });

    expect(change.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: 'BrandNewPass1!' });
    expect(newLogin.status).toBe(200);
  });

  it('refuses a password change with the wrong current password', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', user.auth())
      .send({ currentPassword: 'WrongPassword1!', newPassword: 'BrandNewPass1!' });

    expect(res.status).toBe(400);
  });
});

describe('changing your own email address', () => {
  it('moves the login to the new address and keeps the caller signed in', async () => {
    const user = await createUser();
    const next = uniqueEmail('moved');

    const res = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ email: next, currentPassword: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(next);

    // The response carries a replacement token because the change signed out
    // every session, including the one that made the request.
    expect(res.body.token).toEqual(expect.any(String));
    const after = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(after.status).toBe(200);

    const newLogin = await request(app).post('/api/auth/login')
      .send({ email: next, password: user.password });
    expect(newLogin.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);
  });

  it('signs out the sessions that predate the change', async () => {
    const user = await createUser();
    const before = await request(app).get('/api/auth/me').set('Authorization', user.auth());
    expect(before.status).toBe(200);

    await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ email: uniqueEmail('moved'), currentPassword: user.password });

    const after = await request(app).get('/api/auth/me').set('Authorization', user.auth());
    expect(after.status).toBe(401);
  });

  it('refuses without the current password, and with the wrong one', async () => {
    const user = await createUser();

    const missing = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth()).send({ email: uniqueEmail('nope') });
    expect(missing.status).toBe(400);

    const wrong = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ email: uniqueEmail('nope'), currentPassword: 'WrongPassword1!' });
    expect(wrong.status).toBe(400);

    const me = await request(app).get('/api/auth/me').set('Authorization', user.auth());
    expect(me.body.user.email).toBe(user.email);
  });

  it('refuses an address another account already holds, and says so', async () => {
    const [user, other] = [await createUser(), await createUser()];

    const res = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ email: other.email, currentPassword: user.password });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('leaves the other details editable without a password', async () => {
    const user = await createUser();
    const res = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ phone: '555-0199' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    // Still the session it was made with.
    const me = await request(app).get('/api/auth/me').set('Authorization', user.auth());
    expect(me.status).toBe(200);
  });

  it('treats the caller\'s own address as a no-op, password or not', async () => {
    const user = await createUser();
    const res = await request(app).patch('/api/auth/me')
      .set('Authorization', user.auth())
      .send({ email: user.email.toUpperCase(), phone: '555-0123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.phone).toBe('555-0123');
  });
});

describe('new-account notice', () => {
  const emailService = require('../services/email');
  const config = require('../config');

  // Creating the managers registers them too, and that fires this very
  // notification. Clear the log so each test reads only the signup it is about.
  const registerAndCollect = async () => {
    await emailService.flush();
    await db.query('DELETE FROM email_logs');

    await request(app).post('/api/auth/register').send({
      email: uniqueEmail('newcomer'),
      password: 'Password123!',
      firstName: 'Nina',
      lastName: 'Okafor',
      unitNumber: '12 Pondview Terrace',
    });

    await emailService.flush();
    const { rows } = await db.query(
      "SELECT recipient_email, subject FROM email_logs WHERE template = 'user_registered'",
    );
    return rows;
  };

  afterEach(() => { config.mail.adminNotify = ''; });

  it('tells every active manager, and nobody who was deactivated', async () => {
    const manager = await createUser({ role: 'management' });
    const former = await createUser({ role: 'management' });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [former.id]);

    const rows = await registerAndCollect();

    expect(rows.map((r) => r.recipient_email)).toEqual([manager.email]);
    expect(rows[0].subject).toBe('New account: Nina Okafor');
  });

  it('copies ADMIN_NOTIFY_EMAIL, which need not have an account here', async () => {
    const manager = await createUser({ role: 'management' });
    config.mail.adminNotify = 'watcher@example.test';

    const rows = await registerAndCollect();

    expect(rows.map((r) => r.recipient_email).sort())
      .toEqual([manager.email, 'watcher@example.test'].sort());
  });

  it('reaches somebody even before any management account exists', async () => {
    config.mail.adminNotify = 'watcher@example.test';

    const rows = await registerAndCollect();

    expect(rows.map((r) => r.recipient_email)).toEqual(['watcher@example.test']);
  });

  it('sends one copy when ADMIN_NOTIFY_EMAIL is a manager, whatever the case', async () => {
    const manager = await createUser({ role: 'management' });
    config.mail.adminNotify = manager.email.toUpperCase();

    const rows = await registerAndCollect();

    expect(rows.map((r) => r.recipient_email)).toEqual([manager.email]);
  });
});

describe('sign-up bot checks', () => {
  const config = require('../config');
  const signupGuard = require('../services/signupGuard');
  const emailService = require('../services/email');

  beforeEach(() => { config.signupGuard = true; });
  afterEach(() => { config.signupGuard = false; });

  // What the real page sends: a ticket it fetched on load, an empty hidden
  // field, and how long the form was open.
  const human = async (overrides = {}) => {
    const { body } = await request(app).get('/api/auth/signup-token');
    return {
      email: uniqueEmail('resident'),
      password: 'Password123!',
      firstName: 'Nina',
      lastName: 'Okafor',
      unitNumber: '12 Pondview Terrace',
      website: '',
      formToken: body.token,
      elapsedMs: 25000,
      ...overrides,
    };
  };

  const register = (payload) => request(app).post('/api/auth/register').send(payload);
  const accountExists = async (address) => (
    (await db.query('SELECT 1 FROM users WHERE email = $1', [address])).rowCount > 0
  );

  it('lets a person through', async () => {
    const payload = await human();
    const res = await register(payload);
    expect(res.status).toBe(201);
    expect(await accountExists(payload.email)).toBe(true);
  });

  it('turns away a bot that fills the hidden field', async () => {
    const payload = await human({ website: 'http://spam.example' });
    const res = await register(payload);
    expect(res.status).toBe(400);
    expect(await accountExists(payload.email)).toBe(false);
  });

  it('turns away a bot that submits faster than anyone can type', async () => {
    const payload = await human({ elapsedMs: 600 });
    expect((await register(payload)).status).toBe(400);
    expect(await accountExists(payload.email)).toBe(false);
  });

  it('turns away a bot that posts to the API without loading the page', async () => {
    const payload = await human();
    delete payload.formToken;
    delete payload.elapsedMs;
    delete payload.website;
    expect((await register(payload)).status).toBe(400);
    expect(await accountExists(payload.email)).toBe(false);
  });

  it('turns away a forged or stale ticket', async () => {
    const forged = await human({ formToken: `${Date.now()}.not-a-real-signature` });
    expect((await register(forged)).status).toBe(400);

    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    const stale = await human({ formToken: signupGuard.issueTicket(sevenHoursAgo) });
    expect((await register(stale)).status).toBe(400);
  });

  it('never tells the visitor which check failed', async () => {
    const res = await register(await human({ website: 'x' }));
    expect(res.body.error).not.toMatch(/hidden|honeypot|ticket|token|fast|ms/i);
  });

  it('sends no new-account alert for a blocked sign-up', async () => {
    await emailService.flush();
    await db.query('DELETE FROM email_logs');
    await register(await human({ website: 'x' }));
    await emailService.flush();
    const { rows } = await db.query("SELECT 1 FROM email_logs WHERE template = 'user_registered'");
    expect(rows).toHaveLength(0);
  });
});
