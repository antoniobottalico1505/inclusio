const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    String(process.env.PGSSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false
});

function baseDbShape() {
  return {
    interests: [],
    users: [],
    groups: [],
    checkins: [],
    reports: [],
    waitlist: [],
    partnerLeads: [],
    subscriptions: [],
    organizations: [],
    sessions: [],
    emailVerifications: [],
    passwordResets: [],
    marketing: {
      plans: [],
      faqs: []
    }
  };
}

function normalizeDb(raw = {}) {
  const base = baseDbShape();
  return {
    ...base,
    ...raw,
    interests: Array.isArray(raw.interests) ? raw.interests : [],
    users: Array.isArray(raw.users) ? raw.users : [],
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    checkins: Array.isArray(raw.checkins) ? raw.checkins : [],
    reports: Array.isArray(raw.reports) ? raw.reports : [],
    waitlist: Array.isArray(raw.waitlist) ? raw.waitlist : [],
    partnerLeads: Array.isArray(raw.partnerLeads) ? raw.partnerLeads : [],
    subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
    organizations: Array.isArray(raw.organizations) ? raw.organizations : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    emailVerifications: Array.isArray(raw.emailVerifications) ? raw.emailVerifications : [],
    passwordResets: Array.isArray(raw.passwordResets) ? raw.passwordResets : [],
    marketing: raw.marketing && typeof raw.marketing === 'object'
      ? {
          plans: Array.isArray(raw.marketing.plans) ? raw.marketing.plans : [],
          faqs: Array.isArray(raw.marketing.faqs) ? raw.marketing.faqs : []
        }
      : { plans: [], faqs: [] }
  };
}

async function ensureStateRow() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO app_state (id, payload)
    VALUES (
      1,
      jsonb_build_object(
        'interests', '[]'::jsonb,
        'users', '[]'::jsonb,
        'groups', '[]'::jsonb,
        'checkins', '[]'::jsonb,
        'reports', '[]'::jsonb,
        'waitlist', '[]'::jsonb,
        'partnerLeads', '[]'::jsonb,
        'subscriptions', '[]'::jsonb,
        'organizations', '[]'::jsonb,
        'sessions', '[]'::jsonb,
        'emailVerifications', '[]'::jsonb,
        'passwordResets', '[]'::jsonb,
        'marketing', jsonb_build_object('plans', '[]'::jsonb, 'faqs', '[]'::jsonb)
      )
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

async function readDb() {
  const { rows } = await pool.query('SELECT payload FROM app_state WHERE id = 1');
  return normalizeDb(rows[0]?.payload || baseDbShape());
}

async function writeDb(db) {
  await pool.query(
    `
      INSERT INTO app_state (id, payload, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [JSON.stringify(normalizeDb(db))]
  );
}

module.exports = { pool, ensureStateRow, readDb, writeDb, normalizeDb, baseDbShape };