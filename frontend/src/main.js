import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const state = {
  userId: localStorage.getItem('inclusio_user_id') || '',
  interests: [],
  summary: null,
  insights: null,
  marketing: null,
  toastTimer: null
};

const ui = {
  onboardingForm: document.getElementById('onboarding-form'),
  checkinForm: document.getElementById('checkin-form'),
  reportForm: document.getElementById('report-form'),
  waitlistForm: document.getElementById('waitlist-form'),
  partnerForm: document.getElementById('partner-form'),
  interestOptions: document.getElementById('interest-options'),
  appPanel: document.getElementById('app-panel'),
  demoPersonas: document.getElementById('demo-personas'),
  pricingCards: document.getElementById('pricing-cards'),
  faqList: document.getElementById('faq-list'),
  toast: document.getElementById('toast'),
  logoutBtn: document.getElementById('logout-btn')
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

function showToast(message, tone = 'default') {
  if (!ui.toast) return;
  ui.toast.textContent = message;
  ui.toast.style.background = tone === 'error' ? 'rgba(157, 46, 74, 0.95)' : 'rgba(24, 48, 65, 0.92)';
  ui.toast.classList.add('show');
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderInterestOptions(interests) {
  ui.interestOptions.innerHTML = interests
    .map(
      (interest) => `
        <label class="pill-option">
          <input type="checkbox" name="interests" value="${escapeHtml(interest)}" />
          ${escapeHtml(interest)}
        </label>
      `
    )
    .join('');
}

function renderPricing(plans = []) {
  ui.pricingCards.innerHTML = plans
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
        </article>
      `
    )
    .join('');
}

function renderFaqs(faqs = []) {
  ui.faqList.innerHTML = faqs
    .map(
      (item) => `
        <article class="faq-item">
          <h3>${escapeHtml(item.q)}</h3>
          <p>${escapeHtml(item.a)}</p>
        </article>
      `
    )
    .join('');
}

function renderDemoPersonas(users = []) {
  ui.demoPersonas.innerHTML = users
    .map(
      (user) => `
        <button class="persona-chip ${state.userId === user.id ? 'active' : ''}" data-demo-user="${user.id}">
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
    container.innerHTML = '<div class="buddy-card"><p class="support-text">Nessuna persona ponte disponibile ora.</p></div>';
    return;
  }

  container.innerHTML = `
    <article class="buddy-card">
      <div class="meta-row">
        <span class="meta-pill">${escapeHtml(buddy.city || 'Online')}</span>
        <span class="meta-pill">${buddy.mentor ? 'Mentor' : 'Peer'}</span>
      </div>
      <h4>${escapeHtml(buddy.name)}</h4>
      <p>${escapeHtml(buddy.note || 'Compatibilità alta con il tuo profilo.')}</p>
      <div class="chips">
        ${(buddy.sharedInterests || []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') || '<span class="chip">Compatibilità generale</span>'}
      </div>
    </article>
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
    container.innerHTML = '<article class="group-card"><p class="support-text">Nessun gruppo consigliato disponibile in questo momento.</p></article>';
    return;
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <article class="group-card">
          <div class="meta-row">
            <span class="meta-pill">${escapeHtml(group.city)}</span>
            <span class="meta-pill">Match ${group.matchScore}</span>
            <span class="meta-pill">Posti liberi ${group.spotsLeft}</span>
          </div>
          <h4>${escapeHtml(group.name)}</h4>
          <p>${escapeHtml(group.description)}</p>
          <div class="chips">
            ${group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="meta-row">
            ${(group.matchReasons || []).map((reason) => `<span class="meta-pill">${escapeHtml(reason)}</span>`).join('')}
          </div>
          <div class="group-actions">
            <button class="primary-btn" data-action="join-group" data-group-id="${group.id}">Entra nel gruppo</button>
          </div>
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
    container.innerHTML = '<article class="group-card"><p class="support-text">Non hai ancora gruppi attivi. Parti da un cerchio consigliato.</p></article>';
    return;
  }

  container.innerHTML = groups
    .map(
      (group) => `
        <article class="group-card">
          <div class="meta-row">
            <span class="meta-pill">${escapeHtml(group.city)}</span>
            <span class="meta-pill">${group.memberCount}/${group.sizeLimit} membri</span>
            <span class="meta-pill">Comfort ${group.targetComfort}/5</span>
          </div>
          <h4>${escapeHtml(group.name)}</h4>
          <p>${escapeHtml(group.description)}</p>
          <div class="chips">
            ${group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="activity-list">
            ${group.activities
              .map(
                (activity) => `
                  <div class="activity-block">
                    <strong>${escapeHtml(activity.title)}</strong>
                    <div class="activity-row timeline-meta">
                      <span class="meta-pill">${escapeHtml(activity.when)}</span>
                      <span class="meta-pill">${escapeHtml(activity.mode)}</span>
                      <span class="meta-pill">RSVP ${activity.rsvps.length}</span>
                    </div>
                    <p>${escapeHtml(activity.description)}</p>
                    <div class="inline-actions">
                      <button class="secondary-btn" data-action="toggle-rsvp" data-group-id="${group.id}" data-activity-id="${activity.id}">
                        ${activity.rsvps.includes(state.userId) ? 'Annulla partecipazione' : 'Partecipo'}
                      </button>
                    </div>
                  </div>
                `
              )
              .join('')}
          </div>
          <div class="group-actions">
            <button class="ghost-btn" data-action="leave-group" data-group-id="${group.id}">Esci dal gruppo</button>
          </div>
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
    container.innerHTML = '<article class="timeline-item"><p class="support-text">Nessun check-in registrato finora.</p></article>';
    return;
  }

  container.innerHTML = checkins
    .slice(0, 5)
    .map(
      (item) => `
        <article class="timeline-item">
          <div class="meta-row">
            <span class="meta-pill">${formatDate(item.createdAt)}</span>
            <span class="meta-pill">Inclusione ${item.included}/5</span>
            <span class="meta-pill">Ansia ${item.anxiety}/5</span>
          </div>
          <strong>Momento registrato</strong>
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
    container.innerHTML = '<article class="timeline-item"><p class="support-text">Nessuna segnalazione aperta.</p></article>';
    return;
  }

  container.innerHTML = reports
    .slice(0, 5)
    .map(
      (report) => `
        <article class="timeline-item">
          <div class="meta-row">
            <span class="meta-pill">${escapeHtml(report.category)}</span>
            <span class="meta-pill">${escapeHtml(report.severity)}</span>
            <span class="meta-pill">${formatDate(report.createdAt)}</span>
          </div>
          <strong>Stato: ${escapeHtml(report.statusLabel || report.status)}</strong>
          <p>${escapeHtml(report.details || 'Nessun dettaglio disponibile.')}</p>
        </article>
      `
    )
    .join('');
}

function renderSummary() {
  const summary = state.summary;
  if (!summary) {
    ui.appPanel.classList.add('hidden');
    return;
  }

  ui.appPanel.classList.remove('hidden');
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
    interestsNode.innerHTML = summary.user.interests.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');
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
  renderPricing(payload.marketing?.plans || []);
  renderFaqs(payload.marketing?.faqs || []);
  renderDemoPersonas(payload.marketing?.demoUsers || []);
  renderSummary();
}

async function loadUser(userId) {
  const summary = await api(`/api/users/${encodeURIComponent(userId)}`);
  state.userId = userId;
  localStorage.setItem('inclusio_user_id', userId);
  state.summary = summary;
  const insights = await api('/api/insights');
  state.insights = insights;
  renderTopMetrics();
  renderSummary();
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
    document.getElementById('platform')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    state.insights = await api('/api/insights');
    renderTopMetrics();
    renderSummary();
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
    state.insights = await api('/api/insights');
    renderTopMetrics();
    renderSummary();
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
      const insights = await api('/api/insights');
      state.insights = insights;
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

async function bootstrap() {
  ui.onboardingForm?.addEventListener('submit', handleOnboarding);
  ui.checkinForm?.addEventListener('submit', handleCheckin);
  ui.reportForm?.addEventListener('submit', handleReport);
  ui.waitlistForm?.addEventListener('submit', handleWaitlist);
  ui.partnerForm?.addEventListener('submit', handlePartnerLead);
  ui.demoPersonas?.addEventListener('click', handlePersonaClick);
  ui.appPanel?.addEventListener('click', handleActionClick);
  ui.logoutBtn?.addEventListener('click', handleLogout);

  try {
    await refreshBootstrap();
    if (state.userId && !state.summary) {
      await loadUser(state.userId);
    }
  } catch (error) {
    showToast('Impossibile collegarsi al backend. Controlla URL e deploy.', 'error');
  }
}

bootstrap();
