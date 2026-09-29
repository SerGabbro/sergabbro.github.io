/* =========================================================
   GABBRO — article.js
   Pagine articolo: ancore sui titoli, indice laterale,
   barra di avanzamento, blocchi di codice con copia.
   ========================================================= */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.querySelector('.article-body');
  if (!body) return;

  const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  const heads = [...body.querySelectorAll('h2')];
  const used = new Set();
  heads.forEach(h => {
    if (!h.id) {
      let id = slug(h.textContent) || 'sezione';
      while (used.has(id)) id += '-';
      h.id = id;
    }
    used.add(h.id);
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = '#' + h.id;
    a.textContent = '#';
    a.setAttribute('aria-label', 'Link a questa sezione');
    h.prepend(a);
  });

  /* indice */
  const tocList = document.querySelector('.toc ol');
  if (tocList && heads.length) {
    const links = heads.map(h => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = [...h.childNodes].filter(n => !(n.classList && n.classList.contains('anchor')))
        .map(n => n.textContent).join('').trim();
      li.appendChild(a);
      tocList.appendChild(li);
      return a;
    });
    const setCurrent = () => {
      const y = (parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 60) + 80;
      let idx = 0;
      heads.forEach((h, i) => { if (h.getBoundingClientRect().top < y) idx = i; });
      links.forEach((a, i) => a.classList.toggle('is-current', i === idx));
    };
    addEventListener('scroll', setCurrent, { passive: true });
    setCurrent();
  }

  /* indice come pannello su schermi stretti: pulsante flottante */
  const toc = document.querySelector('.toc');
  let pct = null;
  if (toc && heads.length) {
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'toc-fab';
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = '<span class="ring" aria-hidden="true"></span><span>Indice</span><span class="pct">0%</span>';
    pct = fab.querySelector('.pct');
    document.body.appendChild(fab);
    const setOpen = open => {
      toc.classList.toggle('is-open', open);
      fab.setAttribute('aria-expanded', String(open));
    };
    fab.addEventListener('click', e => { e.stopPropagation(); setOpen(!toc.classList.contains('is-open')); });
    toc.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', e => { if (!toc.contains(e.target)) setOpen(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  }

  /* barra di avanzamento */
  const bar = document.querySelector('.progress');
  const shell = document.querySelector('.article-shell');
  if (bar && shell) {
    const upd = () => {
      const r = shell.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      const p = Math.max(0, Math.min(1, -r.top / Math.max(1, total)));
      bar.style.setProperty('--progress', p.toFixed(4));
      root.style.setProperty('--read', p.toFixed(4));
      if (pct) pct.textContent = `${Math.round(p * 100)}%`;
    };
    addEventListener('scroll', upd, { passive: true });
    addEventListener('resize', upd);
    upd();
  }

  /* blocchi di codice: intestazione con etichetta e pulsante di copia */
  body.querySelectorAll('pre').forEach(pre => {
    const wrap = document.createElement('div');
    wrap.className = 'code';
    const head = document.createElement('div');
    head.className = 'code-head';
    const label = document.createElement('span');
    label.textContent = pre.dataset.label || 'codice';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'copia';
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code') || pre;
      try {
        await navigator.clipboard.writeText(code.innerText.replace(/\n$/, ''));
        btn.textContent = 'copiato';
        btn.classList.add('done');
      } catch {
        btn.textContent = 'errore';
      }
      setTimeout(() => { btn.textContent = 'copia'; btn.classList.remove('done'); }, 1600);
    });
    head.append(label, btn);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });
})();
