import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STRIPE_PLUS_MONTHLY = import.meta.env.VITE_STRIPE_LINK_PLUS_MONTHLY || '';
const STRIPE_PLUS_ANNUAL = import.meta.env.VITE_STRIPE_LINK_PLUS_ANNUAL || '';

const $ = (selector) => document.querySelector(selector);

function setLink(node, href, fallback = '/lista-attesa') {
  if (!node) return;
  node.href = href || fallback;
}

function setText(node, text) {
  if (!node) return;
  node.textContent = text;
}

function wireStripeButtons() {
  const monthlyBtn = $('#plus-monthly-btn');
  const annualBtn = $('#plus-annual-btn');
  const monthlyNote = $('#plus-monthly-note');
  const annualNote = $('#plus-annual-note');

  setLink(monthlyBtn, STRIPE_PLUS_MONTHLY);
  setLink(annualBtn, STRIPE_PLUS_ANNUAL);

  setText(
    monthlyNote,
    STRIPE_PLUS_MONTHLY
      ? 'Pagamento mensile con Stripe.'
      : 'Link Stripe mensile non configurato: reindirizzamento alla lista d’attesa.'
  );

  setText(
    annualNote,
    STRIPE_PLUS_ANNUAL
      ? 'Pagamento annuale con Stripe.'
      : 'Link Stripe annuale non configurato: reindirizzamento alla lista d’attesa.'
  );
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

function hydratePlanPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tier = String(params.get('tier') || params.get('plan') || '').trim();
  const partnerForm = $('#partner-form');

  if (partnerForm && partnerForm.elements?.tier && ['school_starter', 'school_pro', 'custom'].includes(tier)) {
    partnerForm.elements.tier.value = tier;
  }
}

function wireSchoolCheckout() {
  const form = $('#school-checkout-form');
  const result = $('#school-checkout-result');
  const buttons = document.querySelectorAll('[data-school-plan]');

  if (!form || !buttons.length) return;

  const params = new URLSearchParams(window.location.search);

  if (result && params.get('checkout') === 'success') {
    result.textContent = 'Pagamento completato. L’attivazione automatica è in corso: controlla la mail di fatturazione.';
    result.classList.add('show');
  }

  if (result && params.get('checkout') === 'cancelled') {
    result.textContent = 'Checkout annullato. Nessuna attivazione è stata eseguita.';
    result.classList.add('show');
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const organization = form.elements.organization?.value.trim();
      const billingEmail = form.elements.billingEmail?.value.trim();
      const contactName = form.elements.contactName?.value.trim() || '';
      const planCode = button.dataset.schoolPlan || '';
      const schoolSize = button.dataset.schoolSize || '';

      if (!organization || !billingEmail) {
        showResult('#school-checkout-result', 'Compila almeno nome scuola ed email di fatturazione.');
        return;
      }

      const originalLabel = button.textContent;
      buttons.forEach((node) => {
        node.disabled = true;
      });

      button.textContent = 'Reindirizzamento...';

      try {
        const payload = await sendJson('/api/billing/school-checkout', {
          organization,
          billingEmail,
          contactName,
          planCode,
          schoolSize
        });

        if (!payload.url) {
          throw new Error('URL checkout mancante.');
        }

        window.location.href = payload.url;
      } catch (error) {
        showResult('#school-checkout-result', error.message || 'Impossibile aprire il checkout.');
        buttons.forEach((node) => {
          node.disabled = false;
        });
        button.textContent = originalLabel;
      }
    });
  });
}

wireStripeButtons();
wireForm('#waitlist-form', '/api/waitlist', '#waitlist-result');
wireForm('#partner-form', '/api/partner-leads', '#partner-result');
wireSchoolCheckout();
hydratePlanPrefillFromUrl();