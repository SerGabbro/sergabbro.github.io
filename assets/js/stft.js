/* =========================================================
   GABBRO — stft.js
   STFT e FFT a confronto (tools/stft.html).

   Unità: fs in Hz, tempi in s; gli assi mostrano kHz e s.
   Due scale, uguali per FFT globale e frame:
   - ampiezza: una sinusoide di ampiezza 1 dà 0 dB
     (|X|·2/L nella FFT globale, |X|·2/Σw nei frame);
   - densità: dB/Hz, |X|²·2/(fs·Σw²); la media dei frame
     stima la stessa densità della FFT globale.
   Finestre periodiche (DFT-even), così la condizione COLA
   è esatta per hop = N/2 (Hann, Hamming) e N/3 (Blackman).
   ========================================================= */
(() => {
  'use strict';

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
  const nextPow2 = n => 1 << Math.ceil(Math.log2(Math.max(1, n)));

  const WIN = {
    rect:     { a: [1],                 bw6: 1.21, cola: 0,      name: 'rettangolare' },
    hann:     { a: [0.5, 0.5],          bw6: 2.00, cola: 50,     name: 'Hann' },
    hamming:  { a: [0.54, 0.46],        bw6: 1.81, cola: 50,     name: 'Hamming' },
    blackman: { a: [0.42, 0.5, 0.08],   bw6: 2.35, cola: 200 / 3, name: 'Blackman' },
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

  /* FFT dell'intero segnale (finestra rettangolare): dB su M/2+1 bin */
  function globalSpectrum(x, fs, scale) {
    const L = x.length, M = nextPow2(L);
    const re = new Float64Array(M), im = new Float64Array(M);
    re.set(x);
    fft(re, im);
    const g = scale === 'psd' ? 2 / (fs * L) : 4 / (L * L);
    const out = new Float32Array(M / 2 + 1);
    for (let k = 0; k <= M / 2; k++) out[k] = dB((re[k] * re[k] + im[k] * im[k]) * g);
    return { db: out, M };
  }

  /* potenza |X|² di un frame che inizia al campione start */
  function framePower(x, start, w, Nfft, re, im) {
    const N = w.length;
    re.fill(0); im.fill(0);
    for (let n = 0; n < N; n++) re[n] = (x[start + n] || 0) * w[n];
    fft(re, im);
    const out = new Float64Array(Nfft / 2 + 1);
    for (let k = 0; k <= Nfft / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
    return out;
  }
  const toDB = (P, g) => Float32Array.from(P, v => dB(v * g));

  /* STFT completa; le righe in frequenza sono ridotte a ≤ MAXR
     prendendo il massimo, così la memoria resta contenuta */
  const MAXR = 1024;
  function stft(x, w, hop, Nfft, g) {
    const N = w.length;
    const F = x.length >= N ? Math.floor((x.length - N) / hop) + 1 : 0;
    const bins = Nfft / 2 + 1;
    const rows = Math.min(bins, MAXR);
    const data = new Float32Array(F * rows);
    const sum = new Float64Array(bins);
    const re = new Float64Array(Nfft), im = new Float64Array(Nfft);
    for (let m = 0; m < F; m++) {
      const P = framePower(x, m * hop, w, Nfft, re, im);
      for (let k = 0; k < bins; k++) sum[k] += P[k];
      const s = toDB(P, g);
      const o = m * rows;
      if (rows === bins) { data.set(s, o); continue; }
      for (let r = 0; r < rows; r++) {
        const k0 = Math.floor(r * bins / rows), k1 = Math.max(k0 + 1, Math.floor((r + 1) * bins / rows));
        let v = -Infinity;
        for (let k = k0; k < k1; k++) if (s[k] > v) v = s[k];
        data[o + r] = v;
      }
    }
    /* media dei frame in potenza: stima lo stesso spettro della FFT globale */
    const avg = F ? toDB(sum, g / F) : null;
    return { F, rows, data, avg };
  }

  /* somma delle finestre traslate, normalizzata a media 1 */
  function colaSum(w, hop, len) {
    const N = w.length;
    const sum = new Float64Array(len);
    for (let start = 0; start < len; start += hop) {
      for (let n = 0; n < N && start + n < len; n++) sum[start + n] += w[n];
    }
    let sw = 0;
    for (const v of w) sw += v;
    const g = hop / sw;
    for (let i = 0; i < len; i++) sum[i] *= g;
    /* ripple nel tratto a regime, dopo la prima finestra */
    let lo = Infinity, hi = -Infinity;
    for (let i = N; i < len; i++) { if (sum[i] < lo) lo = sum[i]; if (sum[i] > hi) hi = sum[i]; }
    return { sum, g, ripple: (hi - lo) / ((hi + lo) / 2) };
  }

  /* consente i test della parte numerica fuori dal browser */
  if (typeof document === 'undefined') {
    globalThis.STFT_DSP = { fft, windowFn, hopOf, powerGain, globalSpectrum, framePower, toDB, stft, colaSum, WIN };
    return;
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
      note: () => '1 kHz nella prima metà, 2,5 kHz nella seconda. La FFT globale mostra due picchi, senza indicarne l\'ordine.',
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
  const $ = id => document.getElementById(id);
  function fmt(v, d = 2) {
    if (!isFinite(v)) return '—';
    const s = v.toFixed(d);
    return (d > 0 ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace(/^-0$/, '0');
  }
  const fmtTime = s => (s < 1 ? `${fmt(s * 1000, s < 0.01 ? 2 : 1)} ms` : `${fmt(s, 3)} s`);
  const fmtFreq = f => (f < 1000 ? `${fmt(f, f < 10 ? 2 : 1)} Hz` : `${fmt(f / 1000, 3)} kHz`);

  /* colori: gli stessi valori sono in css/stft.css */
  const COL = {
    sig: '#e9eaee', win: '#f5a524', frame: '#22d3ee', glob: '#a0a3ad', avg: '#a78bfa',
    wins: '#a78bfa', sum: '#4ade80',
    grid: 'rgba(255,255,255,0.045)', axis: 'rgba(255,255,255,0.16)',
    label: '#6b6f7a',
  };
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* mappa di colore percettiva (magma), 256 livelli */
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
  const DEFAULT = { sig: 'chirp', fs: 16000, dur: 1, noise: -100, win: 'hann', n: 10, ov: 50, zp: 1, scale: 'auto', dyn: 80, pos: 0.5 };
  const S = { ...DEFAULT };
  let fileData = null;   // { x, fs, name }

  /* risultati, ricalcolati solo quando cambiano i parametri da cui dipendono */
  const R = { sigKey: '', x: null, fs: 0, glob: null, stftKey: '', w: null, hop: 0, Nfft: 0, gain: 1, spg: null, top: 0, img: null, imgKey: '', cola: null, slice: null, sliceKey: '' };

  function computeSignal() {
    const key = S.sig === 'file' ? `file:${fileData ? fileData.name : ''}:${S.noise}` : `${S.sig}:${S.fs}:${S.dur}:${S.noise}`;
    if (key === R.sigKey) return false;
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
    R.stftKey = '';
    return true;
  }

  /* scala effettiva: in automatico densità per i segnali a banda larga, ampiezza per i toni,
     così FFT globale e media dei frame coincidono */
  const isBroad = () => S.sig === 'chirp' || S.sig === 'file';
  const scaleOf = () => (S.scale === 'auto' ? (isBroad() ? 'psd' : 'amp') : S.scale);

  function computeSTFT() {
    const N = 1 << S.n;
    const key = `${R.sigKey}|${S.win}:${N}:${S.ov}:${S.zp}:${scaleOf()}`;
    if (key === R.stftKey) return;
    R.glob = globalSpectrum(R.x, R.fs, scaleOf());
    R.w = windowFn(S.win, N);
    R.hop = hopOf(N, S.ov);
    R.Nfft = N * S.zp;
    R.gain = powerGain(R.w, R.fs, scaleOf());
    R.spg = stft(R.x, R.w, R.hop, R.Nfft, R.gain);
    R.cola = colaSum(R.w, R.hop, 5 * N);
    /* fondo scala: decina sopra il massimo di FFT globale e media dei frame */
    let mx = -Infinity;
    for (const v of R.glob.db) if (v > mx) mx = v;
    if (R.spg.avg) for (const v of R.spg.avg) if (v > mx) mx = v;
    for (const v of R.spg.data) if (v > mx) mx = v;
    R.top = Math.ceil((mx + 1) / 10) * 10;
    R.stftKey = key; R.imgKey = ''; R.sliceKey = '';
  }

  const frameIndex = () => {
    const F = R.spg.F;
    if (!F) return -1;
    const N = R.w.length;
    const c = S.pos * R.x.length - N / 2;
    return Math.min(F - 1, Math.max(0, Math.round(c / R.hop)));
  };

  function computeSlice() {
    const m = frameIndex();
    const key = `${R.stftKey}|${m}`;
    if (key === R.sliceKey) return;
    R.slice = m < 0 ? null : toDB(framePower(R.x, m * R.hop, R.w, R.Nfft, new Float64Array(R.Nfft), new Float64Array(R.Nfft)), R.gain);
    R.sliceKey = key;
  }

  /* immagine dello spettrogramma: colonne ridotte a ≤ MAXC (massimo) */
  const MAXC = 2048;
  function buildImage() {
    const key = `${R.stftKey}|${S.dyn}`;
    if (key === R.imgKey) return;
    R.imgKey = key;
    const { F, rows, data } = R.spg;
    if (!F) { R.img = null; return; }
    const cols = Math.min(F, MAXC);
    const cv = R.img || document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const g = cv.getContext('2d');
    const im = g.createImageData(cols, rows);
    const px = im.data;
    const lo = R.top - S.dyn;
    for (let c = 0; c < cols; c++) {
      const m0 = Math.floor(c * F / cols), m1 = Math.max(m0 + 1, Math.floor((c + 1) * F / cols));
      for (let r = 0; r < rows; r++) {
        let v = -Infinity;
        for (let m = m0; m < m1; m++) { const d = data[m * rows + r]; if (d > v) v = d; }
        const i = Math.max(0, Math.min(255, Math.round((v - lo) / S.dyn * 255)));
        const o = ((rows - 1 - r) * cols + c) * 4;
        px[o] = LUT[i * 3]; px[o + 1] = LUT[i * 3 + 1]; px[o + 2] = LUT[i * 3 + 2]; px[o + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    R.img = cv;
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
      g.strokeStyle = COL.axis;
      g.beginPath();
      if (this.y0 < 0 && this.y1 > 0) { const py = Math.round(this.Y(0)) + 0.5; g.moveTo(this.pad.l, py); g.lineTo(this.w - this.pad.r, py); }
      g.stroke();
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
    clip() {
      const g = this.ctx;
      g.beginPath();
      g.rect(this.pad.l, this.pad.t - 2, this.w - this.pad.l - this.pad.r, this.h - this.pad.t - this.pad.b + 4);
      g.clip();
    }
    /* curva campionata su xs uniformi: riduzione min/max per colonna di pixel */
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
          const i0 = Math.floor(c * n / cols), i1 = Math.max(i0 + 1, Math.floor((c + 1) * n / cols));
          let lo = Infinity, hi = -Infinity;
          for (let i = i0; i < i1; i++) { const v = ys[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          const px = p0 + c + 0.5;
          if (mode === 'max') { c ? g.lineTo(px, this.Y(hi)) : g.moveTo(px, this.Y(hi)); }
          else { g.moveTo(px, this.Y(lo)); g.lineTo(px, this.Y(hi) - 0.5); }
        }
      }
      g.stroke();
    }
    /* curva con la variabile indipendente in verticale (spettro ruotato):
       per ogni riga di pixel il massimo dei bin che vi cadono */
    traceV(y0, dy, xs, color, lw = 1.25) {
      const g = this.ctx;
      const n = xs.length;
      const top = this.Y(y0 + dy * (n - 1)), bot = this.Y(y0);
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath();
      let first = true;
      for (let py = Math.floor(top); py <= Math.ceil(bot); py++) {
        const fa = this.invY(py + 0.5), fb = this.invY(py - 0.5);
        const i0 = Math.max(0, Math.floor((fa - y0) / dy)), i1 = Math.min(n - 1, Math.ceil((fb - y0) / dy));
        let v = -Infinity;
        for (let i = i0; i <= i1; i++) if (xs[i] > v) v = xs[i];
        if (v === -Infinity) continue;
        const px = this.X(v);
        first ? g.moveTo(px, py) : g.lineTo(px, py);
        first = false;
      }
      g.stroke();
    }
    invY(py) { return this.y0 + (1 - (py - this.pad.t) / (this.h - this.pad.t - this.pad.b)) * (this.y1 - this.y0); }
    crosshair() {
      if (this.noCross) return;
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

  /* intervallo del frame selezionato, in secondi */
  function frameSpan() {
    const m = frameIndex();
    if (m < 0) return null;
    const t0 = m * R.hop / R.fs;
    return [t0, t0 + R.w.length / R.fs, m];
  }

  const pTime = new Plot($('c-time'), p => {
    const x = R.x, fs = R.fs, D = x.length / fs;
    let peak = 0;
    for (const v of x) if (Math.abs(v) > peak) peak = Math.abs(v);
    const yl = Math.max(1, peak) * 1.08;
    p.view(0, D, -yl, yl);
    p.axes('t [s]');
    p.clip();
    const sp = frameSpan();
    const g = p.ctx;
    if (sp) {
      g.fillStyle = rgba(COL.win, 0.08);
      g.fillRect(p.X(sp[0]), p.pad.t, p.X(sp[1]) - p.X(sp[0]), p.h - p.pad.t - p.pad.b);
    }
    p.trace(0, 1 / fs, x, rgba(COL.sig, 0.85), 1);
    if (sp) p.trace(sp[0], 1 / fs, R.w, COL.win, 1.5, 'max');
  });

  const pSpg = new Plot($('c-spg'), p => {
    const fs = R.fs, D = R.x.length / fs;
    p.view(0, D, 0, fs / 2000);
    const g = p.ctx;
    const { F } = R.spg;
    if (R.img && F) {
      /* ogni colonna è centrata sul proprio frame */
      const N = R.w.length;
      const t0 = (N / 2 - R.hop / 2) / fs, t1 = ((F - 1) * R.hop + N / 2 + R.hop / 2) / fs;
      g.save();
      p.clip();
      g.imageSmoothingEnabled = false;
      g.drawImage(R.img, p.X(t0), p.Y(fs / 2000), p.X(t1) - p.X(t0), p.Y(0) - p.Y(fs / 2000));
      g.restore();
    }
    p.axes('t [s]', 'f [kHz]', false);
    const sp = frameSpan();
    if (sp) {
      g.save(); p.clip();
      g.strokeStyle = COL.win; g.lineWidth = 1;
      g.setLineDash([3, 3]);
      for (const t of [sp[0], sp[1]]) {
        const px = Math.round(p.X(t)) + 0.5;
        g.beginPath(); g.moveTo(px, p.pad.t); g.lineTo(px, p.h - p.pad.b); g.stroke();
      }
      g.restore();
    }
    if (!F) {
      g.fillStyle = COL.label; g.font = '12px "JetBrains Mono", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N supera la durata del segnale', p.w / 2, p.h / 2);
    }
  });

  const unit = () => (scaleOf() === 'psd' ? 'dB/Hz' : 'dB');

  /* FFT globale ruotata: frequenza in verticale, allineata allo spettrogramma */
  const pFft = new Plot($('c-fft'), p => {
    p.noCross = true;
    p.view(R.top - S.dyn, R.top, 0, R.fs / 2000);
    p.axes(unit(), 'f [kHz]');
    p.clip();
    const { db, M } = R.glob;
    if (R.spg.avg) p.traceV(0, R.fs / R.Nfft / 1000, R.spg.avg, COL.avg, 1.6);
    p.traceV(0, R.fs / M / 1000, db, COL.glob, 1.1);
  });

  const pSlice = new Plot($('c-slice'), p => {
    p.view(0, R.fs / 2000, R.top - S.dyn, R.top);
    p.axes('f [kHz]', unit());
    p.clip();
    const { db, M } = R.glob;
    p.trace(0, R.fs / M / 1000, db, rgba(COL.glob, 0.8), 1, 'max');
    if (R.spg.avg) p.trace(0, R.fs / R.Nfft / 1000, R.spg.avg, COL.avg, 1.6, 'max');
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
    const dx = 1 / N;
    const nW = Math.ceil(len / R.hop);
    const g = p.ctx;
    for (let m = 0; m < nW; m++) {
      const start = m * R.hop;
      p.trace(start / N, dx, start + N <= len ? scaled : scaled.subarray(0, len - start), rgba(COL.wins, 0.55), 1, 'max');
    }
    p.trace(0, dx, sum, COL.sum, 1.8, 'max');
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(p.X(1), p.pad.t); g.lineTo(p.X(1), p.h - p.pad.b); g.stroke();
    g.setLineDash([]);
  });

  const plots = [pTime, pSpg, pFft, pSlice, pCola];

  /* scelta del frame sullo spettrogramma */
  (() => {
    const c = $('c-spg');
    let drag = false;
    const pick = e => {
      const D = R.x.length / R.fs;
      const t = pSpg.invX(e.offsetX);
      S.pos = Math.min(1, Math.max(0, t / D));
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
    sig: $('sig'), dur: $('dur'), noise: $('noise'), n: $('n'), ov: $('ov'), ovQ: $('ov-quick'),
    dyn: $('dyn'), pos: $('pos'), file: $('file'),
  };
  const setFill = el => {
    const p = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', `${p}%`);
  };

  function syncUI() {
    ui.sig.value = S.sig;
    for (const k of ['dur', 'noise', 'n', 'ov', 'dyn', 'pos']) { ui[k].value = S[k]; setFill(ui[k]); }
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

    document.querySelectorAll('[data-fs]').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.fs === S.fs)));
    document.querySelectorAll('[data-win]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.win === S.win)));
    document.querySelectorAll('[data-zp]').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.zp === S.zp)));
    document.querySelectorAll('[data-scale]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.scale === S.scale)));
    $('cola').textContent = `Overlap COLA per ${WIN[S.win].name}: ${fmt(WIN[S.win].cola, 1)}%`;
  }

  function stats() {
    const fs = R.fs, N = R.w.length, hop = R.hop, F = R.spg.F;
    const res = WIN[S.win].bw6 * fs / N;
    const unitSmall = t => t.replace(/ (\S+)$/, '<small>$1</small>');
    $('st-tres').innerHTML = unitSmall(fmtTime(N / fs));
    $('st-res').innerHTML = unitSmall(fmtFreq(res));
    $('st-hop').innerHTML = `${unitSmall(fmtTime(hop / fs))}`;
    $('st-frames').textContent = String(F);
    $('st-glob').innerHTML = unitSmall(fmtFreq(fs / R.x.length));
    const rp = R.cola.ripple * 100;
    $('st-cola').innerHTML = rp < 0.05 ? '&lt; 0,1<small>%</small>' : `${fmt(rp, 1)}<small>%</small>`;

    const D = [];
    const add = (cls, html) => D.push(`<li class="${cls}">${html}</li>`);
    const gres = fs / R.x.length;
    add('info', `FFT globale: risoluzione ${fmtFreq(gres)}, nessuna informazione sul tempo. STFT: risoluzione ${fmtFreq(res)} (${fmt(res / gres, 0)} volte più larga), un frame ogni ${fmtTime(hop / fs)}.`);
    const broad = isBroad();
    if (S.scale === 'auto') add('info', broad
      ? 'Scala automatica in densità (dB/Hz): per un segnale a banda larga FFT globale e media dei frame coincidono.'
      : 'Scala automatica in ampiezza: una sinusoide di ampiezza 1 dà 0 dB, e i picchi di FFT globale e media dei frame coincidono.');
    if (S.scale === 'amp' && broad) add('warn', 'In ampiezza i livelli di un segnale a banda larga dipendono dalla larghezza del bin: FFT globale e media dei frame non coincidono. In densità (dB/Hz) sì.');
    if (S.scale === 'psd' && !broad) add('warn', 'In densità i picchi dei toni dipendono dalla larghezza del bin: FFT globale e media dei frame non coincidono. In ampiezza sì.');
    if (!F) add('bad', `La finestra (${fmtTime(N / fs)}) è più lunga del segnale: nessun frame.`);
    if (rp < 0.05) add('ok', 'La somma delle finestre è costante: ogni campione pesa allo stesso modo (COLA).');
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
    if (F > 2000) add('info', `${F} frame: lo spettrogramma ne mostra il massimo per colonna di pixel.`);
    $('st-diag').innerHTML = D.join('');

    const sp = frameSpan();
    $('m-cmp').textContent = `FFT: ${R.x.length} campioni · STFT: N = ${N}, hop = ${hop}`;
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
      buildImage();
      syncUI();
      stats();
      plots.forEach(p => p.render());
      saveHash();
    });
  }

  const num = (el, k) => el.addEventListener('input', () => { S[k] = parseFloat(el.value); changed(); });
  num(ui.dur, 'dur'); num(ui.noise, 'noise'); num(ui.n, 'n'); num(ui.ov, 'ov'); num(ui.dyn, 'dyn'); num(ui.pos, 'pos');
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
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      ac.close();
      const L = Math.min(buf.length, Math.round(MAX_SEC * buf.sampleRate));
      const x = new Float32Array(L);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < L; i++) x[i] += d[i] / buf.numberOfChannels;
      }
      fileData = { x, fs: buf.sampleRate, name: f.name };
      S.sig = 'file';
      R.sigKey = '';
      changed();
    } catch (err) {
      $('file-name').textContent = 'Formato non supportato dal browser.';
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
  function loadHash() {
    const h = location.hash.slice(1);
    if (!h) return;
    for (const part of h.split('&')) {
      const [k, v] = part.split('=');
      if (!(k in DEFAULT) || v === undefined) continue;
      const d = DEFAULT[k];
      if (typeof d === 'number') { const n = parseFloat(v); if (isFinite(n)) S[k] = n; }
      else if (k === 'sig' && SIG[v] && v !== 'file') S[k] = v;
      else if (k === 'win' && WIN[v]) S[k] = v;
      else if (k === 'scale' && ['auto', 'amp', 'psd'].includes(v)) S[k] = v;
    }
    S.n = Math.min(13, Math.max(6, Math.round(S.n)));
    S.ov = Math.min(95, Math.max(0, S.ov));
    if (![1, 2, 4, 8].includes(S.zp)) S.zp = 1;
    if (![8000, 16000, 48000].includes(S.fs)) S.fs = DEFAULT.fs;
  }

  loadHash();
  plots.forEach(p => p.resize());
  changed();
})();
