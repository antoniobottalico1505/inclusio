const crypto = require('crypto');
const nodemailer = require('nodemailer');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { ensureStateRow, readDb, writeDb } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const SEED_PATH = path.join(__dirname, 'data', 'seed.json');

const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') === 'true';
const BILLING_ADMIN_TOKEN = process.env.BILLING_ADMIN_TOKEN || '';
const SESSION_DURATION_DAYS = Math.max(Number(process.env.SESSION_DURATION_DAYS || 30), 1);
const EMAIL_VERIFY_HOURS = Math.max(Number(process.env.EMAIL_VERIFY_HOURS || 48), 1);
const PASSWORD_RESET_HOURS = Math.max(Number(process.env.PASSWORD_RESET_HOURS || 2), 1);

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
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.emailVerifications = Array.isArray(db.emailVerifications) ? db.emailVerifications : [];
  db.passwordResets = Array.isArray(db.passwordResets) ? db.passwordResets : [];
  db.marketing.plans = Array.isArray(db.marketing.plans) ? db.marketing.plans : [];
  db.marketing.faqs = Array.isArray(db.marketing.faqs) ? db.marketing.faqs : [];

  db.groups = db.groups.map((group) => ({
    ...group,
    premiumOnly: Boolean(group.premiumOnly),
    tags: Array.isArray(group.tags) ? group.tags : [],
    members: Array.isArray(group.members) ? group.members : [],
    activities: Array.isArray(group.activities)
      ? group.activities.map((activity) => ({
          ...activity,
          premiumOnly: Boolean(activity.premiumOnly),
          rsvps: Array.isArray(activity.rsvps) ? activity.rsvps : []
        }))
      : []
  }));

  db.users = db.users.map((user) => ({
    ...user,
    email: email(user.email),
    planCode: normalizePlanCode(user.planCode || user.plan),
    interests: Array.isArray(user.interests) ? user.interests : [],
    goals: Array.isArray(user.goals) ? user.goals : [],
    joinedGroupIds: Array.isArray(user.joinedGroupIds) ? user.joinedGroupIds : [],
    emailVerified: Boolean(user.emailVerified),
    passwordHash: String(user.passwordHash || ''),
    role: text(user.role || 'user', 20) || 'user'
  }));

  db.subscriptions = db.subscriptions.map((subscription) => ({
    ...subscription,
    email: email(subscription.email),
    planCode: normalizePlanCode(subscription.planCode || subscription.plan),
    status: text(subscription.status || 'active', 20) || 'active',
    source: text(subscription.source || 'manual', 30) || 'manual'
  }));

  db.sessions = db.sessions
    .map((session) => ({
      ...session,
      token: String(session.token || ''),
      userId: String(session.userId || ''),
      createdAt: session.createdAt || new Date().toISOString(),
      expiresAt: session.expiresAt || new Date(Date.now() + SESSION_DURATION_DAYS * 86400000).toISOString()
    }))
    .filter((session) => session.token && session.userId);

  db.emailVerifications = db.emailVerifications
    .map((item) => ({
      ...item,
      token: String(item.token || ''),
      userId: String(item.userId || ''),
      email: email(item.email),
      expiresAt: item.expiresAt || new Date(Date.now() + EMAIL_VERIFY_HOURS * 3600000).toISOString(),
      createdAt: item.createdAt || new Date().toISOString()
    }))
    .filter((item) => item.token && item.userId);

  db.passwordResets = db.passwordResets
    .map((item) => ({
      ...item,
      token: String(item.token || ''),
      userId: String(item.userId || ''),
      email: email(item.email),
      expiresAt: item.expiresAt || new Date(Date.now() + PASSWORD_RESET_HOURS * 3600000).toISOString(),
      createdAt: item.createdAt || new Date().toISOString()
    }))
    .filter((item) => item.token && item.userId);

  return db;
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
    .replace(/'/g, '&#039;');
}


function nowIso() {
  return new Date().toISOString();
}

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

function isExpired(value) {
  return !value || new Date(value).getTime() <= Date.now();
}

function purgeExpiredAuthArtifacts(db) {
  db.sessions = (db.sessions || []).filter((item) => !isExpired(item.expiresAt));
  db.emailVerifications = (db.emailVerifications || []).filter((item) => !isExpired(item.expiresAt));
  db.passwordResets = (db.passwordResets || []).filter((item) => !isExpired(item.expiresAt));
}

function getUserByEmail(db, emailValue) {
  const normalized = email(emailValue);
  if (!normalized) return null;
  return db.users.find((user) => email(user.email) === normalized) || null;
}

function makePublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email || '',
    emailVerified: Boolean(user.emailVerified),
    city: user.city || 'Online',
    comfort: user.comfort || 3,
    energy: user.energy || 3,
    accessibility: user.accessibility || '',
    interests: Array.isArray(user.interests) ? user.interests : [],
    goals: Array.isArray(user.goals) ? user.goals : [],
    joinedGroupIds: Array.isArray(user.joinedGroupIds) ? user.joinedGroupIds : [],
    buddyEligible: Boolean(user.buddyEligible),
    mentor: Boolean(user.mentor),
    planCode: normalizePlanCode(user.planCode || user.plan),
    role: user.role || 'user'
  };
}

function getSubscriptionPayload(db, user) {
  const planCode = getUserPlanCode(db, user);
  const entitlements = getPlanEntitlements(planCode);
  const activeSubscription = user?.email ? getActiveSubscriptionByEmail(db, user.email) : null;

  return {
    active: entitlements.isPaid,
    planCode,
    planLabel: entitlements.planLabel,
    entitlements,
    source: activeSubscription?.source || null,
    status: activeSubscription?.status || (entitlements.isPaid ? 'active' : 'free')
  };
}

function buildOrganizationDashboard(db) {
  return {
    stats: {
      users: db.users.length,
      groups: db.groups.length,
      reportsOpen: db.reports.filter((report) => report.status !== 'resolved').length
    },
    insights: computeInsights(db)
  };
}

function buildAuthPayload(db, user, token = '') {
  return {
    token,
    user: makePublicUser(user),
    summary: computeUserSummary(db, user.id),
    subscription: getSubscriptionPayload(db, user),
    organizationDashboard: getPlanEntitlements(getUserPlanCode(db, user)).orgDashboard ? buildOrganizationDashboard(db) : null
  };
}

function getSessionRecord(db, token) {
  if (!token) return null;
  purgeExpiredAuthArtifacts(db);
  return (db.sessions || []).find((session) => session.token === token) || null;
}

function getAuthUser(db, req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const session = getSessionRecord(db, token);
  if (!session) return null;
  return getUserById(db, session.userId);
}

function requireAuth(db, req, res) {
  const user = getAuthUser(db, req);
  if (!user) {
    res.status(401).json({ error: 'Sessione non valida o scaduta.' });
    return null;
  }
  return user;
}

function buildVerifyLink(token) {
  if (!APP_BASE_URL) return '';
  return `${APP_BASE_URL.replace(/\/$/, '')}/app?verify=${encodeURIComponent(token)}`;
}

function buildResetLink(token) {
  if (!APP_BASE_URL) return '';
  return `${APP_BASE_URL.replace(/\/$/, '')}/app?reset=${encodeURIComponent(token)}`;
}

async function issueVerificationEmail(db, user) {
  if (!user?.email) return;
  db.emailVerifications = (db.emailVerifications || []).filter((item) => item.userId !== user.id);
  const token = randomToken(24);
  db.emailVerifications.unshift({
    token,
    userId: user.id,
    email: user.email,
    createdAt: nowIso(),
    expiresAt: addHours(EMAIL_VERIFY_HOURS)
  });

  const verifyLink = buildVerifyLink(token);
  await safeSendEmail({
    to: user.email,
    subject: 'Verifica il tuo account Inclusio',
    html: `
      <p>Ciao ${esc(user.name || '')},</p>
      <p>verifica il tuo indirizzo email per attivare l'area riservata.</p>
      ${verifyLink ? `<p><a href="${esc(verifyLink)}">Verifica email</a></p>` : `<p>Token: <code>${esc(token)}</code></p>`}
      <p>Il link scade tra ${EMAIL_VERIFY_HOURS} ore.</p>
    `
  });
}

async function issuePasswordResetEmail(db, user) {
  if (!user?.email) return;
  db.passwordResets = (db.passwordResets || []).filter((item) => item.userId !== user.id);
  const token = randomToken(24);
  db.passwordResets.unshift({
    token,
    userId: user.id,
    email: user.email,
    createdAt: nowIso(),
    expiresAt: addHours(PASSWORD_RESET_HOURS)
  });

  const resetLink = buildResetLink(token);
  await safeSendEmail({
    to: user.email,
    subject: 'Reset password Inclusio',
    html: `
      <p>Ciao ${esc(user.name || '')},</p>
      <p>usa questo link per impostare una nuova password.</p>
      ${resetLink ? `<p><a href="${esc(resetLink)}">Reimposta password</a></p>` : `<p>Token: <code>${esc(token)}</code></p>`}
      <p>Il link scade tra ${PASSWORD_RESET_HOURS} ore.</p>
    `
  });
}

function normalizePlanCode(value) {
  const code = String(value || '').trim().toLowerCase();

  if (['plus', 'plus_monthly', 'monthly', 'mensile'].includes(code)) return 'plus_monthly';
  if (['plus_annual', 'annual', 'annuale'].includes(code)) return 'plus_annual';

  return 'solo';
}

function getPlanLabel(planCode = 'solo') {
  const normalized = normalizePlanCode(planCode);

  if (normalized === 'plus_annual') return 'Plus Annuale';
  if (normalized === 'plus_monthly') return 'Plus Mensile';

  return 'Solo';
}

function getPlanEntitlements(planCode = 'solo') {
  const normalized = normalizePlanCode(planCode);
  const isPaid = normalized === 'plus_monthly' || normalized === 'plus_annual';

  return {
    planCode: normalized,
    planLabel: getPlanLabel(normalized),
    isPaid,
    maxGroups: isPaid ? 3 : 1,
    buddyMatches: isPaid ? 3 : 1,
    premiumGroups: isPaid,
    premiumActivities: isPaid,
    advancedInsights: isPaid,
    priorityIntroductions: isPaid,
    supportLevel: isPaid ? 'priority' : 'base',
    orgDashboard: false
  };
}

function getActiveSubscriptionByEmail(db, emailValue) {
  const normalizedEmail = email(emailValue);
  if (!normalizedEmail || !Array.isArray(db.subscriptions)) return null;

  return (
    db.subscriptions.find((subscription) => {
      if (email(subscription.email) !== normalizedEmail) return false;
      if (String(subscription.status || '').toLowerCase() !== 'active') return false;
      return normalizePlanCode(subscription.planCode || subscription.plan) !== 'solo';
    }) || null
  );
}

function getPlanCodeForEmail(db, emailValue) {
  const activeSubscription = getActiveSubscriptionByEmail(db, emailValue);
  return activeSubscription ? normalizePlanCode(activeSubscription.planCode || activeSubscription.plan) : 'solo';
}

function getUserPlanCode(db, user) {
  if (!user) return 'solo';

  if (user.email) {
    const subscriptionPlan = getPlanCodeForEmail(db, user.email);
    if (subscriptionPlan !== 'solo') return subscriptionPlan;
  }

  return normalizePlanCode(user.planCode || user.plan);
}

function getUserEntitlements(db, user) {
  return getPlanEntitlements(getUserPlanCode(db, user));
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
  const currentUser = currentUserId ? getUserById(db, currentUserId) : null;
  const entitlements = currentUser ? getUserEntitlements(db, currentUser) : getPlanEntitlements('solo');

  return {
    ...group,
    premiumOnly: Boolean(group.premiumOnly),
    lockedByPlan: Boolean(group.premiumOnly) && !entitlements.premiumGroups,
    lockedReason: Boolean(group.premiumOnly) && !entitlements.premiumGroups ? 'Disponibile con Plus.' : null,
    memberCount: (group.members || []).length,
    spotsLeft: Math.max(Number(group.sizeLimit || 0) - (group.members || []).length, 0),
    isJoined: currentUserId ? (group.members || []).includes(currentUserId) : false,
    membersPreview: getGroupMemberProfiles(db, group),
    activities: (group.activities || []).map((activity) => ({
      ...activity,
      premiumOnly: Boolean(activity.premiumOnly),
      lockedByPlan: Boolean(activity.premiumOnly) && !entitlements.premiumActivities,
      lockedReason: Boolean(activity.premiumOnly) && !entitlements.premiumActivities ? 'Disponibile con Plus.' : null,
      isRsvped: currentUserId ? (activity.rsvps || []).includes(currentUserId) : false
    }))
  };
}

function scoreGroupForUser(group, user) {
  const groupTags = Array.isArray(group.tags) ? group.tags : [];
  const userInterests = Array.isArray(user.interests) ? user.interests : [];
  const commonInterests = groupTags.filter((tag) => userInterests.includes(tag)).length;
  const comfortGap = Math.abs((group.targetComfort || 3) - (user.comfort || 3));
  const energyGap = Math.abs((group.energy || 3) - (user.energy || 3));
  const spaceBonus = (group.members || []).length < Number(group.sizeLimit || 0) ? 1 : -2;
  const opennessBonus = (group.members || []).length <= Math.max(2, Math.floor(Number(group.sizeLimit || 0) / 2)) ? 0.8 : 0.25;

  return Number((commonInterests * 3 - comfortGap * 1.1 - energyGap * 0.7 + spaceBonus + opennessBonus).toFixed(2));
}

function recommendGroups(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return [];

  const entitlements = getUserEntitlements(db, user);

  return db.groups
    .filter((group) => {
      if ((group.members || []).includes(userId)) return false;
      if ((group.members || []).length >= Number(group.sizeLimit || 0)) return false;
      if (group.premiumOnly && !entitlements.premiumGroups) return false;
      if (group.marketingOnly) return false;
      return true;
    })
    .map((group) => ({
      ...serializeGroup(db, group, userId),
      matchScore: scoreGroupForUser(group, user),
      matchReasons: unique([
        (group.tags || []).some((tag) => (user.interests || []).includes(tag)) ? 'Interessi in comune' : null,
        Math.abs((group.targetComfort || 3) - (user.comfort || 3)) <= 1 ? 'Comfort compatibile' : null,
        Math.abs((group.energy || 3) - (user.energy || 3)) <= 1 ? 'Ritmo sociale adatto' : null,
        (group.members || []).length <= Math.max(2, Math.floor(Number(group.sizeLimit || 0) / 2)) ? 'Gruppo aperto a nuovi ingressi' : null
      ])
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, entitlements.isPaid ? 6 : 4);
}

function recommendBuddies(db, userId, limit = 1) {
  const user = getUserById(db, userId);
  if (!user) return [];

  return db.users
    .filter((candidate) => candidate.id !== userId && candidate.buddyEligible && !candidate.marketingOnly)
    .map((candidate) => {
      const candidateInterests = Array.isArray(candidate.interests) ? candidate.interests : [];
      const sharedInterests = candidateInterests.filter((interest) => (user.interests || []).includes(interest));
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
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function recommendBuddy(db, userId) {
  return recommendBuddies(db, userId, 1)[0] || null;
}

function computeActionPlan(summary) {
  if (!summary) return [];

  const actions = [];

  if (!summary.myGroups.length) actions.push('Entra in un primo cerchio consigliato con pochi membri.');
  if (summary.stats.plannedActivities === 0) actions.push('Prenota una micro-attività guidata per rompere il ghiaccio in modo semplice.');
  if (summary.buddy) actions.push(`Scrivi al buddy suggerito: ${summary.buddy.name}.`);
  if (summary.stats.recentAnxietyAverage >= 3) actions.push('Scegli gruppi con comfort basso o medio e attività strutturate.');
  if (summary.stats.recentInclusionAverage <= 3) actions.push('Fai un check-in dopo il prossimo incontro per migliorare i suggerimenti.');

  return unique(actions).slice(0, 4);
}


function computeAdvancedInsights(summary) {
  if (!summary) return null;

  const stabilityBase = 100 - summary.stats.recentAnxietyAverage * 12 + summary.stats.recentInclusionAverage * 7;
  const momentumBase = summary.stats.belongingScore + summary.stats.plannedActivities * 4 + summary.stats.joinedGroups * 3;

  return {
    momentumScore: clamp(Math.round(momentumBase), 0, 100),
    socialStabilityScore: clamp(Math.round(stabilityBase), 0, 100),
    nextBestAction: summary.actionPlan[0] || 'Continua con un gruppo coerente con il tuo ritmo.',
    unlockHint: summary.account?.isPaid ? null : 'Con Plus sblocchi gruppi premium, più buddy match e insight avanzati.'
  };
}

function computeUserSummary(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return null;

  const entitlements = getUserEntitlements(db, user);
  const myGroups = db.groups.filter((group) => (group.members || []).includes(userId));
  const checkins = getUserCheckins(db, userId);
  const recentCheckins = checkins.slice(0, 5);
  const reports = getUserReports(db, userId).map((report) => ({
    ...report,
    statusLabel:
      report.status === 'reviewing'
        ? 'In revisione'
        : report.status === 'resolved'
          ? 'Risolta'
          : 'Aperta'
  }));

  const belongingAvg = avg(recentCheckins.map((item) => item.included || 0));
  const anxietyAvg = avg(recentCheckins.map((item) => item.anxiety || 0));
  const activityCount = myGroups.reduce((sum, group) => {
    return sum + (group.activities || []).filter((activity) => (activity.rsvps || []).includes(userId)).length;
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

const buddyMatches = recommendBuddies(db, userId, entitlements.buddyMatches);

const summary = {
  user,
  account: {
    email: user.email || '',
    planCode: entitlements.planCode,
    planLabel: entitlements.planLabel,
    isPaid: entitlements.isPaid,
    entitlements
  },
  stats,
  myGroups: myGroups
    .filter((group) => !group.marketingOnly)
    .map((group) => serializeGroup(db, group, userId)),
  recommendations: recommendGroups(db, userId),
  buddy: buddyMatches[0] || null,
  buddyMatches,
  checkins,
  reports
};

  const actionPlan = computeActionPlan(summary);

  return {
    ...summary,
    actionPlan: entitlements.advancedInsights ? actionPlan : actionPlan.slice(0, 2),
    advancedInsights: entitlements.advancedInsights ? computeAdvancedInsights({ ...summary, actionPlan }) : null,
    lockedFeatures: entitlements.isPaid
      ? []
      : [
          'Fino a 3 gruppi attivi',
          'Fino a 3 buddy match',
          'Gruppi e attività premium',
          'Insight personali avanzati'
        ]
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
      fillRate: Number((((group.members || []).length / Math.max(Number(group.sizeLimit || 1), 1))).toFixed(2)),
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
    waitlistCount: (db.waitlist || []).length,
    partnerLeadsCount: (db.partnerLeads || []).length,
    activeSubscriptions: (db.subscriptions || []).filter((item) => String(item.status || '').toLowerCase() === 'active').length,
    lonelyUsers: lonelyUsers.map((user) => ({ id: user.id, name: user.name, city: user.city })),
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
    serviceMatrix: {
      solo: getPlanEntitlements('solo'),
      plus: getPlanEntitlements('plus_monthly')
    },
    demoUsers: db.users
  .filter((user) => user.marketingOnly)
  .slice(0, 4)
  .map((user) => ({
    id: user.id,
    name: user.name,
    city: user.city
  }))
  };
}

const mailTransport =
  nodemailer && GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
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
    endpoints: ['/api/health', '/api/bootstrap', '/api/users/onboard', '/api/waitlist', '/api/partner-leads', '/api/subscriptions/lookup', '/api/subscriptions/activate']
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'inclusio-api', now: new Date().toISOString() });
});

app.get('/api/bootstrap', async (req, res) => {
  const db = await readDb();
  const userId = req.query.userId ? String(req.query.userId) : null;
  const emailValue = req.query.email ? email(req.query.email) : '';
  const previewPlanCode = emailValue ? getPlanCodeForEmail(db, emailValue) : 'solo';

  res.json({
    appName: 'Inclusio',
    interests: db.interests,
    summary: userId ? computeUserSummary(db, userId) : null,
    insights: computeInsights(db),
    marketing: getMarketing(db),
    billingPreview: emailValue
      ? {
          email: emailValue,
          planCode: previewPlanCode,
          planLabel: getPlanLabel(previewPlanCode),
          entitlements: getPlanEntitlements(previewPlanCode)
        }
      : null
  });
});


app.post('/api/auth/register', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const name = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const password = String(req.body.password || '');

  if (!name) {
    return res.status(400).json({ error: 'Il nome è obbligatorio.' });
  }

  if (!isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci un indirizzo email valido.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri.' });
  }

  if (getUserByEmail(db, emailValue)) {
    return res.status(409).json({ error: 'Esiste già un account con questa email.' });
  }

  const user = {
    id: `u-${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    email: emailValue,
    emailVerified: false,
    passwordHash: hashPassword(password),
    planCode: getPlanCodeForEmail(db, emailValue),
    city: 'Online',
    interests: [],
    goals: [],
    comfort: 3,
    energy: 3,
    accessibility: '',
    joinedGroupIds: [],
    buddyEligible: true,
    mentor: false,
    role: 'user'
  };

  db.users.push(user);
  await issueVerificationEmail(db, user);
  await writeDb(db);

  return res.status(201).json({
    ok: true,
    message: 'Account creato. Controlla la tua email per verificare l’indirizzo.'
  });
});

app.post('/api/auth/login', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const emailValue = email(req.body.email);
  const password = String(req.body.password || '');
  const user = getUserByEmail(db, emailValue);

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email o password non validi.' });
  }

  const token = randomToken(32);
  db.sessions.unshift({
    token,
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: addDays(SESSION_DURATION_DAYS)
  });

  await writeDb(db);
  return res.json(buildAuthPayload(db, user, token));
});

app.get('/api/auth/me', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const user = requireAuth(db, req, res);
  if (!user) return;

  await writeDb(db);
  return res.json(buildAuthPayload(db, user));
});

app.post('/api/auth/logout', async (req, res) => {
  const db = await readDb();
  const token = getBearerToken(req);
  db.sessions = (db.sessions || []).filter((item) => item.token !== token);
  await writeDb(db);
  return res.json({ ok: true });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const emailValue = email(req.body.email);
  const user = getUserByEmail(db, emailValue);

  if (user && !user.emailVerified) {
    await issueVerificationEmail(db, user);
    await writeDb(db);
  }

  return res.json({ ok: true, message: 'Se necessario, abbiamo reinviato la mail di verifica.' });
});

app.post('/api/auth/verify-email', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const token = String(req.body.token || '').trim();
  const record = (db.emailVerifications || []).find((item) => item.token === token);

  if (!record || isExpired(record.expiresAt)) {
    return res.status(400).json({ error: 'Token di verifica non valido o scaduto.' });
  }

  const user = getUserById(db, record.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato.' });
  }

  user.emailVerified = true;
  db.emailVerifications = (db.emailVerifications || []).filter((item) => item.token !== token);
  await writeDb(db);

  return res.json({ ok: true, message: 'Email verificata. Ora puoi accedere.' });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const emailValue = email(req.body.email);
  const user = getUserByEmail(db, emailValue);

  if (user) {
    await issuePasswordResetEmail(db, user);
    await writeDb(db);
  }

  return res.json({
    ok: true,
    message: 'Se l’account esiste, abbiamo inviato le istruzioni via email.'
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  const record = (db.passwordResets || []).find((item) => item.token === token);

  if (!record || isExpired(record.expiresAt)) {
    return res.status(400).json({ error: 'Token di reset non valido o scaduto.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La password deve contenere almeno 8 caratteri.' });
  }

  const user = getUserById(db, record.userId);
  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato.' });
  }

  user.passwordHash = hashPassword(password);
  db.passwordResets = (db.passwordResets || []).filter((item) => item.token !== token);
  db.sessions = (db.sessions || []).filter((item) => item.userId !== user.id);
  await writeDb(db);

  return res.json({ ok: true, message: 'Password aggiornata. Ora puoi accedere.' });
});


app.post('/api/users/onboard', async (req, res) => {
  const db = await readDb();
  purgeExpiredAuthArtifacts(db);

  const authenticatedUser = getAuthUser(db, req);
  const name = text(req.body.name, 40);
  const emailValue = email(req.body.email);
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

  if (authenticatedUser) {
    authenticatedUser.name = name;
    authenticatedUser.city = city;
    authenticatedUser.comfort = comfort;
    authenticatedUser.energy = energy;
    authenticatedUser.accessibility = accessibility;
    authenticatedUser.interests = interests;
    authenticatedUser.goals = goals;
    authenticatedUser.planCode = getPlanCodeForEmail(db, authenticatedUser.email);
    await writeDb(db);

    return res.json({
      ok: true,
      message: 'Profilo aggiornato.',
      user: makePublicUser(authenticatedUser),
      summary: computeUserSummary(db, authenticatedUser.id),
      subscription: getSubscriptionPayload(db, authenticatedUser)
    });
  }

  if (req.body.email && !isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci un indirizzo email valido.' });
  }

  if (emailValue && db.users.find((item) => item.email === emailValue)) {
    return res.status(409).json({ error: 'Esiste già un profilo associato a questa email.' });
  }

  const user = {
    id: `u-${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    email: emailValue,
    emailVerified: false,
    passwordHash: '',
    planCode: getPlanCodeForEmail(db, emailValue),
    city,
    interests,
    goals,
    comfort,
    energy,
    accessibility,
    joinedGroupIds: [],
    buddyEligible: true,
    mentor: false,
    role: 'user'
  };

  db.users.push(user);
  await writeDb(db);

  return res.status(201).json({
    user: makePublicUser(user),
    summary: computeUserSummary(db, user.id),
    subscription: getSubscriptionPayload(db, user),
    insights: computeInsights(db)
  });
});

app.get('/api/users/:userId', async (req, res) => {
  const db = await readDb();
  const summary = computeUserSummary(db, req.params.userId);

  if (!summary) {
    return res.status(404).json({ error: 'Profilo non trovato.' });
  }

  res.json(summary);
});

app.get('/api/groups', async (req, res) => {
  const db = await readDb();
  const userId = req.query.userId ? String(req.query.userId) : null;
  res.json(db.groups.map((group) => serializeGroup(db, group, userId)));
});

app.post('/api/groups/:groupId/join', async (req, res) => {
  const db = await readDb();
  const authUser = getAuthUser(db, req);
  const userId = authUser?.id || String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = authUser || getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  const entitlements = getUserEntitlements(db, user);

  if ((group.members || []).includes(userId)) {
    return res.json({ summary: computeUserSummary(db, userId), message: 'Sei già in questo gruppo.' });
  }

  if (group.premiumOnly && !entitlements.premiumGroups) {
    return res.status(403).json({ error: 'Questo gruppo è disponibile con Plus.' });
  }

  if ((user.joinedGroupIds || []).length >= entitlements.maxGroups) {
    return res.status(403).json({
      error: `Il piano ${entitlements.planLabel} consente fino a ${entitlements.maxGroups} gruppi attivi.`
    });
  }

  if ((group.members || []).length >= Number(group.sizeLimit || 0)) {
    return res.status(409).json({ error: 'Questo gruppo è pieno.' });
  }

  group.members.push(userId);
  user.joinedGroupIds = unique([...(user.joinedGroupIds || []), group.id]);

  await writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Ingresso nel gruppo completato.' });
});

app.post('/api/groups/:groupId/leave', async (req, res) => {
  const db = await readDb();
  const authUser = getAuthUser(db, req);
  const userId = authUser?.id || String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = authUser || getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  group.members = (group.members || []).filter((memberId) => memberId !== userId);
  user.joinedGroupIds = (user.joinedGroupIds || []).filter((id) => id !== group.id);

  (group.activities || []).forEach((activity) => {
    activity.rsvps = (activity.rsvps || []).filter((id) => id !== userId);
  });

  await writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Hai lasciato il gruppo.' });
});

app.post('/api/groups/:groupId/activities/:activityId/rsvp', async (req, res) => {
  const db = await readDb();
  const authUser = getAuthUser(db, req);
  const userId = authUser?.id || String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = authUser || getUserById(db, userId);

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

  const entitlements = getUserEntitlements(db, user);

  if (activity.premiumOnly && !entitlements.premiumActivities) {
    return res.status(403).json({ error: 'Questa attività è disponibile con Plus.' });
  }

  if ((activity.rsvps || []).includes(userId)) {
    activity.rsvps = activity.rsvps.filter((id) => id !== userId);
  } else {
    activity.rsvps = [...(activity.rsvps || []), userId];
  }

  await writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Partecipazione aggiornata.' });
});

app.post('/api/checkins', async (req, res) => {
  const db = await readDb();
  const authUser = getAuthUser(db, req);
  const userId = authUser?.id || String(req.body.userId || '');
  const user = authUser || getUserById(db, userId);

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
  await writeDb(db);

  res.status(201).json({
    checkin,
    summary: computeUserSummary(db, userId),
    insights: computeInsights(db)
  });
});

app.post('/api/reports', async (req, res) => {
  const db = await readDb();
  const authUser = getAuthUser(db, req);
  const userId = authUser?.id || String(req.body.userId || '');
  const user = authUser || getUserById(db, userId);

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
  await writeDb(db);

  res.status(201).json({
    report,
    summary: computeUserSummary(db, userId),
    insights: computeInsights(db)
  });
});

app.post('/api/waitlist', async (req, res) => {
  const db = await readDb();

  const nameValue = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const role = text(req.body.role, 40) || 'individual';
  const goal = text(req.body.goal, 60) || 'friendship';

  if (!nameValue || !isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci nome ed email validi.' });
  }

  db.waitlist = db.waitlist || [];
  const existing = db.waitlist.find((item) => item.email === emailValue);

  if (existing) {
    return res.json({ ok: true, message: "Questa email è già presente nella lista d'attesa." });
  }

  db.waitlist.unshift({
    id: makeId('w'),
    name: nameValue,
    email: emailValue,
    role,
    goal,
    createdAt: new Date().toISOString()
  });

  await writeDb(db);

  await Promise.all([
    safeSendEmail({
      to: OWNER_EMAIL,
      subject: `[Inclusio] Nuova iscrizione waitlist — ${nameValue}`,
      html: `
        <h2>Nuova iscrizione waitlist</h2>
        <p><strong>Nome:</strong> ${nameValue}</p>
        <p><strong>Email:</strong> ${emailValue}</p>
        <p><strong>Ruolo:</strong> ${role}</p>
        <p><strong>Goal:</strong> ${goal}</p>
      `
    }),
    safeSendEmail({
      to: emailValue,
      subject: 'Inclusio — iscrizione confermata',
      html: `
        <h2>Iscrizione confermata</h2>
        <p>Ciao ${nameValue},</p>
        <p>abbiamo ricevuto la tua richiesta di accesso anticipato.</p>
        <p><a href="${APP_BASE_URL}">Vai al sito</a></p>
      `
    })
  ]);

  return res.status(201).json({
    ok: true,
    message: 'Iscrizione completata. Ti aggiorneremo presto.'
  });
});

app.post('/api/partner-leads', async (req, res) => {
  const db = await readDb();

  const nameValue = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const organization = text(req.body.organization, 80);
  const tier = ['school_starter', 'school_pro', 'custom'].includes(req.body.tier)
    ? req.body.tier
    : 'school_starter';
  const tierLabel =
    tier === 'school_pro'
      ? 'School Pro'
      : tier === 'custom'
        ? 'Custom'
        : 'School Starter';
  const goal = text(req.body.goal, 60);
  const message = text(req.body.message, 400);

  if (!nameValue || !organization || !isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Completa nome, email e organizzazione.' });
  }

  db.partnerLeads = db.partnerLeads || [];
  db.partnerLeads.unshift({
    id: makeId('p'),
    name: nameValue,
    email: emailValue,
    organization,
    tier,
    tierLabel,
    goal,
    message,
    createdAt: new Date().toISOString()
  });

  await writeDb(db);

  await Promise.all([
    safeSendEmail({
      to: OWNER_EMAIL,
      subject: `[Inclusio] Nuovo lead partner — ${organization} (${tier})`,
      html: `
        <h2>Nuovo lead partner</h2>
        <p><strong>Nome:</strong> ${nameValue}</p>
        <p><strong>Email:</strong> ${emailValue}</p>
        <p><strong>Organizzazione:</strong> ${organization}</p>
        <p><strong>Pacchetto:</strong> ${tierLabel}</p>
        <p><strong>Goal:</strong> ${goal}</p>
        <p><strong>Messaggio:</strong><br>${message || 'Nessun messaggio'}</p>
      `
    }),
    safeSendEmail({
      to: emailValue,
      subject: 'Inclusio — richiesta demo ricevuta',
      html: `
        <h2>Richiesta demo ricevuta</h2>
        <p>Ciao ${nameValue},</p>
        <p>abbiamo ricevuto la tua richiesta per <strong>${organization}</strong>.</p>
        <p><strong>Pacchetto richiesto:</strong> ${tierLabel}</p>
        <p>Ti ricontatteremo presto.</p>
        <p><a href="${APP_BASE_URL}">Vai al sito</a></p>
      `
    })
  ]);

  return res.status(201).json({
    ok: true,
    message:
      tier === 'custom'
        ? 'Richiesta personalizzata ricevuta. Ti contatteremo per proposta e setup.'
        : tier === 'school_pro'
          ? 'Richiesta School Pro ricevuta. Ti contatteremo per demo e setup avanzato.'
          : 'Richiesta School Starter ricevuta. Ti contatteremo per demo e setup iniziale.'
  });

});

app.get('/api/subscriptions/lookup', async (req, res) => {
  const db = await readDb();
  const emailValue = email(req.query.email);

  if (!isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci una email valida.' });
  }

  const planCode = getPlanCodeForEmail(db, emailValue);
  const subscription = getActiveSubscriptionByEmail(db, emailValue);

  return res.json({
    ok: true,
    email: emailValue,
    planCode,
    planLabel: getPlanLabel(planCode),
    entitlements: getPlanEntitlements(planCode),
    subscription
  });
});

app.post('/api/subscriptions/activate', async (req, res) => {
  const adminToken = String(req.headers['x-billing-token'] || req.body.adminToken || '').trim();

  if (!BILLING_ADMIN_TOKEN || adminToken !== BILLING_ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Operazione non autorizzata.' });
  }

  const db = await readDb();
  const emailValue = email(req.body.email);
  const planCode = normalizePlanCode(req.body.planCode);
  const source = text(req.body.source, 30) || 'manual';

  if (!isValidEmail(emailValue)) {
    return res.status(400).json({ error: 'Inserisci una email valida.' });
  }

  if (planCode === 'solo') {
    return res.status(400).json({ error: 'Attiva un piano Plus valido.' });
  }

  const now = new Date().toISOString();

  db.subscriptions = (db.subscriptions || []).map((subscription) =>
    email(subscription.email) === emailValue && String(subscription.status || '').toLowerCase() === 'active'
      ? { ...subscription, status: 'replaced', replacedAt: now }
      : subscription
  );

  const subscription = {
    id: makeId('sub'),
    email: emailValue,
    planCode,
    status: 'active',
    source,
    createdAt: now,
    activatedAt: now
  };

  db.subscriptions.unshift(subscription);

  const existingUser = db.users.find((item) => item.email === emailValue);
  if (existingUser) {
    existingUser.planCode = planCode;
  }

  await writeDb(db);

  await safeSendEmail({
    to: emailValue,
    subject: `Inclusio — ${getPlanLabel(planCode)} attivato`,
    html: `
      <h2>Piano attivato</h2>
      <p>Il tuo piano <strong>${getPlanLabel(planCode)}</strong> è ora attivo.</p>
      <p>Da questo momento hai accesso ai servizi extra previsti dal piano.</p>
      <p><a href="${APP_BASE_URL}">Vai al sito</a></p>
    `
  });

  return res.status(201).json({
    ok: true,
    email: emailValue,
    planCode,
    planLabel: getPlanLabel(planCode),
    entitlements: getPlanEntitlements(planCode),
    subscription
  });
});

app.post('/api/reset', async (req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Endpoint demo disattivato: il backend usa Postgres e non supporta più il reset su file.'
  });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

async function boot() {
  try {
    await ensureStateRow();
    app.listen(PORT, HOST, () => {
      console.log(`Inclusio API in ascolto su http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('Postgres init failed:', error);
    process.exit(1);
  }
}

boot();