const { describeDatabase } = require('../config');

describe('describeDatabase', () => {
  it('names the database from discrete settings', () => {
    expect(describeDatabase({ database: 'tsv_db' })).toBe('tsv_db');
  });

  it('names the database and host from a connection string', () => {
    expect(describeDatabase({
      connectionString: 'postgresql://user:pw@dpg-abc.oregon-postgres.render.com:5432/tsv_db',
    })).toBe('tsv_db on dpg-abc.oregon-postgres.render.com:5432');
  });

  it('never puts the password in the label', () => {
    // The label goes into deploy logs, which get pasted into issue trackers.
    const label = describeDatabase({
      connectionString: 'postgresql://tsvuser:sup3r-s3cret-pw@db.internal:5432/tsv_db',
    });
    expect(label).not.toContain('sup3r-s3cret-pw');
    expect(label).not.toContain('tsvuser');
  });

  it('falls back to something printable for a string URL cannot parse', () => {
    // libpq also accepts keyword strings, which WHATWG URL rejects.
    expect(describeDatabase({ connectionString: 'host=db.internal dbname=tsv password=pw' }))
      .toBe('the configured database');
  });

  it('survives a connection string with no database name', () => {
    expect(describeDatabase({ connectionString: 'postgresql://u:p@db.internal:5432' }))
      .toBe('db.internal:5432');
  });
});

describe('parseFrontendUrl', () => {
  const { parseFrontendUrl } = require('../config');

  it('reads a single origin', () => {
    expect(parseFrontendUrl('https://www.example.test')).toEqual(['https://www.example.test']);
  });

  it('reads a list, trimming spaces and trailing slashes', () => {
    // How it gets typed into a dashboard by hand.
    expect(parseFrontendUrl(' https://www.example.test/ , https://example.test,https://api.example.test/'))
      .toEqual(['https://www.example.test', 'https://example.test', 'https://api.example.test']);
  });

  it('ignores empty entries', () => {
    expect(parseFrontendUrl('https://a.test,,')).toEqual(['https://a.test']);
    expect(parseFrontendUrl('')).toEqual([]);
  });
});

describe('emailed links with several origins configured', () => {
  it('point at the first origin only', () => {
    const config = require('../config');
    const { templates } = require('../services/email');
    const saved = config.publicUrl;

    // The shape FRONTEND_URL takes once the site and the backend live at
    // different addresses. Glued together whole, this produced
    // "https://www.example.test,https://api.example.test/tickets/12".
    [config.publicUrl] = config.parseFrontendUrl(
      'https://www.example.test, https://api.example.test',
    );
    const { html } = templates.ticket_created({
      ticket: { id: 12, ticket_number: 'TSV-1', title: 'Gate', priority: 'low', status: 'open' },
    });

    config.publicUrl = saved;
    expect(html).toContain('href="https://www.example.test/tickets/12"');
    expect(html).not.toContain('api.example.test');
  });
});
