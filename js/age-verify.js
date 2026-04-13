/* ============================================================
   THE CIGAR VAULT — age-verify.js
   Full-screen age gate. Checks sessionStorage so it only fires
   once per browser session. Works on every page of the site.
   ============================================================ */

(function () {
  'use strict';

  /* Already verified this session — do nothing */
  if (sessionStorage.getItem('cv-age-ok')) return;

  /* ---- Inject styles ---- */
  var style = document.createElement('style');
  style.textContent = [
    '#cv-gate{',
      'position:fixed;inset:0;z-index:99999;',
      'background:linear-gradient(160deg,#051e17 0%,#0a3830 55%,#072416 100%);',
      'display:flex;align-items:center;justify-content:center;',
      'padding:1.5rem;',
      'opacity:0;transition:opacity 0.35s ease;',
    '}',
    '#cv-gate.cv-visible{opacity:1;}',

    '#cv-box{',
      'max-width:520px;width:100%;',
      'text-align:center;',
      'border:1px solid rgba(26,107,90,0.55);',
      'background:rgba(7,40,32,0.85);',
      'backdrop-filter:blur(6px);',
      '-webkit-backdrop-filter:blur(6px);',
      'padding:3rem 2.5rem 2.75rem;',
      'border-radius:4px;',
      'box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 0 1px rgba(26,107,90,0.18);',
    '}',

    '#cv-logo{',
      'max-width:220px;height:auto;',
      'display:block;margin:0 auto 2rem;',
      'opacity:0.92;',
    '}',

    '#cv-rule{',
      'width:40px;height:2px;',
      'background:linear-gradient(90deg,transparent,#C9A84C,transparent);',
      'margin:0 auto 1.6rem;border:none;',
    '}',

    '#cv-eyebrow{',
      'font-family:"Lato",sans-serif;',
      'font-size:0.62rem;font-weight:700;',
      'letter-spacing:0.42em;text-transform:uppercase;',
      'color:#C9A84C;',
      'display:block;margin-bottom:0.9rem;',
    '}',

    '#cv-heading{',
      'font-family:"Playfair Display",Georgia,serif;',
      'font-size:clamp(1.6rem,4vw,2.4rem);',
      'font-weight:600;line-height:1.15;',
      'color:#FAF6EE;',
      'margin:0 0 1.25rem;',
    '}',

    '#cv-body{',
      'font-family:"Lato",sans-serif;',
      'font-size:0.82rem;line-height:1.65;',
      'color:rgba(250,246,238,0.62);',
      'margin:0 0 2rem;',
      'max-width:400px;margin-left:auto;margin-right:auto;',
    '}',

    '#cv-actions{',
      'display:flex;flex-direction:column;gap:0.75rem;',
      'max-width:320px;margin:0 auto;',
    '}',

    '#cv-enter{',
      'font-family:"Lato",sans-serif;',
      'font-size:0.72rem;font-weight:700;',
      'letter-spacing:0.2em;text-transform:uppercase;',
      'padding:0.9rem 1.5rem;',
      'background:#C9A84C;',
      'border:1px solid #C9A84C;',
      'color:#0a2a20;',
      'cursor:pointer;border-radius:2px;',
      'transition:background 0.25s ease,border-color 0.25s ease;',
    '}',
    '#cv-enter:hover{background:#E0BC6E;border-color:#E0BC6E;}',

    '#cv-exit{',
      'font-family:"Lato",sans-serif;',
      'font-size:0.7rem;font-weight:700;',
      'letter-spacing:0.16em;text-transform:uppercase;',
      'padding:0.75rem 1.5rem;',
      'background:transparent;',
      'border:1px solid rgba(26,107,90,0.6);',
      'color:rgba(250,246,238,0.48);',
      'cursor:pointer;border-radius:2px;',
      'transition:border-color 0.25s ease,color 0.25s ease;',
    '}',
    '#cv-exit:hover{border-color:rgba(250,246,238,0.35);color:rgba(250,246,238,0.65);}',

    '#cv-legal{',
      'font-family:"Lato",sans-serif;',
      'font-size:0.62rem;',
      'color:rgba(250,246,238,0.28);',
      'margin-top:1.75rem;line-height:1.5;',
    '}',

    '@media(max-width:480px){',
      '#cv-box{padding:2.25rem 1.5rem 2rem;}',
      '#cv-logo{max-width:160px;}',
    '}'
  ].join('');
  document.head.appendChild(style);

  /* ---- Build overlay HTML ---- */
  var gate = document.createElement('div');
  gate.id = 'cv-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'cv-heading');
  gate.innerHTML =
    '<div id="cv-box">' +
      '<img id="cv-logo" src="assets/Cigar-Vault-Logo-White-Long.png" alt="The Cigar Vault">' +
      '<hr id="cv-rule" aria-hidden="true">' +
      '<span id="cv-eyebrow">Age Verification</span>' +
      '<h1 id="cv-heading">Are you 21 or older?</h1>' +
      '<p id="cv-body">You must be 21 years of age or older to enter this website. ' +
        'By entering, you confirm that you are of legal age to purchase tobacco products in your state.</p>' +
      '<div id="cv-actions">' +
        '<button id="cv-enter" type="button">I Am 21 or Older &mdash; Enter</button>' +
        '<button id="cv-exit"  type="button">I Am Under 21</button>' +
      '</div>' +
      '<p id="cv-legal">This website complies with applicable age-restriction laws. ' +
        'You must be of legal smoking age in your state to access this site.</p>' +
    '</div>';

  /* ---- Inject and lock scroll ---- */
  function inject() {
    document.body.appendChild(gate);
    document.body.style.overflow = 'hidden';

    /* Fade in on next frame so the CSS transition fires */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        gate.classList.add('cv-visible');
      });
    });

    /* Button handlers */
    document.getElementById('cv-enter').addEventListener('click', function () {
      sessionStorage.setItem('cv-age-ok', '1');
      gate.style.transition = 'opacity 0.3s ease';
      gate.style.opacity = '0';
      setTimeout(function () {
        gate.remove();
        document.body.style.overflow = '';
      }, 320);
    });

    document.getElementById('cv-exit').addEventListener('click', function () {
      window.location.replace('https://www.google.com');
    });
  }

  /* Run immediately if body is ready, otherwise wait for DOMContentLoaded */
  if (document.body) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }

}());
