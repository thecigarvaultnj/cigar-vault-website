/* ============================================================
   THE CIGAR VAULT — main.js
   ============================================================ */

/* ---- Navbar: shrink on scroll ---- */
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ---- Mobile nav toggle ---- */
const navToggle = document.getElementById('nav-toggle');
const navMobile  = document.getElementById('nav-mobile');

navToggle.addEventListener('click', () => {
  const open = navMobile.classList.toggle('open');
  navToggle.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', open);
});

navMobile.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navMobile.classList.remove('open');
    navToggle.classList.remove('open');
    navToggle.setAttribute('aria-expanded', false);
  });
});

/* ---- Merch: product data & dynamic options ---- */
const products = {
  'carhartt-ls': {
    label: 'The Cigar Vault Carhartt Long Sleeve',
    price: 89.95,
    sizes:  ['S', 'M', 'L', 'XL', 'XXL']
  },
  'carhartt-hoodie': {
    label: 'The Cigar Vault Carhartt Hoodie',
    price: 104.95,
    sizes:  ['S', 'M', 'L', 'XL', 'XXL']
  }
};

const productSelect = document.getElementById('product');
const sizeSelect    = document.getElementById('size');
const priceRef      = document.getElementById('price-ref');

function populateSelect(el, options) {
  el.innerHTML = options
    .map(o => `<option value="${o}">${o}</option>`)
    .join('');
}

function syncProductForm() {
  const p = products[productSelect.value];
  if (!p) return;
  populateSelect(sizeSelect, p.sizes);
  if (priceRef) priceRef.value = `$${p.price}`;

  // Highlight matching card
  document.querySelectorAll('.product-card').forEach(card => {
    card.classList.toggle('active', card.dataset.product === productSelect.value);
  });
}

if (productSelect) {
  productSelect.addEventListener('change', syncProductForm);
  syncProductForm(); // initialise on load
}

// Click a product card → select it in the form and scroll down
document.querySelectorAll('.product-card').forEach(card => {
  card.addEventListener('click', () => {
    if (productSelect) {
      productSelect.value = card.dataset.product;
      syncProductForm();
    }
    const formEl = document.getElementById('order-form');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ---- Netlify AJAX form submission ---- */
function encodeFormData(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function handleSubmit(form, msgEl) {
  const btn = form.querySelector('[type="submit"]');
  const originalLabel = btn.textContent;
  btn.textContent = 'Sending\u2026';
  btn.disabled = true;
  msgEl.className = 'form-message';

  const formData = new FormData(form);
  const body = encodeFormData(Object.fromEntries(formData));

  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (res.ok) {
      msgEl.textContent = 'Thank you \u2014 your submission was received. We\u2019ll be in touch.';
      msgEl.className = 'form-message success';
      form.reset();
      if (form.id === 'merch-form') syncProductForm();
    } else {
      msgEl.textContent = 'Something went wrong. Please try again or email us directly.';
      msgEl.className = 'form-message error';
    }
  } catch {
    msgEl.textContent = 'Network error. Please check your connection and try again.';
    msgEl.className = 'form-message error';
  }

  btn.textContent = originalLabel;
  btn.disabled = false;
  msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const merchForm    = document.getElementById('merch-form');
const merchMsg     = document.getElementById('merch-msg');
const petitionForm = document.getElementById('petition-form');
const petitionMsg  = document.getElementById('petition-msg');

if (merchForm && merchMsg) {
  merchForm.addEventListener('submit', e => {
    e.preventDefault();
    handleSubmit(merchForm, merchMsg);
  });
}

if (petitionForm && petitionMsg) {
  petitionForm.addEventListener('submit', e => {
    e.preventDefault();
    handleSubmit(petitionForm, petitionMsg);
  });
}

/* ---- Scroll reveal ---- */
const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
