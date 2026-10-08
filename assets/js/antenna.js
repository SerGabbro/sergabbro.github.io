/* =========================================================
   GABBRO — antenna.js
   Antenna lab, "analyze" section (tools/antenna.html).

   Input: .rfm packages created by antenna-pack.js, read with
   npz.js. Charts: Plotly. Everything runs in the browser.

   Conventions:
   - complex S arrays are interleaved (re, im) and indexed as
     (angleIndex · nF + freqIndex) · 2, i.e. NumPy C order;
   - NaN marks a point that was not measured: nothing is made up;
   - UI strings are Italian, like the rest of the site.
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const C0 = 299792458;                       // speed of light [m/s]
  const TOL_PASSIVITY = 1.05;                  // |S| bound for a passive network, with margin for calibration noise

  /* ---------- colors: categorical palette checked for colour-blind separation on the dark ground ---------- */
  const SERIES = ['#22d3ee', '#f5a524', '#a78bfa', '#f472b6', '#4ade80'];
  const INK = '#e9eaee', DIM = '#a0a3ad', FAINT = '#6b6f7a';
  const GRID = 'rgba(255,255,255,0.06)', AXIS = 'rgba(255,255,255,0.14)';
  const SEQUENTIAL = [[0, '#0b1a20'], [0.2, '#0c3a47'], [0.4, '#0e6276'], [0.6, '#1590a8'], [0.8, '#22d3ee'], [1, '#c4f5fc']];
  const DIVERGING = [[0, '#93c5fd'], [0.25, '#2f6fd6'], [0.5, '#2a2b30'], [0.75, '#c43b3b'], [1, '#f8a5a5']];
  const OK_FILL = '#12301f', BAD = '#e63946', BAD_FILL = '#5c1d23';

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  /** Italian number format (decimal comma), '—' for missing values. */
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d).replace('.', ',').replace(/^-(0,?0*)$/, '$1');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* =========================================================
     THE .rfm FORMAT (RF Measurement), version 1
     An .rfm file is an NPZ archive (np.load opens it) with the
     signature "RFM1" in the zip comment and "meta" as first entry.
     Arrays: frequenze [Hz] and angoli [°], both strictly increasing;
     S11 S21 S12 S22 complex, shape (angles × frequencies), NaN where
     an angle was not measured. meta is a JSON string with at least
     formato, versione, misura and modello:
       "friis"   → two identical antennas, needs distanza_m: gain in dBi
       "nessuno" → raw |S| in dB, no assumption on the setup
     optional: note, griglia, sorgente.
     Array names and meta keys are part of the file format and stay
     in Italian, matching the thesis Python code.
     ========================================================= */
  const FORMAT = 'rfm', VERSION = 1, SIGNATURE = 'RFM1';
  const S_PARAMS = ['S11', 'S21', 'S12', 'S22'];

  function readMeta(arrays) {
    const m = arrays.meta;
    if (!m || !Array.isArray(m.data) || m.data.length !== 1) {
      throw new Error('non è un pacchetto standard (manca "meta"): crealo dalla sezione Impacchetta a partire dai file grezzi');
    }
    let meta;
    try { meta = JSON.parse(m.data[0]); } catch { throw new Error('"meta" non è JSON valido'); }
    if (meta.formato !== FORMAT) throw new Error(`formato "${meta.formato}" sconosciuto: atteso "${FORMAT}"`);
    if (meta.versione !== VERSION) throw new Error(`versione ${meta.versione} del formato non supportata (questa pagina legge la ${VERSION})`);
    if (!meta.misura) throw new Error('"meta" senza nome della misura');
    if (!['friis', 'nessuno'].includes(meta.modello)) throw new Error(`modello "${meta.modello}" sconosciuto: atteso "friis" o "nessuno"`);
    if (meta.modello === 'friis' && !(meta.distanza_m > 0)) throw new Error('modello Friis senza distanza_m valida');
    return meta;
  }

  function assertIncreasing(a, name) {
    for (let i = 1; i < a.length; i++) if (!(a[i] > a[i - 1])) throw new Error(`${name} non strettamente crescenti`);
  }

  /** Parsed .rfm arrays → measurement object used by every view. */
  function buildMeasurement(arrays) {
    const meta = readMeta(arrays);
    for (const k of ['frequenze', 'angoli', ...S_PARAMS]) if (!arrays[k]) throw new Error(`manca l'array ${k}`);
    const f = Float64Array.from(arrays.frequenze.data), ang = Float64Array.from(arrays.angoli.data);
    assertIncreasing(f, 'frequenze');
    assertIncreasing(ang, 'angoli');
    const nF = f.length, nA = ang.length, S = {};
    for (const k of S_PARAMS) {
      const a = arrays[k];
      if (!a.complex) throw new Error(`${k} non è complesso (${a.dtype})`);
      if (a.fortran || a.shape.length !== 2 || a.shape[0] !== nA || a.shape[1] !== nF) {
        throw new Error(`${k} ha forma (${a.shape}), attesa (${nA}, ${nF})`);
      }
      S[k] = Float64Array.from(a.data);
    }
    return {
      id: meta.misura, name: meta.misura, meta,
      ang, f, nA, nF, S, fullCircle: isFullCircle(ang),
      distance: meta.modello === 'friis' ? meta.distanza_m : null,
      cache: {},
    };
  }

  /** The cut covers the whole turn (e.g. −180…180 or 0…359): its ends are neighbours. */
  function isFullCircle(ang) {
    const n = ang.length;
    if (n < 3) return false;
    const step = (ang[n - 1] - ang[0]) / (n - 1);
    return ang[n - 1] - ang[0] + step >= 360 - 1e-6;
  }

  /* =========================================================
     DERIVED QUANTITIES (cached per measurement)
     ========================================================= */
  function magnitude(m, param) {
    const key = `|${param}|`;
    if (m.cache[key]) return m.cache[key];
    const s = m.S[param], out = new Float64Array(m.nA * m.nF);
    for (let j = 0; j < out.length; j++) out[j] = Math.hypot(s[2 * j], s[2 * j + 1]);
    return (m.cache[key] = out);
  }

  const db20 = v => v > 0 ? 20 * Math.log10(v) : NaN;

  /** Transmission in dB, Float64Array (nA · nF).
      Raw model: |S| in dB. Friis model (antenna under test on the turntable, identical reference
      antenna fixed): at the peak of each frequency the antennas face each other and Friis for two
      identical antennas holds, G_max(f) = |S|max(f) · 4πR f / c; while rotating, the received power
      follows G(θ) · G_max, so the pattern shape is |S|²:
        G(θ, f) [dBi] = 10·log10(G_max(f)) + 20·log10(|S(θ, f)| / |S|max(f)) */
  function gainDb(m, param) {
    const key = `G|${param}|${m.distance}`;
    if (m.cache[key]) return m.cache[key];
    const T = magnitude(m, param), out = new Float64Array(T.length);
    if (m.distance == null) {
      for (let j = 0; j < T.length; j++) out[j] = db20(T[j]);
      return (m.cache[key] = out);
    }
    for (let k = 0; k < m.nF; k++) {
      let ref = -Infinity;
      for (let i = 0; i < m.nA; i++) { const v = T[i * m.nF + k]; if (v > ref) ref = v; }
      const gMax = 10 * Math.log10(ref * 4 * Math.PI * m.distance * m.f[k] / C0);
      for (let i = 0; i < m.nA; i++) out[i * m.nF + k] = gMax + db20(T[i * m.nF + k] / ref);
    }
    return (m.cache[key] = out);
  }

  const isReflection = p => p === 'S11' || p === 'S22';

  /** Any parameter in dB: transmission → gainDb (Friis or raw), reflection → |S| in dB. */
  function valuesDb(m, param) {
    if (!isReflection(param)) return gainDb(m, param);
    const key = `R|${param}`;
    return m.cache[key] || (m.cache[key] = magnitude(m, param).map(db20));
  }

  /** Values along the angles at frequency index k. */
  const cutAt = (m, V, k) => Float64Array.from({ length: m.nA }, (_, i) => V[i * m.nF + k]);
  /** Values along the frequencies at angle index i. */
  const columnAt = (m, V, i) => V.subarray(i * m.nF, (i + 1) * m.nF);
  /** z[k][i] rows for Plotly surfaces (rows = frequencies). */
  const toRows = (m, V) => Array.from({ length: m.nF }, (_, k) => Array.from({ length: m.nA }, (_, i) => V[i * m.nF + k]));

  function nearest(arr, v) {
    let best = 0, d = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const e = Math.abs(arr[i] - v);
      if (e < d) { d = e; best = i; }
    }
    return best;
  }

  /** [max, index] ignoring NaN; [-Infinity, -1] if there is no finite value. */
  function nanMax(a) {
    let m = -Infinity, im = -1;
    for (let i = 0; i < a.length; i++) if (a[i] > m) { m = a[i]; im = i; }
    return [m, im];
  }

  /* =========================================================
     ANALYSIS
     ========================================================= */

  /** Maximum over the cut for every frequency. */
  function peakPerFrequency(m, param) {
    const key = `P|${param}|${m.distance}`;
    if (m.cache[key]) return m.cache[key];
    const G = gainDb(m, param);
    return (m.cache[key] = Array.from({ length: m.nF }, (_, k) => nanMax(cutAt(m, G, k))[0]).map(v => isFinite(v) ? v : NaN));
  }

  /** Passivity checks with a per-point violation map. */
  function audit(m) {
    if (m.cache.audit) return m.cache.audit;
    const n = m.nA * m.nF, A = {};
    for (const k of S_PARAMS) A[k] = magnitude(m, k);
    const tp = fmt(TOL_PASSIVITY, 2);
    const checks = [
      [`|S11| > ${tp}`, j => A.S11[j] > TOL_PASSIVITY],
      [`|S22| > ${tp}`, j => A.S22[j] > TOL_PASSIVITY],
      [`|S21| > ${tp}`, j => A.S21[j] > TOL_PASSIVITY],
      [`|S12| > ${tp}`, j => A.S12[j] > TOL_PASSIVITY],
      [`|S11|² + |S21|² > ${tp}`, j => A.S11[j] ** 2 + A.S21[j] ** 2 > TOL_PASSIVITY],
      [`|S22|² + |S12|² > ${tp}`, j => A.S22[j] ** 2 + A.S12[j] ** 2 > TOL_PASSIVITY],
    ];
    const map = new Uint8Array(n), counts = checks.map(() => 0);
    let maxCount = 0;
    for (let j = 0; j < n; j++) {
      for (let c = 0; c < checks.length; c++) if (checks[c][1](j)) { counts[c]++; map[j]++; }
      if (map[j] > maxCount) maxCount = map[j];
    }
    return (m.cache.audit = {
      rows: checks.map(([label], c) => ({ label, count: counts[c] })),
      map, maxCount,
    });
  }

  const sameGrid = (a, b) => a.nA === b.nA && a.nF === b.nF
    && a.ang.every((x, i) => Math.abs(x - b.ang[i]) < 1e-3)
    && a.f.every((x, i) => Math.abs(x - b.f[i]) <= 1e-6 * Math.abs(x));

  /** Δ = A − B in linear power, point by point. Statistics in % of the peak (the larger of
      the two measurements): in linear scale the noise floor weighs almost nothing. */
  function compareMeasurements(a, b, param, split) {
    const va = valuesDb(a, param), vb = valuesDb(b, param), d = new Float64Array(va.length);
    let peak = 0;
    for (let j = 0; j < d.length; j++) {
      const la = 10 ** (va[j] / 10), lb = 10 ** (vb[j] / 10);
      d[j] = la - lb;
      if (la > peak) peak = la;
      if (lb > peak) peak = lb;
    }
    const stats = inBand => {
      let s = 0, sa = 0, sq = 0, mx = 0, c = 0;
      for (let i = 0; i < a.nA; i++) for (let k = 0; k < a.nF; k++) {
        const v = d[i * a.nF + k];
        if (!inBand(k) || !isFinite(v)) continue;
        s += v; sa += Math.abs(v); sq += v * v; mx = Math.max(mx, Math.abs(v)); c++;
      }
      return c ? [s / c, sa / c, Math.sqrt(sq / c), mx].map(v => v / peak * 100).concat(c) : null;
    };
    const bands = [['intera banda', () => true]];
    if (split != null && isFinite(split)) {
      const fa = freqs(a);
      bands.push([`f ≤ ${fmtF(split)}`, k => fa[k] <= split], [`f > ${fmtF(split)}`, k => fa[k] > split]);
    }
    return { d, peak, rows: bands.map(([label, inBand]) => [label, stats(inBand)]).filter(r => r[1]) };
  }

  /** Linear interpolation on an increasing grid; NaN outside the measured range. */
  function interpolate(x, y, q) {
    const n = x.length;
    if (!n || q < x[0] - 1e-9 || q > x[n - 1] + 1e-9) return NaN;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= q) lo = mid; else hi = mid; }
    if (hi === lo) return y[lo];
    return y[lo] + (q - x[lo]) / (x[hi] - x[lo]) * (y[hi] - y[lo]);
  }

  /** A cut ready for interpolation: linear power, angles wrapped to [−180, 180), no NaN
      (like np.interp on finite values), sorted; a full-circle cut is closed with copies of its
      ends shifted by ±360° so that 179° and −180° are neighbours. */
  function prepareCut(ang, valuesDbCut, fullCircle) {
    const pts = [];
    for (let i = 0; i < ang.length; i++) {
      if (!isFinite(valuesDbCut[i])) continue;
      pts.push([((ang[i] + 180) % 360 + 360) % 360 - 180, 10 ** (valuesDbCut[i] / 10)]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const unique = pts.filter((p, i) => i === 0 || p[0] - pts[i - 1][0] > 1e-9);
    if (fullCircle && unique.length > 1) {
      const [a0, v0] = unique[0], [a1, v1] = unique[unique.length - 1];
      unique.unshift([a1 - 360, v1]);
      unique.push([a0 + 360, v0]);
    }
    return { a: unique.map(p => p[0]), v: unique.map(p => p[1]) };
  }

  /** 3D lobe from two orthogonal cuts: G(θ,φ) = G_A(±θ)·cos²φ + G_B(±θ)·sin²φ (linear),
      with the sign of θ taken from the φ quadrant; directions outside the measured range stay empty. */
  function buildLobe(A, B, useDb, floor, nTheta, nPhi) {
    const G = [];
    let gMax = -Infinity, finite = 0, rMax = 0;
    for (let p = 0; p < nPhi; p++) {
      const ph = 2 * Math.PI * p / (nPhi - 1), c2 = Math.cos(ph) ** 2, s2 = Math.sin(ph) ** 2;
      const row = [];
      for (let t = 0; t < nTheta; t++) {
        const th = 180 * t / (nTheta - 1);
        const ga = c2 < 1e-12 ? 0 : interpolate(A.a, A.v, Math.cos(ph) >= 0 ? th : -th);
        const gb = s2 < 1e-12 ? 0 : interpolate(B.a, B.v, Math.sin(ph) >= 0 ? th : -th);
        const g = ga * c2 + gb * s2;
        row.push(g);
        if (isFinite(g)) { finite++; if (g > gMax) gMax = g; }
      }
      G.push(row);
    }
    const gMaxDb = 10 * Math.log10(gMax), X = [], Y = [], Z = [], color = [];
    for (let p = 0; p < nPhi; p++) {
      const ph = 2 * Math.PI * p / (nPhi - 1), x = [], y = [], z = [], c = [];
      for (let t = 0; t < nTheta; t++) {
        const th = Math.PI * t / (nTheta - 1), g = G[p][t];
        const gDb = g > 0 ? 10 * Math.log10(g) : NaN;
        const r = !isFinite(g) ? NaN : useDb ? Math.max(gDb - gMaxDb - floor, 0) : g;
        if (r > rMax) rMax = r;
        x.push(r * Math.sin(th) * Math.cos(ph));
        y.push(r * Math.sin(th) * Math.sin(ph));
        z.push(r * Math.cos(th));
        c.push(useDb ? gDb : g);
      }
      X.push(x); Y.push(y); Z.push(z); color.push(c);
    }
    return { X, Y, Z, color, rMax, coverage: finite / (nTheta * nPhi) * 100 };
  }

  /* =========================================================
     STATE
     ========================================================= */
  const measurements = new Map();                // id → measurement
  const state = {
    current: null,
    tx: 'S21', param: 'S21',                     // tx: polar/freq/lobe · param: surface/compare (also S11, S22)
    fi: 0, ai: 0,                                // frequency and angle index of the working point
    floor: -30, normalize: true, scale: 'db',
    tab: 'surface', overlays: new Set(), timer: null, speed: 90,
    compareB: null, split: null,
    cutA: null, cutB: null, lobeDb: true,
  };
  const current = () => measurements.get(state.current);

  /* display units and decimals, taken from the current measurement:
     unit from the highest frequency, decimals from the smallest grid step */
  let FU = { unit: 'GHz', div: 1e9, digits: 2 }, AU = { digits: 0 };

  function minStep(a) {
    let s = Infinity;
    for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] > 0) s = Math.min(s, a[i] - a[i - 1]);
    return s;
  }

  function setUnits(m) {
    const fMax = Math.abs(m.f[m.nF - 1]);
    const [unit, div] = fMax >= 1e9 ? ['GHz', 1e9] : fMax >= 1e6 ? ['MHz', 1e6] : fMax >= 1e3 ? ['kHz', 1e3] : ['Hz', 1];
    const fStep = minStep(m.f) / div;
    FU = { unit, div, digits: isFinite(fStep) ? Math.min(6, Math.max(2, Math.ceil(-Math.log10(fStep) - 1e-9))) : 2 };
    const aStep = minStep(m.ang), integers = m.ang.every(Number.isInteger);
    AU = { digits: integers || !isFinite(aStep) ? 0 : Math.min(3, Math.max(1, Math.ceil(-Math.log10(aStep) - 1e-9))) };
  }

  /** The measurement's frequencies in the current display unit. */
  function freqs(m) {
    const key = `f|${FU.unit}`;
    return m.cache[key] || (m.cache[key] = m.f.map(x => x / FU.div));
  }
  const fmtF = (v, withUnit = true) => fmt(v, FU.digits) + (withUnit ? ` ${FU.unit}` : '');
  const fmtA = v => isFinite(v) ? `${fmt(v, AU.digits)}°` : '—';
  const hoverF = field => `%{${field}:.${FU.digits}f} ${FU.unit}`;
  const hoverA = field => `%{${field}:.${AU.digits}f}°`;

  /* shown quantity: Friis gain (dBi) or raw |S| (dB) */
  const isFriis = m => m.distance != null;
  const sameModel = m => isFriis(m) === isFriis(current());
  const unitOf = (m, p) => !isReflection(p) && isFriis(m) ? 'dBi' : 'dB';
  const nameOf = (m, p) => !isReflection(p) && isFriis(m) ? 'G' : `|${p}|`;
  const txUnit = () => unitOf(current(), state.tx);
  const txName = () => nameOf(current(), state.tx);

  const selFreq = () => freqs(current())[state.fi];
  const selAngle = () => current().ang[state.ai];

  /* =========================================================
     PLOTLY THEME
     ========================================================= */
  const FONT = 'Inter, system-ui, sans-serif', MONO = 'JetBrains Mono, ui-monospace, monospace';
  const CONFIG = {
    responsive: true, displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
    toImageButtonOptions: { format: 'png', scale: 2 },
  };
  const axis = (title, extra = {}) => ({
    title: { text: title, font: { size: 12, color: DIM }, standoff: 8 },
    gridcolor: GRID, linecolor: AXIS, zeroline: false, ticks: '',
    tickfont: { family: MONO, size: 11, color: FAINT }, ...extra,
  });
  const layout = (extra = {}) => ({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT, size: 12, color: DIM }, separators: ',.',
    margin: { l: 60, r: 20, t: 14, b: 48 },
    hoverlabel: { bgcolor: '#131418', bordercolor: AXIS, font: { family: MONO, size: 12, color: INK } },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 12, color: DIM }, bgcolor: 'rgba(0,0,0,0)' },
    showlegend: false,
    ...extra,
  });
  const colorbar = title => ({
    title: { text: title, side: 'right', font: { size: 12, color: DIM } },
    thickness: 10, outlinewidth: 0, tickfont: { family: MONO, size: 11, color: FAINT },
  });
  /** 3D scene with themed axes; `axes` = { xaxis: { title, … }, … }. */
  function scene(axes, extra) {
    const base = { backgroundcolor: 'rgba(0,0,0,0)', gridcolor: GRID, zerolinecolor: AXIS, linecolor: AXIS,
      color: DIM, tickfont: { family: MONO, size: 10, color: FAINT }, showspikes: false };
    const out = {};
    for (const [k, v] of Object.entries(axes)) out[k] = { ...base, ...v, title: { text: v.title, font: { size: 12, color: DIM } } };
    return { ...out, ...extra };
  }
  const SURFACE_SCENE = { aspectmode: 'manual', aspectratio: { x: 1.4, y: 1.4, z: 0.6 }, camera: { eye: { x: -1.5, y: -1.5, z: 0.9 } } };

  function draw(id, data, lay) {
    const el = $(id);
    if (el.querySelector('.chart-empty')) el.innerHTML = '';
    return Plotly.react(el, data, lay, CONFIG);
  }
  /** A message in place of the chart (no valid data). */
  function showEmpty(id, message) {
    const el = $(id);
    Plotly.purge(el);
    el.dataset.clickBound = '';
    el.innerHTML = message ? `<p class="chart-empty">${esc(message)}</p>` : '';
  }
  /** Does display-unit frequency fs fall inside the measured band of m? */
  function covers(m, fs) {
    const f = freqs(m), half = m.nF > 1 ? (f[m.nF - 1] - f[0]) / (m.nF - 1) / 2 : 0;
    return fs >= f[0] - half - 1e-12 && fs <= f[m.nF - 1] + half + 1e-12;
  }

  /* overlay colours: the current measurement always has the first hue, overlays take the next
     ones in the order they were picked (at most 4, never reused); removing one leaves the others alone */
  const MAX_OVERLAYS = SERIES.length - 1;
  const overlayColors = new Map();
  const colorOf = id => id === state.current ? SERIES[0] : overlayColors.get(id) || 'transparent';
  function setOverlay(id, on) {
    if (on && state.overlays.size < MAX_OVERLAYS) {
      state.overlays.add(id);
      const used = new Set(overlayColors.values());
      overlayColors.set(id, SERIES.slice(1).find(c => !used.has(c)));
    } else if (!on) {
      state.overlays.delete(id);
      overlayColors.delete(id);
    }
  }
  /** Current measurement first, then the overlays with the same model (Friis or raw). */
  const shownMeasurements = () => [current(), ...[...state.overlays]
    .filter(id => id !== state.current && measurements.has(id) && sameModel(measurements.get(id)))
    .map(id => measurements.get(id))];

  /* =========================================================
     VIEWS
     ========================================================= */

  function viewSurface() {
    const m = current(), p = state.param, V = valuesDb(m, p);
    const key = `Z|${p}|${m.distance}`;
    const zDb = m.cache[key] || (m.cache[key] = toRows(m, V));
    const [vMax] = nanMax(V);
    if (!isFinite(vMax)) return showEmpty('chart-surface', `Nessun valore valido di ${p} in tutta la misura.`);

    // dB: from the floor below the peak; linear: power, 10^(dB/10), from 0 to the peak
    const lin = state.scale === 'lin', linKey = `${key}|lin`;
    const z = !lin ? zDb : (m.cache[linKey] || (m.cache[linKey] = zDb.map(r => r.map(v => 10 ** (v / 10)))));
    const zMax = lin ? 10 ** (vMax / 10) : vMax, zMin = lin ? 0 : vMax + state.floor;
    const label = lin ? `${nameOf(m, p)} lineare` : `${nameOf(m, p)} [${unitOf(m, p)}]`;
    $('title-surface').textContent = `${nameOf(m, p) === 'G' ? 'Guadagno' : nameOf(m, p)} su angolo × frequenza`;

    draw('chart-surface', [{
      type: 'surface', x: Array.from(m.ang), y: Array.from(freqs(m)),
      z: z.map(r => r.map(v => isFinite(v) ? Math.max(v, zMin) : null)),
      colorscale: SEQUENTIAL, cmin: zMin, cmax: zMax, colorbar: colorbar(label),
      hovertemplate: `${hoverA('x')} · ${hoverF('y')}<br>${lin ? '%{z:.3g}' : `%{z:.2f} ${unitOf(m, p)}`}<extra></extra>`,
      lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1, roughness: 0.7 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: `surface|${m.id}`,
      scene: scene({ xaxis: { title: 'angolo [°]' }, yaxis: { title: `frequenza [${FU.unit}]` }, zaxis: { title: label, range: [zMin, zMax] } }, SURFACE_SCENE),
    }));
  }

  function viewPolar() {
    const fs = selFreq(), all = shownMeasurements();
    // overlays that do not cover this frequency are left out rather than drawn at another one
    const list = all.filter((m, n) => !n || covers(m, fs));
    const outOfBand = all.length - list.length;
    const cuts = list.map(m => {
      const k = nearest(freqs(m), fs), g = cutAt(m, gainDb(m, state.tx), k);
      const [gm] = nanMax(g);
      return { m, k, v: state.normalize ? g.map(x => x - gm) : g };
    });
    const top = Math.max(...cuts.map(c => nanMax(c.v)[0]));
    if (!isFinite(top)) {
      showEmpty('chart-polar', `Nessun valore valido di ${state.tx} a questa frequenza.`);
      $('info-polar').textContent = fmtF(fs);
      return;
    }
    const rMax = state.normalize ? 0 : Math.ceil(top / 5) * 5;
    const rMin = state.normalize ? state.floor : rMax + state.floor;
    const unit = state.normalize ? 'dB' : txUnit();

    const traces = cuts.map((c, n) => ({
      type: 'scatterpolar', mode: 'lines', name: c.m.name,
      theta: Array.from(c.m.ang), r: c.v.map(x => isFinite(x) ? Math.max(x, rMin) : null),
      customdata: Array.from(c.v), connectgaps: false,
      line: { color: colorOf(c.m.id), width: n ? 1.6 : 2.2 },
      fill: n ? 'none' : 'toself', fillcolor: rgba(colorOf(c.m.id), 0.08),
      hovertemplate: `${hoverA('theta')} · %{customdata:.2f} ${unit}<extra>${esc(c.m.name)}</extra>`,
    }));
    const v0 = cuts[0].v[state.ai];
    if (isFinite(v0)) {
      traces.push({
        type: 'scatterpolar', mode: 'markers', theta: [selAngle()], r: [Math.max(v0, rMin)], showlegend: false,
        marker: { size: 9, color: SERIES[0], line: { color: '#07080a', width: 2 } },
        hovertemplate: `angolo scelto · ${hoverA('theta')} · ${fmt(v0)} ${unit}<extra></extra>`,
      });
    }

    draw('chart-polar', traces, layout({
      showlegend: list.length > 1,
      margin: { l: 40, r: 40, t: list.length > 1 ? 40 : 24, b: 24 },
      uirevision: 'polar',
      polar: {
        bgcolor: 'rgba(0,0,0,0)',
        angularaxis: {
          rotation: 90, direction: 'clockwise', gridcolor: GRID, linecolor: AXIS, ticks: '',
          tickmode: 'array', tickvals: [...Array(12)].map((_, i) => i * 30),
          ticktext: [...Array(12)].map((_, i) => `${i * 30 <= 180 ? i * 30 : i * 30 - 360}°`),
          tickfont: { family: MONO, size: 11, color: DIM },
        },
        radialaxis: {
          range: [rMin, rMax], angle: -22.5, tickangle: -22.5, gridcolor: GRID, linecolor: AXIS,
          dtick: rMax - rMin > 15 ? 10 : 5, ticksuffix: ` ${unit}`, tickfont: { family: MONO, size: 10, color: FAINT },
        },
      },
    }));
    const nearestOnly = cuts.slice(1).filter(c => Math.abs(freqs(c.m)[c.k] - fs) > 1e-9 * Math.max(1, Math.abs(fs))).length;
    $('info-polar').textContent = `${fmtF(fs)} · ${state.normalize ? 'normalizzato' : `${txName()} [${txUnit()}]`}`
      + (nearestOnly ? ` · ${nearestOnly === 1 ? '1 sovrapposta' : `${nearestOnly} sovrapposte`} alla frequenza più vicina` : '')
      + (outOfBand ? ` · ${outOfBand === 1 ? '1 sovrapposta esclusa' : `${outOfBand} sovrapposte escluse`}: fuori banda` : '');
  }

  function viewFreq() {
    // overlays: only those that measured this angle (within half a step)
    const as = selAngle(), all = shownMeasurements();
    const list = all.filter((m, n) => !n || Math.abs(m.ang[nearest(m.ang, as)] - as) <= (m.nA > 1 ? minStep(m.ang) : 0) / 2 + 1e-9);
    const several = list.length > 1, missing = all.length - list.length;
    const lines = (valuesOf, unit) => list.map(m => ({
      type: 'scatter', mode: 'lines', name: m.name, x: Array.from(freqs(m)), y: valuesOf(m),
      line: { color: colorOf(m.id), width: 2 }, connectgaps: false,
      hovertemplate: `%{y:.2f} ${unit}<extra>${esc(m.name)}</extra>`,
    }));
    const marker = [{ type: 'line', xref: 'x', yref: 'paper', x0: selFreq(), x1: selFreq(), y0: 0, y1: 1,
      line: { color: 'rgba(233,234,238,0.45)', width: 1, dash: 'dot' } }];
    const base = (yTitle, extra = {}) => layout({
      showlegend: several, hovermode: 'x unified', shapes: marker, uirevision: 'freq',
      margin: { l: 60, r: 20, t: several ? 34 : 14, b: 44 },
      xaxis: axis(`frequenza [${FU.unit}]`, { hoverformat: `.${FU.digits}f` }), yaxis: axis(yTitle), ...extra,
    });

    draw('chart-freq', lines(m => Array.from(columnAt(m, gainDb(m, state.tx), nearest(m.ang, as))), txUnit()), base(`${txName()} [${txUnit()}]`));
    draw('chart-peak', lines(m => peakPerFrequency(m, state.tx), txUnit()), base(`${txName()} max [${txUnit()}]`, { showlegend: false, margin: { l: 60, r: 20, t: 14, b: 44 } }));
    $('info-freq').textContent = `all'angolo ${fmtA(as)}` + (several ? ' (o al più vicino)' : '')
      + (missing ? ` · ${missing} sovrapposte senza quest'angolo` : '');
  }

  function viewCompare() {
    const m = current(), p = state.param;
    const options = [...measurements.values()].filter(x => x.id !== m.id && (isReflection(p) || sameModel(x)) && sameGrid(m, x));
    fillSelect($('sel-compare-b'), options, state.compareB);
    $('out-compare-a').textContent = m.name;
    if (!options.length) {
      $('compare-empty').hidden = false; $('compare-figure').hidden = true; $('compare-table').innerHTML = '';
      return;
    }
    if (!options.some(x => x.id === state.compareB)) state.compareB = options[0].id;
    $('sel-compare-b').value = state.compareB;
    $('compare-empty').hidden = true; $('compare-figure').hidden = false;

    const b = measurements.get(state.compareB), r = compareMeasurements(m, b, p, state.split), d = r.d;
    const z = Array.from({ length: m.nF }, (_, k) => Array.from({ length: m.nA }, (_, i) => {
      const v = d[i * m.nF + k]; return isFinite(v) ? v : null;
    }));
    // symmetric scale at the 99th percentile of |Δ|, so a few extreme points do not flatten the rest
    const abs = Array.from(d).filter(isFinite).map(Math.abs).sort((x, y) => x - y);
    const lim = abs.length ? Math.max(abs[Math.floor(abs.length * 0.99)], 1e-12) : 1;
    const label = `Δ${nameOf(m, p).replace(/\|/g, '')} lineare`;
    draw('chart-compare', [{
      type: 'surface', x: Array.from(m.ang), y: Array.from(freqs(m)), z,
      surfacecolor: z, cmin: -lim, cmax: lim, colorscale: DIVERGING, colorbar: colorbar(label),
      hovertemplate: `${hoverA('x')} · ${hoverF('y')}<br>Δ = %{z:+.3g}<extra></extra>`,
      lighting: { ambient: 0.8, diffuse: 0.45, specular: 0.05, roughness: 0.8 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: `compare|${m.id}`,
      scene: scene({ xaxis: { title: 'angolo [°]' }, yaxis: { title: `frequenza [${FU.unit}]` }, zaxis: { title: label, range: [-lim * 1.05, lim * 1.05] } }, SURFACE_SCENE),
    }));
    const g3 = v => v.toPrecision(3).replace('.', ',');
    $('info-compare').textContent = `A = ${m.name} · B = ${b.name} · picco ${g3(r.peak)} · scala ±${g3(lim)} (99° percentile)`;

    const heads = ['banda', 'Δ medio', '|Δ| medio', 'Δ RMS', '|Δ| max', 'punti'];
    const cell = (v, i) => i === 4 ? `<td>${v.toLocaleString('it-IT')}</td>`
      : `<td>${i === 0 && v > 0 ? '+' : ''}${fmt(v, 2)}<span class="unit">%</span></td>`;
    $('compare-table').innerHTML = `<table class="data-table"><caption>Statistiche di Δ = A − B, in % del picco</caption>
      <thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${r.rows.map(([band, s]) => `<tr><td>${band}</td>${s.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function viewLobe() {
    const all = [...measurements.values()];
    fillSelect($('sel-cut-a'), all, state.cutA);
    fillSelect($('sel-cut-b'), all, state.cutB, '— uguale al taglio a 0° (simmetria di rotazione) —');
    const A = measurements.get(state.cutA) || current(), B = measurements.get(state.cutB) || A;
    $('sel-cut-a').value = A.id;
    $('sel-cut-b').value = state.cutB && measurements.has(state.cutB) ? state.cutB : '';
    const fail = message => { showEmpty('chart-lobe', message); $('info-lobe').textContent = ''; };

    if (!sameModel(A) || !sameModel(B)) return fail('I due tagli devono essere entrambi con Friis o entrambi senza.');
    const fs = selFreq(), kA = nearest(freqs(A), fs), kB = nearest(freqs(B), fs);
    const outOfBand = [A, B].filter(m => !covers(m, fs)).map(m => m.name);
    if (outOfBand.length) return fail(`${[...new Set(outOfBand)].join(' e ')}: ${fmtF(fs)} è fuori dalla banda misurata.`);

    const playing = state.timer !== null;                 // coarser grid while animating
    const L = buildLobe(prepareCut(A.ang, cutAt(A, gainDb(A, state.tx), kA), A.fullCircle),
      prepareCut(B.ang, cutAt(B, gainDb(B, state.tx), kB), B.fullCircle),
      state.lobeDb, state.floor, playing ? 61 : 121, playing ? 121 : 241);
    let cMax = -Infinity;
    for (const row of L.color) for (const v of row) if (v > cMax) cMax = v;
    if (!isFinite(cMax)) return fail(`Nessun valore valido di ${state.tx} a questa frequenza.`);
    const cMin = state.lobeDb ? cMax + state.floor : 0;
    const R = (L.rMax || 1) * 1.05;
    const lobeAxis = title => ({ title, showticklabels: false, range: [-R, R] });

    draw('chart-lobe', [{
      type: 'surface', x: L.X, y: L.Y, z: L.Z, surfacecolor: L.color, colorscale: SEQUENTIAL, cmin: cMin, cmax: cMax,
      colorbar: colorbar(state.lobeDb ? `${txName()} [${txUnit()}]` : `${txName()} lineare`),
      hovertemplate: `%{surfacecolor:.2f} ${state.lobeDb ? txUnit() : ''}<extra></extra>`,
      lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1, roughness: 0.7 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: 'lobe',
      scene: scene({ xaxis: lobeAxis('x · φ = 0°'), yaxis: lobeAxis('y · φ = 90°'), zaxis: lobeAxis('z · boresight') },
        { aspectmode: 'cube', camera: { eye: { x: 1.4, y: 1.4, z: 0.8 } } }),
    }));
    const fB = freqs(B)[kB], otherFreq = Math.abs(fB - freqs(A)[kA]) > 1e-9 * Math.abs(fB);
    $('info-lobe').textContent = `${fmtF(freqs(A)[kA])} · copertura ${fmt(L.coverage, 0)} % delle direzioni`
      + (A === B ? ' · un solo taglio' : otherFreq ? ` · taglio a 90° a ${fmtF(fB)} (frequenza più vicina)` : '');
  }

  function viewReflection() {
    const m = current(), i = state.ai, threshold = -10;
    const params = [['S11', 0], ['S22', 1]];                     // fixed colour per parameter
    const dbAtAngle = p => Array.from(columnAt(m, valuesDb(m, p), i));
    const matchedShare = p => {
      const V = valuesDb(m, p);
      return Array.from({ length: m.nF }, (_, k) => {
        let ok = 0, c = 0;
        for (let r = 0; r < m.nA; r++) { const v = V[r * m.nF + k]; if (isFinite(v)) { c++; if (v <= threshold) ok++; } }
        return c ? ok / c * 100 : NaN;
      });
    };
    const line = (name, y, n, unit) => ({ type: 'scatter', mode: 'lines', name, x: Array.from(freqs(m)), y,
      line: { color: SERIES[n], width: 2 }, hovertemplate: `%{y:.2f} ${unit}<extra>${name}</extra>` });
    const base = (yTitle, extra = {}) => layout({
      showlegend: true, hovermode: 'x unified', uirevision: 'reflection', margin: { l: 60, r: 20, t: 34, b: 44 },
      xaxis: axis(`frequenza [${FU.unit}]`, { hoverformat: `.${FU.digits}f` }), yaxis: axis(yTitle), ...extra,
    });
    const thresholdLine = { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: threshold, y1: threshold,
      line: { color: 'rgba(245,165,36,0.6)', width: 1, dash: 'dash' } };
    const freqLine = { type: 'line', xref: 'x', yref: 'paper', x0: selFreq(), x1: selFreq(), y0: 0, y1: 1,
      line: { color: 'rgba(233,234,238,0.45)', width: 1, dash: 'dot' } };

    viewSmith(m, params);
    draw('chart-reflection', params.map(([p, n]) => line(`|${p}|`, dbAtAngle(p), n, 'dB')), base('|S| [dB]', { shapes: [thresholdLine, freqLine] }));
    const shares = params.map(([p, n]) => [p, n, matchedShare(p)]);
    draw('chart-matched', shares.map(([p, n, y]) => line(p, y, n, '%')), base('angoli adattati [%]', { yaxis: axis('angoli adattati [%]', { range: [0, 101] }) }));
    const mean = a => { const ok = a.filter(isFinite); return ok.reduce((s, v) => s + v, 0) / ok.length; };
    $('info-reflection').textContent = `angolo ${fmtA(selAngle())} · soglia ${threshold} dB tratteggiata`;
    $('info-matched').textContent = `media su tutta la griglia: ${shares.map(([p, , y]) => `${p} ${fmt(mean(y), 0)} %`).join(' · ')}`;
  }

  /** Smith chart: Γ = S11, S22 over frequency at the chosen angle, marker at the chosen frequency.
      Plotly wants the normalised impedance z = (1 + Γ) / (1 − Γ). */
  function viewSmith(m, params) {
    const i = state.ai, f = freqs(m);
    const impedance = (re, im) => {
      const dr = 1 - re, d = dr * dr + im * im;
      return [((1 + re) * dr - im * im) / d, (im * dr + (1 + re) * im) / d];
    };
    const traces = [];
    for (const [p, n] of params) {
      const S = m.S[p], real = [], imag = [], info = [];
      for (let k = 0; k < m.nF; k++) {
        const gr = S[(i * m.nF + k) * 2], gi = S[(i * m.nF + k) * 2 + 1];
        const [r, x] = impedance(gr, gi);
        real.push(isFinite(r) ? r : null); imag.push(isFinite(x) ? x : null);
        info.push([f[k], db20(Math.hypot(gr, gi)), Math.atan2(gi, gr) * 180 / Math.PI]);
      }
      const hover = `${hoverF('customdata[0]')}<br>|${p}| %{customdata[1]:.2f} dB · ∠ %{customdata[2]:.1f}°<br>z = %{real:.2f} %{imag:+.2f}j<extra>${p}</extra>`;
      traces.push({ type: 'scattersmith', mode: 'lines', name: p, real, imag, customdata: info,
        line: { color: SERIES[n], width: 1.8 }, hovertemplate: hover });
      traces.push({ type: 'scattersmith', mode: 'markers', name: `${p} @ ${fmtF(selFreq())}`, showlegend: false,
        real: [real[state.fi]], imag: [imag[state.fi]], customdata: [info[state.fi]], hovertemplate: hover,
        marker: { size: 10, color: SERIES[n], line: { color: '#07080a', width: 2 } } });
    }
    const smithAxis = { gridcolor: GRID, linecolor: AXIS, tickfont: { family: MONO, size: 10, color: FAINT } };
    draw('chart-smith', traces, layout({
      showlegend: true, uirevision: 'smith', margin: { l: 30, r: 30, t: 40, b: 30 },
      smith: { bgcolor: 'rgba(0,0,0,0)', domain: { x: [0, 1], y: [0, 1] }, realaxis: smithAxis, imaginaryaxis: smithAxis },
    }));
    $('info-smith').textContent = `angolo ${fmtA(selAngle())} · marcatore a ${fmtF(selFreq())}`;
  }

  function viewAudit() {
    const m = current(), a = audit(m), total = m.nA * m.nF;
    const row = (label, count, share, ok, verdict) =>
      `<tr><td>${label}</td><td>${count}</td><td>${share}</td><td class="${ok ? 'ok' : 'bad'}">${verdict}</td></tr>`;
    const rows = a.rows.map(r => row(r.label, r.count.toLocaleString('it-IT'), `${fmt(r.count / total * 100, 2)}<span class="unit">%</span>`,
      !r.count, r.count ? 'violato' : 'ok'));
    $('audit-table').innerHTML = `<table class="data-table"><caption>Controlli su ${total.toLocaleString('it-IT')} punti (${m.nA} angoli × ${m.nF} frequenze)</caption>
      <thead><tr><th>controllo</th><th>punti</th><th>quota</th><th>esito</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;

    const top = Math.max(1, a.maxCount), s = 0.5 / (top + 0.5);
    draw('chart-audit', [{
      type: 'heatmap', x: Array.from(m.ang), y: Array.from(freqs(m)), z: toRows(m, a.map), zmin: 0, zmax: top + 0.5,
      colorscale: [[0, OK_FILL], [s, OK_FILL], [s + 1e-6, BAD_FILL], [1, BAD]],
      colorbar: { ...colorbar('controlli violati'), tickvals: [...Array(top + 1).keys()] },
      hovertemplate: `${hoverA('x')} · ${hoverF('y')}<br>%{z} controlli violati<extra></extra>`,
    }], layout({ uirevision: `audit|${m.id}`, xaxis: axis('angolo [°]'), yaxis: axis(`frequenza [${FU.unit}]`) }));

    // clicking the map moves the working point there
    const el = $('chart-audit');
    if (!el.dataset.clickBound) {
      el.dataset.clickBound = '1';
      el.on('plotly_click', ev => {
        const pt = ev.points && ev.points[0];
        if (!pt) return;
        state.ai = nearest(current().ang, pt.x);
        state.fi = nearest(freqs(current()), pt.y);
        requestRender();
      });
    }
  }

  const VIEWS = { surface: viewSurface, polar: viewPolar, freq: viewFreq, compare: viewCompare, lobe: viewLobe, reflection: viewReflection, audit: viewAudit };

  /* =========================================================
     MEASUREMENT HEADER
     ========================================================= */

  function renderHeader() {
    const m = current(), f = freqs(m), meta = m.meta;
    $('meas-name').textContent = m.name;
    $('meas-notes').textContent = meta.note || '';
    $('meas-notes').hidden = !meta.note;

    let sMin = Infinity, sMax = -Infinity;
    for (let i = 1; i < m.nA; i++) { const d = m.ang[i] - m.ang[i - 1]; sMin = Math.min(sMin, d); sMax = Math.max(sMax, d); }
    const step = m.nA < 2 ? '1 angolo' : sMax - sMin < 1e-6 ? `passo ${fmtA(sMin)}` : `passo ${fmtA(sMin)}–${fmtA(sMax)}`;
    const missing = meta.griglia?.angoli_mancanti || 0;

    const info = [
      ['grandezza', isFriis(m) ? 'Guadagno · Friis' : '|S| grezzo',
        isFriis(m) ? `R = ${fmt(meta.distanza_m, 2)} m${m.distance !== meta.distanza_m ? ` (ora ${fmt(m.distance, 2)} m)` : ''}` : 'nessuna ipotesi sul setup'],
      ['angoli', `${fmtA(m.ang[0])} … ${fmtA(m.ang[m.nA - 1])}`, `${step} · ${m.nA} righe${missing ? ` · ${missing} NaN` : ''}`],
      ['frequenze', `${fmtF(f[0], false)} – ${fmtF(f[m.nF - 1])}`, `${m.nF} ${m.nF === 1 ? 'punto' : 'punti'}`],
    ];
    $('meas-info').innerHTML = info.map(([k, v, sub]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd>${sub ? `<dd class="sub">${esc(sub)}</dd>` : ''}</div>`).join('');

    updatePanel();
    $('distance-note').textContent = !isFriis(m) ? '' : m.distance === meta.distanza_m
      ? 'dal pacchetto' : `modificata: nel pacchetto è ${fmt(meta.distanza_m, 2)} m`;
    $('split-unit').textContent = FU.unit;
  }

  /* =========================================================
     SIDE PANEL, TABS, RENDER LOOP
     ========================================================= */

  /** Slide the indicator under the active tab. */
  function moveTabIndicator() {
    const tab = $('tabs').querySelector('[aria-selected="true"]'), ind = $('tabs').querySelector('.tabs-indicator');
    if (!tab || !tab.offsetWidth) return;
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  /** The side panel follows the tab: only the controls that matter there are shown. */
  const ANIMATED_TABS = ['polar', 'lobe'];
  function updatePanel() {
    document.querySelectorAll('.lab-side [data-views]').forEach(el => {
      let visible = el.dataset.views.split(' ').includes(state.tab);
      // the distance only matters to Friis: not for raw |S|, nor for S11/S22 where those are shown
      if (el.id === 'distance-field') {
        visible = visible && !!current() && isFriis(current()) && !(['surface', 'compare'].includes(state.tab) && isReflection(state.param));
      }
      el.hidden = !visible;
    });
    if (!ANIMATED_TABS.includes(state.tab) && state.timer !== null) animate(false);
  }

  /** Redraw at most once per animation frame. */
  let renderPending = false;
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      if (!current() || !window.Plotly) return;
      syncSliders();
      VIEWS[state.tab]();
    });
  }

  const setFill = el => el.style.setProperty('--fill', `${el.max > el.min ? (el.value - el.min) / (el.max - el.min) * 100 : 0}%`);

  function syncSliders() {
    const m = current();
    for (const [id, i, n] of [['in-freq', state.fi, m.nF], ['in-angle', state.ai, m.nA]]) {
      const el = $(id);
      el.max = n - 1; el.value = i;
      setFill(el);
    }
    setFill($('in-floor'));
    $('out-freq').textContent = fmtF(selFreq());
    $('out-angle').textContent = fmtA(selAngle());
    $('out-floor').textContent = `${state.floor} dB`;
  }

  /** Rebuild a <select> only when its option list changes; `emptyLabel` adds a first empty option. */
  function fillSelect(select, list, value, emptyLabel) {
    const signature = (emptyLabel || '') + list.map(m => m.id).join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.innerHTML = (emptyLabel ? `<option value="">${emptyLabel}</option>` : '')
        + list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    }
    if (value != null) select.value = value;
  }

  function renderOverlayList() {
    const full = state.overlays.size >= MAX_OVERLAYS;
    $('overlay-list').innerHTML = [...measurements.values()].filter(m => m.id !== state.current).map(m => `
      <label class="check"><input type="checkbox" value="${esc(m.id)}" ${state.overlays.has(m.id) ? 'checked' : full ? 'disabled' : ''}>
        <span>${esc(m.name)}</span><i class="sw" style="--c:${colorOf(m.id)}"></i></label>`).join('');
    $('measure-count').textContent = `${measurements.size} ${measurements.size === 1 ? 'misura' : 'misure'}`;
  }

  function syncSegment(id, value) {
    $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === value)));
  }

  /** Make `id` the current measurement, keeping the working point (frequency and angle) if possible. */
  function selectMeasurement(id) {
    const previous = current();
    const fHz = previous ? previous.f[state.fi] : null, angle = previous ? selAngle() : 0;
    state.current = id;
    setOverlay(id, false);
    const m = current();
    setUnits(m);
    state.fi = fHz != null ? nearest(m.f, fHz) : Math.floor(m.nF / 2);
    state.ai = nearest(m.ang, angle);
    // the orthogonal cut is picked by the user: file names do not tell how a measurement is oriented
    state.cutA = id;
    state.cutB = null;
    $('in-distance').value = m.distance ?? '';
    syncSegment('seg-tx', state.tx);
    syncSegment('seg-param', state.param);
    fillSelect($('sel-measure'), [...measurements.values()], id);
    renderOverlayList();
    renderHeader();
    requestRender();
  }

  /* =========================================================
     LOADING
     ========================================================= */
  async function loadFiles(items) {
    const errors = [];
    for (const { name, read } of items) {
      if (!/\.rfm$/i.test(name)) { errors.push(`${name}: servono file .rfm, creati nella sezione Impacchetta`); continue; }
      try {
        const buf = await read();
        if (!Npz.comment(buf).startsWith(SIGNATURE)) throw new Error('firma RFM mancante: non è un file .rfm valido');
        const m = buildMeasurement(await Npz.read(buf));
        measurements.set(m.id, m);
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
    $('drop-error').textContent = $('lab-error').textContent = errors.join(' · ');
    if (!measurements.size) {
      if (!errors.length) $('drop-error').textContent = 'Nessun file .rfm trovato.';
      return;
    }
    $('drop').hidden = true;
    $('lab').hidden = false;
    requestAnimationFrame(moveTabIndicator);
    selectMeasurement(state.current && measurements.has(state.current) ? state.current : [...measurements.keys()].sort()[0]);
  }

  /** Normalised file items: { name, path, size, read() → ArrayBuffer }. */
  const fromFileList = list => [...list].map(f => ({
    name: f.name, path: f.webkitRelativePath || f.name, size: f.size, read: () => f.arrayBuffer(),
  }));
  const isFolder = items => items.some(it => it.path.split('/').filter(Boolean).length > 1);
  const formatSize = bytes => bytes > 1e6 ? `${fmt(bytes / 1e6, 1)} MB` : `${fmt(bytes / 1e3, 0)} kB`;

  /** Items from a drag-and-drop, walking dropped folders recursively. */
  async function fromDrop(dataTransfer) {
    const out = [];
    const visit = async (entry, base) => {
      if (entry.isFile) {
        const f = await new Promise((ok, ko) => entry.file(ok, ko));
        out.push({ name: f.name, path: `${base}/${f.name}`, size: f.size, read: () => f.arrayBuffer() });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((ok, ko) => reader.readEntries(ok, ko));
          for (const e of batch) await visit(e, `${base}/${entry.name}`);
        } while (batch.length);
      }
    };
    const roots = [...dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!roots.length) return fromFileList(dataTransfer.files);
    for (const e of roots) await visit(e, '');
    return out;
  }

  /** The analysis takes single .rfm files, not folders. */
  async function loadAnalysisFiles(items) {
    if (isFolder(items)) {
      $('drop-error').textContent = $('lab-error').textContent = 'Trascina i singoli file .rfm, non una cartella.';
      return;
    }
    await loadFiles(items);
  }

  /** Site-styled confirmation dialog. rows = [[name, detail], …] → Promise<boolean>. */
  function confirmDialog({ eyebrow = '', title, text = '', rows = [], ok = 'Conferma', cancel = 'Annulla' }) {
    const dialog = $('dialog');
    $('dialog-eyebrow').textContent = eyebrow;
    $('dialog-title').textContent = title;
    $('dialog-text').textContent = text;
    $('dialog-list').innerHTML = rows.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
    $('dialog-list').hidden = !rows.length;
    $('dialog-ok').textContent = ok;
    $('dialog-cancel').textContent = cancel;
    dialog.returnValue = '';
    dialog.showModal();
    $('dialog-ok').focus();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
  }

  /* =========================================================
     EVENTS
     ========================================================= */
  function onSegment(id, handler) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      syncSegment(id, b.dataset.v);
      handler(b.dataset.v);
      requestRender();
    });
  }

  function animate(on) {
    clearInterval(state.timer);
    state.timer = on ? setInterval(() => { state.fi = (state.fi + 1) % current().nF; requestRender(); }, state.speed) : null;
    $('btn-play').setAttribute('aria-pressed', String(on));
    $('btn-play').querySelector('.play-label').textContent = on ? 'Pausa' : 'Anima in frequenza';
    if (!on) requestRender();                         // redraw the lobe at full resolution
  }

  function bindEvents() {
    const drop = $('drop');
    for (const type of ['dragenter', 'dragover']) {
      document.addEventListener(type, e => { e.preventDefault(); drop.classList.add('is-over'); });
    }
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('is-over'); });
    document.addEventListener('drop', async e => {
      e.preventDefault();
      if (document.body.dataset.mode === 'pack') return;            // handled by antenna-pack.js
      drop.classList.remove('is-over');
      await loadAnalysisFiles(await fromDrop(e.dataTransfer));
    });
    for (const id of ['in-files', 'in-files-more']) {
      $(id).addEventListener('change', async e => { await loadAnalysisFiles(fromFileList(e.target.files)); e.target.value = ''; });
    }

    $('sel-measure').addEventListener('change', e => selectMeasurement(e.target.value));
    onSegment('seg-tx', v => { state.tx = v; });
    onSegment('seg-param', v => { state.param = v; updatePanel(); });
    onSegment('seg-scale', v => { state.scale = v; });
    onSegment('seg-speed', v => { state.speed = +v; if (state.timer !== null) animate(true); });
    $('in-distance').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (v > 0 && isFriis(current())) { current().distance = v; renderHeader(); requestRender(); }
    });
    $('in-freq').addEventListener('input', e => { state.fi = +e.target.value; requestRender(); });
    $('in-angle').addEventListener('input', e => { state.ai = +e.target.value; requestRender(); });
    $('in-floor').addEventListener('input', e => { state.floor = +e.target.value; requestRender(); });
    $('tg-normalize').addEventListener('change', e => { state.normalize = e.target.checked; requestRender(); });
    $('btn-play').addEventListener('click', () => animate(state.timer === null));
    $('overlay-list').addEventListener('change', e => {
      setOverlay(e.target.value, e.target.checked);
      renderOverlayList();
      requestRender();
    });
    $('sel-compare-b').addEventListener('change', e => { state.compareB = e.target.value; requestRender(); });
    $('in-split').addEventListener('input', e => { const v = parseFloat(e.target.value); state.split = isFinite(v) ? v : null; requestRender(); });
    $('sel-cut-a').addEventListener('change', e => { state.cutA = e.target.value; requestRender(); });
    $('sel-cut-b').addEventListener('change', e => { state.cutB = e.target.value || null; requestRender(); });
    $('tg-lobe-db').addEventListener('change', e => { state.lobeDb = e.target.checked; requestRender(); });

    $('tabs').addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      state.tab = tab.dataset.tab;
      $('tabs').querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== state.tab; });
      updatePanel();
      moveTabIndicator();
      requestRender();
    });
    window.addEventListener('resize', () => requestAnimationFrame(moveTabIndicator));

    // keyboard: ← → frequency, ↑ ↓ angle, space toggles the animation
    document.addEventListener('keydown', e => {
      if (!current() || e.target.closest('input, select, textarea, button')) return;
      const m = current();
      const moves = {
        ArrowRight: () => { state.fi = Math.min(state.fi + 1, m.nF - 1); }, ArrowLeft: () => { state.fi = Math.max(state.fi - 1, 0); },
        ArrowUp: () => { state.ai = Math.min(state.ai + 1, m.nA - 1); }, ArrowDown: () => { state.ai = Math.max(state.ai - 1, 0); },
      };
      if (moves[e.key]) { e.preventDefault(); moves[e.key](); requestRender(); }
      else if (e.key === ' ') { e.preventDefault(); animate(state.timer === null); }
    });

    $('modes').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setMode(b.dataset.v); });
    document.addEventListener('click', e => {
      const link = e.target.closest('[data-goto]');
      if (link) { e.preventDefault(); setMode(link.dataset.goto); }
    });
  }

  /** Page sections: "analyze" (packages) or "pack" (raw folders). */
  function setMode(mode) {
    document.body.dataset.mode = mode;
    document.querySelectorAll('[data-section]').forEach(s => { s.hidden = s.dataset.section !== mode; });
    syncSegment('modes', mode);
    if (mode === 'analyze') { requestRender(); requestAnimationFrame(moveTabIndicator); }
  }

  // API used by antenna-pack.js
  window.AntennaLab = {
    FORMAT, VERSION, SIGNATURE, buildMeasurement, fromDrop, fromFileList, confirm: confirmDialog, formatSize,
    /** Open packages already in memory in the analysis: [{ name, blob }]. */
    open: async packages => {
      setMode('analyze');
      await loadFiles(packages.map(p => ({ name: p.name, path: p.name, read: () => p.blob.arrayBuffer() })));
    },
  };

  bindEvents();
  setMode('analyze');
})();
