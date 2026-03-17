import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STRIPE_LINKS = {
  plus_monthly: import.meta.env.VITE_STRIPE_LINK_PLUS_MONTHLY || '',
  plus_annual: import.meta.env.VITE_STRIPE_LINK_PLUS_ANNUAL || ''
};

function getPlanCta(plan) {
  const code = String(plan?.code || '').trim();

  if (code === 'plus_monthly') {
    return {
      href: STRIPE_LINKS.plus_monthly || '#waitlist',
      label: plan.ctaLabel || 'Attiva Plus mensile',
      external: Boolean(STRIPE_LINKS.plus_monthly)
    };
  }

  if (code === 'plus_annual') {
    return {
      href: STRIPE_LINKS.plus_annual || '#waitlist',
      label: plan.ctaLabel || 'Attiva Plus annuale',
      external: Boolean(STRIPE_LINKS.plus_annual)
    };
  }

  if (code === 'school_starter' || code === 'school_pro' || code === 'custom' || plan.ctaType === 'b2b') {
    return {
      href: '#partner',
      label: plan.ctaLabel || 'Richiedi demo',
      external: false
    };
  }

  return {
    href: '#platform',
    label: plan.ctaLabel || 'Inizia gratis',
    external: false
  };
}

function hydratePlanPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tier = String(params.get('tier') || params.get('plan') || '').trim();
  const partnerForm = $('#partner-form');

  if (partnerForm && partnerForm.elements?.tier && ['school_starter', 'school_pro', 'custom'].includes(tier)) {
    partnerForm.elements.tier.value = tier;
    window.location.hash = 'partner';
  }
}

const $ = (selector) => document.querySelector(selector);

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
  try { payload = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(payload.error || 'Operazione non riuscita.');
  }
  return payload;
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

wireForm('#waitlist-form', '/api/waitlist', '#waitlist-result');
wireForm('#partner-form', '/api/partner-leads', '#partner-result');


hydratePlanPrefillFromUrl();
