/* =========================================================
   GABBRO — sampling.js
   Laboratorio di campionamento (tools/sampling.html).

   Unità: frequenze in kHz, tempi in ms (kHz · ms = 1).
   Tutti i calcoli "teorici" sono in forma chiusa:
   - segnali a banda limitata: X(f) analitico, spettro del
     campionato come somma di repliche, ricostruzione come
     integrale di H(f)·Z(f)·Xs(f)·e^{j2πft} sulla banda passante;
   - segnali periodici: spettro a righe, repliche delle righe,
     ricostruzione come somma delle righe che passano il filtro.
   Il confronto numerico usa la DFT dei campioni nella finestra.
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const TAU = 2 * Math.PI;

  /* colori: gli stessi valori sono in css/sampling.css */
  const COL = {
    sig: '#e9eaee', smp: '#22d3ee', r0: '#22d3ee', rk: '#a78bfa',
    alias: '#e63946', filter: '#f5a524', rec: '#4ade80', dft: '#f472b6',
    grid: 'rgba(255,255,255,0.045)', axis: 'rgba(255,255,255,0.16)',
    label: '#6b6f7a', text: '#a0a3ad',
  };
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const sinc = x => {
    if (Math.abs(x) < 1e-9) return 1;
    const p = Math.PI * x;
    return Math.sin(p) / p;
  };
  const fmt = (v, d = 2) => {
    if (!isFinite(v)) return '—';
    const s = v.toFixed(d);
    return (d > 0 ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace(/^-0$/, '0');
  };

  /* =======================================================
     SEGNALI
     ======================================================= */

  /* a banda limitata: X(f) reale e pari, x(0) = 1 */
  const BL = {
    tri: {
      band: [0, 1], T: 4, y: [-0.35, 1.15],
      X: f => { const a = Math.abs(f); return a < 1 ? 1 - a : 0; },
      x: t => sinc(t) ** 2,
      note: 'X(f) triangolare di banda B = 1 kHz; nel tempo x(t) = sinc²(Bt).',
    },
    rect: {
      band: [0, 1], T: 4, y: [-0.35, 1.15],
      X: f => { const a = Math.abs(f); return a < 1 ? 0.5 : a === 1 ? 0.25 : 0; },
      x: t => sinc(2 * t),
      note: 'X(f) rettangolare di banda B = 1 kHz; nel tempo x(t) = sinc(2Bt).',
    },
    trap: {
      band: [0, 1], T: 4, y: [-0.35, 1.15],
      X: f => { const a = Math.abs(f); return a <= 0.5 ? 2 / 3 : a < 1 ? (4 / 3) * (1 - a) : 0; },
      x: t => sinc(1.5 * t) * sinc(0.5 * t),
      note: 'X(f) piatto fino a B/2 e lineare fino a B = 1 kHz; nel tempo è il prodotto di due sinc.',
    },
    rc: {
      band: [0, 1], T: 4, y: [-0.35, 1.15],
      X: f => {
        const a = Math.abs(f);
        if (a <= 1 / 3) return 0.75;
        if (a < 1) return 0.375 * (1 + Math.cos(Math.PI * (a - 1 / 3) / (2 / 3)));
        return 0;
      },
      x: t => {
        const u = 4 * t / 3;
        let d = 1 - u * u;
        if (Math.abs(d) < 1e-7) d = 1e-7;
        return sinc(u) * Math.cos(Math.PI * 0.5 * u) / d;
      },
      note: 'Coseno rialzato con roll-off β = 0,5 e banda B = 1 kHz: lo spettro scende a zero senza discontinuità.',
    },
    bp: {
      band: [2, 3], T: 4, y: [-1.15, 1.15],
      X: f => { const d = Math.abs(Math.abs(f) - 2.5); return d < 0.5 ? 1 - d / 0.5 : 0; },
      x: t => sinc(0.5 * t) ** 2 * Math.cos(TAU * 2.5 * t),
      note: 'Spettro triangolare fra 2 e 3 kHz: x(t) = sinc²(Wt)·cos(2π·2,5t), con W = 0,5 kHz.',
    },
  };

  /* periodici: righe {f, re, im} a due lati e forma chiusa nel tempo */
  const frac = v => v - Math.floor(v);
  const PER = {
    square: {
      x: (t, f0) => (frac(f0 * t) < 0.5 ? 1 : -1),
      c: k => (k % 2 ? [0, -2 / (Math.PI * k)] : null),
      note: 'Armoniche dispari con ampiezza 4/(πk): decadono lentamente e l\'aliasing è evidente.',
    },
    ptri: {
      x: (t, f0) => { const p = frac(f0 * t); return 1 - 4 * Math.min(p, 1 - p); },
      c: k => (k % 2 ? [4 / (Math.PI * Math.PI * k * k), 0] : null),
      note: 'Armoniche dispari con ampiezza 8/(π²k²): decadono rapidamente, l\'aliasing è contenuto.',
    },
    saw: {
      x: (t, f0) => 2 * frac(f0 * t + 0.5) - 1,
      c: k => [0, -((k % 2 ? 1 : -1)) / (Math.PI * k)],
      note: 'Tutte le armoniche, con ampiezza 2/(πk).',
    },
    tones: {
      tones: [[1, 0.5], [2.6, 0.3], [4.3, 0.2]],
      x(t, f0) { return this.tones.reduce((s, [m, a]) => s + a * Math.cos(TAU * m * f0 * t), 0); },
      note: 'Toni a f₀, 2,6·f₀ e 4,3·f₀ con ampiezze 0,5, 0,3 e 0,2.',
    },
  };

  function periodicLines(key, f0, fmax) {
    const s = PER[key];
    const out = [];
    if (key === 'tones') {
      for (const [m, a] of s.tones) {
        out.push({ f: m * f0, re: a / 2, im: 0 }, { f: -m * f0, re: a / 2, im: 0 });
      }
      return out;
    }
    const K = Math.min(400, Math.ceil(fmax / f0));
    for (let k = 1; k <= K; k++) {
      const c = s.c(k);
      if (!c) continue;
      out.push({ f: k * f0, re: c[0], im: c[1] }, { f: -k * f0, re: c[0], im: -c[1] });
    }
    return out;
  }

  /* =======================================================
     STATO
     ======================================================= */
  const DEFAULT = {
    sig: 'tri', f0: 0.4, fs: 4, ph: 0, hold: 'ideal',
    filter: 'lp', fc: 2, f1: 2, f2: 3, lock: true,
    rep: true, err: false, dft: false,
  };
  const S = { ...DEFAULT };

  const PRESETS = {
    over:     { sig: 'tri',    fs: 4,   ph: 0, hold: 'ideal', filter: 'lp', lock: true },
    nyquist:  { sig: 'rect',   fs: 2,   ph: 0, hold: 'ideal', filter: 'lp', lock: true },
    alias:    { sig: 'tri',    fs: 1.4, ph: 0, hold: 'ideal', filter: 'lp', lock: true },
    bandpass: { sig: 'bp',     fs: 3.5, ph: 0, hold: 'ideal', filter: 'bp', f1: 2, f2: 3, lock: false },
    square:   { sig: 'square', f0: 0.3, fs: 4, ph: 0, hold: 'ideal', filter: 'lp', lock: true },
    zoh:      { sig: 'tri',    fs: 3,   ph: 0, hold: 'zoh',   filter: 'lp', lock: true },
  };

  /* =======================================================
     CALCOLO
     ======================================================= */
  let R = null;   // risultati dell'ultimo calcolo

  const NT = 900;
  const NF = 1400;

  function filterBands() {
    return S.filter === 'lp' ? [[0, S.fc]] : [[Math.min(S.f1, S.f2), Math.max(S.f1, S.f2)]];
  }
  function H(f) {
    const a = Math.abs(f);
    for (const [lo, hi] of filterBands()) {
      if (a > lo && a < hi) return 1;
      if (lo === 0 && a === 0) return 1;
      if (Math.abs(a - lo) < 1e-9 || Math.abs(a - hi) < 1e-9) return 0.5;
    }
    return 0;
  }
  /* mantenimento: ideale = 1, ZOH = sinc(f/fs)·e^{-jπf/fs} */
  function Z(f) {
    if (S.hold !== 'zoh') return [1, 0];
    const m = sinc(f / S.fs);
    const th = -Math.PI * f / S.fs;
    return [m * Math.cos(th), m * Math.sin(th)];
  }

  /* intervalli (lati positivo e negativo) */
  const both = ([lo, hi]) => (lo === 0 ? [[-hi, hi]] : [[-hi, -lo], [lo, hi]]);
  const overlapLen = (A, B) => {
    let L = 0;
    for (const [a0, a1] of A) for (const [b0, b1] of B) L += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    return L;
  };
  const shift = (I, d) => I.map(([a, b]) => [a + d, b + d]);

  function compute() {
    const bl = BL[S.sig];
    const Ts = 1 / S.fs;
    const t0 = S.ph * Ts;
    const fb = filterBands();
    const fMaxFilter = fb[0][1];

    /* finestra temporale */
    const T = bl ? bl.T : Math.min(8, Math.max(0.6, 1.5 / S.f0));
    const dt = 2 * T / (NT - 1);
    const t = new Float64Array(NT);
    const x = new Float64Array(NT);
    const xf = bl ? bl.x : (tt => PER[S.sig].x(tt, S.f0));
    for (let i = 0; i < NT; i++) { t[i] = -T + i * dt; x[i] = xf(t[i]); }

    /* campioni nella finestra */
    const n0 = Math.ceil((-T - t0) / Ts), n1 = Math.floor((T - t0) / Ts);
    const tn = [], xn = [];
    for (let n = n0; n <= n1; n++) { const tt = n * Ts + t0; tn.push(tt); xn.push(xf(tt)); }

    /* finestra in frequenza */
    const fHi = bl ? bl.band[1] : 0;
    let Fv = bl
      ? Math.max(S.fs + fHi, 1.5 * fHi, 1.15 * fMaxFilter)
      : Math.max(1.5 * S.fs, 5 * S.f0, 1.15 * fMaxFilter);
    Fv = Math.min(30, Math.max(1.5, Fv));
    const Fext = Math.max(Fv, fMaxFilter) + 0.01;

    const res = { bl: !!bl, T, t, x, tn, xn, Ts, t0, Fv, fHi };

    if (bl) {
      /* ── spettro: griglia, repliche, somma complessa ── */
      const f = new Float64Array(NF);
      const X0 = new Float64Array(NF);
      const mag = new Float64Array(NF);
      const ov = new Uint8Array(NF);
      const M = Math.ceil((Fv + fHi) / S.fs);
      const reps = [];
      for (let m = -M; m <= M; m++) reps.push({ m, v: new Float64Array(NF) });
      for (let i = 0; i < NF; i++) {
        const fi = -Fv + 2 * Fv * i / (NF - 1);
        f[i] = fi;
        X0[i] = bl.X(fi);
        let re = 0, im = 0, cnt = 0;
        for (const r of reps) {
          const v = bl.X(fi - r.m * S.fs);
          r.v[i] = v;
          if (v > 1e-12) {
            cnt++;
            const th = -TAU * r.m * S.ph;
            re += v * Math.cos(th); im += v * Math.sin(th);
          }
        }
        mag[i] = Math.hypot(re, im);
        ov[i] = cnt;
      }
      Object.assign(res, { f, X0, mag, ov, reps });

      /* ── ricostruzione: ∫ H Z S e^{j2πft} df sulla banda passante ── */
      const S_ = fr => {
        let re = 0, im = 0;
        const m0 = Math.ceil((fr - fHi) / S.fs), m1 = Math.floor((fr + fHi) / S.fs);
        for (let m = m0; m <= m1; m++) {
          const v = bl.X(fr - m * S.fs);
          if (!v) continue;
          const th = -TAU * m * S.ph;
          re += v * Math.cos(th); im += v * Math.sin(th);
        }
        return [re, im];
      };
      const xr = new Float64Array(NT);
      for (const band of fb) {
        for (const [lo, hi] of both(band)) {
          const n = Math.max(8, Math.ceil((hi - lo) / 0.02));
          const df = (hi - lo) / n;
          for (let k = 0; k < n; k++) {
            const fr = lo + (k + 0.5) * df;
            const [sr, si] = S_(fr);
            if (!sr && !si) continue;
            const [zr, zi] = Z(fr);
            accumulate(xr, t, fr, (sr * zr - si * zi) * df, (sr * zi + si * zr) * df);
          }
        }
      }
      res.xr = xr;

      /* ── diagnosi ── */
      const sup = both(bl.band);
      let alias = 0;
      const Mm = Math.ceil(2 * fHi / S.fs) + 1;
      for (let m = -Mm; m <= Mm; m++) if (m) alias += overlapLen(sup, shift(sup, m * S.fs));
      const pass = fb.flatMap(both);
      let imaging = 0;
      for (let m = -Math.ceil((fMaxFilter + fHi) / S.fs) - 1; m <= Math.ceil((fMaxFilter + fHi) / S.fs) + 1; m++) {
        if (m) imaging += overlapLen(pass, shift(sup, m * S.fs));
      }
      const supLen = sup.reduce((s, [a, b]) => s + b - a, 0);
      const cut = supLen - overlapLen(sup, pass);
      Object.assign(res, { alias, imaging, cut });
    } else {
      /* ── righe ── */
      const lines = periodicLines(S.sig, S.f0, 4 * Fext);
      res.lines = lines.filter(l => Math.abs(l.f) <= Fv);

      const bins = new Map();
      for (const l of lines) {
        const m0 = Math.ceil((-Fext - l.f) / S.fs), m1 = Math.floor((Fext - l.f) / S.fs);
        for (let m = m0; m <= m1; m++) {
          const fr = l.f + m * S.fs;
          const th = -TAU * m * S.ph;
          const c = Math.cos(th), s = Math.sin(th);
          const key = Math.round(fr * 1e6);
          let b = bins.get(key);
          if (!b) { b = { f: fr, re: 0, im: 0, zm: 0, o: false }; bins.set(key, b); }
          b.re += l.re * c - l.im * s;
          b.im += l.re * s + l.im * c;
          if (m === 0) b.zm = Math.hypot(l.re, l.im); else b.o = true;
        }
      }
      res.bins = [...bins.values()];

      const xr = new Float64Array(NT);
      for (const b of res.bins) {
        const h = H(b.f);
        if (!h) continue;
        const [zr, zi] = Z(b.f);
        accumulate(xr, t, b.f, h * (b.re * zr - b.im * zi), h * (b.re * zi + b.im * zr));
      }
      res.xr = xr;

      /* diagnosi */
      const fN = S.fs / 2;
      if (S.sig === 'tones') {
        res.toneAlias = PER.tones.tones
          .map(([m]) => m * S.f0)
          .filter(fr => fr >= fN - 1e-9)
          .map(fr => [fr, Math.abs(frac(fr / S.fs + 0.5) - 0.5) * S.fs]);
      }
      res.harmBelow = lines.filter(l => l.f > 0 && l.f < fN && Math.hypot(l.re, l.im) > 1e-12).length;
      res.imaging = fb.some(([, hi]) => hi > fN + 1e-9) ? 1 : 0;
    }

    /* errore */
    let pe = 0, pn = 0;
    for (let i = 0; i < NT; i++) { pe += x[i] * x[i]; pn += (res.xr[i] - x[i]) ** 2; }
    res.snr = pn < 1e-30 ? Infinity : 10 * Math.log10(pe / pn);

    /* DFT / IFFT dei campioni nella finestra */
    if (S.dft && tn.length >= 2 && tn.length <= 2048) {
      const N = tn.length;
      const df = S.fs / N;
      const kmin = -Math.floor(N / 2);
      const D = [];
      for (let k = kmin; k < kmin + N; k++) {
        const fr = k * df;
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
          const th = -TAU * fr * tn[n];
          re += xn[n] * Math.cos(th); im += xn[n] * Math.sin(th);
        }
        D.push({ f: fr, re, im });
      }
      /* punti nello spettro: |Ts·D| su tutte le repliche visibili */
      const pts = [];
      const Mv = Math.ceil(Fv / S.fs) + 1;
      for (let m = -Mv; m <= Mv && pts.length < 6000; m++) {
        for (const d of D) {
          const fr = d.f + m * S.fs;
          if (Math.abs(fr) <= Fv) pts.push([fr, Math.hypot(d.re, d.im) * Ts]);
        }
      }
      /* IFFT: bin filtrati, anche delle repliche se il filtro va oltre fs/2 */
      const xi = new Float64Array(NT);
      const Mf = Math.ceil(fMaxFilter / S.fs) + 1;
      for (let m = -Mf; m <= Mf; m++) {
        const th = -TAU * m * S.ph;
        const c = Math.cos(th), s = Math.sin(th);
        for (const d of D) {
          const fr = d.f + m * S.fs;
          const h = H(fr);
          if (!h) continue;
          const re = d.re * c - d.im * s, im = d.re * s + d.im * c;
          const [zr, zi] = Z(fr);
          accumulate(xi, t, fr, h * (re * zr - im * zi) / N, h * (re * zi + im * zr) / N);
        }
      }
      let qe = 0;
      for (let i = 0; i < NT; i++) qe += (xi[i] - x[i]) ** 2;
      Object.assign(res, { dftPts: pts, xi, snrDft: qe < 1e-30 ? Infinity : 10 * Math.log10(pe / qe) });
    } else if (S.dft) {
      res.dftSkip = true;
    }

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
      if (this.w < 420) this.pad.l = 36;
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
    area(xs, ys, color, mask) {
      const g = this.ctx;
      g.fillStyle = color;
      g.beginPath();
      let open = false;
      const y0 = this.Y(0);
      for (let i = 0; i < xs.length; i++) {
        const on = !mask || mask(i);
        if (on && !open) { g.moveTo(this.X(xs[i]), y0); open = true; }
        if (on) g.lineTo(this.X(xs[i]), this.Y(ys[i]));
        if (open && (!on || i === xs.length - 1)) {
          g.lineTo(this.X(xs[on ? i : i - 1]), y0); g.closePath(); open = false;
        }
      }
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
  const baseY = () => (R.bl ? BL[S.sig].y : [-1.35, 1.35]);

  /* ── 1. tempo ── */
  const pTime = new Plot($('c-time'), p => {
    const [y0, y1] = baseY();
    p.view(-R.T, R.T, y0, y1);
    p.axes('t [ms]');
    p.clip();
    if (S.hold === 'zoh') {
      const g = p.ctx;
      g.strokeStyle = rgba(COL.smp, 0.8); g.lineWidth = 1.3;
      g.beginPath();
      R.tn.forEach((tt, i) => {
        const a = p.X(tt), b = p.X(tt + R.Ts), y = p.Y(R.xn[i]);
        i ? g.lineTo(a, y) : g.moveTo(a, y);
        g.lineTo(b, y);
      });
      g.stroke();
      g.fillStyle = rgba(COL.smp, 0.07);
      R.tn.forEach((tt, i) => {
        const a = p.X(tt), b = p.X(tt + R.Ts), y = p.Y(R.xn[i]), y0p = p.Y(0);
        g.fillRect(a, Math.min(y, y0p), b - a, Math.abs(y - y0p));
      });
    }
    p.line(R.t, R.x, COL.sig, 1.5);
    const many = R.tn.length > 160;
    p.stems(R.tn, R.xn, COL.smp, many ? 1.4 : 2.8, S.hold !== 'zoh' && !many);
  });

  /* ── 2. spettro originale ── */
  const pSpec = new Plot($('c-spec'), p => {
    if (R.bl) {
      let mx = 0; for (const v of R.X0) mx = Math.max(mx, v);
      p.view(-R.Fv, R.Fv, 0, mx * 1.18);
      p.axes('f [kHz]');
      p.clip();
      p.area(R.f, R.X0, rgba(COL.r0, 0.14));
      p.line(R.f, R.X0, COL.r0, 1.5);
      const [lo, hi] = BL[S.sig].band;
      for (const v of lo ? [-hi, -lo, lo, hi] : [-hi, hi]) p.vline(v, rgba(COL.r0, 0.45), [2, 4]);
    } else {
      let mx = 0; for (const l of R.lines) mx = Math.max(mx, Math.hypot(l.re, l.im));
      p.view(-R.Fv, R.Fv, 0, mx * 1.2);
      p.axes('f [kHz]');
      p.clip();
      p.stems(R.lines.map(l => l.f), R.lines.map(l => Math.hypot(l.re, l.im)), COL.r0, 2.2, true, 0.8);
    }
  });

  /* ── 3. spettro campionato + filtro ── */
  const pSamp = new Plot($('c-samp'), p => {
    const g = p.ctx;
    let mx;
    if (R.bl) { mx = 0; for (const v of R.mag) mx = Math.max(mx, v); for (const v of R.X0) mx = Math.max(mx, v); }
    else { mx = 0; for (const b of R.bins) if (Math.abs(b.f) <= R.Fv) mx = Math.max(mx, Math.hypot(b.re, b.im)); }
    if (R.dftPts) for (const [, v] of R.dftPts) mx = Math.max(mx, v);
    p.view(-R.Fv, R.Fv, 0, (mx || 1) * 1.22);
    p.axes('f [kHz]');
    p.clip();

    /* filtro */
    for (const band of filterBands()) {
      for (const [lo, hi] of both(band)) {
        const a = p.X(lo), b = p.X(hi);
        g.fillStyle = rgba(COL.filter, 0.07);
        g.fillRect(a, p.pad.t, b - a, p.h - p.pad.t - p.pad.b);
      }
    }

    /* multipli di fs e fs/2 */
    const Mv = Math.floor(R.Fv / S.fs);
    for (let m = -Mv; m <= Mv; m++) {
      if (!m) continue;
      p.vline(m * S.fs, 'rgba(255,255,255,0.12)', [1, 3], m === 1 ? 'fs' : m === -1 ? '−fs' : `${m}fs`, false);
    }
    p.vline(S.fs / 2, 'rgba(255,255,255,0.28)', [4, 4], 'fs/2', true);
    p.vline(-S.fs / 2, 'rgba(255,255,255,0.28)', [4, 4], null);

    if (R.bl) {
      p.area(R.f, R.mag, rgba(COL.alias, 0.3), i => R.ov[i] >= 2);
      if (S.rep) {
        for (const r of R.reps) {
          if (!r.m) continue;
          p.line(R.f, r.v, rgba(COL.rk, 0.75), 1.1);
        }
        const r0 = R.reps.find(r => r.m === 0);
        p.area(R.f, r0.v, rgba(COL.r0, 0.1));
        p.line(R.f, r0.v, COL.r0, 1.4);
        p.line(R.f, R.mag, rgba(COL.sig, 0.85), 1.1, [3, 3]);
      } else {
        p.area(R.f, R.mag, rgba(COL.r0, 0.12));
        p.line(R.f, R.mag, COL.r0, 1.5);
      }
    } else {
      const vis = R.bins.filter(b => Math.abs(b.f) <= R.Fv);
      const groups = { z: [], o: [], a: [] };
      for (const b of vis) {
        const m = Math.hypot(b.re, b.im);
        if (m < 1e-6) continue;
        /* ciano: componente vera del segnale (anche se vi cade sopra un alias);
           rosso: solo alias ripiegati nella banda base; viola: repliche */
        const inBase = Math.abs(b.f) < S.fs / 2;
        const k = b.zm > 1e-9 ? 'z' : inBase ? 'a' : 'o';
        groups[k].push([b.f, m]);
      }
      if (S.rep) p.stems(groups.o.map(v => v[0]), groups.o.map(v => v[1]), COL.rk, 2, true, 0.6);
      p.stems(groups.z.map(v => v[0]), groups.z.map(v => v[1]), COL.r0, 2.2, true, 0.85);
      p.stems(groups.a.map(v => v[0]), groups.a.map(v => v[1]), COL.alias, 2.6, true, 0.9);
    }

    if (R.dftPts) {
      g.fillStyle = rgba(COL.dft, 0.85);
      g.beginPath();
      for (const [fr, v] of R.dftPts) { const px = p.X(fr), py = p.Y(v); g.moveTo(px + 1.6, py); g.arc(px, py, 1.6, 0, TAU); }
      g.fill();
    }

    /* bordi del filtro, trascinabili */
    for (const band of filterBands()) {
      const edges = band[0] === 0 ? [-band[1], band[1]] : [-band[1], -band[0], band[0], band[1]];
      for (const v of edges) {
        p.vline(v, COL.filter, [5, 3]);
        const px = p.X(v);
        g.fillStyle = COL.filter;
        g.fillRect(px - 3.5, p.pad.t + 18, 7, 16);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(px - 0.5, p.pad.t + 21, 1, 10);
      }
    }
  });

  /* ── 4. ricostruzione ── */
  const pRec = new Plot($('c-rec'), p => {
    const arrs = [R.xr];
    if (R.xi) arrs.push(R.xi);
    const [y0, y1] = yRange(arrs, baseY());
    p.view(-R.T, R.T, y0, y1);
    p.axes('t [ms]');
    p.clip();
    p.line(R.t, R.x, rgba(COL.sig, 0.45), 1.4);
    if (S.err) {
      const e = R.xr.map((v, i) => v - R.x[i]);
      p.area(R.t, e, rgba(COL.alias, 0.12));
      p.line(R.t, e, COL.alias, 1.1);
    }
    if (R.xi) p.line(R.t, R.xi, COL.dft, 1.3, [5, 4]);
    p.line(R.t, R.xr, COL.rec, 1.8);
  });

  const plots = [pTime, pSpec, pSamp, pRec];

  /* ── trascinamento dei bordi del filtro ── */
  (() => {
    const c = pSamp.c;
    let drag = null;
    const edgeAt = px => {
      const tol = matchMedia('(pointer: coarse)').matches ? 22 : 10;
      let best = null, bd = tol;
      const cand = S.filter === 'lp' ? [['fc', S.fc]] : [['f1', S.f1], ['f2', S.f2]];
      for (const [k, v] of cand) for (const s of [-1, 1]) {
        const d = Math.abs(pSamp.X(s * v) - px);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    };
    c.addEventListener('pointerdown', e => {
      const k = edgeAt(e.offsetX);
      if (!k) return;
      drag = k;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!drag) { c.classList.toggle('is-drag', !!edgeAt(e.offsetX)); return; }
      const v = Math.min(12, Math.max(0.05, Math.abs(pSamp.invX(e.offsetX))));
      S[drag] = Math.round(v * 100) / 100;
      if (drag === 'fc') S.lock = false;
      changed();
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();

  /* =======================================================
     INTERFACCIA
     ======================================================= */
  const ui = {
    sig: $('sig'), f0: $('f0'), fs: $('fs'), ph: $('ph'), fc: $('fc'), f1: $('f1'), f2: $('f2'),
    lock: $('lock'), rep: $('show-replicas'), err: $('show-error'), dft: $('show-dft'),
    fsQ: $('fs-quick'),
  };
  const setFill = el => {
    const p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', `${p}%`);
  };

  function syncUI() {
    ui.sig.value = S.sig;
    for (const k of ['f0', 'fs', 'ph', 'fc', 'f1', 'f2']) { ui[k].value = S[k]; setFill(ui[k]); }
    ui.fsQ.value = S.fs; setFill(ui.fsQ);
    ui.lock.checked = S.lock; ui.rep.checked = S.rep; ui.err.checked = S.err; ui.dft.checked = S.dft;

    $('f0-out').textContent = `${fmt(S.f0)} kHz`;
    $('fs-out').textContent = `${fmt(S.fs)} kHz`;
    $('fs-quick-out').textContent = `${fmt(S.fs)} kHz`;
    $('ph-out').textContent = `${Math.round(S.ph * 100)}% · ${fmt(S.ph / S.fs * 1000, 0)} µs`;
    $('fc-out').textContent = `${fmt(S.fc)} kHz`;
    $('f1-out').textContent = `${fmt(S.f1)} kHz`;
    $('f2-out').textContent = `${fmt(S.f2)} kHz`;

    const per = !BL[S.sig];
    $('f0-field').hidden = !per;
    $('fc-field').hidden = S.filter !== 'lp';
    $('lock-field').hidden = S.filter !== 'lp';
    $('f1-field').hidden = $('f2-field').hidden = S.filter !== 'bp';
    $('sig-note').textContent = (BL[S.sig] || PER[S.sig]).note;

    document.querySelectorAll('[data-hold]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.hold === S.hold)));
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.filter === S.filter)));
    document.querySelectorAll('.if-zoh').forEach(el => { el.hidden = S.hold !== 'zoh'; });
    document.querySelectorAll('.if-err').forEach(el => { el.hidden = !S.err; });
    document.querySelectorAll('.if-dft').forEach(el => { el.hidden = !S.dft; });
  }

  function stats() {
    $('st-fs').innerHTML = `${fmt(S.fs)}<small>kHz</small>`;
    const lab = $('st-nyq-label'), val = $('st-nyq');
    if (R.bl && S.sig === 'bp') {
      lab.textContent = 'fs validi (passa-banda)';
      const [fL, fH] = BL.bp.band;
      const ranges = [];
      for (let n = 1; n <= Math.floor(fH / (fH - fL)); n++) {
        const a = 2 * fH / n, b = n === 1 ? Infinity : 2 * fL / (n - 1);
        if (a <= b) ranges.push([a, b]);
      }
      const hit = ranges.find(([a, b]) => S.fs >= a - 1e-9 && S.fs <= b + 1e-9);
      const show = hit || ranges.reduce((best, r) => (Math.abs(r[0] - S.fs) < Math.abs(best[0] - S.fs) ? r : best));
      val.innerHTML = `${fmt(show[0])}${isFinite(show[1]) ? `–${fmt(show[1])}` : '+'}<small>kHz</small>`;
    } else if (R.bl) {
      lab.textContent = '2B (Nyquist)';
      val.innerHTML = `${fmt(2 * R.fHi)}<small>kHz</small>`;
    } else {
      lab.textContent = 'Armoniche sotto fs/2';
      val.textContent = String(R.harmBelow);
    }
    $('st-n').textContent = String(R.tn.length);
    const snr = v => (v === Infinity || v > 80 ? '> 80' : fmt(v, 1));
    $('st-snr').innerHTML = `${snr(R.snr)}<small>dB</small>`;

    const D = [];
    const add = (cls, html) => D.push(`<li class="${cls}">${html}</li>`);
    if (R.bl) {
      const nyq = 2 * R.fHi;
      if (R.alias > 1e-6) add('bad', 'Le repliche si sovrappongono: <strong>aliasing</strong>. Nessun filtro può più separarle.');
      else if (S.sig !== 'bp' && Math.abs(S.fs - nyq) < 0.011) add('warn', 'Limite di Nyquist: le repliche si toccano. Serve un filtro con taglio esattamente a B.');
      else add('ok', 'Nessuna sovrapposizione fra le repliche.');
      if (S.sig === 'bp' && R.alias <= 1e-6 && S.fs < nyq) add('info', `Campionamento passa-banda: f<sub>s</sub> è sotto 2·f<sub>H</sub> = ${fmt(nyq)} kHz, ma le repliche non si sovrappongono.`);
      if (R.cut > 0.01) add('warn', 'Il filtro taglia parte dello spettro del segnale.');
      if (R.imaging > 0.01) add('warn', 'Il filtro lascia passare parte delle repliche k ≠ 0 (immagini).');
    } else {
      if (S.sig === 'tones') {
        if (!R.toneAlias.length) add('ok', 'Tutti i toni sono sotto f<sub>s</sub>/2.');
        for (const [fr, fa] of R.toneAlias) add('bad', `Il tono a ${fmt(fr)} kHz supera f<sub>s</sub>/2 e compare a ${fmt(fa)} kHz.`);
      } else {
        add('bad', 'Segnale non a banda limitata: le armoniche oltre f<sub>s</sub>/2 si ripiegano. L\'aliasing si riduce aumentando f<sub>s</sub>, ma non si elimina.');
      }
      if (R.imaging) add('warn', 'f<sub>c</sub> supera f<sub>s</sub>/2: passano anche righe delle repliche.');
    }
    if (S.hold === 'zoh') add('info', `ZOH: attenuazione sinc(f/f<sub>s</sub>), ${fmt(20 * Math.log10(sinc(0.5)), 1)} dB a f<sub>s</sub>/2, e ritardo T<sub>s</sub>/2 = ${fmt(500 / S.fs, 0)} µs.`);
    if (R.dftSkip) add('info', 'Confronto DFT disattivato: troppi campioni nella finestra.');
    else if (S.dft) add('info', `Ricostruzione via IFFT su ${R.tn.length} campioni: SNR ${snr(R.snrDft)} dB.`);
    $('st-diag').innerHTML = D.join('');

    $('m-time').textContent = `Ts = ${fmt(1000 / S.fs, 0)} µs · finestra ±${fmt(R.T, 2)} ms`;
    $('m-spec').textContent = R.bl ? (S.sig === 'bp' ? 'banda 2–3 kHz' : 'B = 1 kHz') : `f₀ = ${fmt(S.f0)} kHz`;
    $('m-samp').textContent = S.filter === 'lp' ? `fc = ${fmt(S.fc)} kHz` : `banda ${fmt(Math.min(S.f1, S.f2))}–${fmt(Math.max(S.f1, S.f2))} kHz`;
    $('m-rec').textContent = `SNR ${snr(R.snr)} dB`;
  }

  /* ── aggiornamento ── */
  let queued = false;
  function changed(fromPreset = false) {
    if (S.lock && S.filter === 'lp') S.fc = Math.round(S.fs / 2 * 1000) / 1000;
    if (!fromPreset) document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('is-active'));
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

  const num = (el, k) => el.addEventListener('input', () => { S[k] = parseFloat(el.value); if (k === 'fc') S.lock = false; changed(); });
  num(ui.f0, 'f0'); num(ui.fs, 'fs'); num(ui.ph, 'ph'); num(ui.fc, 'fc'); num(ui.f1, 'f1'); num(ui.f2, 'f2');
  ui.fsQ.addEventListener('input', () => { S.fs = parseFloat(ui.fsQ.value); changed(); });
  ui.sig.addEventListener('change', () => {
    S.sig = ui.sig.value;
    if (S.sig === 'bp' && S.filter === 'lp') { S.filter = 'bp'; S.f1 = 2; S.f2 = 3; }
    else if (S.sig !== 'bp' && S.filter === 'bp') { S.filter = 'lp'; S.lock = true; }
    changed();
  });
  ui.lock.addEventListener('change', () => { S.lock = ui.lock.checked; changed(); });
  ui.rep.addEventListener('change', () => { S.rep = ui.rep.checked; changed(); });
  ui.err.addEventListener('change', () => { S.err = ui.err.checked; changed(); });
  ui.dft.addEventListener('change', () => { S.dft = ui.dft.checked; changed(); });
  document.querySelectorAll('[data-hold]').forEach(b => b.addEventListener('click', () => { S.hold = b.dataset.hold; changed(); }));
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    S.filter = b.dataset.filter;
    if (S.filter === 'bp' && S.sig !== 'bp') { S.f1 = 0.5; S.f2 = Math.max(1, S.fs / 2); }
    changed();
  }));
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    Object.assign(S, DEFAULT, { rep: S.rep, err: S.err, dft: S.dft }, PRESETS[b.dataset.preset]);
    document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('is-active', x === b));
    changed(true);
  }));

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
      if (typeof d === 'number') { const n = parseFloat(v); if (isFinite(n)) S[k] = n; }
      else if (typeof d === 'boolean') S[k] = v === '1';
      else if (k === 'sig' && (BL[v] || PER[v])) S[k] = v;
      else if (k === 'hold' && (v === 'ideal' || v === 'zoh')) S[k] = v;
      else if (k === 'filter' && (v === 'lp' || v === 'bp')) S[k] = v;
    }
  }

  loadHash();
  plots.forEach(p => p.resize());
  changed(true);
})();
