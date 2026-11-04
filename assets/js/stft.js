/* =========================================================
   GABBRO — stft.js
   STFT e spettrogramma (tools/stft.html).

   Unità: fs in Hz, tempi in s; gli assi mostrano kHz e s.
   Due scale per i frame:
   - ampiezza: |X|²·4/(Σw)², una sinusoide di ampiezza 1
     al centro di un bin dà un picco di 0 dB;
   - densità: |X|²·2/(fs·Σw²), in dB/Hz.
   Finestre periodiche (DFT-even), così la condizione COLA
   è esatta per hop = N/2 (Hann, Hamming) e N/3 (Blackman).
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const TAU = 2 * Math.PI;

  /* =======================================================
     DSP
     ======================================================= */

  /* FFT radix-2 iterativa, in place; n potenza di 2 */
  const TW = new Map();
  function twiddles(n) {
    let t = TW.get(n);
    if (!t) {
      t = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let i = 0; i < n / 2; i++) { t.c[i] = Math.cos(TAU * i / n); t.s[i] = -Math.sin(TAU * i / n); }
      TW.set(n, t);
    }
    return t;
  }
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const { c, s } = twiddles(n);
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = c[k * step], wi = s[k * step];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const WIN = {
    rect:     { a: [1],               bw6: 1.21, cola: 0,       name: 'rettangolare' },
    hann:     { a: [0.5, 0.5],        bw6: 2.00, cola: 50,      name: 'Hann' },
    hamming:  { a: [0.54, 0.46],      bw6: 1.81, cola: 50,      name: 'Hamming' },
    blackman: { a: [0.42, 0.5, 0.08], bw6: 2.35, cola: 200 / 3, name: 'Blackman' },
  };
  function windowFn(type, N) {
    const a = WIN[type].a;
    const w = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let v = a[0];
      for (let k = 1; k < a.length; k++) v += (k % 2 ? -1 : 1) * a[k] * Math.cos(TAU * k * n / N);
      w[n] = v;
    }
    return w;
  }
  const hopOf = (N, ov) => Math.max(1, Math.round(N * (1 - ov / 100)));

  /* potenza → dB, con pavimento per evitare -Infinity */
  const dB = p => 10 * Math.log10(p + 1e-20);

  /* guadagno di potenza per la scala scelta (vedi intestazione) */
  function powerGain(w, fs, scale) {
    let s1 = 0, s2 = 0;
    for (const v of w) { s1 += v; s2 += v * v; }
    return scale === 'psd' ? 2 / (fs * s2) : 4 / (s1 * s1);
  }

  /* spettro in dB del frame che inizia al campione start, su out.length = Nfft/2 + 1 bin;
     re e im sono buffer di lavoro di Nfft campioni */
  function frameDB(x, start, w, g, re, im, out) {
    re.fill(0); im.fill(0);
    for (let n = 0; n < w.length; n++) re[n] = x[start + n] * w[n];
    fft(re, im);
    for (let k = 0; k < out.length; k++) out[k] = dB((re[k] * re[k] + im[k] * im[k]) * g);
    return out;
  }

  /* STFT in dB, ridotta a ≤ MAXC colonne e ≤ MAXR righe prendendo il massimo:
     la memoria resta limitata e gli eventi brevi o stretti non si perdono */
  const MAXC = 2048, MAXR = 1024;
  function stft(x, w, hop, Nfft, g) {
    const N = w.length;
    const F = x.length >= N ? Math.floor((x.length - N) / hop) + 1 : 0;
    const bins = Nfft / 2 + 1;
    const cols = Math.min(F, MAXC), rows = Math.min(bins, MAXR);
    const data = new Float32Array(cols * rows).fill(-Infinity);
    const re = new Float64Array(Nfft), im = new Float64Array(Nfft), s = new Float32Array(bins);
    for (let m = 0; m < F; m++) {
      frameDB(x, m * hop, w, g, re, im, s);
      const o = Math.floor(m * cols / F) * rows;
      for (let r = 0, k = 0; r < rows; r++) {
        const k1 = Math.floor((r + 1) * bins / rows);
        let v = data[o + r];
        for (; k < k1; k++) if (s[k] > v) v = s[k];
        data[o + r] = v;
      }
    }
    return { F, cols, rows, data };
  }

  /* somma delle finestre traslate di hop, normalizzata a media 1;
     il ripple è misurato a regime, dopo la prima finestra */
  function colaSum(w, hop, len) {
    const N = w.length;
    const sum = new Float64Array(len);
    for (let start = 0; start < len; start += hop) {
      for (let n = 0; n < N && start + n < len; n++) sum[start + n] += w[n];
    }
    let sw = 0;
    for (const v of w) sw += v;
    const g = hop / sw;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < len; i++) {
      sum[i] *= g;
      if (i >= N) { if (sum[i] < lo) lo = sum[i]; if (sum[i] > hi) hi = sum[i]; }
    }
    return { sum, g, ripple: (hi - lo) / ((hi + lo) / 2) };
  }

  /* =======================================================
     SEGNALI DI PROVA
     ======================================================= */

  /* generatore pseudo-casuale con seme: il rumore non cambia a ogni ridisegno */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SIG = {
    chirp: {
      note: fs => `Frequenza istantanea da 200 Hz a ${fmt(Math.min(6000, 0.45 * fs) / 1000, 2)} kHz, lineare nel tempo.`,
      gen(t, D, fs) {
        const f0 = 200, f1 = Math.min(6000, 0.45 * fs);
        return 0.8 * Math.sin(TAU * (f0 * t + (f1 - f0) * t * t / (2 * D)));
      },
    },
    seq: {
      note: () => '1 kHz nella prima metà, 2,5 kHz nella seconda. Il passaggio è a metà della durata.',
      gen: (t, D) => 0.8 * Math.sin(TAU * (t < D / 2 ? 1000 : 2500) * t),
    },
    close: {
      note: () => 'Toni stazionari a 1000 e 1080 Hz. Per separarli serve una risoluzione migliore di 80 Hz.',
      gen: t => 0.4 * Math.sin(TAU * 1000 * t) + 0.4 * Math.sin(TAU * 1080 * t),
    },
    clicks: {
      note: () => 'Tono a 1,5 kHz e due impulsi distanti 10 ms, al 40% della durata. Per separarli serve un frame più corto di 10 ms.',
      gen: t => 0.3 * Math.sin(TAU * 1500 * t),
      post(x, D, fs) {
        const i0 = Math.round(0.4 * D * fs), i1 = i0 + Math.round(0.01 * fs);
        if (i0 < x.length) x[i0] += 1;
        if (i1 < x.length) x[i1] += 1;
      },
    },
    file: {
      note: () => 'File audio decodificato nel browser, ridotto a un canale e troncato a 10 s.',
    },
  };

  /* =======================================================
     UTILITÀ
     ======================================================= */
  function fmt(v, d = 2) {
    if (!isFinite(v)) return '—';
    const s = v.toFixed(d);
    return (d > 0 ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace(/^-0$/, '0');
  }
  const fmtTime = s => (s < 1 ? `${fmt(s * 1000, s < 0.01 ? 2 : 1)} ms` : `${fmt(s, 3)} s`);
  const fmtFreq = f => (f < 1000 ? `${fmt(f, f < 10 ? 2 : 1)} Hz` : `${fmt(f / 1000, 3)} kHz`);

  /* colori: quelli delle legende sono anche in css/stft.css */
  const COL = {
    sig: '#e9eaee', win: '#f5a524', frame: '#22d3ee', wins: '#a78bfa', sum: '#4ade80',
    grid: 'rgba(255,255,255,0.045)', axis: 'rgba(255,255,255,0.16)', label: '#6b6f7a',
  };
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* mappa di colore percettiva (magma), 256 livelli; gli stessi nodi sono nella barra in css/stft.css */
  const LUT = (() => {
    const stops = ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'];
    const rgb = stops.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const p = i / 255 * (rgb.length - 1), j = Math.min(rgb.length - 2, Math.floor(p)), f = p - j;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[j][c] + (rgb[j + 1][c] - rgb[j][c]) * f;
    }
    return lut;
  })();

  /* =======================================================
     STATO
     ======================================================= */
  const DEFAULT = { sig: 'chirp', fs: 16000, dur: 1, noise: -100, win: 'hann', n: 10, ov: 50, zp: 1, scale: 'amp', dyn: 80, pos: 0.5 };
  const S = { ...DEFAULT };
  let fileData = null;   // { x, fs, name }

  /* risultati, ricalcolati solo quando cambiano i parametri da cui dipendono */
  const R = { sigKey: '', x: null, fs: 0, stftKey: '', w: null, hop: 0, Nfft: 0, gain: 1, spg: null, top: 0, cola: null, sliceKey: '', slice: null, imgKey: '' };

  function computeSignal() {
    const key = S.sig === 'file' ? `file:${fileData ? fileData.name : ''}:${S.noise}` : `${S.sig}:${S.fs}:${S.dur}:${S.noise}`;
    if (key === R.sigKey) return;
    let x, fs;
    if (S.sig === 'file' && fileData) {
      fs = fileData.fs;
      x = Float64Array.from(fileData.x);
    } else {
      const sig = SIG[S.sig === 'file' ? 'chirp' : S.sig];
      fs = S.fs;
      const L = Math.round(S.dur * fs);
      x = new Float64Array(L);
      for (let i = 0; i < L; i++) x[i] = sig.gen(i / fs, S.dur, fs);
      if (sig.post) sig.post(x, S.dur, fs);
    }
    if (S.noise > -100) {
      /* rumore gaussiano (Box-Muller) con valore efficace 10^(dB/20) */
      const r = rng(12345), a = 10 ** (S.noise / 20);
      for (let i = 0; i < x.length; i++) {
        const u = Math.max(1e-12, r()), v = r();
        x[i] += a * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      }
    }
    R.x = x; R.fs = fs; R.sigKey = key;
  }

  function computeSTFT() {
    const N = 1 << S.n;
    const key = `${R.sigKey}|${S.win}:${N}:${S.ov}:${S.zp}:${S.scale}`;
    if (key === R.stftKey) return;
    R.w = windowFn(S.win, N);
    R.hop = hopOf(N, S.ov);
    R.Nfft = N * S.zp;
    R.gain = powerGain(R.w, R.fs, S.scale);
    R.spg = stft(R.x, R.w, R.hop, R.Nfft, R.gain);
    R.cola = colaSum(R.w, R.hop, 5 * N);
    /* fondo scala: la decina sopra il massimo dello spettrogramma */
    let mx = -Infinity;
    for (const v of R.spg.data) if (v > mx) mx = v;
    R.top = isFinite(mx) ? Math.ceil((mx + 1) / 10) * 10 : 0;
    R.stftKey = key;
  }

  const frameIndex = () => {
    const F = R.spg.F;
    if (!F) return -1;
    const c = S.pos * R.x.length - R.w.length / 2;
    return Math.min(F - 1, Math.max(0, Math.round(c / R.hop)));
  };

  function computeSlice() {
    const m = frameIndex();
    const key = `${R.stftKey}|${m}`;
    if (key === R.sliceKey) return;
    R.sliceKey = key;
    R.slice = m < 0 ? null
      : frameDB(R.x, m * R.hop, R.w, R.gain, new Float64Array(R.Nfft), new Float64Array(R.Nfft), new Float32Array(R.Nfft / 2 + 1));
  }

  /* immagine dello spettrogramma alla risoluzione del grafico in pixel del dispositivo:
     se frame o bin sono più dei pixel, ogni pixel mostra il massimo del proprio gruppo */
  const IMG = document.createElement('canvas');
  function buildImage(wPx, hPx) {
    const { cols: C, rows: Rn, data } = R.spg;
    const cols = Math.min(C, Math.max(1, wPx)), rows = Math.min(Rn, Math.max(1, hPx));
    const key = `${R.stftKey}|${S.dyn}|${cols}x${rows}`;
    if (key === R.imgKey) return;
    R.imgKey = key;
    IMG.width = cols; IMG.height = rows;
    const g = IMG.getContext('2d');
    const im = g.createImageData(cols, rows);
    const px = im.data, lo = R.top - S.dyn;
    for (let c = 0; c < cols; c++) {
      const a0 = Math.floor(c * C / cols), a1 = Math.floor((c + 1) * C / cols);
      for (let r = 0; r < rows; r++) {
        const b0 = Math.floor(r * Rn / rows), b1 = Math.floor((r + 1) * Rn / rows);
        let v = -Infinity;
        for (let a = a0; a < a1; a++) for (let b = b0; b < b1; b++) { const d = data[a * Rn + b]; if (d > v) v = d; }
        const i = Math.max(0, Math.min(255, Math.round((v - lo) / S.dyn * 255))) * 3;
        const o = ((rows - 1 - r) * cols + c) * 4;
        px[o] = LUT[i]; px[o + 1] = LUT[i + 1]; px[o + 2] = LUT[i + 2]; px[o + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
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
      this.w = r.width; this.h = r.height; this.dpr = d;
      this.c.width = Math.max(1, Math.round(r.width * d));
      this.c.height = Math.max(1, Math.round(r.height * d));
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
      this.pad.l = this.w < 420 ? 38 : 44;
    }
    view(x0, x1, y0, y1) { Object.assign(this, { x0, x1, y0, y1 }); }
    X(v) { return this.pad.l + (v - this.x0) / (this.x1 - this.x0) * (this.w - this.pad.l - this.pad.r); }
    Y(v) { return this.pad.t + (1 - (v - this.y0) / (this.y1 - this.y0)) * (this.h - this.pad.t - this.pad.b); }
    invX(px) { return this.x0 + (px - this.pad.l) / (this.w - this.pad.l - this.pad.r) * (this.x1 - this.x0); }
    render() {
      if (!R.x || !this.w) return;
      const g = this.ctx;
      g.clearRect(0, 0, this.w, this.h);
      g.save();
      this.draw(this);
      g.restore();
      this.crosshair();
    }

    axes(xl, yl = '', grid = true) {
      const g = this.ctx;
      this.xl = xl;
      g.font = '10px "JetBrains Mono", ui-monospace, monospace';
      g.lineWidth = 1;
      const xs = ticks(this.x0, this.x1, Math.max(4, Math.floor(this.w / 90)));
      const ys = ticks(this.y0, this.y1, Math.max(3, Math.floor(this.h / 45)));
      if (grid) {
        g.strokeStyle = COL.grid;
        g.beginPath();
        for (const v of xs.v) { const px = Math.round(this.X(v)) + 0.5; g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); }
        for (const v of ys.v) { const py = Math.round(this.Y(v)) + 0.5; g.moveTo(this.pad.l, py); g.lineTo(this.w - this.pad.r, py); }
        g.stroke();
      }
      if (this.y0 < 0 && this.y1 > 0) {
        const py = Math.round(this.Y(0)) + 0.5;
        g.strokeStyle = COL.axis;
        g.beginPath(); g.moveTo(this.pad.l, py); g.lineTo(this.w - this.pad.r, py); g.stroke();
      }
      g.fillStyle = COL.label;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of xs.v) g.fillText(fmt(v, xs.d), this.X(v), this.h - this.pad.b + 7);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of ys.v) g.fillText(fmt(v, ys.d), this.pad.l - 7, this.Y(v));
      g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillStyle = grid ? COL.label : 'rgba(233,234,238,0.75)';
      g.fillText(xl, this.w - this.pad.r - 2, this.h - this.pad.b - 4);
      if (yl) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(yl, this.pad.l + 5, this.pad.t + 3); }
    }
    /* area del grafico, con un margine m per lo spessore delle linee */
    clip(m = 2) {
      const g = this.ctx;
      g.beginPath();
      g.rect(this.pad.l, this.pad.t - m, this.w - this.pad.l - this.pad.r, this.h - this.pad.t - this.pad.b + 2 * m);
      g.clip();
    }
    /* curva campionata su xs uniformi; con più punti che pixel, per ogni colonna
       una barra min–max ('minmax') o il solo massimo ('max') */
    trace(x0, dx, ys, color, lw = 1.25, mode = 'minmax') {
      const g = this.ctx;
      const n = ys.length;
      const p0 = this.X(x0), p1 = this.X(x0 + dx * (n - 1));
      const cols = Math.max(1, Math.ceil(p1 - p0));
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath();
      if (n <= cols * 2) {
        for (let i = 0; i < n; i++) {
          const px = this.X(x0 + i * dx), py = this.Y(ys[i]);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
      } else {
        for (let c = 0; c < cols; c++) {
          const i0 = Math.floor(c * n / cols), i1 = Math.floor((c + 1) * n / cols);
          let lo = Infinity, hi = -Infinity;
          for (let i = i0; i < i1; i++) { const v = ys[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          const px = p0 + c + 0.5;
          if (mode === 'max') { c ? g.lineTo(px, this.Y(hi)) : g.moveTo(px, this.Y(hi)); }
          else { g.moveTo(px, this.Y(lo)); g.lineTo(px, this.Y(hi) - 0.5); }
        }
      }
      g.stroke();
    }
    crosshair() {
      if (this.hx == null || this.hx < this.pad.l || this.hx > this.w - this.pad.r) return;
      const g = this.ctx;
      const px = Math.round(this.hx) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, this.pad.t); g.lineTo(px, this.h - this.pad.b); g.stroke();
      const txt = `${this.xl.split(' ')[0]} = ${fmt(this.invX(this.hx), 3)}`;
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

  /* intervallo del frame selezionato, in secondi, e suo indice */
  function frameSpan() {
    const m = frameIndex();
    if (m < 0) return null;
    const t0 = m * R.hop / R.fs;
    return [t0, t0 + R.w.length / R.fs, m];
  }

  const unit = () => (S.scale === 'psd' ? 'dB/Hz' : 'dB');

  const pSpg = new Plot($('c-spg'), p => {
    const fs = R.fs, fN = fs / 2000;
    p.view(0, R.x.length / fs, 0, fN);
    const g = p.ctx;
    const { F } = R.spg;
    if (F) {
      /* ogni colonna è centrata sul proprio frame, ogni riga sul proprio bin */
      const N = R.w.length, hb = fs / R.Nfft / 2000;
      const x0 = p.X((N - R.hop) / 2 / fs), x1 = p.X(((F - 1) * R.hop + (N + R.hop) / 2) / fs);
      const y0 = p.Y(-hb), y1 = p.Y(fN + hb);
      buildImage(Math.round((x1 - x0) * p.dpr), Math.round((y0 - y1) * p.dpr));
      g.save();
      p.clip(0);
      g.imageSmoothingEnabled = false;
      g.drawImage(IMG, x0, y1, x1 - x0, y0 - y1);
      g.restore();
    }
    p.axes('t [s]', 'f [kHz]', false);
    const sp = frameSpan();
    if (sp) {
      p.clip();
      g.strokeStyle = COL.win; g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      for (const t of [sp[0], sp[1]]) {
        const px = Math.round(p.X(t)) + 0.5;
        g.moveTo(px, p.pad.t); g.lineTo(px, p.h - p.pad.b);
      }
      g.stroke();
    } else {
      g.fillStyle = COL.label; g.font = '12px "JetBrains Mono", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N supera la durata del segnale', p.w / 2, p.h / 2);
    }
  });

  const pTime = new Plot($('c-time'), p => {
    const x = R.x, fs = R.fs;
    let peak = 0;
    for (const v of x) if (Math.abs(v) > peak) peak = Math.abs(v);
    const yl = Math.max(1, peak) * 1.08;
    p.view(0, x.length / fs, -yl, yl);
    p.axes('t [s]');
    p.clip();
    const sp = frameSpan();
    if (sp) {
      p.ctx.fillStyle = rgba(COL.win, 0.08);
      p.ctx.fillRect(p.X(sp[0]), p.pad.t, p.X(sp[1]) - p.X(sp[0]), p.h - p.pad.t - p.pad.b);
    }
    p.trace(0, 1 / fs, x, rgba(COL.sig, 0.85), 1);
    if (sp) p.trace(sp[0], 1 / fs, R.w, COL.win, 1.5, 'max');
  });

  const pSlice = new Plot($('c-slice'), p => {
    p.view(0, R.fs / 2000, R.top - S.dyn, R.top);
    p.axes('f [kHz]', unit());
    p.clip();
    if (R.slice) p.trace(0, R.fs / R.Nfft / 1000, R.slice, COL.frame, 1.4, 'max');
  });

  const pCola = new Plot($('c-cola'), p => {
    const { sum, g: gain } = R.cola;
    const N = R.w.length, len = sum.length;
    let hi = 0;
    for (const v of sum) if (v > hi) hi = v;
    p.view(0, len / N, 0, Math.max(1.25, hi * 1.1));
    p.axes('n / N');
    p.clip();
    const scaled = R.w.map(v => v * gain);
    for (let start = 0; start < len; start += R.hop) {
      p.trace(start / N, 1 / N, scaled.subarray(0, Math.min(N, len - start)), rgba(COL.wins, 0.55), 1, 'max');
    }
    p.trace(0, 1 / N, sum, COL.sum, 1.8, 'max');
    const g = p.ctx, px = Math.round(p.X(1)) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, p.pad.t); g.lineTo(px, p.h - p.pad.b); g.stroke();
  });

  const plots = [pSpg, pTime, pSlice, pCola];

  /* scelta del frame sullo spettrogramma */
  (() => {
    const c = pSpg.c;
    let drag = false;
    const pick = e => {
      S.pos = Math.min(1, Math.max(0, pSpg.invX(e.offsetX) / pSpg.x1));
      changed();
    };
    c.addEventListener('pointerdown', e => { drag = true; c.setPointerCapture(e.pointerId); pick(e); });
    c.addEventListener('pointermove', e => { if (drag) pick(e); });
    const end = () => { drag = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  })();

  /* =======================================================
     INTERFACCIA
     ======================================================= */
  const ui = {
    sig: $('sig'), dur: $('dur'), noise: $('noise'), n: $('n'), ov: $('ov'),
    dyn: $('dyn'), pos: $('pos'), ovQ: $('ov-quick'), file: $('file'),
  };
  const SLIDERS = ['dur', 'noise', 'n', 'ov', 'dyn', 'pos'];
  const setFill = el => {
    const p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', `${p}%`);
  };
  const setRadio = (attr, v) => document.querySelectorAll(`[data-${attr}]`)
    .forEach(b => b.setAttribute('aria-checked', String(b.dataset[attr] === String(v))));

  function syncUI() {
    ui.sig.value = S.sig;
    for (const k of SLIDERS) { ui[k].value = S[k]; setFill(ui[k]); }
    ui.ovQ.value = S.ov; setFill(ui.ovQ);

    const N = 1 << S.n;
    const isFile = S.sig === 'file';
    $('dur-out').textContent = `${fmt(S.dur)} s`;
    $('noise-out').textContent = S.noise <= -100 ? 'spento' : `${S.noise} dBFS`;
    $('n-out').textContent = `${N} · ${fmtTime(N / R.fs)}`;
    const ovTxt = `${fmt(S.ov, 1)}%`;
    $('ov-out').textContent = ovTxt;
    $('ov-quick-out').textContent = ovTxt;
    $('dyn-out').textContent = `${S.dyn} dB`;
    const sp = frameSpan();
    $('pos-out').textContent = sp ? `${sp[2] + 1} / ${R.spg.F}` : '—';
    $('cb-lo').textContent = `${fmt(R.top - S.dyn, 0)} ${unit()}`;
    $('cb-hi').textContent = `${fmt(R.top, 0)} ${unit()}`;

    $('file-field').hidden = !isFile;
    $('fs-field').hidden = isFile;
    $('dur-field').hidden = isFile;
    $('file-name').textContent = fileData ? `${fileData.name} · ${fmt(fileData.fs / 1000, 1)} kHz · ${fmt(fileData.x.length / fileData.fs, 2)} s` : '';
    $('sig-note').textContent = isFile && !fileData ? 'Nessun file caricato: è mostrato il chirp.' : SIG[S.sig].note(R.fs);

    setRadio('fs', S.fs);
    setRadio('win', S.win);
    setRadio('zp', S.zp);
    setRadio('scale', S.scale);
    $('cola').textContent = `Overlap COLA per ${WIN[S.win].name}: ${fmt(WIN[S.win].cola, 1)}%`;
  }

  function stats() {
    const fs = R.fs, N = R.w.length, hop = R.hop, F = R.spg.F;
    const res = WIN[S.win].bw6 * fs / N;
    const unitSmall = t => t.replace(/ (\S+)$/, '<small>$1</small>');
    $('st-tres').innerHTML = unitSmall(fmtTime(N / fs));
    $('st-res').innerHTML = unitSmall(fmtFreq(res));
    $('st-bin').innerHTML = unitSmall(fmtFreq(fs / R.Nfft));
    $('st-hop').innerHTML = unitSmall(fmtTime(hop / fs));
    $('st-frames').textContent = String(F);
    const rp = R.cola.ripple * 100;
    $('st-cola').innerHTML = rp < 0.1 ? '&lt; 0,1<small>%</small>' : `${fmt(rp, 1)}<small>%</small>`;

    const D = [];
    const add = (cls, html) => D.push(`<li class="${cls}">${html}</li>`);
    if (!F) add('bad', `La finestra (${fmtTime(N / fs)}) è più lunga del segnale: nessun frame.`);
    if (rp < 0.1) add('ok', 'La somma delle finestre è costante: ogni campione pesa allo stesso modo (COLA).');
    else if (rp < 5) add('warn', `Somma delle finestre quasi costante, ripple ${fmt(rp, 1)}%.`);
    else add('bad', `La somma delle finestre oscilla del ${fmt(rp, 0)}%: i campioni fra due frame sono attenuati.`);
    if (S.zp > 1) add('info', `Zero-padding × ${S.zp}: il passo dei bin scende a ${fmtFreq(fs / R.Nfft)}, la risoluzione resta ${fmtFreq(res)}.`);
    if (S.sig === 'close') {
      add(res < 80 ? 'ok' : 'bad', res < 80
        ? `Risoluzione ${fmtFreq(res)} &lt; 80 Hz: i due toni sono separabili.`
        : `Risoluzione ${fmtFreq(res)} ≥ 80 Hz: i due toni cadono nello stesso lobo e nel tempo compare il battimento a 80 Hz.`);
    }
    if (S.sig === 'clicks') {
      const T = N / fs;
      add(T < 0.01 ? 'ok' : 'bad', T < 0.01
        ? `Frame di ${fmtTime(T)} &lt; 10 ms: i due impulsi cadono in frame distinti.`
        : `Frame di ${fmtTime(T)} ≥ 10 ms: i due impulsi cadono nello stesso frame.`);
    }
    $('st-diag').innerHTML = D.join('');

    const sp = frameSpan();
    $('m-spg').textContent = `${R.x.length} campioni · N = ${N} · hop = ${hop}${S.zp > 1 ? ` · Nfft = ${R.Nfft}` : ''}`;
    $('m-slice').textContent = sp ? `frame ${sp[2] + 1} di ${F} · ${fmt(sp[0], 3)}–${fmt(sp[1], 3)} s` : '';
    $('m-cola').textContent = `hop = ${hop} = ${fmt(hop / N, 3)}·N`;
  }

  /* ── aggiornamento ── */
  let queued = false;
  function changed() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      computeSignal();
      computeSTFT();
      computeSlice();
      syncUI();
      stats();
      plots.forEach(p => p.render());
      saveHash();
    });
  }

  for (const k of SLIDERS) ui[k].addEventListener('input', () => { S[k] = parseFloat(ui[k].value); changed(); });
  ui.ovQ.addEventListener('input', () => { S.ov = parseFloat(ui.ovQ.value); changed(); });
  ui.sig.addEventListener('change', () => { S.sig = ui.sig.value; changed(); });
  document.querySelectorAll('[data-fs]').forEach(b => b.addEventListener('click', () => { S.fs = +b.dataset.fs; changed(); }));
  document.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => { S.win = b.dataset.win; changed(); }));
  document.querySelectorAll('[data-zp]').forEach(b => b.addEventListener('click', () => { S.zp = +b.dataset.zp; changed(); }));
  document.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => { S.scale = b.dataset.scale; changed(); }));
  $('cola').addEventListener('click', () => { S.ov = Math.round(WIN[S.win].cola * 100) / 100; changed(); });

  /* ── file audio ── */
  const MAX_SEC = 10;
  ui.file.addEventListener('change', async () => {
    const f = ui.file.files[0];
    if (!f) return;
    $('file-name').textContent = 'Decodifica in corso…';
    const ac = new AudioContext();
    try {
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      const L = Math.min(buf.length, Math.round(MAX_SEC * buf.sampleRate));
      const x = new Float32Array(L);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < L; i++) x[i] += d[i] / buf.numberOfChannels;
      }
      fileData = { x, fs: buf.sampleRate, name: f.name };
      S.sig = 'file';
      R.sigKey = '';   // un file diverso con lo stesso nome va ricalcolato
      changed();
    } catch {
      $('file-name').textContent = 'Formato non supportato dal browser.';
    } finally {
      ac.close();
    }
  });

  /* ── stato nell'indirizzo ── */
  const KEYS = Object.keys(DEFAULT);
  let hashTimer = 0;
  function saveHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const q = KEYS.filter(k => S[k] !== DEFAULT[k] && !(k === 'sig' && S.sig === 'file'))
        .map(k => `${k}=${S[k]}`).join('&');
      history.replaceState(null, '', q ? `#${q}` : location.pathname + location.search);
    }, 250);
  }
  /* valori accettati solo entro i limiti dei controlli della pagina */
  function loadHash() {
    const h = location.hash.slice(1);
    if (!h) return;
    for (const part of h.split('&')) {
      const [k, v] = part.split('=');
      if (!Object.hasOwn(DEFAULT, k) || v === undefined) continue;
      if (typeof DEFAULT[k] === 'number') {
        const n = parseFloat(v);
        if (!isFinite(n)) continue;
        if (SLIDERS.includes(k)) S[k] = Math.min(+ui[k].max, Math.max(+ui[k].min, k === 'n' ? Math.round(n) : n));
        else if (document.querySelector(`[data-${k}="${n}"]`)) S[k] = n;
      }
      else if (k === 'sig' && v !== 'file' && Object.hasOwn(SIG, v)) S.sig = v;
      else if (k === 'win' && Object.hasOwn(WIN, v)) S.win = v;
      else if (k === 'scale' && (v === 'amp' || v === 'psd')) S.scale = v;
    }
  }

  loadHash();
  plots.forEach(p => p.resize());
  changed();
})();
