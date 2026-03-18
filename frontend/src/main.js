import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const appState = {
  currentUserId: null,
  currentSummary: null,
  bootstrap: null
};

const $ = (selector) => document.querySelector(selector);

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getJson(path) {
  if (!API_BASE) {
    throw new Error('Configura VITE_API_BASE_URL nel frontend.');
  }

  const res = await fetch(`${API_BASE}${path}`);
  const payload = await res.json();

  if (!res.ok) {
    throw new Error(payload.error || 'Operazione non riuscita.');
  }

  return payload;
}

async function sendJson(path, body) {
  if (!API_BASE) {
    throw new Error('Configura VITE_API_BASE_URL nel frontend.');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(payload.error || 'Operazione non riuscita.');
  }

  return payload;
}

function showResult(selector, message) {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
}

function normalizeList(value, max = 8) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function metricCard(label, value, meta = '') {
  return `
    <div class="card" style="display:grid; gap:8px;">
      <div class="kicker">${esc(label)}</div>
      <div style="font-size:2rem; font-weight:700;">${esc(value)}</div>
      ${meta ? `<div class="muted">${esc(meta)}</div>` : ''}
    </div>
  `;
}

function emptyCard(message) {
  return `
    <div class="card">
      <p>${esc(message)}</p>
    </div>
  `;
}

function wireForm(selector, path, successSelector) {
  const form = $(selector);
  const success = $(successSelector);

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Invio in corso...';
    }

    try {
      const payload = await sendJson(path, data);

      if (success) {
        success.textContent = payload.message || 'Richiesta inviata correttamente.';
        success.classList.add('show');
      }

      form.reset();
    } catch (error) {
      if (success) {
        success.textContent = error.message || 'Invio non riuscito.';
        success.classList.add('show');
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Invia';
      }
    }
  });
}

function wirePlusCheckout() {
  const form = $('#plus-checkout-form');
  const buttons = document.querySelectorAll('[data-plus-plan]');
  const result = $('#plus-checkout-result');

  if (!form || !buttons.length) return;

  const params = new URLSearchParams(window.location.search);

  if (result && params.get('checkout') === 'success') {
    result.textContent = 'Pagamento completato. Il piano Plus risulta in attivazione automatica.';
    result.classList.add('show');
  }

  if (result && params.get('checkout') === 'cancelled') {
    result.textContent = 'Checkout annullato. Nessuna attivazione eseguita.';
    result.classList.add('show');
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const contactName = form.elements.contactName?.value.trim() || '';
      const billingEmail = form.elements.billingEmail?.value.trim() || '';
      const planCode = button.dataset.plusPlan || '';

      if (!billingEmail) {
        showResult('#plus-checkout-result', 'Inserisci l’email prima del pagamento.');
        return;
      }

      const originalLabel = button.textContent;
      buttons.forEach((node) => {
        node.disabled = true;
      });

      button.textContent = 'Reindirizzamento...';

      try {
        const payload = await sendJson('/api/billing/plus-checkout', {
          contactName,
          billingEmail,
          planCode
        });

        if (!payload.url) {
          throw new Error('URL checkout mancante.');
        }

        window.location.href = payload.url;
      } catch (error) {
        showResult('#plus-checkout-result', error.message || 'Impossibile aprire il checkout.');
        buttons.forEach((node) => {
          node.disabled = false;
        });
        button.textContent = originalLabel;
      }
    });
  });
}

function getSchoolCheckoutContext() {
  const schoolForm = $('#school-checkout-form');

  if (schoolForm) {
    return {
      contactName: schoolForm.elements.contactName?.value.trim() || '',
      billingEmail: schoolForm.elements.billingEmail?.value.trim() || '',
      organization: schoolForm.elements.organization?.value.trim() || '',
      resultSelector: '#school-checkout-result'
    };
  }

  const partnerForm = $('#partner-form');

  if (partnerForm) {
    return {
      contactName: partnerForm.elements.name?.value.trim() || '',
      billingEmail: partnerForm.elements.email?.value.trim() || '',
      organization: partnerForm.elements.organization?.value.trim() || '',
      resultSelector: '#partner-result'
    };
  }

  return null;
}

function wireSchoolCheckout() {
  const buttons = document.querySelectorAll('[data-school-plan]');

  if (!buttons.length) return;

  const params = new URLSearchParams(window.location.search);
  const resultNode = $('#school-checkout-result') || $('#partner-result');

  if (resultNode && params.get('checkout') === 'success') {
    resultNode.textContent =
      'Pagamento completato. L’attivazione automatica della scuola è in corso.';
    resultNode.classList.add('show');
  }

  if (resultNode && params.get('checkout') === 'cancelled') {
    resultNode.textContent = 'Checkout annullato. Nessuna attivazione è stata eseguita.';
    resultNode.classList.add('show');
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();

      const context = getSchoolCheckoutContext();
      const resultSelector = context?.resultSelector || '#partner-result';

      if (!context) {
        showResult(resultSelector, 'Form scuola non trovato sulla pagina.');
        return;
      }

      if (!context.organization || !context.billingEmail) {
        showResult(resultSelector, 'Compila organizzazione ed email prima del pagamento.');
        return;
      }

      const originalLabel = button.textContent;

      buttons.forEach((node) => {
        node.disabled = true;
      });

      button.textContent = 'Reindirizzamento...';

      try {
        const payload = await sendJson('/api/billing/school-checkout', {
          organization: context.organization,
          billingEmail: context.billingEmail,
          contactName: context.contactName,
          planCode: button.dataset.schoolPlan || '',
          schoolSize: button.dataset.schoolSize || ''
        });

        if (!payload.url) {
          throw new Error('URL checkout mancante.');
        }

        window.location.href = payload.url;
      } catch (error) {
        showResult(resultSelector, error.message || 'Impossibile aprire il checkout.');
        buttons.forEach((node) => {
          node.disabled = false;
        });
        button.textContent = originalLabel;
      }
    });
  });
}

function renderInsights(insights) {
  const grid = $('#demo-insights-grid');
  if (!grid || !insights) return;

  grid.innerHTML = [
    metricCard('Utenti demo', insights.users),
    metricCard('Gruppi attivi', insights.groups),
    metricCard('Buddy disponibili', insights.buddyEligible),
    metricCard('Inclusione media', insights.averageInclusion),
    metricCard('Ansia media', insights.averageAnxiety),
    metricCard('Report aperti', insights.openReports)
  ].join('');
}

function renderDemoUsers(marketing) {
  const node = $('#demo-users');
  if (!node) return;

  const users = marketing?.demoUsers || [];

  if (!users.length) {
    node.innerHTML = emptyCard('Nessun utente demo disponibile.');
    return;
  }

  node.innerHTML = users
    .map(
      (user) => `
        <div class="card" style="display:grid; gap:8px;">
          <h3>${esc(user.name)}</h3>
          <p>${esc(user.city || 'Online')}</p>
        </div>
      `
    )
    .join('');
}

function renderStats(stats) {
  const node = $('#app-stats');
  if (!node || !stats) return;

  node.innerHTML = [
    metricCard('Belonging score', `${stats.belongingScore}/100`),
    metricCard('Gruppi attivi', stats.joinedGroups),
    metricCard('Attività pianificate', stats.plannedActivities),
    metricCard('Inclusione recente', stats.recentInclusionAverage),
    metricCard('Ansia recente', stats.recentAnxietyAverage),
    metricCard('Report aperti', stats.reportsOpen)
  ].join('');
}

function renderActionPlan(actions) {
  const node = $('#app-action-plan');
  if (!node) return;

  if (!actions?.length) {
    node.innerHTML = emptyCard('Nessuna azione prioritaria al momento.');
    return;
  }

  node.innerHTML = `
    <div class="card">
      <h3>Prossimi passi consigliati</h3>
      <ul>${actions.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderBuddy(buddy) {
  const node = $('#app-buddy');
  if (!node) return;

  if (!buddy) {
    node.innerHTML = emptyCard('Nessun buddy consigliato per ora.');
    return;
  }

  node.innerHTML = `
    <div class="card" style="display:grid; gap:8px;">
      <div class="kicker">Buddy suggerito</div>
      <h3>${esc(buddy.name)}</h3>
      <p>${esc(buddy.city || 'Online')}</p>
      <p><strong>Interessi condivisi:</strong> ${esc((buddy.sharedInterests || []).join(', ') || 'n/d')}</p>
      <p><strong>Profilo:</strong> ${buddy.mentor ? 'Mentor disponibile' : 'Peer match'}</p>
      ${buddy.note ? `<p>${esc(buddy.note)}</p>` : ''}
    </div>
  `;
}

function renderRecommendations(groups) {
  const node = $('#app-recommendations');
  if (!node) return;

  if (!groups?.length) {
    node.innerHTML = emptyCard('Nessun gruppo consigliato al momento.');
    return;
  }

  node.innerHTML = groups
    .map(
      (group) => `
        <article class="card" style="display:grid; gap:10px;">
          <div class="kicker">Match score ${esc(group.matchScore)}</div>
          <h3>${esc(group.name)}</h3>
          <p>${esc(group.description || '')}</p>
          <p><strong>Tag:</strong> ${esc((group.tags || []).join(', ') || 'n/d')}</p>
          <p><strong>Perché:</strong> ${esc((group.matchReasons || []).join(' · ') || 'Compatibilità generale')}</p>
          <button type="button" class="btn btn-primary" data-join-group="${esc(group.id)}">
            Entra nel gruppo
          </button>
        </article>
      `
    )
    .join('');
}

function renderMyGroups(groups) {
  const node = $('#app-my-groups');
  if (!node) return;

  if (!groups?.length) {
    node.innerHTML = emptyCard('Non hai ancora gruppi attivi.');
    return;
  }

  node.innerHTML = groups
    .map((group) => {
      const activities = (group.activities || [])
        .map(
          (activity) => `
            <div style="border-top:1px solid rgba(0,0,0,.08); padding-top:12px; display:grid; gap:8px;">
              <strong>${esc(activity.title)}</strong>
              <span>${esc(activity.when || '')}</span>
              <span>${esc(activity.location || '')}</span>
              <button
                type="button"
                class="btn btn-secondary"
                data-rsvp-group="${esc(group.id)}"
                data-rsvp-activity="${esc(activity.id)}"
              >
                RSVP / annulla RSVP
              </button>
            </div>
          `
        )
        .join('');

      return `
        <article class="card" style="display:grid; gap:12px;">
          <div class="kicker">Gruppo attivo</div>
          <h3>${esc(group.name)}</h3>
          <p>${esc(group.description || '')}</p>
          <p><strong>Membri:</strong> ${esc(group.memberCount)} · <strong>Posti liberi:</strong> ${esc(group.spotsLeft)}</p>
          <button type="button" class="btn btn-secondary" data-leave-group="${esc(group.id)}">
            Lascia il gruppo
          </button>
          ${activities || '<p>Nessuna attività pianificata.</p>'}
        </article>
      `;
    })
    .join('');
}

function renderCheckins(checkins) {
  const node = $('#app-checkins');
  if (!node) return;

  if (!checkins?.length) {
    node.innerHTML = emptyCard('Nessun check-in ancora registrato.');
    return;
  }

  node.innerHTML = checkins
    .slice(0, 5)
    .map(
      (item) => `
        <div class="card" style="display:grid; gap:8px;">
          <strong>${new Date(item.createdAt).toLocaleString('it-IT')}</strong>
          <span>Inclusione: ${esc(item.included)} · Energia: ${esc(item.energy)} · Ansia: ${esc(item.anxiety)}</span>
          ${item.note ? `<p>${esc(item.note)}</p>` : ''}
        </div>
      `
    )
    .join('');
}

function renderReports(reports) {
  const node = $('#app-reports');
  if (!node) return;

  if (!reports?.length) {
    node.innerHTML = emptyCard('Nessun report presente.');
    return;
  }

  node.innerHTML = reports
    .slice(0, 5)
    .map(
      (report) => `
        <div class="card" style="display:grid; gap:8px;">
          <strong>${esc(report.category)}</strong>
          <span>${esc(report.statusLabel || report.status || 'Aperta')} · Severità ${esc(report.severity)}</span>
          <p>${esc(report.details || '')}</p>
        </div>
      `
    )
    .join('');
}

function renderSummary(summary) {
  if (!summary) return;

  appState.currentSummary = summary;
  appState.currentUserId = summary.user?.id || appState.currentUserId;

  const emptyState = $('#app-empty-state');
  const liveShell = $('#app-live-shell');

  if (emptyState) emptyState.style.display = 'none';
  if (liveShell) liveShell.style.display = 'grid';

  renderStats(summary.stats);
  renderActionPlan(summary.actionPlan);
  renderBuddy(summary.buddy);
  renderRecommendations(summary.recommendations);
  renderMyGroups(summary.myGroups);
  renderCheckins(summary.checkins);
  renderReports(summary.reports);

  showResult('#app-status', `Profilo demo attivo: ${summary.user?.name || 'utente'}`);
}

async function loadBootstrap() {
  if (!API_BASE) return;

  try {
    const payload = await getJson('/api/bootstrap');
    appState.bootstrap = payload;
    renderInsights(payload.insights);
    renderDemoUsers(payload.marketing);
  } catch (error) {
    showResult('#platform-status', error.message || 'Impossibile caricare il backend.');
    showResult('#app-status', error.message || 'Impossibile caricare il backend.');
  }
}

function wireDemoOnboarding() {
  const form = $('#demo-onboard-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submit = form.querySelector('button[type="submit"]');

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Creazione profilo...';
    }

    try {
      const payload = await sendJson('/api/users/onboard', {
        name: form.elements.name.value.trim(),
        city: form.elements.city.value.trim(),
        comfort: Number(form.elements.comfort.value),
        energy: Number(form.elements.energy.value),
        accessibility: form.elements.accessibility.value.trim(),
        interests: normalizeList(form.elements.interests.value, 8),
        goals: normalizeList(form.elements.goals.value, 4)
      });

      renderSummary(payload.summary);
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Impossibile creare il profilo demo.');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Crea profilo demo';
      }
    }
  });
}

function wireCheckinForm() {
  const form = $('#app-checkin-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!appState.currentUserId) {
      showResult('#app-status', 'Crea prima un profilo demo.');
      return;
    }

    try {
      const payload = await sendJson('/api/checkins', {
        userId: appState.currentUserId,
        included: Number(form.elements.included.value),
        energy: Number(form.elements.energy.value),
        anxiety: Number(form.elements.anxiety.value),
        note: form.elements.note.value.trim()
      });

      renderSummary(payload.summary);
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Check-in non riuscito.');
    }
  });
}

function wireReportForm() {
  const form = $('#app-report-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!appState.currentUserId) {
      showResult('#app-status', 'Crea prima un profilo demo.');
      return;
    }

    try {
      const payload = await sendJson('/api/reports', {
        userId: appState.currentUserId,
        severity: form.elements.severity.value,
        category: form.elements.category.value.trim(),
        details: form.elements.details.value.trim()
      });

      renderSummary(payload.summary);
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Report non riuscito.');
    }
  });
}

function wireAppActions() {
  document.addEventListener('click', async (event) => {
    const joinButton = event.target.closest('[data-join-group]');
    const leaveButton = event.target.closest('[data-leave-group]');
    const rsvpButton = event.target.closest('[data-rsvp-group][data-rsvp-activity]');

    if (!appState.currentUserId) return;

    try {
      if (joinButton) {
        const payload = await sendJson(`/api/groups/${joinButton.dataset.joinGroup}/join`, {
          userId: appState.currentUserId
        });
        renderSummary(payload.summary);
        return;
      }

      if (leaveButton) {
        const payload = await sendJson(`/api/groups/${leaveButton.dataset.leaveGroup}/leave`, {
          userId: appState.currentUserId
        });
        renderSummary(payload.summary);
        return;
      }

      if (rsvpButton) {
        const payload = await sendJson(
          `/api/groups/${rsvpButton.dataset.rsvpGroup}/activities/${rsvpButton.dataset.rsvpActivity}/rsvp`,
          { userId: appState.currentUserId }
        );
        renderSummary(payload.summary);
      }
    } catch (error) {
      showResult('#app-status', error.message || 'Operazione non riuscita.');
    }
  });
}

wireForm('#waitlist-form', '/api/waitlist', '#waitlist-result');
wireForm('#partner-form', '/api/partner-leads', '#partner-result');
wirePlusCheckout();
wireSchoolCheckout();
wireDemoOnboarding();
wireCheckinForm();
wireReportForm();
wireAppActions();
loadBootstrap();