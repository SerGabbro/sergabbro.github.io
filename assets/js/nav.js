/* =========================================================
   GABBRO — nav.js
   Menu a schermo intero sugli schermi stretti.
   ========================================================= */
(() => {
  'use strict';

  const bar = document.querySelector('.navbar');
  const btn = bar && bar.querySelector('.nav-toggle');
  if (!btn) return;

  const setOpen = open => {
    bar.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Chiudi il menu' : 'Apri il menu');
  };

  btn.addEventListener('click', () => setOpen(!bar.classList.contains('is-open')));
  bar.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  matchMedia('(min-width: 641px)').addEventListener('change', e => { if (e.matches) setOpen(false); });
})();
