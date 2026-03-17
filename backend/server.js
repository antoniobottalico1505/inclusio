const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');

const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') === 'true';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_SCHOOL_STARTER_YEARLY = process.env.STRIPE_PRICE_SCHOOL_STARTER_YEARLY || '';
const STRIPE_PRICE_SCHOOL_PRO_YEARLY = process.env.STRIPE_PRICE_SCHOOL_PRO_YEARLY || '';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Stripe webhook non configurato.' });
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const planCode = normalizePlanCode(session.metadata?.planCode);
      const customerEmail = email(session.customer_email || session.metadata?.billingEmail);
      const organization = text(session.metadata?.organization, 120);
      const schoolSize = text(session.metadata?.schoolSize, 60);

      if (['school_starter', 'school_pro'].includes(planCode) && isValidEmail(customerEmail)) {
        const db = readDb();

        const activated = activateSubscriptionRecord(db, {
          email: customerEmail,
          planCode,
          source: 'stripe_checkout',
          organization,
          schoolSize,
          stripeCustomerId: text(session.customer, 80),
          stripeSubscriptionId: text(session.subscription, 80),
          checkoutSessionId: text(session.id, 80)
        });

        writeDb(db);

        await Promise.all([
          safeSendEmail({
            to: OWNER_EMAIL,
            subject: `[Inclusio] Scuola attivata — ${organization || customerEmail}`,
            html: `
              <h2>Pagamento scuola completato</h2>
              <p><strong>Organizzazione:</strong> ${esc(organization || 'Non indicata')}</p>
              <p><strong>Email fatturazione:</strong> ${esc(customerEmail)}</p>
              <p><strong>Piano:</strong> ${esc(activated.planLabel)}</p>
              <p><strong>Dimensione:</strong> ${esc(schoolSize || 'Non indicata')}</p>
              <p><strong>Subscription ID:</strong> ${esc(session.subscription || 'n/d')}</p>
            `
          }),
          safeSendEmail({
            to: customerEmail,
            subject: 'Inclusio — attivazione scuola completata',
            html: `
              <h2>Attivazione completata</h2>
              <p>Ciao,</p>
              <p>il pagamento per <strong>${esc(organization || 'la tua organizzazione')}</strong> è stato registrato correttamente.</p>
              <p><strong>Piano attivo:</strong> ${esc(activated.planLabel)}</p>
              <p><strong>Fascia dimensionale:</strong> ${esc(schoolSize || 'Non indicata')}</p>
              <p><a href="${APP_BASE_URL || '#'}">Vai al sito</a></p>
            `
          })
        ]);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const db = readDb();

      deactivateSubscriptionRecord(db, {
        stripeSubscriptionId: text(subscription.id, 80),
        status: 'canceled'
      });

      writeDb(db);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook failed:', error);
    return res.status(500).json({ error: 'Elaborazione webhook non riuscita.' });
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
});

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.copyFileSync(SEED_PATH, DB_PATH);
  }
}

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
    marketing: {
      plans: [],
      faqs: []
    }
  };
}

function normalizeDb(raw) {
  const base = baseDbShape();

  const db = {
    ...base,
    ...(raw || {}),
    marketing: {
      ...base.marketing,
      ...((raw && raw.marketing) || {})
    }
  };

  db.interests = Array.isArray(db.interests) ? db.interests : [];
  db.users = Array.isArray(db.users) ? db.users : [];
  db.groups = Array.isArray(db.groups) ? db.groups : [];
  db.checkins = Array.isArray(db.checkins) ? db.checkins : [];
  db.reports = Array.isArray(db.reports) ? db.reports : [];
  db.waitlist = Array.isArray(db.waitlist) ? db.waitlist : [];
  db.partnerLeads = Array.isArray(db.partnerLeads) ? db.partnerLeads : [];
  db.subscriptions = Array.isArray(db.subscriptions) ? db.subscriptions : [];
  db.organizations = Array.isArray(db.organizations) ? db.organizations : [];
  db.marketing.plans = Array.isArray(db.marketing.plans) ? db.marketing.plans : [];
  db.marketing.faqs = Array.isArray(db.marketing.faqs) ? db.marketing.faqs : [];

  db.groups = db.groups.map((group) => ({
    ...group,
    tags: Array.isArray(group.tags) ? group.tags : [],
    members: Array.isArray(group.members) ? group.members : [],
    activities: Array.isArray(group.activities)
      ? group.activities.map((activity) => ({
          ...activity,
          rsvps: Array.isArray(activity.rsvps) ? activity.rsvps : []
        }))
      : []
  }));

  db.users = db.users.map((user) => ({
    ...user,
    interests: Array.isArray(user.interests) ? user.interests : [],
    goals: Array.isArray(user.goals) ? user.goals : [],
    joinedGroupIds: Array.isArray(user.joinedGroupIds) ? user.joinedGroupIds : []
  }));

  return db;
}

function readDb() {
  ensureDb();
  const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return normalizeDb(raw);
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(normalizeDb(db), null, 2), 'utf8');
}

function slugify(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function avg(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function text(value, max = 280) {
  return String(value || '').trim().slice(0, max);
}

function email(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value));
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePlanCode(value) {
  const code = String(value || '').trim().toLowerCase();

  if (['plus', 'plus_monthly', 'monthly', 'mensile'].includes(code)) return 'plus_monthly';
  if (['plus_annual', 'annual', 'annuale'].includes(code)) return 'plus_annual';
  if (['school_starter', 'starter', 'scuola_starter'].includes(code)) return 'school_starter';
  if (['school_pro', 'pro', 'scuola_pro'].includes(code)) return 'school_pro';
  if (['custom', 'enterprise', 'campus', 'school_enterprise'].includes(code)) return 'custom';

  return 'solo';
}

function getPlanLabel(planCode = 'solo') {
  const normalized = normalizePlanCode(planCode);

  if (normalized === 'plus_annual') return 'Plus Annuale';
  if (normalized === 'plus_monthly') return 'Plus Mensile';
  if (normalized === 'school_starter') return 'School Starter';
  if (normalized === 'school_pro') return 'School Pro';
  if (normalized === 'custom') return 'Campus / Enterprise';

  return 'Solo';
}

function getPlanEntitlements(planCode = 'solo') {
  const normalized = normalizePlanCode(planCode);

  if (normalized === 'school_starter') {
    return {
      planCode: normalized,
      planLabel: getPlanLabel(normalized),
      isPaid: true,
      isB2B: true,
      orgDashboard: true,
      advancedInsights: true,
      premiumGroups: true,
      premiumActivities: true,
      exports: false,
      multiCampus: false,
      schoolSizeBand: 'fino a 400 studenti'
    };
  }

  if (normalized === 'school_pro') {
    return {
      planCode: normalized,
      planLabel: getPlanLabel(normalized),
      isPaid: true,
      isB2B: true,
      orgDashboard: true,
      advancedInsights: true,
      premiumGroups: true,
      premiumActivities: true,
      exports: true,
      multiCampus: true,
      schoolSizeBand: 'da 401 a 1.200 studenti'
    };
  }

  if (normalized === 'custom') {
    return {
      planCode: normalized,
      planLabel: getPlanLabel(normalized),
      isPaid: true,
      isB2B: true,
      orgDashboard: true,
      advancedInsights: true,
      premiumGroups: true,
      premiumActivities: true,
      exports: true,
      multiCampus: true,
      schoolSizeBand: 'oltre 1.200 studenti / multisede'
    };
  }

  const isPaid = normalized === 'plus_monthly' || normalized === 'plus_annual';

  return {
    planCode: normalized,
    planLabel: getPlanLabel(normalized),
    isPaid,
    isB2B: false,
    orgDashboard: false,
    advancedInsights: isPaid,
    premiumGroups: isPaid,
    premiumActivities: isPaid,
    exports: false,
    multiCampus: false,
    schoolSizeBand: null
  };
}

function getSchoolPriceId(planCode) {
  const normalized = normalizePlanCode(planCode);

  if (normalized === 'school_starter') return STRIPE_PRICE_SCHOOL_STARTER_YEARLY;
  if (normalized === 'school_pro') return STRIPE_PRICE_SCHOOL_PRO_YEARLY;

  return '';
}

function activateSubscriptionRecord(db, payload) {
  const emailValue = email(payload.email);
  const planCode = normalizePlanCode(payload.planCode);
  const now = new Date().toISOString();

  if (!isValidEmail(emailValue)) {
    throw new Error('Email di fatturazione non valida.');
  }

  db.subscriptions.forEach((item) => {
    if (
      email(item.email) === emailValue &&
      String(item.status || '').toLowerCase() === 'active' &&
      normalizePlanCode(item.planCode || item.plan) !== 'solo'
    ) {
      item.status = 'replaced';
      item.replacedAt = now;
    }
  });

  const record = {
    id: makeId('sub'),
    email: emailValue,
    planCode,
    planLabel: getPlanLabel(planCode),
    status: 'active',
    source: text(payload.source, 40) || 'manual',
    organization: text(payload.organization, 120),
    schoolSize: text(payload.schoolSize, 60),
    stripeCustomerId: text(payload.stripeCustomerId, 80),
    stripeSubscriptionId: text(payload.stripeSubscriptionId, 80),
    checkoutSessionId: text(payload.checkoutSessionId, 80),
    createdAt: now,
    activatedAt: now
  };

  db.subscriptions.unshift(record);

  if (['school_starter', 'school_pro', 'custom'].includes(planCode)) {
    const orgKey = slugify(payload.organization || emailValue);
    const current = db.organizations.find(
      (item) => slugify(item.name || item.billingEmail) === orgKey
    );

    if (current) {
      current.name = text(payload.organization, 120) || current.name;
      current.billingEmail = emailValue;
      current.planCode = planCode;
      current.planLabel = getPlanLabel(planCode);
      current.schoolSize = text(payload.schoolSize, 60);
      current.status = 'active';
      current.activatedAt = now;
      current.stripeCustomerId = text(payload.stripeCustomerId, 80);
      current.stripeSubscriptionId = text(payload.stripeSubscriptionId, 80);
    } else {
      db.organizations.unshift({
        id: makeId('org'),
        name: text(payload.organization, 120),
        billingEmail: emailValue,
        planCode,
        planLabel: getPlanLabel(planCode),
        schoolSize: text(payload.schoolSize, 60),
        status: 'active',
        createdAt: now,
        activatedAt: now,
        stripeCustomerId: text(payload.stripeCustomerId, 80),
        stripeSubscriptionId: text(payload.stripeSubscriptionId, 80)
      });
    }
  }

  return record;
}

function deactivateSubscriptionRecord(db, payload) {
  const subscriptionId = text(payload.stripeSubscriptionId, 80);
  const nextStatus = text(payload.status, 20) || 'canceled';
  const now = new Date().toISOString();

  db.subscriptions.forEach((item) => {
    if (subscriptionId && text(item.stripeSubscriptionId, 80) === subscriptionId) {
      item.status = nextStatus;
      item.deactivatedAt = now;
    }
  });

  db.organizations.forEach((item) => {
    if (subscriptionId && text(item.stripeSubscriptionId, 80) === subscriptionId) {
      item.status = nextStatus;
      item.deactivatedAt = now;
    }
  });
}

function getActiveSubscription(db, criteria = {}) {
  const wantedEmail = email(criteria.email);
  const wantedOrg = slugify(criteria.organization || '');

  return [...db.subscriptions]
    .filter((item) => String(item.status || '').toLowerCase() === 'active')
    .filter((item) => {
      const emailMatch = wantedEmail ? email(item.email) === wantedEmail : true;
      const orgMatch = wantedOrg ? slugify(item.organization || '') === wantedOrg : true;
      return emailMatch && orgMatch;
    })
    .sort(
      (a, b) =>
        new Date(b.activatedAt || b.createdAt || 0) - new Date(a.activatedAt || a.createdAt || 0)
    )[0] || null;
}

function getUserById(db, userId) {
  return db.users.find((user) => user.id === userId) || null;
}

function getUserCheckins(db, userId) {
  return db.checkins
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getUserReports(db, userId) {
  return db.reports
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getGroupMemberProfiles(db, group) {
  return (group.members || [])
    .map((memberId) => getUserById(db, memberId))
    .filter(Boolean)
    .map((member) => ({
      id: member.id,
      name: member.name,
      interests: member.interests || [],
      comfort: member.comfort,
      energy: member.energy
    }));
}

function serializeGroup(db, group, currentUserId = null) {
  return {
    ...group,
    memberCount: (group.members || []).length,
    spotsLeft: Math.max(Number(group.sizeLimit || 0) - (group.members || []).length, 0),
    isJoined: currentUserId ? (group.members || []).includes(currentUserId) : false,
    membersPreview: getGroupMemberProfiles(db, group)
  };
}

function scoreGroupForUser(group, user) {
  const groupTags = Array.isArray(group.tags) ? group.tags : [];
  const userInterests = Array.isArray(user.interests) ? user.interests : [];
  const commonInterests = groupTags.filter((tag) => userInterests.includes(tag)).length;
  const comfortGap = Math.abs((group.targetComfort || 3) - (user.comfort || 3));
  const energyGap = Math.abs((group.energy || 3) - (user.energy || 3));
  const spaceBonus = (group.members || []).length < Number(group.sizeLimit || 0) ? 1 : -2;
  const opennessBonus =
    (group.members || []).length <= Math.max(2, Math.floor(Number(group.sizeLimit || 0) / 2))
      ? 0.8
      : 0.25;

  return Number(
    (commonInterests * 3 - comfortGap * 1.1 - energyGap * 0.7 + spaceBonus + opennessBonus).toFixed(2)
  );
}

function recommendGroups(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return [];

  return db.groups
    .filter(
      (group) =>
        !(group.members || []).includes(userId) &&
        (group.members || []).length < Number(group.sizeLimit || 0)
    )
    .map((group) => ({
      ...serializeGroup(db, group, userId),
      matchScore: scoreGroupForUser(group, user),
      matchReasons: unique([
        (group.tags || []).some((tag) => (user.interests || []).includes(tag))
          ? 'Interessi in comune'
          : null,
        Math.abs((group.targetComfort || 3) - (user.comfort || 3)) <= 1
          ? 'Comfort compatibile'
          : null,
        Math.abs((group.energy || 3) - (user.energy || 3)) <= 1
          ? 'Ritmo sociale adatto'
          : null,
        (group.members || []).length <= Math.max(2, Math.floor(Number(group.sizeLimit || 0) / 2))
          ? 'Gruppo aperto a nuovi ingressi'
          : null
      ])
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}

function recommendBuddy(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return null;

  const candidates = db.users
    .filter((candidate) => candidate.id !== userId && candidate.buddyEligible)
    .map((candidate) => {
      const candidateInterests = Array.isArray(candidate.interests) ? candidate.interests : [];
      const sharedInterests = candidateInterests.filter((interest) =>
        (user.interests || []).includes(interest)
      );
      const comfortGap = Math.abs((candidate.comfort || 3) - (user.comfort || 3));
      const score = sharedInterests.length * 3 + (candidate.mentor ? 1.5 : 0) - comfortGap;

      return {
        id: candidate.id,
        name: candidate.name,
        city: candidate.city,
        mentor: Boolean(candidate.mentor),
        interests: candidateInterests,
        sharedInterests,
        note: candidate.accessibility,
        score
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0] || null;
}

function computeActionPlan(summary) {
  if (!summary) return [];

  const actions = [];

  if (!summary.myGroups.length) {
    actions.push('Entra in un primo cerchio consigliato con pochi membri.');
  }

  if (summary.stats.plannedActivities === 0) {
    actions.push('Prenota una micro-attività guidata per rompere il ghiaccio in modo semplice.');
  }

  if (summary.buddy) {
    actions.push(`Scrivi al buddy suggerito: ${summary.buddy.name}.`);
  }

  if (summary.stats.recentAnxietyAverage >= 3) {
    actions.push('Scegli gruppi con comfort basso o medio e attività strutturate.');
  }

  if (summary.stats.recentInclusionAverage <= 3) {
    actions.push('Fai un check-in dopo il prossimo incontro per migliorare i suggerimenti.');
  }

  return unique(actions).slice(0, 4);
}

function computeUserSummary(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return null;

  const myGroups = db.groups.filter((group) => (group.members || []).includes(userId));
  const checkins = getUserCheckins(db, userId);
  const recentCheckins = checkins.slice(0, 5);

  const reports = getUserReports(db, userId).map((report) => ({
    ...report,
    statusLabel:
      report.status === 'reviewing' ? 'In revisione' : report.status === 'resolved' ? 'Risolta' : 'Aperta'
  }));

  const belongingAvg = avg(recentCheckins.map((item) => item.included || 0));
  const anxietyAvg = avg(recentCheckins.map((item) => item.anxiety || 0));

  const activityCount = myGroups.reduce((sum, group) => {
    return (
      sum +
      (group.activities || []).filter((activity) => (activity.rsvps || []).includes(userId)).length
    );
  }, 0);

  const stats = {
    belongingScore: Math.max(
      0,
      Math.min(
        100,
        Math.round(32 + myGroups.length * 12 + activityCount * 7 + belongingAvg * 8 - anxietyAvg * 4)
      )
    ),
    joinedGroups: myGroups.length,
    plannedActivities: activityCount,
    recentInclusionAverage: Number(belongingAvg.toFixed(1)),
    recentAnxietyAverage: Number(anxietyAvg.toFixed(1)),
    reportsOpen: reports.filter((report) => report.status !== 'resolved').length
  };

  const summary = {
    user,
    stats,
    myGroups: myGroups.map((group) => serializeGroup(db, group, userId)),
    recommendations: recommendGroups(db, userId),
    buddy: recommendBuddy(db, userId),
    checkins,
    reports
  };

  return {
    ...summary,
    actionPlan: computeActionPlan(summary)
  };
}

function computeInsights(db) {
  const includedValues = db.checkins.map((item) => item.included || 0);
  const anxietyValues = db.checkins.map((item) => item.anxiety || 0);

  const lonelyUsers = db.users.filter((user) => {
    const userCheckins = getUserCheckins(db, user.id).slice(0, 3);
    if (!userCheckins.length) return false;
    return avg(userCheckins.map((item) => item.included || 0)) <= 2.5;
  });

  const closedGroups = db.groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      fillRate: Number(
        (((group.members || []).length / Math.max(Number(group.sizeLimit || 1), 1))).toFixed(2)
      ),
      spotsLeft: Math.max(Number(group.sizeLimit || 0) - (group.members || []).length, 0)
    }))
    .sort((a, b) => a.spotsLeft - b.spotsLeft);

  return {
    users: db.users.length,
    groups: db.groups.length,
    buddyEligible: db.users.filter((user) => user.buddyEligible).length,
    averageInclusion: Number(avg(includedValues).toFixed(1)),
    averageAnxiety: Number(avg(anxietyValues).toFixed(1)),
    openReports: db.reports.filter((report) => report.status !== 'resolved').length,
    waitlistCount: db.waitlist.length,
    partnerLeadsCount: db.partnerLeads.length,
    lonelyUsers: lonelyUsers.map((user) => ({
      id: user.id,
      name: user.name,
      city: user.city
    })),
    closedGroups,
    reportsByCategory: db.reports.reduce((acc, report) => {
      const category = report.category || 'altro';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {})
  };
}

function getMarketing(db) {
  return {
    plans: db.marketing?.plans || [],
    faqs: db.marketing?.faqs || [],
    demoUsers: db.users.slice(0, 4).map((user) => ({
      id: user.id,
      name: user.name,
      city: user.city
    }))
  };
}

const mailTransport =
  nodemailer && GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        service: SMTP_HOST === 'smtp.gmail.com' ? 'gmail' : undefined,
        auth: {
          user: GMAIL_USER,
          pass: GMAIL_APP_PASSWORD
        }
      })
    : null;

async function sendEmail({ to, subject, html }) {
  if (!mailTransport || !to) return;
  await mailTransport.sendMail({
    from: GMAIL_USER,
    to,
    subject,
    html
  });
}

async function safeSendEmail(payload) {
  try {
    await sendEmail(payload);
  } catch (error) {
    console.error('Email send failed:', error.message);
  }
}

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'inclusio-api',
    message: 'Backend attivo. Il frontend pubblico è pensato per Vercel.',
    endpoints: [
      '/api/health',
      '/api/bootstrap',
      '/api/users/onboard',
      '/api/waitlist',
      '/api/partner-leads',
      '/api/billing/status',
      '/api/billing/school-checkout',
      '/api/stripe/webhook'
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'inclusio-api',
    now: new Date().toISOString()
  });
});

app.get('/api/bootstrap', (req, res) => {
  const db = readDb();
  const userId = req.query.userId ? String(req.query.userId) : null;

  res.json({
    appName: 'Inclusio',
    interests: db.interests,
    summary: userId ? computeUserSummary(db, userId) : null,
    insights: computeInsights(db),
    marketing: getMarketing(db)
  });
});

app.get('/api/billing/status', (req, res) => {
  const db = readDb();
  const emailValue = email(req.query.email || '');
  const organization = text(req.query.organization, 120);

  if (!emailValue && !organization) {
    return res.status(400).json({ error: 'Passa almeno email o organization.' });
  }

  const subscription = getActiveSubscription(db, {
    email: emailValue,
    organization
  });

  if (!subscription) {
    return res.json({
      ok: true,
      active: false,
      subscription: null
    });
  }

  return res.json({
    ok: true,
    active: true,
    subscription: {
      ...subscription,
      entitlements: getPlanEntitlements(subscription.planCode)
    }
  });
});

app.post('/api/billing/school-checkout', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe non configurato sul backend.' });
  }

  if (!APP_BASE_URL) {
    return res.status(500).json({ error: 'APP_BASE_URL non configurato sul backend.' });
  }

  const organization = text(req.body.organization, 120);
  const billingEmail = email(req.body.billingEmail || req.body.email);
  const contactName = text(req.body.contactName || req.body.name, 80);
  const schoolSize = text(req.body.schoolSize, 60);
  const planCode = normalizePlanCode(req.body.planCode);

  if (!organization || !isValidEmail(billingEmail)) {
    return res.status(400).json({ error: 'Inserisci nome scuola ed email di fatturazione validi.' });
  }

  if (!['school_starter', 'school_pro'].includes(planCode)) {
    return res.status(400).json({ error: 'Per questa fascia è necessario usare Starter o Pro.' });
  }

  const priceId = getSchoolPriceId(planCode);

  if (!priceId) {
    return res.status(500).json({ error: 'Prezzo Stripe del piano scuola non configurato.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: billingEmail,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_BASE_URL}/organizzazioni?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/organizzazioni?checkout=cancelled`,
      metadata: {
        planCode,
        organization,
        billingEmail,
        contactName,
        schoolSize
      },
      subscription_data: {
        metadata: {
          planCode,
          organization,
          billingEmail,
          contactName,
          schoolSize
        }
      }
    });

    return res.json({
      ok: true,
      url: session.url
    });
  } catch (error) {
    console.error('School checkout create failed:', error);
    return res.status(500).json({ error: 'Impossibile creare il checkout Stripe.' });
  }
});

app.post('/api/users/onboard', (req, res) => {
  const db = readDb();

  const name = text(req.body.name, 40);
  const city = text(req.body.city, 40) || 'Online';
  const comfort = clamp(Number(req.body.comfort || 3), 1, 5);
  const energy = clamp(Number(req.body.energy || 3), 1, 5);
  const accessibility = text(req.body.accessibility, 220);
  const interests = Array.isArray(req.body.interests)
    ? req.body.interests.slice(0, 8).map((item) => text(item, 40)).filter(Boolean)
    : [];
  const goals = Array.isArray(req.body.goals)
    ? req.body.goals.slice(0, 4).map((item) => text(item, 40)).filter(Boolean)
    : [];

  if (!name) {
    return res.status(400).json({ error: 'Il nome è obbligatorio.' });
  }

  const user = {
    id: `u-${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    city,
    interests,
    goals,
    comfort,
    energy,
    accessibility,
    joinedGroupIds: [],
    buddyEligible: true,
    mentor: false
  };

  db.users.push(user);
  writeDb(db);

  return res.status(201).json({
    user,
    summary: computeUserSummary(db, user.id),
    insights: computeInsights(db)
  });
});

app.get('/api/users/:userId', (req, res) => {
  const db = readDb();
  const summary = computeUserSummary(db, req.params.userId);

  if (!summary) {
    return res.status(404).json({ error: 'Profilo non trovato.' });
  }

  res.json(summary);
});

app.get('/api/groups', (req, res) => {
  const db = readDb();
  const userId = req.query.userId ? String(req.query.userId) : null;
  res.json(db.groups.map((group) => serializeGroup(db, group, userId)));
});

app.post('/api/groups/:groupId/join', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  if ((group.members || []).includes(userId)) {
    return res.json({
      summary: computeUserSummary(db, userId),
      message: 'Sei già in questo gruppo.'
    });
  }

  if ((group.members || []).length >= Number(group.sizeLimit || 0)) {
    return res.status(409).json({ error: 'Questo gruppo è pieno.' });
  }

  group.members.push(userId);
  user.joinedGroupIds = unique([...(user.joinedGroupIds || []), group.id]);
  writeDb(db);

  res.json({
    summary: computeUserSummary(db, userId),
    message: 'Ingresso nel gruppo completato.'
  });
});

app.post('/api/groups/:groupId/leave', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  group.members = (group.members || []).filter((memberId) => memberId !== userId);
  user.joinedGroupIds = (user.joinedGroupIds || []).filter((id) => id !== group.id);

  (group.activities || []).forEach((activity) => {
    activity.rsvps = (activity.rsvps || []).filter((id) => id !== userId);
  });

  writeDb(db);

  res.json({
    summary: computeUserSummary(db, userId),
    message: 'Hai lasciato il gruppo.'
  });
});

app.post('/api/groups/:groupId/activities/:activityId/rsvp', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  if (!(group.members || []).includes(userId)) {
    return res.status(409).json({ error: 'Entra prima nel gruppo.' });
  }

  const activity = (group.activities || []).find((item) => item.id === req.params.activityId);

  if (!activity) {
    return res.status(404).json({ error: 'Attività non trovata.' });
  }

  if ((activity.rsvps || []).includes(userId)) {
    activity.rsvps = activity.rsvps.filter((id) => id !== userId);
  } else {
    activity.rsvps = [...(activity.rsvps || []), userId];
  }

  writeDb(db);

  res.json({
    summary: computeUserSummary(db, userId),
    message: 'Partecipazione aggiornata.'
  });
});

app.post('/api/checkins', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const user = getUserById(db, userId);

  if (!user) {
    return res.status(404).json({ error: 'Profilo non trovato.' });
  }

  const checkin = {
    id: makeId('c'),
    userId,
    included: clamp(Number(req.body.included || 3), 1, 5),
    energy: clamp(Number(req.body.energy || 3), 1, 5),
    anxiety: clamp(Number(req.body.anxiety || 3), 1, 5),
    note: text(req.body.note, 220),
    createdAt: new Date().toISOString()
  };

  db.checkins.unshift(checkin);
  writeDb(db);

  res.status(201).json({
    checkin,
    summary: computeUserSummary(db, userId),
    insights: computeInsights(db)
  });
});

app.post('/api/reports', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const user = getUserById(db, userId);

  if (!user) {
    return res.status(404).json({ error: 'Profilo non trovato.' });
  }

  const report = {
    id: makeId('r'),
    userId,
    severity: ['low', 'medium', 'high'].includes(req.body.severity) ? req.body.severity : 'medium',
    category: text(req.body.category, 30) || 'altro',
    details: text(req.body.details, 300),
    createdAt: new Date().toISOString(),
    status: 'reviewing'
  };

  db.reports.unshift(report);
  writeDb(db);

  res.status(201).json({
    report,
    summary: computeUserSummary(db, userId),
    insights: computeInsights(db)
  });
});

app.post('/api/waitlist', async (req, res) => {
  const db = readDb();
  const nameValue = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const role = text(req.body.role, 40) || 'individual';
  const goal = text(req.body.goal, 60) || 'friendship';

  if (!nameValue || !isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci nome ed email validi.' });
  }

  const existing = db.waitlist.find((item) => item.email === emailValue);

  if (existing) {
    return res.json({
      ok: true,
      message: "Questa email è già presente nella lista d'attesa."
    });
  }

  db.waitlist.unshift({
    id: makeId('w'),
    name: nameValue,
    email: emailValue,
    role,
    goal,
    createdAt: new Date().toISOString()
  });

  writeDb(db);

  await Promise.all([
    safeSendEmail({
      to: OWNER_EMAIL,
      subject: `[Inclusio] Nuova iscrizione waitlist — ${nameValue}`,
      html: `
        <h2>Nuova iscrizione waitlist</h2>
        <p><strong>Nome:</strong> ${esc(nameValue)}</p>
        <p><strong>Email:</strong> ${esc(emailValue)}</p>
        <p><strong>Ruolo:</strong> ${esc(role)}</p>
        <p><strong>Goal:</strong> ${esc(goal)}</p>
      `
    }),
    safeSendEmail({
      to: emailValue,
      subject: 'Inclusio — iscrizione confermata',
      html: `
        <h2>Iscrizione confermata</h2>
        <p>Ciao ${esc(nameValue)},</p>
        <p>abbiamo ricevuto la tua richiesta di accesso anticipato.</p>
        <p><a href="${APP_BASE_URL || '#'}">Vai al sito</a></p>
      `
    })
  ]);

  return res.status(201).json({
    ok: true,
    message: 'Iscrizione completata. Ti aggiorneremo presto.'
  });
});

app.post('/api/partner-leads', async (req, res) => {
  const db = readDb();

  const nameValue = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const organization = text(req.body.organization, 80);
  const tierInput = text(req.body.tier, 40).toLowerCase();
  const tierMap = {
    school_starter: 'starter',
    school_pro: 'pro',
    starter: 'starter',
    pro: 'pro',
    campus: 'campus',
    custom: 'custom'
  };
  const tier = tierMap[tierInput] || 'custom';
  const goal = text(req.body.goal, 60);
  const message = text(req.body.message, 400);

  if (!nameValue || !organization || !isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Completa nome, email e organizzazione.' });
  }

  db.partnerLeads.unshift({
    id: makeId('p'),
    name: nameValue,
    email: emailValue,
    organization,
    tier,
    goal,
    message,
    createdAt: new Date().toISOString()
  });

  writeDb(db);

  await Promise.all([
    safeSendEmail({
      to: OWNER_EMAIL,
      subject: `[Inclusio] Nuovo lead partner — ${organization} (${tier})`,
      html: `
        <h2>Nuovo lead partner</h2>
        <p><strong>Nome:</strong> ${esc(nameValue)}</p>
        <p><strong>Email:</strong> ${esc(emailValue)}</p>
        <p><strong>Organizzazione:</strong> ${esc(organization)}</p>
        <p><strong>Pacchetto:</strong> ${esc(tier)}</p>
        <p><strong>Goal:</strong> ${esc(goal)}</p>
        <p><strong>Messaggio:</strong><br>${esc(message || 'Nessun messaggio')}</p>
      `
    }),
    safeSendEmail({
      to: emailValue,
      subject: 'Inclusio — richiesta proposta ricevuta',
      html: `
        <h2>Richiesta proposta ricevuta</h2>
        <p>Ciao ${esc(nameValue)},</p>
        <p>abbiamo ricevuto la tua richiesta per ${esc(organization)}.</p>
        <p>Ti ricontatteremo presto.</p>
        <p><a href="${APP_BASE_URL || '#'}">Vai al sito</a></p>
      `
    })
  ]);

  return res.status(201).json({
    ok: true,
    message:
      tier === 'pro'
        ? 'Richiesta Pro ricevuta. Ti contatteremo per setup avanzato.'
        : tier === 'starter'
        ? 'Richiesta Starter ricevuta. Ti contatteremo per setup iniziale.'
        : 'Richiesta Enterprise ricevuta. Ti contatteremo per proposta personalizzata.'
  });
});

app.post('/api/reset', (req, res) => {
  fs.copyFileSync(SEED_PATH, DB_PATH);
  res.json({
    ok: true,
    message: 'Ambiente demo ripristinato.'
  });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.listen(PORT, HOST, () => {
  console.log(`Inclusio API in ascolto su http://${HOST}:${PORT}`);

  if (!nodemailer) {
    console.log('Nodemailer non installato: email Gmail disabilitate finché non esegui npm install nodemailer');
  } else if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.log('Credenziali Gmail mancanti: email disabilitate finché non imposti GMAIL_USER e GMAIL_APP_PASSWORD');
  }

  if (!stripe) {
    console.log('Stripe non configurato: checkout scuola disabilitato finché non imposti STRIPE_SECRET_KEY');
  }
});