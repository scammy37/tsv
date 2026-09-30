const {
  app, db, request, uniqueEmail, resetDatabase, createUser, createTicket,
} = require('./helpers');

let homeowner;
let staff;
let manager;

beforeEach(async () => {
  await resetDatabase();
  [homeowner, staff, manager] = await Promise.all([
    createUser({ role: 'homeowner' }),
    createUser({ role: 'staff' }),
    createUser({ role: 'management' }),
  ]);
});

afterAll(() => db.pool.end());

describe('GET /api/users/assignable', () => {
  it('lists staff and management with their open workload', async () => {
    const ticket = await createTicket(homeowner);
    await request(app).post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', manager.auth()).send({ assignedTo: staff.id });

    const res = await request(app).get('/api/users/assignable').set('Authorization', staff.auth());

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users.every((u) => u.role !== 'homeowner')).toBe(true);
    expect(res.body.users.find((u) => u.id === staff.id).openTicketCount).toBe(1);
  });

  it('is closed to homeowners', async () => {
    const res = await request(app).get('/api/users/assignable').set('Authorization', homeowner.auth());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users', () => {
  it('lists the directory for management', async () => {
    const res = await request(app).get('/api/users').set('Authorization', manager.auth());

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.pagination.total).toBe(3);
  });

  it('filters by role and search term', async () => {
    const byRole = await request(app).get('/api/users?role=homeowner')
      .set('Authorization', manager.auth());
    expect(byRole.body.users).toHaveLength(1);

    const bySearch = await request(app).get(`/api/users?q=${encodeURIComponent(staff.email)}`)
      .set('Authorization', manager.auth());
    expect(bySearch.body.users).toHaveLength(1);
    expect(bySearch.body.users[0].id).toBe(staff.id);
  });

  it('is closed to staff and homeowners', async () => {
    const asStaff = await request(app).get('/api/users').set('Authorization', staff.auth());
    expect(asStaff.status).toBe(403);

    const asHomeowner = await request(app).get('/api/users').set('Authorization', homeowner.auth());
    expect(asHomeowner.status).toBe(403);
  });

  it('hides deactivated users unless asked for', async () => {
    await request(app).patch(`/api/users/${staff.id}`)
      .set('Authorization', manager.auth()).send({ isActive: false });

    const active = await request(app).get('/api/users').set('Authorization', manager.auth());
    expect(active.body.users).toHaveLength(2);

    const all = await request(app).get('/api/users?includeInactive=true')
      .set('Authorization', manager.auth());
    expect(all.body.users).toHaveLength(3);
  });
});

describe('PATCH /api/users/:id', () => {
  it('promotes a homeowner to staff', async () => {
    const res = await request(app).patch(`/api/users/${homeowner.id}`)
      .set('Authorization', manager.auth()).send({ role: 'staff' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('staff');
  });

  it('deactivates an account, locking out its existing token', async () => {
    await request(app).patch(`/api/users/${staff.id}`)
      .set('Authorization', manager.auth()).send({ isActive: false });

    const res = await request(app).get('/api/auth/me').set('Authorization', staff.auth());
    expect(res.status).toBe(403);
  });

  it('stops a manager deactivating or demoting themselves', async () => {
    const deactivate = await request(app).patch(`/api/users/${manager.id}`)
      .set('Authorization', manager.auth()).send({ isActive: false });
    expect(deactivate.status).toBe(400);

    const demote = await request(app).patch(`/api/users/${manager.id}`)
      .set('Authorization', manager.auth()).send({ role: 'staff' });
    expect(demote.status).toBe(400);
  });

  it('returns 404 for a user that does not exist', async () => {
    const res = await request(app).patch('/api/users/999999')
      .set('Authorization', manager.auth()).send({ role: 'staff' });
    expect(res.status).toBe(404);
  });

  it('corrects a homeowner email address, and the new one is the login', async () => {
    const next = uniqueEmail('corrected');
    const res = await request(app).patch(`/api/users/${homeowner.id}`)
      .set('Authorization', manager.auth()).send({ email: next });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(next);

    const login = await request(app).post('/api/auth/login')
      .send({ email: next, password: homeowner.password });
    expect(login.status).toBe(200);
  });

  it('refuses an address another account already holds, and says so', async () => {
    const res = await request(app).patch(`/api/users/${homeowner.id}`)
      .set('Authorization', manager.auth()).send({ email: manager.email });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });
});

describe('DELETE /api/users/:id', () => {
  it('removes an account that has no ticket history', async () => {
    const res = await request(app).delete(`/api/users/${staff.id}`)
      .set('Authorization', manager.auth());
    expect(res.status).toBe(204);

    const directory = await request(app).get('/api/users?includeInactive=true')
      .set('Authorization', manager.auth());
    expect(directory.body.users.map((u) => u.id)).not.toContain(staff.id);
  });

  it('stops the token of a deleted account working', async () => {
    await request(app).delete(`/api/users/${staff.id}`).set('Authorization', manager.auth());

    const res = await request(app).get('/api/auth/me').set('Authorization', staff.auth());
    expect(res.status).toBe(401);
  });

  it('refuses an account that appears on a ticket, and says why', async () => {
    await createTicket(homeowner);

    const res = await request(app).delete(`/api/users/${homeowner.id}`)
      .set('Authorization', manager.auth());

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/1 ticket\b/);
    expect(res.body.error).toMatch(/[Dd]eactivate/);

    // The refusal leaves the account exactly as it was.
    const still = await request(app).get(`/api/users/${homeowner.id}`)
      .set('Authorization', manager.auth());
    expect(still.status).toBe(200);
    expect(still.body.user.isActive).toBe(true);
  });

  it('leaves a deleted assignee\'s tickets standing, unassigned', async () => {
    const ticket = await createTicket(homeowner);
    await request(app).post(`/api/tickets/${ticket.id}/assign`)
      .set('Authorization', manager.auth()).send({ assignedTo: staff.id });

    const res = await request(app).delete(`/api/users/${staff.id}`)
      .set('Authorization', manager.auth());
    expect(res.status).toBe(204);

    const after = await request(app).get(`/api/tickets/${ticket.id}`)
      .set('Authorization', manager.auth());
    expect(after.status).toBe(200);
    expect(after.body.ticket.assignee).toBeNull();
  });

  it('stops a manager deleting themselves', async () => {
    const res = await request(app).delete(`/api/users/${manager.id}`)
      .set('Authorization', manager.auth());
    expect(res.status).toBe(400);
  });

  it('returns 404 for a user that does not exist', async () => {
    const res = await request(app).delete('/api/users/999999')
      .set('Authorization', manager.auth());
    expect(res.status).toBe(404);
  });

  it('is closed to staff and homeowners', async () => {
    const asStaff = await request(app).delete(`/api/users/${homeowner.id}`)
      .set('Authorization', staff.auth());
    expect(asStaff.status).toBe(403);

    const asHomeowner = await request(app).delete(`/api/users/${staff.id}`)
      .set('Authorization', homeowner.auth());
    expect(asHomeowner.status).toBe(403);
  });
});

describe('GET /api/meta', () => {
  it('returns the categories, priorities and statuses the UI renders', async () => {
    const res = await request(app).get('/api/meta').set('Authorization', homeowner.auth());

    expect(res.status).toBe(200);
    const slugs = res.body.categories.map((c) => c.slug);
    expect(slugs).toContain('common_area');
    // Retired categories stay in the table for the tickets already filed under
    // them, but must never reach a dropdown again.
    expect(slugs).not.toContain('plumbing');
    expect(res.body.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'high', label: 'High' }),
    ]));
    expect(res.body.statuses.find((s) => s.value === 'open').next).toContain('in_progress');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/meta');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users/:id/reset-password', () => {
  it('issues a working temporary password and retires the old one', async () => {
    const res = await request(app)
      .post(`/api/users/${homeowner.id}/reset-password`)
      .set('Authorization', manager.auth());

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(res.body.user.mustChangePassword).toBe(true);

    const withOld = await request(app).post('/api/auth/login')
      .send({ email: homeowner.email, password: homeowner.password });
    expect(withOld.status).toBe(401);

    const withTemp = await request(app).post('/api/auth/login')
      .send({ email: homeowner.email, password: res.body.temporaryPassword });
    expect(withTemp.status).toBe(200);
    expect(withTemp.body.user.mustChangePassword).toBe(true);
  });

  it('never returns the same temporary password twice', async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post(`/api/users/${homeowner.id}/reset-password`)
        .set('Authorization', manager.auth());
      seen.add(res.body.temporaryPassword);
    }
    expect(seen.size).toBe(5);
  });

  it('confines the account to changing its password until it does', async () => {
    const { body } = await request(app)
      .post(`/api/users/${homeowner.id}/reset-password`)
      .set('Authorization', manager.auth());

    const login = await request(app).post('/api/auth/login')
      .send({ email: homeowner.email, password: body.temporaryPassword });
    const auth = `Bearer ${login.body.token}`;

    // Everything else is refused...
    const tickets = await request(app).get('/api/tickets').set('Authorization', auth);
    expect(tickets.status).toBe(403);
    const profile = await request(app).patch('/api/auth/me')
      .set('Authorization', auth).send({ firstName: 'Nope' });
    expect(profile.status).toBe(403);

    // ...except reading itself, which the client needs to render the screen.
    const me = await request(app).get('/api/auth/me').set('Authorization', auth);
    expect(me.status).toBe(200);

    const changed = await request(app).post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ currentPassword: body.temporaryPassword, newPassword: 'BrandNewPass1!' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    // The token handed back by the change is a working session.
    const after = await request(app).get('/api/tickets')
      .set('Authorization', `Bearer ${changed.body.token}`);
    expect(after.status).toBe(200);
  });

  it('signs out sessions opened before the reset', async () => {
    const before = await request(app).get('/api/tickets').set('Authorization', homeowner.auth());
    expect(before.status).toBe(200);

    await request(app).post(`/api/users/${homeowner.id}/reset-password`)
      .set('Authorization', manager.auth());

    const after = await request(app).get('/api/tickets').set('Authorization', homeowner.auth());
    expect(after.status).toBe(401);
  });

  it('signs out a session opened in the same second as the change', async () => {
    // The reason sessions are pinned to a counter rather than to a timestamp.
    // JWT `iat` is whole seconds, so this token and the change that follows it
    // are indistinguishable by time, and a time comparison has to let one of
    // them through. Everything here happens well inside one second.
    const { body } = await request(app)
      .post(`/api/users/${homeowner.id}/reset-password`)
      .set('Authorization', manager.auth());

    const login = await request(app).post('/api/auth/login')
      .send({ email: homeowner.email, password: body.temporaryPassword });
    const tempSession = `Bearer ${login.body.token}`;

    const changed = await request(app).post('/api/auth/change-password')
      .set('Authorization', tempSession)
      .send({ currentPassword: body.temporaryPassword, newPassword: 'AnotherPass1!' });
    expect(changed.status).toBe(200);

    // The session that did the changing is replaced, not preserved.
    const reused = await request(app).get('/api/tickets').set('Authorization', tempSession);
    expect(reused.status).toBe(401);

    const fresh = await request(app).get('/api/tickets')
      .set('Authorization', `Bearer ${changed.body.token}`);
    expect(fresh.status).toBe(200);
  });

  it('leaves sessions alone that carry no generation, as pre-upgrade ones do', async () => {
    const jwt = require('jsonwebtoken');
    const config = require('../config');

    // A token minted before token_version existed has no tv claim. It has to
    // keep working, or deploying this would sign out every signed-in resident.
    const legacy = jwt.sign(
      { sub: homeowner.id, role: homeowner.role },
      config.jwt.secret,
      { expiresIn: '7d' },
    );
    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${legacy}`);
    expect(res.status).toBe(200);
  });

  it('invalidates an outstanding emailed reset link', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: homeowner.email });
    const { rows } = await db.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [homeowner.id],
    );
    expect(rows).toHaveLength(1);

    await request(app).post(`/api/users/${homeowner.id}/reset-password`)
      .set('Authorization', manager.auth());

    const { rows: after } = await db.query(
      'SELECT * FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [homeowner.id],
    );
    expect(after).toHaveLength(0);
  });

  it('is closed to homeowners and to staff', async () => {
    for (const actor of [homeowner, staff]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post(`/api/users/${homeowner.id}/reset-password`)
        .set('Authorization', actor.auth());
      expect(res.status).toBe(403);
    }
  });

  it('refuses to reset the caller\'s own password', async () => {
    const res = await request(app).post(`/api/users/${manager.id}/reset-password`)
      .set('Authorization', manager.auth());
    expect(res.status).toBe(400);
  });

  it('404s for an account that does not exist', async () => {
    const res = await request(app).post('/api/users/999999/reset-password')
      .set('Authorization', manager.auth());
    expect(res.status).toBe(404);
  });
});
