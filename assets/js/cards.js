/* =========================================================
   GABBRO — cards.js
   Riflesso luminoso che segue il cursore sulle card.
   ========================================================= */
(() => {
  'use strict';
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
})();
