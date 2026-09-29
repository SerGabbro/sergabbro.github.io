/* =========================================================
   GABBRO — sky.js
   Sfondo a costellazioni, generato da un seme casuale a ogni
   caricamento.
   - Le stelle vicine al cursore si accendono, vengono
     attratte leggermente verso di lui e si collegano in
     costellazioni che sfumano lentamente.
   - Click o tap: onda d'urto che accende le stelle che
     attraversa.
   - Quando il cursore è fermo o assente, un punto invisibile
     vaga da solo e continua a formare costellazioni.
   - Il disegno si dissolve attorno ai blocchi di contenuto
     (OCCLUDERS) per non interferire con la lettura.
   Imposta anche la tinta della sessione (--glow) e aggiorna
   il pannello readout della home, se presente.
   ========================================================= */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer  = matchMedia('(pointer: fine)').matches;

  /* ── PRNG deterministico (mulberry32) ── */
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 8) || 1;
  const rng = (() => {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  /* ── tinta della sessione ── */
  const palettes = [
    { name: 'rosso', rgb: [230, 57, 70] },
    { name: 'ciano', rgb: [34, 211, 238] },
    { name: 'ambra', rgb: [245, 165, 36] },
    { name: 'viola', rgb: [167, 139, 250] },
  ];
  const pal = palettes[Math.floor(rng() * palettes.length)];
  const root = document.documentElement;
  root.style.setProperty('--glow', pal.rgb.join(', '));
  root.style.setProperty('--glow-x', `${Math.round(15 + rng() * 70)}%`);
  root.style.setProperty('--glow-y', `${Math.round(-20 + rng() * 25)}%`);

  /* ── parametri ── */
  const OCCLUDERS = '.navbar, .hero-copy, .readout, .section-head, .card, .about, .article-shell, .toc, .site-footer';
  const FEATHER   = 32;                        // px di sfumatura attorno ai blocchi
  const LINK      = 160;                       // lunghezza massima di un lato di costellazione
  const AMBIENT   = 90;                        // collegamenti d'ambiente
  const RADIUS    = finePointer ? 240 : 170;   // raggio d'influenza del cursore
  const PULL      = 0.10;                      // attrazione verso il cursore (frazione della distanza)
  const DECAY     = 0.16;                      // spegnimento delle stelle, 1/s
  const PROBES    = 3;                         // linee dal cursore alle stelle accese più vicine

  const BASE = [214, 220, 232];
  const [GR, GG, GB] = pal.rgb;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  const GLOW = pal.rgb;

  /* ── canvas ── */
  const canvas = document.createElement('canvas');
  canvas.className = 'sky';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0;
  let stars = [];
  let occluders = [];
  let linkCount = 0;
  const ripples = [];
  const meteors = [];
  let nextMeteor = 4 + rng() * 6;

  const drift  = rng() * Math.PI * 2;
  const driftV = 3 + rng() * 4;                               // px/s
  const liss   = [rng() * 6.28, rng() * 6.28, 0.05 + rng() * 0.04, 0.035 + rng() * 0.04];

  const pointer = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, t: -1e9, over: false };
  const idleFor = () => performance.now() - pointer.t;

  /* ── generazione ── */
  function makeStar(x, y) {
    return {
      x, y,                                    // posizione "di casa", in deriva lenta
      ox: 0, oy: 0,                            // spostamento dovuto al cursore
      r: 0.5 + Math.pow(rng(), 3) * 1.4,
      a: 0.3 + rng() * 0.5,
      tw: 0.4 + rng() * 1.6,
      ph: rng() * 6.28,
      depth: 0.04 + rng() * 0.22,              // parallasse sullo scroll
      aff: rng(),                              // non tutte le stelle si accendono
      e: 0,                                    // energia: 0 spenta, 1 accesa
      dx: 0, dy: 0, m: 1,                      // posizione disegnata e maschera
    };
  }

  function generate() {
    const n = Math.max(70, Math.min(240, Math.round((W * H) / 6200)));
    stars = [];
    /* cielo non uniforme: fondo sparso + due o tre ammassi */
    const clusters = Array.from({ length: 2 + Math.floor(rng() * 2) }, () => ({
      x: rng() * W, y: rng() * H, s: 90 + rng() * 160,
    }));
    for (let i = 0; i < n; i++) {
      if (rng() < 0.3) {
        const c = clusters[Math.floor(rng() * clusters.length)];
        const u = Math.max(1e-6, rng()), v = rng();
        const g = Math.sqrt(-2 * Math.log(u));
        stars.push(makeStar(
          (c.x + g * Math.cos(6.28 * v) * c.s + W) % W,
          (c.y + g * Math.sin(6.28 * v) * c.s + H) % H,
        ));
      } else {
        stars.push(makeStar(rng() * W, rng() * H));
      }
    }
  }

  function resize() {
    const pw = W, ph = H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length || !pw) generate();
    else for (const s of stars) { s.x = s.x / pw * W; s.y = s.y / ph * H; }
  }

  /* ── maschera: 0 dentro un blocco di contenuto, 1 lontano ── */
  function readOccluders() {
    occluders = [];
    document.querySelectorAll(OCCLUDERS).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -FEATHER || r.top > H + FEATHER || r.width === 0) return;
      occluders.push(r);
    });
  }

  function mask(x, y) {
    let m = 1;
    for (const r of occluders) {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      if (dx > FEATHER || dy > FEATHER) continue;
      const d = Math.hypot(dx, dy);
      if (d === 0) return 0;
      const t = Math.min(1, d / FEATHER);
      m = Math.min(m, t * t * (3 - 2 * t));
    }
    return m;
  }

  const mod = (a, n) => ((a % n) + n) % n;

  /* ── simulazione ── */
  let clock = 0;

  function step(dt) {
    clock += dt;
    readOccluders();
    const sy = window.scrollY;
    const vx = Math.cos(drift) * driftV * dt;
    const vy = Math.sin(drift) * driftV * dt;

    /* sorgente di energia: il cursore, o un punto che vaga da solo */
    const idle = idleFor() > 3500;
    let px, py, rad, gain, pull;
    if (!idle) {
      px = pointer.x; py = pointer.y;
      rad = pointer.over ? RADIUS * 0.55 : RADIUS;
      gain = 3.4;
      pull = pointer.over ? 0 : PULL;
    } else {
      px = W * (0.5 + 0.44 * Math.sin(clock * liss[2] + liss[0]));
      py = H * (0.5 + 0.42 * Math.sin(clock * liss[3] + liss[1]));
      rad = RADIUS * 0.8;
      gain = 1.8;
      pull = 0;
    }

    /* anello del cursore, inseguimento smorzato */
    const k = 1 - Math.exp(-dt * 14);
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;

    /* onde d'urto */
    for (const rp of ripples) { rp.prev = rp.r; rp.r += dt * 520; }
    while (ripples.length && ripples[0].r > ripples[0].max) ripples.shift();

    const spring = 1 - Math.exp(-dt * 3);
    for (const s of stars) {
      s.x = mod(s.x + vx, W);
      s.y = mod(s.y + vy, H);
      const hx = s.x;
      const hy = mod(s.y - sy * s.depth, H);

      /* attrazione verso il cursore, con ritorno elastico */
      let tx = 0, ty = 0;
      const dh = Math.hypot(hx - px, hy - py);
      if (pull && dh < rad) {
        const f = pull * Math.pow(1 - dh / rad, 1.5);
        tx = (px - hx) * f;
        ty = (py - hy) * f;
      }
      s.ox += (tx - s.ox) * spring;
      s.oy += (ty - s.oy) * spring;

      s.dx = hx + s.ox;
      s.dy = hy + s.oy;
      s.m = mask(s.dx, s.dy);

      const d = Math.hypot(s.dx - px, s.dy - py);
      if (d < rad && s.aff > 0.28 && s.m > 0.05) {
        s.e = Math.min(1, s.e + (1 - d / rad) * dt * gain);
      }
      for (const rp of ripples) {
        const dr = Math.hypot(s.dx - rp.x, s.dy - rp.y);
        if (dr >= rp.prev && dr < rp.r && s.aff > 0.15) s.e = Math.min(1, s.e + 0.9 * (1 - rp.r / rp.max));
      }
      s.e = Math.max(0, s.e - dt * DECAY);
    }

    /* stelle cadenti, rare */
    nextMeteor -= dt;
    if (nextMeteor <= 0 && !reduceMotion) {
      nextMeteor = 7 + rng() * 10;
      const ang = drift + Math.PI / 2 + (rng() - 0.5) * 0.8;
      meteors.push({
        x: rng() * W, y: rng() * H * 0.6,
        vx: Math.cos(ang) * 620, vy: Math.abs(Math.sin(ang)) * 620,
        life: 0, dur: 0.9 + rng() * 0.5,
      });
    }
    for (const mt of meteors) { mt.life += dt; mt.x += mt.vx * dt; mt.y += mt.vy * dt; }
    while (meteors.length && meteors[0].life > meteors[0].dur) meteors.shift();
  }

  /* ── disegno ── */
  function line(ax, ay, bx, by) {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const n = stars.length;

    /* collegamenti d'ambiente */
    ctx.lineWidth = 0.6;
    for (let i = 0; i < n; i++) {
      const a = stars[i];
      if (a.m <= 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = stars[j];
        if (b.m <= 0) continue;
        const dx = a.dx - b.dx, dy = a.dy - b.dy;
        if (dx > AMBIENT || dx < -AMBIENT || dy > AMBIENT || dy < -AMBIENT) continue;
        const d = Math.hypot(dx, dy);
        if (d > AMBIENT) continue;
        const al = 0.11 * (1 - d / AMBIENT) * Math.min(a.m, b.m);
        if (al < 0.006) continue;
        ctx.strokeStyle = rgba(BASE, al);
        line(a.dx, a.dy, b.dx, b.dy);
      }
    }

    /* costellazioni: ogni stella accesa si lega alle due stelle
       accese più vicine -> grafo sparso, non una rete */
    const lit = [];
    for (let i = 0; i < n; i++) if (stars[i].e > 0.02 && stars[i].m > 0) lit.push(i);
    const seen = new Set();
    linkCount = 0;
    ctx.lineWidth = 1;
    for (const i of lit) {
      const a = stars[i];
      let n1 = -1, n2 = -1, d1 = LINK, d2 = LINK;
      for (const j of lit) {
        if (j === i) continue;
        const b = stars[j];
        const d = Math.hypot(a.dx - b.dx, a.dy - b.dy);
        if (d < d1) { n2 = n1; d2 = d1; n1 = j; d1 = d; }
        else if (d < d2) { n2 = j; d2 = d; }
      }
      for (const [j, d] of [[n1, d1], [n2, d2]]) {
        if (j < 0) continue;
        const key = i < j ? i * 4096 + j : j * 4096 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = stars[j];
        const midM = mask((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
        const al = Math.min(a.e, b.e) * Math.sqrt(1 - d / LINK) * 0.85 * Math.min(a.m, b.m, midM);
        if (al < 0.01) continue;
        linkCount++;
        ctx.strokeStyle = rgba(GLOW, al);
        line(a.dx, a.dy, b.dx, b.dy);
      }
    }

    /* cursore: anello e sonde verso le stelle accese più vicine */
    const live = idleFor() < 3500 && finePointer;
    if (live) {
      const cm = mask(pointer.sx, pointer.sy);
      const fade = Math.max(0, 1 - idleFor() / 3500);
      if (cm > 0) {
        const near = lit
          .map(i => stars[i])
          .map(s => [s, Math.hypot(s.dx - pointer.sx, s.dy - pointer.sy)])
          .filter(([, d]) => d < RADIUS * 0.8)
          .sort((p, q) => p[1] - q[1])
          .slice(0, PROBES);
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 4]);
        for (const [s, d] of near) {
          ctx.strokeStyle = rgba(GLOW, 0.35 * s.e * (1 - d / (RADIUS * 0.8)) * cm * s.m * fade);
          line(pointer.sx, pointer.sy, s.dx, s.dy);
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = rgba(GLOW, 0.35 * cm * fade);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pointer.sx, pointer.sy, 14, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = rgba(GLOW, 0.6 * cm * fade);
        ctx.beginPath(); ctx.arc(pointer.sx, pointer.sy, 1.6, 0, 6.2832); ctx.fill();
      }
    }

    /* onde d'urto */
    for (const rp of ripples) {
      const t = rp.r / rp.max;
      ctx.strokeStyle = rgba(GLOW, 0.28 * (1 - t) * (1 - t));
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, 6.2832); ctx.stroke();
    }

    /* stelle cadenti */
    for (const mt of meteors) {
      const t = mt.life / mt.dur;
      const al = Math.sin(Math.PI * t) * 0.55 * mask(mt.x, mt.y);
      if (al <= 0.01) continue;
      const tail = 0.12;
      const g = ctx.createLinearGradient(mt.x, mt.y, mt.x - mt.vx * tail, mt.y - mt.vy * tail);
      g.addColorStop(0, rgba(BASE, al));
      g.addColorStop(1, rgba(BASE, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2;
      line(mt.x, mt.y, mt.x - mt.vx * tail, mt.y - mt.vy * tail);
    }

    /* stelle */
    for (const s of stars) {
      if (s.m <= 0) continue;
      const tw = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(clock * s.tw + s.ph);
      const e = s.e;
      const al = Math.min(1, s.a * tw + e * 0.75) * s.m;
      const r = s.r + e * 1.1;
      const c = [
        Math.round(BASE[0] + (GR - BASE[0]) * e),
        Math.round(BASE[1] + (GG - BASE[1]) * e),
        Math.round(BASE[2] + (GB - BASE[2]) * e),
      ];
      if (e > 0.12) {
        ctx.fillStyle = rgba(c, 0.14 * e * s.m);
        ctx.beginPath(); ctx.arc(s.dx, s.dy, r * 5, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = rgba(c, al);
      ctx.beginPath(); ctx.arc(s.dx, s.dy, r, 0, 6.2832); ctx.fill();
    }
  }

  /* ── ciclo ── */
  let last = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  resize();
  if (reduceMotion) {
    /* un solo fotogramma statico, ridisegnato su resize e scroll */
    const still = () => { step(0); draw(); };
    still();
    addEventListener('resize', () => { resize(); still(); });
    addEventListener('scroll', still, { passive: true });
  } else {
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    start();
  }

  /* ── input ── */
  addEventListener('pointermove', e => {
    if (idleFor() > 3500) { pointer.sx = e.clientX; pointer.sy = e.clientY; }
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.t = performance.now();
    pointer.over = !!(e.target.closest && e.target.closest(OCCLUDERS));
  }, { passive: true });

  document.addEventListener('pointerleave', () => { pointer.t = -1e9; });

  addEventListener('pointerdown', e => {
    if (reduceMotion) return;
    if (e.target.closest && e.target.closest('a, button, input, select, textarea, label')) return;
    if (mask(e.clientX, e.clientY) < 0.2) return;           // solo sullo sfondo libero
    ripples.push({ x: e.clientX, y: e.clientY, r: 0, prev: 0, max: Math.max(W, H) * 0.45 });
    if (ripples.length > 4) ripples.shift();
  }, { passive: true });

  /* ── pannello readout in home ── */
  const ro = {};
  document.querySelectorAll('[data-ro]').forEach(el => { ro[el.dataset.ro] = el; });
  if (ro.seed) ro.seed.textContent = '0x' + seed.toString(16).toUpperCase().padStart(6, '0');
  if (ro.hue) ro.hue.textContent = pal.name;
  if (ro.nodes || ro.links || ro.cursor) {
    setInterval(() => {
      if (ro.nodes) ro.nodes.textContent = stars.length;
      if (ro.links) ro.links.textContent = String(linkCount).padStart(2, '0');
      if (ro.cursor) {
        ro.cursor.textContent = idleFor() < 3500
          ? `${Math.round(pointer.x)}, ${Math.round(pointer.y)}`
          : 'autonomo';
      }
    }, 150);
  }
})();
