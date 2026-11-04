/* =========================================================
   GABBRO — sampling.js
   Laboratorio di campionamento (tools/sampling.html).

   Unità: frequenze in kHz, tempi in ms (kHz · ms = 1).
   Tutti i segnali sono periodici e hanno spettro a righe:
   - spettro del campionato: repliche delle righe a passo fs;
   - filtro ideale: ricostruzione come somma delle righe che
     cadono nella banda passante;
   - filtro di Butterworth: risposta del filtro analogico
     causale al treno di impulsi, calcolata nel tempo con
     l'espansione in fratti semplici di h(t).
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const TAU = 2 * Math.PI;

  /* colori: gli stessi valori sono in css/sampling.css */
  const COL = {
    sig: '#e9eaee', smp: '#22d3ee', r0: '#22d3ee', rk: '#a78bfa',
    alias: '#e63946', filter: '#f5a524', rec: '#4ade80',
    grid: 'rgba(255,255,255,0.045)', axis: 'rgba(255,255,255,0.16)',
    label: '#6b6f7a',
  };
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const fmt = (v, d = 2) => {
    if (!isFinite(v)) return '—';
    const s = v.toFixed(d);
    return (d > 0 ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace(/^-0$/, '0');
  };

  /* aritmetica complessa minima: [re, im] */
  const cmul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
  const cdiv = ([a, b], [c, d]) => { const m = c * c + d * d; return [(a * c + b * d) / m, (b * c - a * d) / m]; };
  const cexp = ([a, b], t) => { const m = Math.exp(a * t); return [m * Math.cos(b * t), m * Math.sin(b * t)]; };

  /* =======================================================
     SEGNALI
     ======================================================= */

  /* toni: righe {f, re, im} a due lati; periodici: coefficienti c(k) */
  const frac = v => v - Math.floor(v);
  const SIG = {
    sine: {
      tones: () => [[S.f0, 1]],
      note: 'x(t) = cos(2πf₀t): una sola riga a ±f₀.',
    },
    two: {
      tones: () => [[S.f0, 0.6], [S.f1, 0.4]],
      note: 'x(t) = 0,6·cos(2πf₀t) + 0,4·cos(2πf₁t). Portando f₁ oltre f_s/2 si osserva l\'alias di un singolo tono.',
    },
    square: {
      x: (t, f0) => (frac(f0 * t) < 0.5 ? 1 : -1),
      c: k => (k % 2 ? [0, -2 / (Math.PI * k)] : null),
      note: 'Armoniche dispari con ampiezza 4/(πk). Decadono lentamente, quindi l\'aliasing è evidente.',
    },
    ptri: {
      x: (t, f0) => { const p = frac(f0 * t); return 1 - 4 * Math.min(p, 1 - p); },
      c: k => (k % 2 ? [4 / (Math.PI * Math.PI * k * k), 0] : null),
      note: 'Armoniche dispari con ampiezza 8/(π²k²). Decadono rapidamente e l\'aliasing è contenuto.',
    },
    saw: {
      x: (t, f0) => 2 * frac(f0 * t + 0.5) - 1,
      c: k => [0, -((k % 2 ? 1 : -1)) / (Math.PI * k)],
      note: 'Tutte le armoniche, con ampiezza 2/(πk).',
    },
  };

  const tonesOf = key => (SIG[key].tones ? SIG[key].tones() : null);

  function signalFn(key) {
    const tones = tonesOf(key);
    if (tones) return t => tones.reduce((s, [f, a]) => s + a * Math.cos(TAU * f * t), 0);
    return t => SIG[key].x(t, S.f0);
  }

  function lines(key, fmax) {
    const out = [];
    const tones = tonesOf(key);
    if (tones) {
      for (const [f, a] of tones) out.push({ f, re: a / 2, im: 0 }, { f: -f, re: a / 2, im: 0 });
      return out;
    }
    const K = Math.min(400, Math.ceil(fmax / S.f0));
    for (let k = 1; k <= K; k++) {
      const c = SIG[key].c(k);
      if (!c) continue;
      out.push({ f: k * S.f0, re: c[0], im: c[1] }, { f: -k * S.f0, re: c[0], im: -c[1] });
    }
    return out;
  }

  /* =======================================================
     STATO
     ======================================================= */
  const DEFAULT = {
    sig: 'sine', f0: 0.4, f1: 1.3, fs: 4,
    filter: 'ideal', fc: 2, order: 4, err: false,
  };
  const S = { ...DEFAULT };

  /* =======================================================
     FILTRO
     ======================================================= */

  /* poli di Butterworth di ordine N in rad/ms, semipiano sinistro */
  function butterPoles(N, fc) {
    const wc = TAU * fc;
    const p = [];
    for (let k = 0; k < N; k++) {
      const th = Math.PI * (2 * k + N + 1) / (2 * N);
      p.push([wc * Math.cos(th), wc * Math.sin(th)]);
    }
    return p;
  }

  /* risposta in frequenza: ideale reale, Butterworth complessa */
  function H(f) {
    const a = Math.abs(f);
    if (S.filter === 'ideal') {
      if (Math.abs(a - S.fc) < 1e-9) return [0.5, 0];
      return [a < S.fc ? 1 : 0, 0];
    }
    const P = butterPoles(S.order, S.fc);
    const s = [0, TAU * f];
    let num = [1, 0], den = [1, 0];
    for (const p of P) { num = cmul(num, [-p[0], -p[1]]); den = cmul(den, [s[0] - p[0], s[1] - p[1]]); }
    return cdiv(num, den);
  }
  const Hmag = f => Math.hypot(...H(f));

  /* ritardo di gruppo a f = 0 del Butterworth: Σ −Re(p)/|p|² */
  const groupDelay = () => butterPoles(S.order, S.fc).reduce((s, [a, b]) => s - a / (a * a + b * b), 0);

  /* =======================================================
     CALCOLO
     ======================================================= */
  let R = null;   // risultati dell'ultimo calcolo

  const NT = 900;

  function compute() {
    const Ts = 1 / S.fs;
    const tones = tonesOf(S.sig);
    const fTop = tones ? Math.max(...tones.map(([f]) => f)) : Infinity;
    const fLow = tones ? Math.min(...tones.map(([f]) => f)) : S.f0;

    /* finestra temporale */
    const T = Math.min(8, Math.max(0.6, 1.5 / fLow));
    const dt = 2 * T / (NT - 1);
    const t = new Float64Array(NT);
    const x = new Float64Array(NT);
    const xf = signalFn(S.sig);
    for (let i = 0; i < NT; i++) { t[i] = -T + i * dt; x[i] = xf(t[i]); }

    /* campioni nella finestra */
    const n0 = Math.ceil(-T / Ts), n1 = Math.floor(T / Ts);
    const tn = [], xn = [];
    for (let n = n0; n <= n1; n++) { const tt = n * Ts; tn.push(tt); xn.push(xf(tt)); }

    /* finestra in frequenza */
    let Fv = Math.max(1.5 * S.fs, tones ? 1.3 * fTop : 5 * S.f0, 1.15 * S.fc);
    Fv = Math.min(30, Math.max(1.5, Fv));
    const Fext = Math.max(Fv, S.fc) + 0.01;

    const res = { T, t, x, tn, xn, Ts, Fv, fTop };

    /* righe del segnale e delle repliche */
    const L = lines(S.sig, 4 * Fext);
    res.lines = L.filter(l => Math.abs(l.f) <= Fv);
    const bins = new Map();
    for (const l of L) {
      const m0 = Math.ceil((-Fext - l.f) / S.fs), m1 = Math.floor((Fext - l.f) / S.fs);
      for (let m = m0; m <= m1; m++) {
        const fr = l.f + m * S.fs;
        const key = Math.round(fr * 1e6);
        let b = bins.get(key);
        if (!b) { b = { f: fr, re: 0, im: 0, zm: 0 }; bins.set(key, b); }
        b.re += l.re; b.im += l.im;
        if (m === 0) b.zm = Math.hypot(l.re, l.im);
      }
    }
    res.bins = [...bins.values()];

    /* ricostruzione */
    const xr = new Float64Array(NT);
    if (S.filter === 'ideal') {
      for (const b of res.bins) {
        const [h] = H(b.f);
        if (h) accumulate(xr, t, b.f, h * b.re, h * b.im);
      }
    } else {
      butterworthOut(xr, t, xf, Ts);
    }
    res.xr = xr;

    /* diagnosi */
    const fN = S.fs / 2;
    if (tones) {
      res.toneAlias = tones
        .map(([f]) => f)
        .filter(fr => fr >= fN - 1e-9)
        .map(fr => [fr, Math.abs(frac(fr / S.fs + 0.5) - 0.5) * S.fs]);
      res.toneCut = tones.map(([f]) => f).filter(fr => fr < fN && Hmag(fr) < 0.7);
    }

    /* errore: con il Butterworth il riferimento è x(t − τ), τ ritardo di gruppo a f = 0 */
    const tau = S.filter === 'butter' ? groupDelay() : 0;
    const ref = tau ? t.map(tt => xf(tt - tau)) : x;
    let pe = 0, pn = 0;
    for (let i = 0; i < NT; i++) { pe += ref[i] * ref[i]; pn += (xr[i] - ref[i]) ** 2; }
    Object.assign(res, { ref, tau });
    res.snr = pn < 1e-30 ? Infinity : 10 * Math.log10(pe / pn);

    R = res;
  }

  /* somma di Re{(a + jb)·e^{j2πft}} sulla griglia t, con fasore rotante */
  function accumulate(out, t, f, a, b) {
    const n = t.length;
    const dt = t[1] - t[0];
    let pr = Math.cos(TAU * f * t[0]), pi = Math.sin(TAU * f * t[0]);
    const sr = Math.cos(TAU * f * dt), si = Math.sin(TAU * f * dt);
    for (let i = 0; i < n; i++) {
      out[i] += a * pr - b * pi;
      const nr = pr * sr - pi * si;
      pi = pr * si + pi * sr;
      pr = nr;
    }
  }

  /* y(t) = Ts·Σ x[n]·h(t − nTs), con h(t) = Σ r_k e^{p_k t} per t ≥ 0.
     Ogni polo ha un accumulatore complesso che evolve fra un campione
     e il successivo; si parte abbastanza prima della finestra perché
     il transitorio iniziale si sia esaurito. */
  function butterworthOut(out, t, xf, Ts) {
    const P = butterPoles(S.order, S.fc);
    const r = P.map((p, k) => {
      let num = [1, 0], den = [1, 0];
      P.forEach((q, j) => { num = cmul(num, [-q[0], -q[1]]); if (j !== k) den = cmul(den, [p[0] - q[0], p[1] - q[1]]); });
      return cdiv(num, den);
    });
    const slow = Math.min(...P.map(([a]) => -a));
    const warm = Math.min(14 / slow, 60000 * Ts);
    let n = Math.ceil((t[0] - warm) / Ts);
    const acc = P.map(() => [0, 0]);
    let tl = n * Ts;
    for (let i = 0; i < t.length; i++) {
      for (; n * Ts <= t[i]; n++) {
        const tt = n * Ts, v = xf(tt);
        for (let k = 0; k < P.length; k++) {
          const e = cexp(P[k], tt - tl);
          const a = cmul(acc[k], e);
          acc[k] = [a[0] + v, a[1]];
        }
        tl = tt;
      }
      let y = 0;
      for (let k = 0; k < P.length; k++) {
        const v = cmul(r[k], cmul(acc[k], cexp(P[k], t[i] - tl)));
        y += v[0];
      }
      out[i] = y * Ts;
    }
  }

  /* =======================================================
     GRAFICI
     ======================================================= */
  class Plot {
    constructor(canvas, draw) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.draw = draw;
      this.pad = { l: 44, r: 14, t: 14, b: 26 };
      this.hx = null;
      this.xl = '';
      canvas.addEventListener('pointermove', e => { this.hx = e.offsetX; this.render(); });
      canvas.addEventListener('pointerleave', () => { this.hx = null; this.render(); });
      new ResizeObserver(() => { this.resize(); this.render(); }).observe(canvas);
    }
    resize() {
      const r = this.c.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      this.w = r.width; this.h = r.height;
      this.c.width = Math.max(1, Math.round(r.width * d));
      this.c.height = Math.max(1, Math.round(r.height * d));
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
      this.pad.l = this.w < 420 ? 36 : 44;
    }
    view(x0, x1, y0, y1) { Object.assign(this, { x0, x1, y0, y1 }); }
    X(v) { return this.pad.l + (v - this.x0) / (this.x1 - this.x0) * (this.w - this.pad.l - this.pad.r); }
    Y(v) { return this.pad.t + (1 - (v - this.y0) / (this.y1 - this.y0)) * (this.h - this.pad.t - this.pad.b); }
    invX(px) { return this.x0 + (px - this.pad.l) / (this.w - this.pad.l - this.pad.r) * (this.x1 - this.x0); }
    render() {
      if (!R || !this.w) return;
      const g = this.ctx;
      g.clearRect(0, 0, this.w, this.h);
      g.save();
      this.draw(this);
      g.restore();
      this.crosshair();
    }

    axes(xl) {
      const g = this.ctx;
      this.xl = xl;
      g.font = '10px "JetBrains Mono", ui-monospace, monospace';
      g.lineWidth = 1;
      const xs = ticks(this.x0, this.x1, Math.max(4, Math.floor(this.w / 90)));
      const ys = ticks(this.y0, this.y1, Math.max(3, Math.floor(this.h / 55)));
      g.strokeStyle = COL.grid;
      g.beginPath();
      for (const v of xs.v) { const px = Math.round(this.X(v)) + 0.5; g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); }
      for (const v of ys.v) { const py = Math.round(this.Y(v)) + 0.5; g.moveTo(this.pad.l, py); g.lineTo(this.w - this.pad.r, py); }
      g.stroke();
      g.strokeStyle = COL.axis;
      g.beginPath();
      if (this.y0 < 0 && this.y1 > 0) { const py = Math.round(this.Y(0)) + 0.5; g.moveTo(this.pad.l, py); g.lineTo(this.w - this.pad.r, py); }
      if (this.x0 < 0 && this.x1 > 0) { const px = Math.round(this.X(0)) + 0.5; g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); }
      g.stroke();
      g.fillStyle = COL.label;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of xs.v) g.fillText(fmt(v, xs.d), this.X(v), this.h - this.pad.b + 7);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of ys.v) g.fillText(fmt(v, ys.d), this.pad.l - 7, this.Y(v));
      g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillText(xl, this.w - this.pad.r, this.h - this.pad.b - 4);
    }
    clip() {
      const g = this.ctx;
      g.beginPath();
      g.rect(this.pad.l, this.pad.t - 2, this.w - this.pad.l - this.pad.r, this.h - this.pad.t - this.pad.b + 4);
      g.clip();
    }
    line(xs, ys, color, lw = 1.5, dash = null) {
      const g = this.ctx;
      g.strokeStyle = color; g.lineWidth = lw;
      g.setLineDash(dash || []);
      g.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const px = this.X(xs[i]), py = this.Y(ys[i]);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
    }
    area(xs, ys, color) {
      const g = this.ctx;
      const y0 = this.Y(0);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(this.X(xs[0]), y0);
      for (let i = 0; i < xs.length; i++) g.lineTo(this.X(xs[i]), this.Y(ys[i]));
      g.lineTo(this.X(xs[xs.length - 1]), y0);
      g.closePath();
      g.fill();
    }
    stems(xs, ys, color, r = 2.5, stem = true, alpha = 0.55) {
      const g = this.ctx;
      const y0 = this.Y(0);
      if (stem) {
        g.strokeStyle = rgba(color, alpha); g.lineWidth = 1;
        g.beginPath();
        for (let i = 0; i < xs.length; i++) { const px = this.X(xs[i]); g.moveTo(px, y0); g.lineTo(px, this.Y(ys[i])); }
        g.stroke();
      }
      if (r > 0) {
        g.fillStyle = color;
        g.beginPath();
        for (let i = 0; i < xs.length; i++) {
          const px = this.X(xs[i]), py = this.Y(ys[i]);
          g.moveTo(px + r, py); g.arc(px, py, r, 0, TAU);
        }
        g.fill();
      }
    }
    vline(v, color, dash = [3, 4], label = null, top = true) {
      const g = this.ctx;
      const px = Math.round(this.X(v)) + 0.5;
      if (px < this.pad.l || px > this.w - this.pad.r) return;
      g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dash);
      g.beginPath(); g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); g.stroke();
      g.setLineDash([]);
      if (label) {
        g.font = '10px "JetBrains Mono", ui-monospace, monospace';
        g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = top ? 'top' : 'bottom';
        g.fillText(label, px, top ? this.pad.t + 2 : this.h - this.pad.b - 2);
      }
    }
    crosshair() {
      if (this.hx == null || this.hx < this.pad.l || this.hx > this.w - this.pad.r) return;
      const g = this.ctx;
      const px = Math.round(this.hx) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); g.stroke();
      const v = this.invX(this.hx);
      const txt = `${this.xl.split(' ')[0]} = ${fmt(v, 3)}`;
      g.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
      const w = g.measureText(txt).width + 12;
      const bx = Math.min(this.w - this.pad.r - w, Math.max(this.pad.l, px + 6));
      g.fillStyle = 'rgba(19,20,24,0.92)';
      g.fillRect(bx, this.pad.t + 2, w, 18);
      g.fillStyle = COL.sig; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(txt, bx + 6, this.pad.t + 11);
    }
  }

  function ticks(a, b, n) {
    const span = b - a;
    let step = Math.pow(10, Math.floor(Math.log10(span / n)));
    const e = span / n / step;
    if (e >= 7.5) step *= 10; else if (e >= 3.5) step *= 5; else if (e >= 1.5) step *= 2;
    const v = [];
    for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) v.push(Math.abs(x) < step * 1e-6 ? 0 : x);
    return { v, d: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }

  const yRange = (arrs, base) => {
    let lo = base[0], hi = base[1];
    for (const a of arrs) for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.06;
    return [Math.max(lo - pad, -4), Math.min(hi + pad, 4)];
  };
  const BASE_Y = [-1.35, 1.35];

  /* ── 1. tempo ── */
  const pTime = new Plot($('c-time'), p => {
    p.view(-R.T, R.T, ...BASE_Y);
    p.axes('t [ms]');
    p.clip();
    p.line(R.t, R.x, COL.sig, 1.5);
    const many = R.tn.length > 160;
    p.stems(R.tn, R.xn, COL.smp, many ? 1.4 : 2.8, !many);
  });

  /* ── 2. spettro originale ── */
  const pSpec = new Plot($('c-spec'), p => {
    let mx = 0; for (const l of R.lines) mx = Math.max(mx, Math.hypot(l.re, l.im));
    p.view(-R.Fv, R.Fv, 0, mx * 1.2);
    p.axes('f [kHz]');
    p.clip();
    p.stems(R.lines.map(l => l.f), R.lines.map(l => Math.hypot(l.re, l.im)), COL.r0, 2.2, true, 0.8);
  });

  /* ── 3. spettro campionato + filtro ── */
  const pSamp = new Plot($('c-samp'), p => {
    const g = p.ctx;
    let mx = 0;
    for (const b of R.bins) if (Math.abs(b.f) <= R.Fv) mx = Math.max(mx, Math.hypot(b.re, b.im));
    p.view(-R.Fv, R.Fv, 0, (mx || 1) * 1.22);
    p.axes('f [kHz]');
    p.clip();

    /* filtro: banda passante ideale, oppure |H(f)| riferito alla scala del grafico */
    if (S.filter === 'ideal') {
      const a = p.X(-S.fc), b = p.X(S.fc);
      g.fillStyle = rgba(COL.filter, 0.07);
      g.fillRect(a, p.pad.t, b - a, p.h - p.pad.t - p.pad.b);
    } else {
      const n = 400, fx = [], hy = [];
      for (let i = 0; i < n; i++) { const f = -R.Fv + 2 * R.Fv * i / (n - 1); fx.push(f); hy.push(Hmag(f) * p.y1 * 0.92); }
      p.area(fx, hy, rgba(COL.filter, 0.07));
      p.line(fx, hy, rgba(COL.filter, 0.8), 1.2);
    }

    /* multipli di fs e fs/2 */
    const Mv = Math.floor(R.Fv / S.fs);
    for (let m = -Mv; m <= Mv; m++) {
      if (!m) continue;
      p.vline(m * S.fs, 'rgba(255,255,255,0.12)', [1, 3], m === 1 ? 'fs' : m === -1 ? '−fs' : `${m}fs`, false);
    }
    p.vline(S.fs / 2, 'rgba(255,255,255,0.28)', [4, 4], 'fs/2', true);
    p.vline(-S.fs / 2, 'rgba(255,255,255,0.28)', [4, 4], null);

    /* ciano: componente vera del segnale (anche se vi cade sopra un alias);
       rosso: solo alias ripiegati nella banda base; viola: repliche */
    const groups = { z: [], o: [], a: [] };
    for (const b of R.bins) {
      if (Math.abs(b.f) > R.Fv) continue;
      const m = Math.hypot(b.re, b.im);
      if (m < 1e-6) continue;
      const inBase = Math.abs(b.f) < S.fs / 2;
      const k = b.zm > 1e-9 ? 'z' : inBase ? 'a' : 'o';
      groups[k].push([b.f, m]);
    }
    p.stems(groups.o.map(v => v[0]), groups.o.map(v => v[1]), COL.rk, 2, true, 0.6);
    p.stems(groups.z.map(v => v[0]), groups.z.map(v => v[1]), COL.r0, 2.2, true, 0.85);
    p.stems(groups.a.map(v => v[0]), groups.a.map(v => v[1]), COL.alias, 2.6, true, 0.9);

    /* taglio del filtro, trascinabile */
    for (const v of [-S.fc, S.fc]) {
      p.vline(v, COL.filter, [5, 3]);
      const px = p.X(v);
      g.fillStyle = COL.filter;
      g.fillRect(px - 3.5, p.pad.t + 18, 7, 16);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(px - 0.5, p.pad.t + 21, 1, 10);
    }
  });

  /* ── 4. ricostruzione ── */
  const pRec = new Plot($('c-rec'), p => {
    const [y0, y1] = yRange([R.xr], BASE_Y);
    p.view(-R.T, R.T, y0, y1);
    p.axes('t [ms]');
    p.clip();
    p.line(R.t, R.ref, rgba(COL.sig, 0.45), 1.4);
    if (S.err) {
      const e = R.xr.map((v, i) => v - R.ref[i]);
      p.area(R.t, e, rgba(COL.alias, 0.12));
      p.line(R.t, e, COL.alias, 1.1);
    }
    p.line(R.t, R.xr, COL.rec, 1.8);
  });

  const plots = [pTime, pSpec, pSamp, pRec];

  /* ── trascinamento del taglio del filtro ── */
  (() => {
    const c = pSamp.c;
    let drag = false;
    const near = px => {
      const tol = matchMedia('(pointer: coarse)').matches ? 22 : 10;
      return [-1, 1].some(s => Math.abs(pSamp.X(s * S.fc) - px) < tol);
    };
    c.addEventListener('pointerdown', e => {
      if (!near(e.offsetX)) return;
      drag = true;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!drag) { c.classList.toggle('is-drag', near(e.offsetX)); return; }
      const v = Math.min(12, Math.max(0.05, Math.abs(pSamp.invX(e.offsetX))));
      S.fc = Math.round(v * 100) / 100;
      changed();
    });
    const end = () => { drag = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();

  /* =======================================================
     INTERFACCIA
     ======================================================= */
  const ui = {
    sig: $('sig'), f0: $('f0'), f1: $('f1'), fs: $('fs'), fc: $('fc'), order: $('order'),
    err: $('show-error'), fsQ: $('fs-quick'),
  };
  const setFill = el => {
    const p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', `${p}%`);
  };

  function syncUI() {
    ui.sig.value = S.sig;
    for (const k of ['f0', 'f1', 'fs', 'fc', 'order']) { ui[k].value = S[k]; setFill(ui[k]); }
    ui.fsQ.value = S.fs; setFill(ui.fsQ);
    ui.err.checked = S.err;

    $('f0-out').textContent = `${fmt(S.f0)} kHz`;
    $('f1-out').textContent = `${fmt(S.f1)} kHz`;
    $('fs-out').textContent = `${fmt(S.fs)} kHz`;
    $('fs-quick-out').textContent = `${fmt(S.fs)} kHz`;
    $('fc-out').textContent = `${fmt(S.fc)} kHz`;
    $('order-out').textContent = String(S.order);

    $('f1-field').hidden = S.sig !== 'two';
    $('order-field').hidden = S.filter !== 'butter';
    $('sig-note').textContent = SIG[S.sig].note;

    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.filter === S.filter)));
    document.querySelectorAll('.if-err').forEach(el => { el.hidden = !S.err; });
  }

  function stats() {
    const fN = S.fs / 2;
    const band = isFinite(R.fTop);
    $('st-fs').innerHTML = `${fmt(S.fs)}<small>kHz</small>`;
    $('st-fmax').innerHTML = band ? `${fmt(R.fTop)}<small>kHz</small>` : '∞';
    $('st-nyq').innerHTML = band ? `${fmt(2 * R.fTop)}<small>kHz</small>` : '∞';
    const snr = v => (v === Infinity || v > 80 ? '> 80' : fmt(v, 1));
    $('st-snr').innerHTML = `${snr(R.snr)}<small>dB</small>`;

    const D = [];
    const add = (cls, html) => D.push(`<li class="${cls}">${html}</li>`);
    if (band) {
      if (!R.toneAlias.length) add('ok', 'Tutte le componenti sono sotto f<sub>s</sub>/2.');
      for (const [fr, fa] of R.toneAlias) add('bad', `La componente a ${fmt(fr)} kHz supera f<sub>s</sub>/2 e ricompare a ${fmt(fa)} kHz.`);
      for (const fr of R.toneCut) add('warn', `Il filtro attenua la componente a ${fmt(fr)} kHz: f<sub>c</sub> è troppo basso.`);
    } else {
      add('bad', 'Segnale non a banda limitata: le armoniche oltre f<sub>s</sub>/2 si ripiegano. Aumentare f<sub>s</sub> riduce l\'aliasing, ma non lo elimina.');
    }
    if (S.filter === 'ideal') {
      if (S.fc > fN + 1e-9) add('warn', 'f<sub>c</sub> supera f<sub>s</sub>/2: passano anche righe delle repliche.');
    } else {
      const att = 20 * Math.log10(Hmag(S.fs - S.fc));
      add('info', `Butterworth di ordine ${S.order}: ${fmt(att, 1)} dB a f<sub>s</sub> − f<sub>c</sub>, ritardo di gruppo τ = ${fmt(R.tau * 1000, 0)} µs. SNR ed errore sono calcolati rispetto a x(t − τ).`);
    }
    $('st-diag').innerHTML = D.join('');

    $('m-time').textContent = `Ts = ${fmt(1000 / S.fs, 0)} µs · ${R.tn.length} campioni in ±${fmt(R.T, 2)} ms`;
    $('m-spec').textContent = S.sig === 'two' ? `f₀ = ${fmt(S.f0)} kHz · f₁ = ${fmt(S.f1)} kHz` : `f₀ = ${fmt(S.f0)} kHz`;
    $('m-samp').textContent = S.filter === 'ideal' ? `ideale · fc = ${fmt(S.fc)} kHz` : `Butterworth N = ${S.order} · fc = ${fmt(S.fc)} kHz`;
    $('m-rec').textContent = R.tau ? `riferimento x(t − ${fmt(R.tau * 1000, 0)} µs) · SNR ${snr(R.snr)} dB` : `SNR ${snr(R.snr)} dB`;
  }

  /* ── aggiornamento ── */
  let queued = false;
  function changed() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      compute();
      syncUI();
      stats();
      plots.forEach(p => p.render());
      saveHash();
    });
  }

  const num = (el, k) => el.addEventListener('input', () => { S[k] = parseFloat(el.value); changed(); });
  num(ui.f0, 'f0'); num(ui.f1, 'f1'); num(ui.fs, 'fs'); num(ui.fc, 'fc'); num(ui.order, 'order');
  ui.fsQ.addEventListener('input', () => { S.fs = parseFloat(ui.fsQ.value); changed(); });
  ui.sig.addEventListener('change', () => { S.sig = ui.sig.value; changed(); });
  ui.err.addEventListener('change', () => { S.err = ui.err.checked; changed(); });
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { S.filter = b.dataset.filter; changed(); }));

  /* ── stato nell'indirizzo ── */
  const KEYS = Object.keys(DEFAULT);
  let hashTimer = 0;
  function saveHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const q = KEYS.filter(k => S[k] !== DEFAULT[k])
        .map(k => `${k}=${typeof S[k] === 'boolean' ? (S[k] ? 1 : 0) : S[k]}`).join('&');
      history.replaceState(null, '', q ? `#${q}` : location.pathname + location.search);
    }, 250);
  }
  function loadHash() {
    const h = location.hash.slice(1);
    if (!h) return;
    for (const part of h.split('&')) {
      const [k, v] = part.split('=');
      if (!(k in DEFAULT) || v === undefined) continue;
      const d = DEFAULT[k];
      if (typeof d === 'number') {
        const n = parseFloat(v);
        if (isFinite(n)) S[k] = Math.min(+ui[k].max, Math.max(+ui[k].min, k === 'order' ? Math.round(n) : n));
      }
      else if (typeof d === 'boolean') S[k] = v === '1';
      else if (k === 'sig' && Object.hasOwn(SIG, v)) S[k] = v;
      else if (k === 'filter' && (v === 'ideal' || v === 'butter')) S[k] = v;
    }
  }

  loadHash();
  plots.forEach(p => p.resize());
  changed();
})();
