const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const allowAnyOrigin = allowedOrigins.includes('*');

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowAnyOrigin) {
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

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function avg(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(items = []) {
  return Array.from(new Set(items));
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
  return group.members
    .map((memberId) => getUserById(db, memberId))
    .filter(Boolean)
    .map((member) => ({
      id: member.id,
      name: member.name,
      interests: member.interests,
      comfort: member.comfort,
      energy: member.energy
    }));
}

function serializeGroup(db, group, currentUserId = null) {
  return {
    ...group,
    memberCount: group.members.length,
    spotsLeft: Math.max(group.sizeLimit - group.members.length, 0),
    isJoined: currentUserId ? group.members.includes(currentUserId) : false,
    membersPreview: getGroupMemberProfiles(db, group)
  };
}

function scoreGroupForUser(group, user) {
  const commonInterests = group.tags.filter((tag) => user.interests.includes(tag)).length;
  const comfortGap = Math.abs((group.targetComfort || 3) - (user.comfort || 3));
  const energyGap = Math.abs((group.energy || 3) - (user.energy || 3));
  const spaceBonus = group.members.length < group.sizeLimit ? 1 : -2;
  const opennessBonus = group.members.length <= Math.max(2, Math.floor(group.sizeLimit / 2)) ? 0.8 : 0.25;
  return Number((commonInterests * 3 - comfortGap * 1.1 - energyGap * 0.7 + spaceBonus + opennessBonus).toFixed(2));
}

function recommendGroups(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return [];

  return db.groups
    .filter((group) => !group.members.includes(userId) && group.members.length < group.sizeLimit)
    .map((group) => ({
      ...serializeGroup(db, group, userId),
      matchScore: scoreGroupForUser(group, user),
      matchReasons: unique([
        group.tags.some((tag) => user.interests.includes(tag)) ? 'Interessi in comune' : null,
        Math.abs((group.targetComfort || 3) - (user.comfort || 3)) <= 1 ? 'Comfort compatibile' : null,
        Math.abs((group.energy || 3) - (user.energy || 3)) <= 1 ? 'Ritmo sociale adatto' : null,
        group.members.length <= Math.max(2, Math.floor(group.sizeLimit / 2)) ? 'Gruppo aperto a nuovi ingressi' : null
      ].filter(Boolean))
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
      const sharedInterests = candidate.interests.filter((interest) => user.interests.includes(interest));
      const comfortGap = Math.abs((candidate.comfort || 3) - (user.comfort || 3));
      const score = sharedInterests.length * 3 + (candidate.mentor ? 1.5 : 0) - comfortGap;
      return {
        id: candidate.id,
        name: candidate.name,
        city: candidate.city,
        mentor: Boolean(candidate.mentor),
        interests: candidate.interests,
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
  if (!summary.myGroups.length) actions.push('Entra in un primo cerchio consigliato con pochi membri.');
  if (summary.stats.plannedActivities === 0) actions.push('Prenota una micro-attività guidata per rompere il ghiaccio in modo semplice.');
  if (summary.buddy) actions.push(`Scrivi al buddy suggerito: ${summary.buddy.name}.`);
  if (summary.stats.recentAnxietyAverage >= 3) actions.push('Scegli gruppi con comfort basso o medio e attività strutturate.');
  if (summary.stats.recentInclusionAverage <= 3) actions.push('Fai un check-in dopo il prossimo incontro per migliorare i suggerimenti.');
  return unique(actions).slice(0, 4);
}

function computeUserSummary(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return null;

  const myGroups = db.groups.filter((group) => group.members.includes(userId));
  const checkins = getUserCheckins(db, userId);
  const recentCheckins = checkins.slice(0, 5);
  const reports = getUserReports(db, userId).map((report) => ({
    ...report,
    statusLabel: report.status === 'reviewing' ? 'In revisione' : report.status === 'resolved' ? 'Risolta' : 'Aperta'
  }));
  const belongingAvg = avg(recentCheckins.map((item) => item.included || 0));
  const anxietyAvg = avg(recentCheckins.map((item) => item.anxiety || 0));
  const activityCount = myGroups.reduce((sum, group) => {
    return sum + group.activities.filter((activity) => activity.rsvps.includes(userId)).length;
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
      fillRate: Number((group.members.length / group.sizeLimit).toFixed(2)),
      spotsLeft: Math.max(group.sizeLimit - group.members.length, 0)
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
    lonelyUsers: lonelyUsers.map((user) => ({ id: user.id, name: user.name, city: user.city })),
    closedGroups,
    reportsByCategory: db.reports.reduce((acc, report) => {
      acc[report.category] = (acc[report.category] || 0) + 1;
      return acc;
    }, {})
  };
}

function getMarketing(db) {
  return {
    plans: db.marketing?.plans || [],
    faqs: db.marketing?.faqs || [],
    demoUsers: db.users.slice(0, 4).map((user) => ({ id: user.id, name: user.name, city: user.city }))
  };
}

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'inclusio-api',
    message: 'Backend attivo. Il frontend pubblico è pensato per Vercel.',
    endpoints: ['/api/health', '/api/bootstrap', '/api/users/onboard', '/api/waitlist', '/api/partner-leads']
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'inclusio-api', now: new Date().toISOString() });
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

app.post('/api/users/onboard', (req, res) => {
  const db = readDb();
  const name = text(req.body.name, 40);
  const city = text(req.body.city, 40) || 'Online';
  const comfort = clamp(Number(req.body.comfort || 3), 1, 5);
  const energy = clamp(Number(req.body.energy || 3), 1, 5);
  const accessibility = text(req.body.accessibility, 220);
  const interests = Array.isArray(req.body.interests) ? req.body.interests.slice(0, 8).map((item) => text(item, 40)).filter(Boolean) : [];
  const goals = Array.isArray(req.body.goals) ? req.body.goals.slice(0, 4).map((item) => text(item, 40)).filter(Boolean) : [];

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
  return res.status(201).json({ user, summary: computeUserSummary(db, user.id), insights: computeInsights(db) });
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
  if (group.members.includes(userId)) {
    return res.json({ summary: computeUserSummary(db, userId), message: 'Sei già in questo gruppo.' });
  }
  if (group.members.length >= group.sizeLimit) {
    return res.status(409).json({ error: 'Questo gruppo è pieno.' });
  }

  group.members.push(userId);
  user.joinedGroupIds = unique([...(user.joinedGroupIds || []), group.id]);
  writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Ingresso nel gruppo completato.' });
});

app.post('/api/groups/:groupId/leave', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }

  group.members = group.members.filter((memberId) => memberId !== userId);
  user.joinedGroupIds = (user.joinedGroupIds || []).filter((id) => id !== group.id);
  group.activities.forEach((activity) => {
    activity.rsvps = activity.rsvps.filter((id) => id !== userId);
  });
  writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Hai lasciato il gruppo.' });
});

app.post('/api/groups/:groupId/activities/:activityId/rsvp', (req, res) => {
  const db = readDb();
  const userId = String(req.body.userId || '');
  const group = db.groups.find((item) => item.id === req.params.groupId);
  const user = getUserById(db, userId);

  if (!group || !user) {
    return res.status(404).json({ error: 'Gruppo o profilo non trovato.' });
  }
  if (!group.members.includes(userId)) {
    return res.status(409).json({ error: 'Entra prima nel gruppo.' });
  }

  const activity = group.activities.find((item) => item.id === req.params.activityId);
  if (!activity) {
    return res.status(404).json({ error: 'Attività non trovata.' });
  }

  if (activity.rsvps.includes(userId)) {
    activity.rsvps = activity.rsvps.filter((id) => id !== userId);
  } else {
    activity.rsvps.push(userId);
  }

  writeDb(db);
  res.json({ summary: computeUserSummary(db, userId), message: 'Partecipazione aggiornata.' });
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
  res.status(201).json({ checkin, summary: computeUserSummary(db, userId), insights: computeInsights(db) });
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
  res.status(201).json({ report, summary: computeUserSummary(db, userId), insights: computeInsights(db) });
});

app.post('/api/waitlist', (req, res) => {
  const db = readDb();
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
    return res.json({ ok: true, message: 'Questa email è già presente nella lista d\'attesa.' });
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
  res.status(201).json({ ok: true, message: 'Iscrizione completata. Ti aggiorneremo presto.' });
});

app.post('/api/partner-leads', (req, res) => {
  const db = readDb();
  const nameValue = text(req.body.name, 60);
  const emailValue = email(req.body.email);
  const organization = text(req.body.organization, 80);
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
    goal,
    message,
    createdAt: new Date().toISOString()
  });
  writeDb(db);
  res.status(201).json({ ok: true, message: 'Richiesta demo ricevuta. Ti contatteremo con una proposta.' });
});

app.get('/api/insights', (req, res) => {
  const db = readDb();
  res.json(computeInsights(db));
});

app.post('/api/reset', (req, res) => {
  fs.copyFileSync(SEED_PATH, DB_PATH);
  res.json({ ok: true, message: 'Ambiente demo ripristinato.' });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.listen(PORT, HOST, () => {
  console.log(`Inclusio API in ascolto su http://${HOST}:${PORT}`);
});
