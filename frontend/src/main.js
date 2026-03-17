import './styles.css';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STRIPE_PLUS_MONTHLY = import.meta.env.VITE_STRIPE_LINK_PLUS_MONTHLY || '';
const STRIPE_PLUS_ANNUAL = import.meta.env.VITE_STRIPE_LINK_PLUS_ANNUAL || '';

function getPlanCta(plan) {
  if (plan.ctaType === 'stripe_monthly') {
    return {
      href: STRIPE_PLUS_MONTHLY || '#waitlist',
      label: plan.ctaLabel || 'Attiva Plus mensile',
      external: Boolean(STRIPE_PLUS_MONTHLY)
    };
  }

  if (plan.ctaType === 'stripe_annual') {
    return {
      href: STRIPE_PLUS_ANNUAL || '#waitlist',
      label: plan.ctaLabel || 'Attiva Plus annuale',
      external: Boolean(STRIPE_PLUS_ANNUAL)
    };
  }

  if (plan.ctaType === 'b2b') {
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

function getSchoolCheckoutContext() {
  const schoolForm = $('#school-checkout-form');

  if (schoolForm) {
    return {
      contactName: schoolForm.elements.contactName?.value.trim() || schoolForm.elements.name?.value.trim() || '',
      billingEmail: schoolForm.elements.billingEmail?.value.trim() || schoolForm.elements.email?.value.trim() || '',
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
    resultNode.textContent = 'Pagamento completato. L’attivazione automatica è in corso: controlla la mail di fatturazione.';
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
        node.setAttribute('aria-disabled', 'true');
        node.classList.add('is-loading');
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
          node.removeAttribute('aria-disabled');
          node.classList.remove('is-loading');
        });

        button.textContent = originalLabel;
      }
    });
  });
}

wireForm('#waitlist-form', '/api/waitlist', '#waitlist-result');
wireForm('#partner-form', '/api/partner-leads', '#partner-result');
wireSchoolCheckout();