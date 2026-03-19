import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SESSION_STORAGE_KEY = 'inclusio.sessionToken';

const appState = {
  sessionToken: localStorage.getItem(SESSION_STORAGE_KEY) || '',
  currentSummary: null,
  bootstrap: null,
  me: null,
  subscription: null,
  organizationDashboard: null
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

function getAuthHeaders() {
  return appState.sessionToken
    ? {
        Authorization: `Bearer ${appState.sessionToken}`
      }
    : {};
}

function persistSessionToken(token = '') {
  appState.sessionToken = token || '';

  if (token) {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

async function requestJson(path, options = {}) {
  if (!API_BASE) {
    throw new Error('Configura VITE_API_BASE_URL nel frontend.');
  }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...getAuthHeaders(),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
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

function getJson(path) {
  return requestJson(path, { method: 'GET' });
}

function sendJson(path, body, method = 'POST') {
  return requestJson(path, { method, body });
}

function showResult(selector, message, kind = 'success') {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.remove('is-error', 'is-info');

  if (kind === 'error') node.classList.add('is-error');
  if (kind === 'info') node.classList.add('is-info');

  node.classList.add('show');
}

function clearResult(selector) {
  const node = $(selector);
  if (!node) return;
  node.textContent = '';
  node.classList.remove('show', 'is-error', 'is-info');
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
        showResult(successSelector, payload.message || 'Richiesta inviata correttamente.');
      }

      form.reset();
    } catch (error) {
      if (success) {
        showResult(successSelector, error.message || 'Invio non riuscito.', 'error');
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

  if (!form || !buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const contactName = form.elements.contactName?.value.trim() || appState.me?.user?.name || '';
      const billingEmail = form.elements.billingEmail?.value.trim() || appState.me?.user?.email || '';
      const planCode = button.dataset.plusPlan || '';

      if (!billingEmail) {
        showResult('#plus-checkout-result', 'Inserisci l’email del tuo account prima del pagamento.', 'error');
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
        showResult('#plus-checkout-result', error.message || 'Impossibile aprire il checkout.', 'error');
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
      billingEmail: schoolForm.elements.billingEmail?.value.trim() || appState.me?.user?.email || '',
      organization: schoolForm.elements.organization?.value.trim() || '',
      resultSelector: '#school-checkout-result'
    };
  }

  const partnerForm = $('#partner-form');

  if (partnerForm) {
    return {
      contactName: partnerForm.elements.name?.value.trim() || '',
      billingEmail: partnerForm.elements.email?.value.trim() || appState.me?.user?.email || '',
      organization: partnerForm.elements.organization?.value.trim() || '',
      resultSelector: '#partner-result'
    };
  }

  return null;
}

function wireSchoolCheckout() {
  const buttons = document.querySelectorAll('[data-school-plan]');

  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();

      const context = getSchoolCheckoutContext();
      const resultSelector = context?.resultSelector || '#partner-result';

      if (!context) {
        showResult(resultSelector, 'Form scuola non trovato sulla pagina.', 'error');
        return;
      }

      if (!context.organization || !context.billingEmail) {
        showResult(resultSelector, 'Compila organizzazione ed email prima del pagamento.', 'error');
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
        showResult(resultSelector, error.message || 'Impossibile aprire il checkout.', 'error');
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
    metricCard('Utenti attivi', insights.users),
    metricCard('Gruppi attivi', insights.groups),
    metricCard('Buddy disponibili', insights.buddyEligible),
    metricCard('Inclusione media', insights.averageInclusion),
    metricCard('Ansia media', insights.averageAnxiety),
    metricCard('Report aperti', insights.openReports)
  ].join('');
}

function renderDemoUsers(marketing) {
  const grid = $('#demo-users');
  if (!grid || !marketing) return;

  const users = marketing.demoUsers || [];

  if (!users.length) {
    grid.innerHTML = emptyCard('Nessun profilo visibile al momento.');
    return;
  }

  grid.innerHTML = users
    .map(
      (user) => `
        <article class="card" style="display:grid; gap:10px;">
          <div class="kicker">Community</div>
          <h3>${esc(user.name)}</h3>
          <p>${esc(user.city || 'Online')}</p>
        </article>
      `
    )
    .join('');
}

function renderDemoGroups(marketing) {
  const grid = $('#demo-groups');

  if (!grid || !marketing) return;

  const groups = marketing.demoGroups || [];

  if (!groups.length) {
    grid.innerHTML = emptyCard('Nessun gruppo demo visibile al momento.');
    return;
  }

  grid.innerHTML = groups
    .map(
      (group) => `
      <article class="card" style="display:grid; gap:10px;">
        <div class="kicker">${group.premiumOnly ? 'Demo premium' : 'Demo gruppo'}</div>
        <h3>${esc(group.name)}</h3>
        <p>${esc(group.description || '')}</p>
        <p><strong>Città:</strong> ${esc(group.city || 'Online')}</p>
        <p><strong>Membri demo:</strong> ${esc(group.memberCount || 0)} / ${esc(group.sizeLimit || 0)}</p>
        <p>${(group.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join(' ')}</p>
      </article>
      `
    )
    .join('');
}

function renderStats(stats) {
  const node = $('#app-stats');
  if (!node || !stats) return;

  node.innerHTML = [
    metricCard('Gruppi attivi', stats.joinedGroups || 0),
    metricCard('RSVP attivi', stats.rsvps || 0),
    metricCard('Check-in inviati', stats.checkins || 0),
    metricCard('Inclusione media', stats.averageInclusion || 0),
    metricCard('Ansia media', stats.averageAnxiety || 0),
    metricCard('Report aperti', stats.openReports || 0)
  ].join('');
}

function renderActionPlan(actionPlan = []) {
  const node = $('#app-action-plan');
  if (!node) return;

  if (!actionPlan.length) {
    node.innerHTML = emptyCard('Completa il profilo per ottenere un piano d’azione personalizzato.');
    return;
  }

  node.innerHTML = `
    <div class="card">
      <ul>
        ${actionPlan.map((item) => `<li>${esc(item)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderBuddy(buddy) {
  const node = $('#app-buddy');
  if (!node) return;

  if (!buddy) {
    node.innerHTML = emptyCard('Nessun buddy consigliato per ora. Aggiorna interessi e obiettivi.');
    return;
  }

  node.innerHTML = `
    <article class="card" style="display:grid; gap:12px;">
      <div class="kicker">Buddy suggerito</div>
      <h3>${esc(buddy.name)}</h3>
      <p>${esc(buddy.city || 'Online')}</p>
      <p>${esc(buddy.reason || 'Compatibilità elevata con il tuo profilo.')}</p>
    </article>
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
        <article class="card" style="display:grid; gap:12px;">
          <div class="kicker">Match ${esc(group.matchScore || 0)}</div>
          <h3>${esc(group.name)}</h3>
          <p>${esc(group.description || '')}</p>
          <p><strong>Città:</strong> ${esc(group.city || 'Online')}</p>
          <p><strong>Posti liberi:</strong> ${esc(group.spotsLeft)}</p>
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

function buildPremiumInsights(summary) {
  const checkins = summary?.checkins || [];
  const lastThree = checkins.slice(0, 3);

  if (!lastThree.length) {
    return [
      metricCard('Trend inclusione', 'n/d', 'Invia almeno un check-in per sbloccare il trend'),
      metricCard('Stabilità sociale', 'n/d', 'Servono dati per misurare la stabilità')
    ].join('');
  }

  const avgInclusion =
    lastThree.reduce((sum, item) => sum + Number(item.included || 0), 0) / lastThree.length;
  const avgAnxiety =
    lastThree.reduce((sum, item) => sum + Number(item.anxiety || 0), 0) / lastThree.length;

  const stability = Math.max(0, Math.round((avgInclusion * 20) - (avgAnxiety * 8)));

  return [
    metricCard('Trend inclusione', avgInclusion.toFixed(1), 'Media ultimi 3 check-in'),
    metricCard('Stabilità sociale', `${stability}/100`, 'Indice interno avanzato per la continuità')
  ].join('');
}

function renderSubscription(subscription) {
  const node = $('#app-plan-card');
  const premiumNode = $('#app-premium-insights');
  const upgradeNode = $('#app-upgrade-card');
  const orgNode = $('#app-org-dashboard');

  if (!node) return;

  const sub = subscription || {
    active: false,
    planCode: 'solo',
    planLabel: 'Solo',
    entitlements: { advancedInsights: false, orgDashboard: false }
  };

  node.innerHTML = `
    <div class="card" style="display:grid; gap:12px;">
      <div class="kicker">Piano attivo</div>
      <h3>${esc(sub.planLabel || 'Solo')}</h3>
      <p>${sub.active ? 'Abbonamento attivo e riconosciuto dal backend.' : 'Accesso gratuito attivo.'}</p>
      <ul>
        <li>Gruppi, buddy, check-in e report sempre disponibili</li>
        <li>${sub.entitlements?.advancedInsights ? 'Insight avanzati sbloccati' : 'Insight avanzati disponibili con Plus'}</li>
        <li>${sub.entitlements?.orgDashboard ? 'Dashboard organizzativa sbloccata' : 'Dashboard organizzativa non inclusa'}</li>
      </ul>
      ${sub.active ? '<a class="btn btn-secondary" href="/prezzi">Gestisci o cambia piano</a>' : '<a class="btn btn-primary" href="/prezzi">Attiva Plus</a>'}
    </div>
  `;

  if (premiumNode) {
    premiumNode.innerHTML = sub.entitlements?.advancedInsights
      ? buildPremiumInsights(appState.currentSummary)
      : emptyCard('Con Plus sblocchi insight avanzati e una lettura più utile dei tuoi check-in.');
  }

  if (upgradeNode) {
    upgradeNode.innerHTML = sub.entitlements?.advancedInsights
      ? ''
      : `
        <div class="card">
          <div class="kicker">Upgrade</div>
          <h3>Passa a Plus</h3>
          <p>Usa la stessa email del tuo account per far riconoscere automaticamente il piano dopo Stripe.</p>
          <a class="btn btn-primary" href="/prezzi">Vai ai piani</a>
        </div>
      `;
  }

  if (orgNode) {
    const dashboard = appState.organizationDashboard;

    orgNode.innerHTML = sub.entitlements?.orgDashboard && dashboard
      ? `
        <div class="card" style="display:grid; gap:16px;">
          <div class="kicker">Dashboard organizzativa</div>
          <h3>Vista responsabile</h3>
          <div style="display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
            ${metricCard('Utenti', dashboard.insights?.users || 0)}
            ${metricCard('Gruppi', dashboard.insights?.groups || 0)}
            ${metricCard('Report aperti', dashboard.insights?.openReports || 0)}
            ${metricCard('Waitlist', dashboard.insights?.waitlistCount || 0)}
          </div>
          <p>${(dashboard.organizations || []).length ? `Organizzazioni collegate: ${(dashboard.organizations || []).map((item) => esc(item.name)).join(', ')}` : 'Nessuna organizzazione associata a questa email.'}</p>
        </div>
      `
      : '';
  }
}

function applyAccountView(payload) {
  appState.me = payload;
  appState.currentSummary = payload.summary || null;
  appState.subscription = payload.subscription || null;
  appState.organizationDashboard = payload.organizationDashboard || null;

  const authShell = $('#auth-shell');
  const appShell = $('#app-live-shell');
  const profileSection = $('#app-profile-section');
  const authSummary = $('#auth-summary');
  const logoutButton = $('#app-logout-button');

  if (authShell) authShell.style.display = 'none';
  if (appShell) appShell.style.display = 'grid';
  if (profileSection) profileSection.style.display = 'grid';
  if (logoutButton) logoutButton.style.display = 'inline-flex';

  if (authSummary) {
    authSummary.innerHTML = `
      <div class="card">
        <div class="kicker">Account</div>
        <h3>${esc(payload.user?.name || 'Profilo')}</h3>
        <p>${esc(payload.user?.email || '')}</p>
        <p>${payload.user?.emailVerified ? 'Email verificata' : 'Email non verificata'}</p>
      </div>
    `;
  }

  fillProfileForm(payload.user || {});
  renderSummary(payload.summary);
  renderSubscription(payload.subscription);
}

function renderSummary(summary) {
  if (!summary) return;

  appState.currentSummary = summary;

  renderStats(summary.stats);
  renderActionPlan(summary.actionPlan);
  renderBuddy(summary.buddy);
  renderRecommendations(summary.recommendations);
  renderMyGroups(summary.myGroups);
  renderCheckins(summary.checkins);
  renderReports(summary.reports);

  showResult('#app-status', `Accesso attivo: ${summary.user?.name || 'utente'}`);
}

function fillProfileForm(user) {
  const form = $('#account-profile-form');
  if (!form || !user) return;

  form.elements.name.value = user.name || '';
  form.elements.city.value = user.city || '';
  form.elements.comfort.value = user.comfort || 3;
  form.elements.energy.value = user.energy || 3;
  form.elements.interests.value = Array.isArray(user.interests) ? user.interests.join(', ') : '';
  form.elements.goals.value = Array.isArray(user.goals) ? user.goals.join(', ') : '';
  form.elements.accessibility.value = user.accessibility || '';
}

async function refreshAuthenticatedUser() {
  if (!appState.sessionToken) return null;

  try {
    const payload = await getJson('/api/auth/me');
    applyAccountView(payload);
    return payload;
  } catch (error) {
    persistSessionToken('');
    showResult('#app-status', error.message || 'Sessione non valida. Effettua di nuovo l’accesso.', 'error');
    return null;
  }
}

async function loadBootstrap() {
  if (!API_BASE) return;

  try {
    const payload = await getJson('/api/bootstrap');
    appState.bootstrap = payload;
    renderInsights(payload.insights);
renderDemoUsers(payload.marketing);
renderDemoGroups(payload.marketing);
  } catch (error) {
    showResult('#platform-status', error.message || 'Impossibile caricare il backend.', 'error');
    showResult('#app-status', error.message || 'Impossibile caricare il backend.', 'error');
  }
}

function wireRegisterForm() {
  const form = $('#auth-register-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    clearResult('#app-status');

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Creazione account...';
    }

    try {
      const payload = await sendJson('/api/auth/register', {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        password: form.elements.password.value
      });

      showResult('#app-status', payload.message || 'Account creato. Controlla la tua email per verificare l’indirizzo.');
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Registrazione non riuscita.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Crea account';
      }
    }
  });
}

function wireLoginForm() {
  const form = $('#auth-login-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    clearResult('#app-status');

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Accesso...';
    }

    try {
      const payload = await sendJson('/api/auth/login', {
        email: form.elements.email.value.trim(),
        password: form.elements.password.value
      });

      persistSessionToken(payload.token || '');
      applyAccountView(payload);
      showResult('#app-status', 'Accesso completato.');
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Accesso non riuscito.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Accedi';
      }
    }
  });
}

function wireForgotPasswordForm() {
  const form = $('#auth-forgot-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Invio...';
    }

    try {
      const payload = await sendJson('/api/auth/forgot-password', {
        email: form.elements.email.value.trim()
      });
      showResult('#app-status', payload.message || 'Se l’account esiste, abbiamo inviato le istruzioni via email.');
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Richiesta non riuscita.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Invia link di reset';
      }
    }
  });
}

function wireResendVerificationForm() {
  const form = $('#auth-resend-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const payload = await sendJson('/api/auth/resend-verification', {
        email: form.elements.email.value.trim()
      });
      showResult('#app-status', payload.message || 'Se necessario, abbiamo reinviato la mail di verifica.');
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Richiesta non riuscita.', 'error');
    }
  });
}

function wireProfileForm() {
  const form = $('#account-profile-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!appState.sessionToken) {
      showResult('#app-status', 'Accedi per salvare il profilo.', 'error');
      return;
    }

    const submit = form.querySelector('button[type="submit"]');

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Salvataggio...';
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

      await refreshAuthenticatedUser();
      showResult('#app-status', payload.message || 'Profilo aggiornato.');
    } catch (error) {
      showResult('#app-status', error.message || 'Aggiornamento profilo non riuscito.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || 'Salva profilo';
      }
    }
  });
}

function wireCheckinForm() {
  const form = $('#app-checkin-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!appState.sessionToken) {
      showResult('#app-status', 'Accedi per inviare un check-in.', 'error');
      return;
    }

    try {
      const payload = await sendJson('/api/checkins', {
        included: Number(form.elements.included.value),
        energy: Number(form.elements.energy.value),
        anxiety: Number(form.elements.anxiety.value),
        note: form.elements.note.value.trim()
      });

      renderSummary(payload.summary);
      renderSubscription(appState.subscription);
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Check-in non riuscito.', 'error');
    }
  });
}

function wireReportForm() {
  const form = $('#app-report-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!appState.sessionToken) {
      showResult('#app-status', 'Accedi per inviare un report.', 'error');
      return;
    }

    try {
      const payload = await sendJson('/api/reports', {
        severity: form.elements.severity.value,
        category: form.elements.category.value.trim(),
        details: form.elements.details.value.trim()
      });

      renderSummary(payload.summary);
      form.reset();
    } catch (error) {
      showResult('#app-status', error.message || 'Report non riuscito.', 'error');
    }
  });
}

function wireAppActions() {
  document.addEventListener('click', async (event) => {
    const joinButton = event.target.closest('[data-join-group]');
    const leaveButton = event.target.closest('[data-leave-group]');
    const rsvpButton = event.target.closest('[data-rsvp-group][data-rsvp-activity]');
    const logoutButton = event.target.closest('#app-logout-button');

    if (logoutButton) {
      try {
        await sendJson('/api/auth/logout', {});
      } catch {}
      persistSessionToken('');
      appState.me = null;
      window.location.href = '/app';
      return;
    }

    if (!appState.sessionToken) return;

    try {
      if (joinButton) {
        const payload = await sendJson(`/api/groups/${joinButton.dataset.joinGroup}/join`, {});
        renderSummary(payload.summary);
        renderSubscription(appState.subscription);
        return;
      }

      if (leaveButton) {
        const payload = await sendJson(`/api/groups/${leaveButton.dataset.leaveGroup}/leave`, {});
        renderSummary(payload.summary);
        renderSubscription(appState.subscription);
        return;
      }

      if (rsvpButton) {
        const payload = await sendJson(
          `/api/groups/${rsvpButton.dataset.rsvpGroup}/activities/${rsvpButton.dataset.rsvpActivity}/rsvp`,
          {}
        );
        renderSummary(payload.summary);
        renderSubscription(appState.subscription);
      }
    } catch (error) {
      showResult('#app-status', error.message || 'Operazione non riuscita.', 'error');
    }
  });
}

async function handleQueryActions() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify');
  const resetToken = params.get('reset');
  const billing = params.get('billing');
  const plan = params.get('plan');

  if (billing === 'success') {
    showResult(
      '#app-status',
      plan
        ? `Pagamento completato per ${plan}. Accedi o registrati con la stessa email usata su Stripe per vedere il piano attivo.`
        : 'Pagamento completato. Accedi con la stessa email usata su Stripe per vedere il piano attivo.'
    );
  }

  if (verifyToken) {
    try {
      const payload = await sendJson('/api/auth/verify-email', { token: verifyToken });
      showResult('#app-status', payload.message || 'Email verificata. Ora puoi accedere.');
      params.delete('verify');
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
    } catch (error) {
      showResult('#app-status', error.message || 'Verifica email non riuscita.', 'error');
    }
  }

  if (resetToken) {
    const wrapper = $('#reset-password-shell');
    const form = $('#auth-reset-form');

    if (wrapper && form) {
      wrapper.style.display = 'grid';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');

        if (submit) {
          submit.disabled = true;
          submit.textContent = 'Aggiornamento...';
        }

        try {
          const payload = await sendJson('/api/auth/reset-password', {
            token: resetToken,
            password: form.elements.password.value
          });
          showResult('#app-status', payload.message || 'Password aggiornata. Ora puoi accedere.');
          form.reset();
          wrapper.style.display = 'none';
          params.delete('reset');
          window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
        } catch (error) {
          showResult('#app-status', error.message || 'Reset password non riuscito.', 'error');
        } finally {
          if (submit) {
            submit.disabled = false;
            submit.textContent = submit.dataset.label || 'Imposta nuova password';
          }
        }
      }, { once: true });
    }
  }
}

async function initAppPage() {
  if (!$('#app-page')) return;

  wireRegisterForm();
  wireLoginForm();
  wireForgotPasswordForm();
  wireResendVerificationForm();
  wireProfileForm();
  wireCheckinForm();
  wireReportForm();

  await handleQueryActions();
  await refreshAuthenticatedUser();
}

wireForm('#waitlist-form', '/api/waitlist', '#waitlist-result');
wireForm('#partner-form', '/api/partner-leads', '#partner-result');
wirePlusCheckout();
wireSchoolCheckout();
wireAppActions();
loadBootstrap();
initAppPage();
