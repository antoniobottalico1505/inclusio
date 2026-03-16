import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const page = document.body?.dataset?.page || 'landing';

const STRIPE_LINKS = {
  plusMonthly: import.meta.env.VITE_STRIPE_LINK_PLUS_MONTHLY || '',
  plusYearly: import.meta.env.VITE_STRIPE_LINK_PLUS_YEARLY || ''
};

const PLAN_CATALOG = [
  {
    key: 'solo',
    audience: 'Per iniziare',
    name: 'Solo',
    price: '€0',
    period: '/mese',
    description: 'Per esplorare il prodotto e provare la demo senza impegno.',
    features: [
      'accesso alla demo prodotto',
      'gruppi aperti e onboarding base',
      'check-in e segnalazioni',
      'aggiornamenti dalla lista d’attesa'
    ],
    ctaLabel: 'Apri la demo',
    ctaHref: '/app',
    segment: 'consumer'
  },
  {
    key: 'plus-monthly',
    audience: 'Uso personale',
    name: 'Plus Mensile',
    price: '€12,90',
    period: '/mese',
    description: 'Per chi vuole più continuità, introduzioni curate e percorsi sociali guidati.',
    features: [
      'introduzioni sociali curate',
      'slot prioritari nei cerchi guidati',
      'match buddy potenziati',
      'percorsi suggeriti personalizzati'
    ],
    ctaLabel: 'Attiva Plus',
    ctaHref: STRIPE_LINKS.plusMonthly || '/waitlist',
    highlight: true,
    segment: 'consumer'
  },
  {
    key: 'plus-yearly',
    audience: 'Uso personale',
    name: 'Plus Annuale',
    price: '€119',
    period: '/anno',
    description: 'Versione annuale per chi vuole usare Inclusio con continuità.',
    features: [
      'tutto del piano Plus',
      'risparmio rispetto al mensile',
      'accesso continuativo',
      'priorità sulle novità'
    ],
    ctaLabel: 'Attiva Annuale',
    ctaHref: STRIPE_LINKS.plusYearly || '/waitlist',
    segment: 'consumer'
  },
  {
    key: 'school-starter',
    audience: 'Scuole e community',
    name: 'School Starter',
    price: 'da €1.990',
    period: '/anno',
    description: 'Per istituti e community che vogliono migliorare integrazione e onboarding.',
    features: [
      'dashboard istituto',
      'cerchi guidati per nuovi ingressi',
      'report base',
      'setup iniziale'
    ],
    ctaLabel: 'Richiedi demo',
    ctaHref: '/schools',
    segment: 'schools'
  },
  {
    key: 'school-pro',
    audience: 'Campus e organizzazioni',
    name: 'School Pro',
    price: 'da €3.990',
    period: '/anno',
    description: 'Per contesti più grandi che richiedono più sedi, più referenti e più visibilità.',
    features: [
      'tutto dello Starter',
      'supporto prioritario',
      'report avanzati',
      'configurazione multi-segmento'
    ],
    ctaLabel: 'Parla con noi',
    ctaHref: '/schools',
    segment: 'schools'
  }
];

const state = {
  userId: localStorage.getItem('inclusio_user_id') || '',
  interests: [],
  summary: null,
  insights: null,
  marketing: null,
  toastTimer: null
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function collectChecked(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((node) => node.value);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showToast(message, tone = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${tone === 'error' ? 'toast-error' : ''}`;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  if (!API_BASE) {
    throw new Error('Configurazione mancante: VITE_API_BASE_URL');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Operazione non riuscita.');
  }

  return payload;
}

function renderPlanCards(targetId, plans = PLAN_CATALOG) {
  const node = document.getElementById(targetId);
  if (!node) return;

  node.innerHTML = plans
    .map(
      (plan) => `
        <article class="pricing-card ${plan.highlight ? 'highlight' : ''}">
          <div class="eyebrow">${escapeHtml(plan.audience)}</div>
          <h3>${escapeHtml(plan.name)}</h3>
          <p>${escapeHtml(plan.description)}</p>
          <div class="plan-price">
            <strong>${escapeHtml(plan.price)}</strong>
            <small>${escapeHtml(plan.period || '')}</small>
          </div>
          <ul class="check-list">
            ${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}
          </ul>
          <a class="button ${plan.highlight ? 'button-primary' : 'button-secondary'}" href="${escapeHtml(plan.ctaHref)}" ${/^https?:/i.test(plan.ctaHref) ? 'target="_blank" rel="noreferrer"' : ''}>${escapeHtml(plan.ctaLabel)}</a>
        </article>
      `
    )
    .join('');
}

function renderValueCards() {
  const node = document.getElementById('value-points');
  if (!node) return;

  const items = [
    {
      title: 'Piccoli gruppi curati',
      text: 'Cerchi con obiettivi chiari, contesti più semplici da vivere e meno dispersione sociale.'
    },
    {
      title: 'Buddy introduttivi',
      text: 'Una persona ponte aiuta i nuovi ingressi a sentirsi accolti fin dal primo momento.'
    },
    {
      title: 'Strumenti per scuole',
      text: 'Dashboard, onboarding e segnali leggeri per chi gestisce gruppi, classi e community.'
    }
  ];

  node.innerHTML = items
    .map(
      (item) => `
        <article class="feature-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `
    )
    .join('');
}

function renderSteps() {
  const node = document.getElementById('steps-grid');
  if (!node) return;

  const items = [
    {
      title: '1. Entra',
      text: 'Profilo leggero, interessi essenziali e obiettivi sociali dichiarati in modo semplice.'
    },
    {
      title: '2. Connettiti',
      text: 'Buddy, cerchi guidati e attività a basso attrito aiutano a rompere il ghiaccio.'
    },
    {
      title: '3. Resta dentro',
      text: 'Check-in, suggerimenti e supporto organizzativo mantengono le relazioni più vive.'
    }
  ];

  node.innerHTML = items
    .map(
      (item) => `
        <article class="feature-card step-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `
    )
    .join('');
}

function renderInterestOptions(interests) {
  const node = document.getElementById('interest-options');
  if (!node) return;

  node.innerHTML = interests
    .map(
      (interest) => `
        <label class="chip-option">
          <input type="checkbox" name="interests" value="${escapeHtml(interest)}" />
          <span>${escapeHtml(interest)}</span>
        </label>
      `
    )
    .join('');
}

function renderDemoPersonas(users = []) {
  const node = document.getElementById('demo-personas');
  if (!node) return;

  node.innerHTML = users
    .map(
      (user) => `
        <button type="button" class="persona-pill" data-demo-user="${escapeHtml(user.id)}">
          ${escapeHtml(user.name)} · ${escapeHtml(user.city)}
        </button>
      `
    )
    .join('');
}

function renderTopMetrics() {
  if (!state.insights) return;
  setText('metric-groups', String(state.insights.groups || 0));
  setText('metric-inclusion', `${state.insights.averageInclusion || 0}/5`);
  setText('metric-buddies', String(state.insights.buddyEligible || 0));
}

function renderBuddy() {
  const container = document.getElementById('buddy-content');
  const buddy = state.summary?.buddy;
  if (!container) return;

  if (!buddy) {
    container.innerHTML = '<p class="muted">Nessuna persona ponte disponibile in questo momento.</p>';
    return;
  }

  container.innerHTML = `
    <div class="stack-xs">
      <div class="meta-row">
        <span>${escapeHtml(buddy.city || 'Online')}</span>
        <span>${buddy.mentor ? 'Mentor' : 'Peer'}</span>
      </div>
      <h4>${escapeHtml(buddy.name)}</h4>
      <p>${escapeHtml(buddy.note || 'Compatibilità alta con il tuo profilo.')}</p>
      <div class="tag-row">
        ${(buddy.sharedInterests || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('') || '<span class="tag">Compatibilità generale</span>'}
      </div>
    </div>
  `;
}

function renderActionPlan() {
  const list = document.getElementById('next-actions');
  const actions = state.summary?.actionPlan || [];
  if (!list) return;
  list.innerHTML = actions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderRecommendedGroups() {
  const container = document.getElementById('recommended-groups');
  const groups = state.summary?.recommendations || [];
  if (!container) return;

  if (!groups.length) {
    container.innerHTML = '<p class="muted">Nessun gruppo consigliato disponibile in questo momento.</p>';
    return;
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <article class="entity-card">
          <div class="meta-row">
            <span>${escapeHtml(group.city)}</span>
            <span>Match ${escapeHtml(group.matchScore)}</span>
            <span>Posti liberi ${escapeHtml(group.spotsLeft)}</span>
          </div>
          <h4>${escapeHtml(group.name)}</h4>
          <p>${escapeHtml(group.description)}</p>
          <div class="tag-row">${group.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <ul class="reason-list">${(group.matchReasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          <button class="button button-primary" data-action="join-group" data-group-id="${escapeHtml(group.id)}">Entra nel gruppo</button>
        </article>
      `
    )
    .join('');
}

function renderMyGroups() {
  const container = document.getElementById('my-groups');
  const groups = state.summary?.myGroups || [];
  if (!container) return;

  if (!groups.length) {
    container.innerHTML = '<p class="muted">Non hai ancora gruppi attivi. Parti da un cerchio consigliato.</p>';
    return;
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <article class="entity-card">
          <div class="meta-row">
            <span>${escapeHtml(group.city)}</span>
            <span>${escapeHtml(group.memberCount)}/${escapeHtml(group.sizeLimit)} membri</span>
            <span>Comfort ${escapeHtml(group.targetComfort)}/5</span>
          </div>
          <h4>${escapeHtml(group.name)}</h4>
          <p>${escapeHtml(group.description)}</p>
          <div class="tag-row">${group.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <div class="stack-sm">
            ${group.activities
              .map(
                (activity) => `
                  <div class="activity-card">
                    <div class="meta-row">
                      <span>${escapeHtml(activity.when)}</span>
                      <span>${escapeHtml(activity.mode)}</span>
                      <span>RSVP ${escapeHtml(activity.rsvps.length)}</span>
                    </div>
                    <h5>${escapeHtml(activity.title)}</h5>
                    <p>${escapeHtml(activity.description)}</p>
                    <button class="button button-secondary" data-action="toggle-rsvp" data-group-id="${escapeHtml(group.id)}" data-activity-id="${escapeHtml(activity.id)}">
                      ${activity.rsvps.includes(state.userId) ? 'Annulla partecipazione' : 'Partecipo'}
                    </button>
                  </div>
                `
              )
              .join('')}
          </div>
          <button class="button button-ghost" data-action="leave-group" data-group-id="${escapeHtml(group.id)}">Esci dal gruppo</button>
        </article>
      `
    )
    .join('');
}

function renderCheckins() {
  const container = document.getElementById('recent-checkins');
  const checkins = state.summary?.checkins || [];
  if (!container) return;

  if (!checkins.length) {
    container.innerHTML = '<p class="muted">Nessun check-in registrato finora.</p>';
    return;
  }

  container.innerHTML = checkins
    .slice(0, 5)
    .map(
      (item) => `
        <article class="log-card">
          <div class="meta-row">
            <span>${escapeHtml(formatDate(item.createdAt))}</span>
            <span>Inclusione ${escapeHtml(item.included)}/5</span>
            <span>Ansia ${escapeHtml(item.anxiety)}/5</span>
          </div>
          <p>${escapeHtml(item.note || 'Nessuna nota aggiuntiva.')}</p>
        </article>
      `
    )
    .join('');
}

function renderReports() {
  const container = document.getElementById('recent-reports');
  const reports = state.summary?.reports || [];
  if (!container) return;

  if (!reports.length) {
    container.innerHTML = '<p class="muted">Nessuna segnalazione aperta.</p>';
    return;
  }

  container.innerHTML = reports
    .slice(0, 5)
    .map(
      (report) => `
        <article class="log-card">
          <div class="meta-row">
            <span>${escapeHtml(report.category)}</span>
            <span>${escapeHtml(report.severity)}</span>
            <span>${escapeHtml(formatDate(report.createdAt))}</span>
          </div>
          <strong>Stato: ${escapeHtml(report.statusLabel || report.status)}</strong>
          <p>${escapeHtml(report.details || 'Nessun dettaglio disponibile.')}</p>
        </article>
      `
    )
    .join('');
}

function renderSummary() {
  const panel = document.getElementById('app-panel');
  const summary = state.summary;
  if (!panel) return;

  if (!summary) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  document.getElementById('app-fallback')?.classList.add('hidden');

  setText('welcome-name', `Ciao ${summary.user.name}`);
  setText('belonging-score', String(summary.stats.belongingScore));
  setText('joined-groups', String(summary.stats.joinedGroups));
  setText('planned-activities', String(summary.stats.plannedActivities));
  setText('anxiety-average', `${summary.stats.recentAnxietyAverage}/5`);
  setText('insight-users', String(state.insights?.users || 0));
  setText('insight-average-inclusion', `${state.insights?.averageInclusion || 0}/5`);
  setText('insight-open-reports', String(state.insights?.openReports || 0));
  setText('insight-waitlist', String(state.insights?.waitlistCount || 0));

  const interestsNode = document.getElementById('user-interests');
  if (interestsNode) {
    interestsNode.innerHTML = summary.user.interests.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('');
  }

  const accessibilityNode = document.getElementById('user-accessibility');
  if (accessibilityNode) {
    accessibilityNode.textContent = summary.user.accessibility || 'Nessuna preferenza dichiarata.';
  }

  renderActionPlan();
  renderBuddy();
  renderRecommendedGroups();
  renderMyGroups();
  renderCheckins();
  renderReports();
  renderDemoPersonas(state.marketing?.demoUsers || []);
}

async function refreshBootstrap() {
  const query = state.userId ? `?userId=${encodeURIComponent(state.userId)}` : '';
  const payload = await api(`/api/bootstrap${query}`);
  state.interests = payload.interests || [];
  state.insights = payload.insights || null;
  state.summary = payload.summary || null;
  state.marketing = payload.marketing || null;
  renderInterestOptions(state.interests);
  renderTopMetrics();
  renderDemoPersonas(payload.marketing?.demoUsers || []);
  renderSummary();
}

async function loadUser(userId) {
  try {
    const summary = await api(`/api/users/${encodeURIComponent(userId)}`);
    state.userId = userId;
    localStorage.setItem('inclusio_user_id', userId);
    state.summary = summary;
    state.insights = await api('/api/insights');
    renderTopMetrics();
    renderSummary();
  } catch (error) {
    if (/Profilo non trovato/i.test(error.message)) {
      state.userId = '';
      state.summary = null;
      localStorage.removeItem('inclusio_user_id');
      await refreshBootstrap();
      renderSummary();
      showToast('Il profilo salvato non esiste più. Selezionane o creane uno nuovo.');
      return;
    }

    throw error;
  }
}

async function handleOnboarding(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const interests = collectChecked('interests').slice(0, 8);

  if (!interests.length) {
    showToast('Seleziona almeno un interesse.', 'error');
    return;
  }

  try {
    const payload = await api('/api/users/onboard', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value.trim(),
        city: form.city.value.trim(),
        comfort: Number(form.comfort.value),
        energy: Number(form.energy.value),
        accessibility: form.accessibility.value.trim(),
        interests,
        goals: collectChecked('goals')
      })
    });

    state.userId = payload.user.id;
    localStorage.setItem('inclusio_user_id', state.userId);
    state.summary = payload.summary;
    state.insights = payload.insights || state.insights;
    form.reset();
    renderSummary();
    showToast('Profilo creato. Ora puoi esplorare buddy, gruppi e attività.');
    await refreshBootstrap();
    document.getElementById('personal-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleCheckin(event) {
  event.preventDefault();
  if (!state.userId) {
    showToast('Seleziona o crea prima un profilo.', 'error');
    return;
  }

  const form = event.currentTarget;

  try {
    const payload = await api('/api/checkins', {
      method: 'POST',
      body: JSON.stringify({
        userId: state.userId,
        included: Number(form.included.value),
        energy: Number(form.energy.value),
        anxiety: Number(form.anxiety.value),
        note: form.note.value.trim()
      })
    });

    state.summary = payload.summary;
    state.insights = payload.insights;
    renderTopMetrics();
    renderSummary();
    form.reset();
    showToast('Check-in salvato.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleReport(event) {
  event.preventDefault();
  if (!state.userId) {
    showToast('Seleziona o crea prima un profilo.', 'error');
    return;
  }

  const form = event.currentTarget;

  try {
    const payload = await api('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        userId: state.userId,
        category: form.category.value,
        severity: form.severity.value,
        details: form.details.value.trim()
      })
    });

    state.summary = payload.summary;
    state.insights = payload.insights;
    renderTopMetrics();
    renderSummary();
    form.reset();
    showToast('Segnalazione inviata con successo.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleWaitlist(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const payload = await api('/api/waitlist', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        role: form.role.value,
        goal: form.goal.value
      })
    });

    form.reset();
    showToast(payload.message || 'Iscrizione confermata.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handlePartnerLead(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const payload = await api('/api/partner-leads', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        organization: form.organization.value.trim(),
        goal: form.goal.value,
        message: form.message.value.trim()
      })
    });

    form.reset();
    showToast(payload.message || 'Richiesta ricevuta.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleActionClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button || !state.userId) return;

  const action = button.dataset.action;
  const groupId = button.dataset.groupId;
  const activityId = button.dataset.activityId;

  try {
    let payload = null;

    if (action === 'join-group') {
      payload = await api(`/api/groups/${encodeURIComponent(groupId)}/join`, {
        method: 'POST',
        body: JSON.stringify({ userId: state.userId })
      });
    } else if (action === 'leave-group') {
      payload = await api(`/api/groups/${encodeURIComponent(groupId)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ userId: state.userId })
      });
    } else if (action === 'toggle-rsvp') {
      payload = await api(`/api/groups/${encodeURIComponent(groupId)}/activities/${encodeURIComponent(activityId)}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ userId: state.userId })
      });
    }

    if (payload?.summary) {
      state.summary = payload.summary;
      showToast(payload.message || 'Operazione completata.');
      state.insights = await api('/api/insights');
      renderTopMetrics();
      renderSummary();
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function handlePersonaClick(event) {
  const button = event.target.closest('[data-demo-user]');
  if (!button) return;
  loadUser(button.dataset.demoUser).catch((error) => showToast(error.message, 'error'));
}

function handleLogout() {
  state.userId = '';
  state.summary = null;
  localStorage.removeItem('inclusio_user_id');
  renderSummary();
  renderDemoPersonas(state.marketing?.demoUsers || []);
  showToast('Profilo deselezionato.');
}

function bootstrapLanding() {
  renderPlanCards('featured-plans', PLAN_CATALOG.filter((plan) => ['solo', 'plus-monthly', 'school-starter'].includes(plan.key)));
  renderValueCards();
  renderSteps();
}

function bootstrapPricing() {
  renderPlanCards('pricing-plans', PLAN_CATALOG);
}

function bootstrapSchools() {
  renderPlanCards('schools-plans', PLAN_CATALOG.filter((plan) => plan.segment === 'schools'));
  document.getElementById('partner-form')?.addEventListener('submit', handlePartnerLead);
}

function bootstrapWaitlistPage() {
  renderPlanCards('mini-pricing', PLAN_CATALOG.filter((plan) => ['solo', 'plus-monthly'].includes(plan.key)));
  document.getElementById('waitlist-form')?.addEventListener('submit', handleWaitlist);
}

function showAppFallback(message) {
  document.getElementById('app-panel')?.classList.add('hidden');
  const fallback = document.getElementById('app-fallback');
  if (!fallback) return;
  fallback.classList.remove('hidden');
  const p = fallback.querySelector('p');
  if (p && message) p.innerHTML = message;
}

async function bootstrapAppPage() {
  document.getElementById('onboarding-form')?.addEventListener('submit', handleOnboarding);
  document.getElementById('checkin-form')?.addEventListener('submit', handleCheckin);
  document.getElementById('report-form')?.addEventListener('submit', handleReport);
  document.getElementById('demo-personas')?.addEventListener('click', handlePersonaClick);
  document.getElementById('app-panel')?.addEventListener('click', handleActionClick);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  try {
    await refreshBootstrap();
    if (state.userId && !state.summary) {
      await loadUser(state.userId);
    }
  } catch (error) {
    console.error('Bootstrap error:', error, 'API_BASE=', API_BASE);
    const message = !API_BASE
      ? 'Controlla <strong>VITE_API_BASE_URL</strong> su Vercel e pubblica di nuovo il frontend.'
      : 'Controlla che il backend Render sia online e che <strong>CORS_ORIGIN</strong> includa il dominio Vercel.';
    showAppFallback(message);
    showToast(API_BASE ? `Connessione al backend non riuscita: ${error?.message || 'Failed to fetch'}` : 'Configurazione mancante: VITE_API_BASE_URL', 'error');
  }
}

async function bootstrap() {
  if (page === 'landing') {
    bootstrapLanding();
  } else if (page === 'pricing') {
    bootstrapPricing();
  } else if (page === 'waitlist') {
    bootstrapWaitlistPage();
  } else if (page === 'schools') {
    bootstrapSchools();
  } else if (page === 'app') {
    await bootstrapAppPage();
  }
}

bootstrap().catch((error) => {
  console.error('Global bootstrap error:', error);
  showToast('Si è verificato un errore inatteso.', 'error');
});
