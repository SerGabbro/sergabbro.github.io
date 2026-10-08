/* =========================================================
   GABBRO — antenne.js
   Laboratorio antenne (tools/antenne.html).

   Dati: cubi di parametri S (angoli × frequenze) letti da .npz
   con npz.js; grafici con Plotly. Tutto avviene nel browser.

   Convenzioni:
   - array S complessi interlacciati (re, im), indice
     (i_angolo · nF + k_freq) · 2, come in NumPy (C-order);
   - guadagno lineare di una antenna con Friis per due antenne
     identiche: G = |S21| · 4πR f / c;
   - NaN dove un punto non è stato misurato: non si inventa nulla.
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const C0 = 299792458;
  const TOL_PASS = 1.05, TOL_REC = 0.05;

  /* ---------- colori: palette categorica verificata CVD sul fondo scuro ---------- */
  const SERIE = ['#22d3ee', '#f5a524', '#a78bfa', '#f472b6', '#4ade80'];
  const INK = '#e9eaee', DIM = '#a0a3ad', FAINT = '#6b6f7a';
  const GRID = 'rgba(255,255,255,0.06)', AXIS = 'rgba(255,255,255,0.14)';
  const SEQ = [[0, '#0b1a20'], [0.2, '#0c3a47'], [0.4, '#0e6276'], [0.6, '#1590a8'], [0.8, '#22d3ee'], [1, '#c4f5fc']];
  const DIV = [[0, '#93c5fd'], [0.25, '#2f6fd6'], [0.5, '#2a2b30'], [0.75, '#c43b3b'], [1, '#f8a5a5']];
  const OK_T = '#12301f', KO = '#e63946', KO_T = '#5c1d23';

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d).replace('.', ',').replace(/^-(0,?0*)$/, '$1');

  /* =========================================================
     MISURE
     ========================================================= */
  const misure = new Map();      // id → misura

  /* =========================================================
     STANDARD DEI PACCHETTI (v1)
     Array: frequenze [Hz] crescenti, angoli [°] crescenti,
     S11 S21 S12 S22 complessi (angoli × frequenze), NaN dove un
     angolo non è stato misurato; meta = stringa JSON con almeno
     formato, versione, misura e modello:
       "friis"   → due antenne uguali, serve distanza_m: guadagno in dBi
       "nessuno" → si mostra |S| grezzo in dB, senza ipotesi sul setup
     (facoltative: note, acquisizione, griglia, sorgente).
     I pacchetti si creano nella sezione Impacchetta (pacchetto.js).
     ========================================================= */
  const FORMATO = 'gabbro-antenne', VERSIONE = 1;
  const PARAM_S = ['S11', 'S21', 'S12', 'S22'];

  function leggiMeta(arr) {
    const m = arr.meta;
    if (!m || !Array.isArray(m.data) || m.data.length !== 1) {
      throw new Error('non è un pacchetto standard (manca "meta"): crealo dalla sezione Impacchetta a partire dai file grezzi');
    }
    let j;
    try { j = JSON.parse(m.data[0]); } catch { throw new Error('"meta" non è JSON valido'); }
    if (j.formato !== FORMATO) throw new Error(`formato "${j.formato}" sconosciuto: atteso "${FORMATO}"`);
    if (j.versione !== VERSIONE) throw new Error(`versione ${j.versione} del formato non supportata (questa pagina legge la ${VERSIONE})`);
    if (!j.misura) throw new Error('"meta" senza nome della misura');
    if (!['friis', 'nessuno'].includes(j.modello)) throw new Error(`modello "${j.modello}" sconosciuto: atteso "friis" o "nessuno"`);
    if (j.modello === 'friis' && !(j.distanza_m > 0)) throw new Error('modello Friis senza distanza_m valida');
    return j;
  }

  function crescente(a, nome) {
    for (let i = 1; i < a.length; i++) if (!(a[i] > a[i - 1])) throw new Error(`${nome} non strettamente crescenti`);
  }

  function costruisci(arr) {
    const meta = leggiMeta(arr);
    for (const k of ['frequenze', 'angoli', ...PARAM_S]) if (!arr[k]) throw new Error(`manca l'array ${k}`);
    const f = Float64Array.from(arr.frequenze.data, Number), ang = Float64Array.from(arr.angoli.data, Number);
    crescente(f, 'frequenze');
    crescente(ang, 'angoli');
    const nF = f.length, nA = ang.length, S = {};
    for (const k of PARAM_S) {
      const a = arr[k];
      if (!a.complesso) throw new Error(`${k} non è complesso (${a.dtype})`);
      if (a.shape.length !== 2 || a.shape[0] !== nA || a.shape[1] !== nF) {
        throw new Error(`${k} ha forma (${a.shape}), attesa (${nA}, ${nF})`);
      }
      S[k] = Float64Array.from(a.fortran ? trasponi(a.data, nF, nA) : a.data);
    }
    return {
      id: meta.misura, nome: meta.misura, camp: '',
      ang, giro: giroCompleto(ang), f, nA, nF, S, meta,
      dist: meta.modello === 'friis' ? meta.distanza_m : null,
      cache: {},
    };
  }

  /** Il taglio copre tutto il giro (es. −180…180 o 0…359): gli estremi sono adiacenti. */
  function giroCompleto(ang) {
    const n = ang.length;
    if (n < 3) return false;
    const passo = (ang[n - 1] - ang[0]) / (n - 1);
    return ang[n - 1] - ang[0] + passo >= 360 - 1e-6;
  }

  /** Da (righe × colonne) = (nR × nC) complesso interlacciato a (nC × nR). */
  function trasponi(d, nR, nC) {
    const out = new d.constructor(d.length);
    for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
      out[(c * nR + r) * 2] = d[(r * nC + c) * 2];
      out[(c * nR + r) * 2 + 1] = d[(r * nC + c) * 2 + 1];
    }
    return out;
  }

  /* ---------- grandezze derivate (in cache per misura) ---------- */

  function modulo(m, nome) {
    const key = `|${nome}|`;
    if (m.cache[key]) return m.cache[key];
    const n = m.nA * m.nF, out = new Float64Array(n);
    if (nome === 'media') {
      const a = m.S.S12, b = m.S.S21;
      for (let j = 0; j < n; j++) out[j] = Math.hypot((a[2 * j] + b[2 * j]) / 2, (a[2 * j + 1] + b[2 * j + 1]) / 2);
    } else {
      const s = m.S[nome];
      for (let j = 0; j < n; j++) out[j] = Math.hypot(s[2 * j], s[2 * j + 1]);
    }
    return (m.cache[key] = out);
  }

  /** Angolo di allineamento: le due antenne sono affacciate dove la potenza ricevuta
      |S|² mediata su tutta la banda è massima. È un angolo meccanico, quindi uno solo
      per tutte le frequenze. Per controllo si riporta anche il picco frequenza per frequenza
      (se si sposta molto, il lobo "strabuzza" in frequenza o il picco cade nel rumore). */
  function allineamento(m, param) {
    const key = `A|${param}`;
    if (m.cache[key]) return m.cache[key];
    const T = modulo(m, param);
    let i0 = -1, best = -Infinity;
    for (let i = 0; i < m.nA; i++) {
      let s = 0, c = 0;
      for (let k = 0; k < m.nF; k++) { const v = T[i * m.nF + k]; if (isFinite(v)) { s += v * v; c++; } }
      if (c && s / c > best) { best = s / c; i0 = i; }
    }
    const perF = Array.from({ length: m.nF }, (_, k) => {
      let im = -1, vm = -Infinity;
      for (let i = 0; i < m.nA; i++) { const v = T[i * m.nF + k]; if (v > vm) { vm = v; im = i; } }
      return im < 0 ? NaN : m.ang[im];
    });
    const ok = perF.filter(isFinite).sort((p, q) => p - q);
    return (m.cache[key] = {
      i0, a0: i0 < 0 ? NaN : m.ang[i0], perF,
      min: ok[0], max: ok[ok.length - 1], mediana: ok[Math.floor(ok.length / 2)],
    });
  }

  /** Senza modello: |S| grezzo in dB. Con Friis (AUT sul turntable, riferimento identico fisso):
      all'allineamento θ0 vale Friis per due antenne uguali, G(θ0) = |S(θ0)| · 4πR f / c;
      ruotando, la potenza ricevuta segue G(θ) · G(θ0), quindi la forma è |S|²:
        G(θ) [dBi] = 10·log10(G(θ0)) + 20·log10(|S(θ)| / |S(θ0)|)
      Float64Array (nA · nF). */
  function gainDb(m, param) {
    const key = `G|${param}|${m.dist}`;
    if (m.cache[key]) return m.cache[key];
    const T = modulo(m, param), out = new Float64Array(T.length);
    const db20 = v => v > 0 ? 20 * Math.log10(v) : NaN;
    if (m.dist == null) {
      for (let j = 0; j < T.length; j++) out[j] = db20(T[j]);
      return (m.cache[key] = out);
    }
    const { i0 } = allineamento(m, param);
    for (let k = 0; k < m.nF; k++) {
      let ref = i0 >= 0 ? T[i0 * m.nF + k] : NaN;
      if (!(ref > 0)) {                       // θ0 non misurato a questa frequenza: picco locale
        ref = -Infinity;
        for (let i = 0; i < m.nA; i++) { const v = T[i * m.nF + k]; if (v > ref) ref = v; }
      }
      const gRef = 10 * Math.log10(ref * 4 * Math.PI * m.dist * m.f[k] / C0);
      for (let i = 0; i < m.nA; i++) out[i * m.nF + k] = gRef + db20(T[i * m.nF + k] / ref);
    }
    return (m.cache[key] = out);
  }

  const taglio = (m, G, k) => Float64Array.from({ length: m.nA }, (_, i) => G[i * m.nF + k]);
  const colonna = (m, G, i) => G.subarray(i * m.nF, (i + 1) * m.nF);

  /** z[k][i] per le mappe Plotly (righe = frequenze). */
  function matrice(m, G) {
    return Array.from({ length: m.nF }, (_, k) => Array.from({ length: m.nA }, (_, i) => G[i * m.nF + k]));
  }

  function vicino(arr, v) {
    let best = 0, d = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const e = Math.abs(arr[i] - v);
      if (e < d) { d = e; best = i; }
    }
    return best;
  }

  function nanMax(a) {
    let m = -Infinity, im = -1;
    for (let i = 0; i < a.length; i++) if (a[i] > m) { m = a[i]; im = i; }
    return [m, im];
  }

  /* =========================================================
     ANALISI (porting di analisi.py)
     ========================================================= */

  /** HPBW con interpolazione lineare dei due attraversamenti a −3 dB; null se non raggiunto.
      Se il taglio copre tutto il giro si prosegue oltre l'estremo (359° → 0°), srotolando l'angolo. */
  function hpbw(ang, g, giro) {
    const [gm, i0] = nanMax(g);
    if (i0 < 0) return null;
    const n = g.length, liv = gm - 3, lati = [];
    for (const passo of [-1, 1]) {
      let i = i0, a = ang[i0], trovato = null;
      for (let s = 0; s < n; s++) {
        let j = i + passo;
        if (j < 0 || j >= n) {
          if (!giro) break;
          j = (j + n) % n;
        }
        if (!isFinite(g[j])) break;
        let da = ang[j] - ang[i];
        if (passo > 0 && da < 0) da += 360;
        if (passo < 0 && da > 0) da -= 360;
        if (g[j] < liv) {
          trovato = a + (liv - g[i]) * da / (g[j] - g[i]);
          break;
        }
        i = j; a += da;
      }
      if (trovato === null) return null;
      lati.push(trovato);
    }
    return lati[1] - lati[0];
  }

  function metriche(ang, g, giro) {
    const [gm, i0] = nanMax(g);
    if (i0 < 0) return { gmax: NaN, amax: NaN, hpbw: null, fb: null };
    const a0 = ang[i0];
    let j = 0, dj = Infinity;
    for (let i = 0; i < ang.length; i++) {
      const d = Math.abs((((ang[i] - a0) % 360) + 360) % 360 - 180);
      if (d < dj) { dj = d; j = i; }
    }
    // la direzione opposta deve cadere sulla griglia: tolleranza di mezzo passo locale
    const passo = Math.max(j > 0 ? ang[j] - ang[j - 1] : 0, j < ang.length - 1 ? ang[j + 1] - ang[j] : 0);
    const fb = dj <= Math.max(0.51, passo / 2 + 1e-9) && isFinite(g[j]) ? gm - g[j] : null;
    return { gmax: gm, amax: a0, hpbw: hpbw(ang, g, giro), fb };
  }

  /** Metriche per ogni frequenza (per i grafici G max e HPBW vs f). */
  function metrichePerFreq(m, param) {
    const key = `M|${param}|${m.dist}`;
    if (m.cache[key]) return m.cache[key];
    const G = gainDb(m, param), gmax = [], hp = [];
    for (let k = 0; k < m.nF; k++) {
      const r = metriche(m.ang, taglio(m, G, k), m.giro);
      gmax.push(r.gmax);
      hp.push(r.hpbw ?? NaN);
    }
    return (m.cache[key] = { gmax, hp });
  }

  const ha = (m, nome) => nome === 'media' ? !!(m.S.S12 && m.S.S21) : !!m.S[nome];

  /** Controlli fisici. Quelli che richiedono un parametro assente nel file non vengono
      eseguiti e sono elencati a parte (non contano né come superati né come violati). */
  function audit(m) {
    if (m.cache.audit) return m.cache.audit;
    const n = m.nA * m.nF;
    const A = {};
    for (const k of PARAM_S) if (m.S[k]) A[k] = modulo(m, k);
    const { S12: s12, S21: s21 } = m.S;
    const t = fmt(TOL_PASS, 2), r = fmt(TOL_REC, 2);
    const tutte = [
      [`|S11| > ${t}`, ['S11'], j => A.S11[j] > TOL_PASS],
      [`|S22| > ${t}`, ['S22'], j => A.S22[j] > TOL_PASS],
      [`|S21| > ${t}`, ['S21'], j => A.S21[j] > TOL_PASS],
      [`|S12| > ${t}`, ['S12'], j => A.S12[j] > TOL_PASS],
      [`|S11|² + |S21|² > ${t}`, ['S11', 'S21'], j => A.S11[j] ** 2 + A.S21[j] ** 2 > TOL_PASS],
      [`|S22|² + |S12|² > ${t}`, ['S22', 'S12'], j => A.S22[j] ** 2 + A.S12[j] ** 2 > TOL_PASS],
      [`| |S12| − |S21| | > ${r}`, ['S12', 'S21'], j => Math.abs(A.S12[j] - A.S21[j]) > TOL_REC],
      [`|S12 − S21| > ${r} (complessa)`, ['S12', 'S21'], j => Math.hypot(s12[2 * j] - s21[2 * j], s12[2 * j + 1] - s21[2 * j + 1]) > TOL_REC],
    ];
    const voci = tutte.filter(([, req]) => req.every(k => m.S[k]));
    const saltati = tutte.filter(([, req]) => !req.every(k => m.S[k])).map(([nome, req]) => ({ nome, manca: req.filter(k => !m.S[k]) }));
    const presenti = Object.keys(A);
    voci.push(['punti mancanti (NaN)', presenti, j => presenti.some(k => isNaN(A[k][j]))]);

    const mappa = new Uint8Array(n), conta = voci.map(() => 0);
    let nmax = 0;
    for (let j = 0; j < n; j++) {
      for (let v = 0; v < voci.length; v++) if (voci[v][2](j)) { conta[v]++; mappa[j]++; }
      if (mappa[j] > nmax) nmax = mappa[j];
    }

    // parametri S identici bit per bit: quasi sempre un errore nel salvataggio
    const doppi = [];
    for (let p = 0; p < presenti.length; p++) for (let q = p + 1; q < presenti.length; q++) {
      const X = m.S[presenti[p]], Y = m.S[presenti[q]];
      let uguali = true;
      for (let j = 0; j < X.length && uguali; j++) uguali = X[j] === Y[j] || (isNaN(X[j]) && isNaN(Y[j]));
      if (uguali) doppi.push(`${presenti[p]} = ${presenti[q]}`);
    }

    const totale = conta.reduce((a, c) => a + c, 0);
    return (m.cache.audit = {
      righe: voci.map(([nome], v) => ({ nome, n: conta[v] })),
      saltati, mappa, nmax, totale, doppi, ok: totale === 0 && !doppi.length,
    });
  }

  const compatibili = (a, b) => a.nA === b.nA && a.nF === b.nF
    && a.ang.every((x, i) => Math.abs(x - b.ang[i]) < 1e-3)
    && a.f.every((x, i) => Math.abs(x - b.f[i]) <= 1e-6 * Math.abs(x));

  function confronta(a, b, param, maschera, split) {
    const ga = gainDb(a, param), gb = gainDb(b, param);
    const [pa] = nanMax(ga), [pb] = nanMax(gb);
    const n = ga.length, dd = new Float64Array(n), dl = new Float64Array(n), ds = new Float64Array(n);
    let picco = 0;
    for (let j = 0; j < n; j++) picco = Math.max(picco, 10 ** (ga[j] / 10) || 0, 10 ** (gb[j] / 10) || 0);
    for (let j = 0; j < n; j++) {
      const rumore = maschera != null && ga[j] < pa + maschera && gb[j] < pb + maschera;
      dd[j] = rumore ? NaN : ga[j] - gb[j];
      ds[j] = rumore ? NaN : 10 ** (ga[j] / 10) - 10 ** (gb[j] / 10);
      dl[j] = Math.abs(ds[j]);
    }
    const stats = sel => {
      let s = 0, sa = 0, sq = 0, mx = 0, l = 0, lmx = 0, c = 0;
      for (let i = 0; i < a.nA; i++) for (let k = 0; k < a.nF; k++) {
        if (!sel(k)) continue;
        const j = i * a.nF + k, d = dd[j];
        if (!isFinite(d)) continue;
        s += d; sa += Math.abs(d); sq += d * d; mx = Math.max(mx, Math.abs(d));
        l += dl[j]; lmx = Math.max(lmx, dl[j]); c++;
      }
      return c ? [s / c, sa / c, Math.sqrt(sq / c), mx, l / c / picco * 100, lmx / picco * 100, c] : null;
    };
    const bande = [['intera banda', () => true]];
    if (split != null && isFinite(split)) {
      const fa = fv(a);
      bande.push([`f ≤ ${fF(split)}`, k => fa[k] <= split], [`f > ${fF(split)}`, k => fa[k] > split]);
    }
    return { dd, ds, righe: bande.map(([nome, sel]) => [nome, stats(sel)]).filter(r => r[1]) };
  }

  /** Interpolazione lineare su griglia crescente; NaN fuori dal range misurato. */
  function interp(ang, val, q) {
    const n = ang.length;
    if (!n || q < ang[0] - 1e-9 || q > ang[n - 1] + 1e-9) return NaN;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ang[mid] <= q) lo = mid; else hi = mid; }
    if (hi === lo) return val[lo];
    const t = (q - ang[lo]) / (ang[hi] - ang[lo]);
    return val[lo] + t * (val[hi] - val[lo]);
  }

  /** Taglio pronto per l'interpolazione: lineare, angoli riportati in [−180, 180),
      senza NaN (come np.interp su valori finiti), ordinato; se copre il giro, chiuso
      con una copia degli estremi spostata di ±360° così 179° e −180° sono vicini. */
  function preparaTaglio(ang, gDb, giro) {
    const punti = [];
    for (let i = 0; i < ang.length; i++) {
      if (!isFinite(gDb[i])) continue;
      punti.push([((ang[i] + 180) % 360 + 360) % 360 - 180, 10 ** (gDb[i] / 10)]);
    }
    punti.sort((p, q) => p[0] - q[0]);
    const uniche = punti.filter((p, i) => i === 0 || p[0] - punti[i - 1][0] > 1e-9);
    if (giro && uniche.length > 1) {
      const [a0, v0] = uniche[0], [a1, v1] = uniche[uniche.length - 1];
      uniche.unshift([a1 - 360, v1]);
      uniche.push([a0 + 360, v0]);
    }
    return { a: uniche.map(p => p[0]), v: uniche.map(p => p[1]) };
  }

  /** G(θ,φ) = G_A(±θ)·cos²φ + G_B(±θ)·sin²φ (lineare), senza estrapolare. */
  function lobo(A, B, usaDb, floor, nT, nP) {
    const X = [], Y = [], Z = [], col = [];
    const G = [];
    let gmax = -Infinity, fin = 0, rmax = 0;
    for (let p = 0; p < nP; p++) {
      const ph = 2 * Math.PI * p / (nP - 1), c2 = Math.cos(ph) ** 2, s2 = Math.sin(ph) ** 2;
      const riga = [];
      for (let t = 0; t < nT; t++) {
        const th = 180 * t / (nT - 1);
        const ga = c2 < 1e-12 ? 0 : interp(A.a, A.v, Math.cos(ph) >= 0 ? th : -th);
        const gb = s2 < 1e-12 ? 0 : interp(B.a, B.v, Math.sin(ph) >= 0 ? th : -th);
        const g = ga * c2 + gb * s2;
        riga.push(g);
        if (isFinite(g)) { fin++; if (g > gmax) gmax = g; }
      }
      G.push(riga);
    }
    const gmaxDb = 10 * Math.log10(gmax);
    for (let p = 0; p < nP; p++) {
      const ph = 2 * Math.PI * p / (nP - 1), x = [], y = [], z = [], c = [];
      for (let t = 0; t < nT; t++) {
        const th = Math.PI * t / (nT - 1), g = G[p][t];
        const gdb = g > 0 ? 10 * Math.log10(g) : NaN;
        let r = usaDb ? Math.max(gdb - gmaxDb - floor, 0) : g;
        if (!isFinite(g)) r = NaN;
        if (r > rmax) rmax = r;
        x.push(r * Math.sin(th) * Math.cos(ph));
        y.push(r * Math.sin(th) * Math.sin(ph));
        z.push(r * Math.cos(th));
        c.push(usaDb ? gdb : g);
      }
      X.push(x); Y.push(y); Z.push(z); col.push(c);
    }
    return { X, Y, Z, col, rmax, copertura: fin / (nT * nP) * 100 };
  }

  /* =========================================================
     STATO
     ========================================================= */
  const st = {
    cur: null, param: 'S21', fi: 0, ai: 0, floor: -30, norm: true,
    tab: 'mappa', sovr: new Set(), play: null, vel: 90,
    scala: 'db', cfScala: 'db', b: null, mask: -30, split: null,
    la: null, lb: null, loboDb: true,
  };
  const cur = () => misure.get(st.cur);

  /* unità e decimali di visualizzazione, dedotti dalla misura corrente:
     unità dalla frequenza massima, decimali dal passo più piccolo della griglia */
  let UF = { u: 'GHz', div: 1e9, d: 2 }, UA = { d: 0 };
  function passoMin(a) {
    let p = Infinity;
    for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] > 0) p = Math.min(p, a[i] - a[i - 1]);
    return p;
  }
  function scale(m) {
    const fmax = Math.abs(m.f[m.nF - 1]);
    const [u, div] = fmax >= 1e9 ? ['GHz', 1e9] : fmax >= 1e6 ? ['MHz', 1e6] : fmax >= 1e3 ? ['kHz', 1e3] : ['Hz', 1];
    const pf = passoMin(m.f) / div;
    UF = { u, div, d: isFinite(pf) ? Math.min(6, Math.max(2, Math.ceil(-Math.log10(pf) - 1e-9))) : 2 };
    const pa = passoMin(m.ang), interi = m.ang.every(Number.isInteger);
    UA = { d: interi || !isFinite(pa) ? 0 : Math.min(3, Math.max(1, Math.ceil(-Math.log10(pa) - 1e-9))) };
  }
  /** frequenze della misura nell'unità di visualizzazione corrente */
  function fv(m) {
    const key = `fv|${UF.u}`;
    return m.cache[key] || (m.cache[key] = m.f.map(x => x / UF.div));
  }
  const fF = (v, unita = true) => fmt(v, UF.d) + (unita ? ` ${UF.u}` : '');
  const fA = v => isFinite(v) ? `${fmt(v, UA.d)}°` : '—';
  const hovF = v => `%{${v}:.${UF.d}f} ${UF.u}`;
  const hovA = v => `%{${v}:.${UA.d}f}°`;

  /* grandezza mostrata: guadagno (Friis) o |S| grezzo */
  const friis = m => m.dist != null;
  const UG = () => friis(cur()) ? 'dBi' : 'dB';
  const NG = () => friis(cur()) ? 'G' : `|${st.param === 'media' ? 'S̄' : st.param}|`;
  const stessoModello = m => friis(m) === friis(cur());

  const fSel = () => fv(cur())[st.fi];
  const aSel = () => cur().ang[st.ai];

  /* =========================================================
     PLOTLY: tema comune
     ========================================================= */
  const FONT = 'Inter, system-ui, sans-serif', MONO = 'JetBrains Mono, ui-monospace, monospace';
  const CONFIG = {
    responsive: true, displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
    toImageButtonOptions: { format: 'png', scale: 2 },
  };
  const asse = (titolo, extra = {}) => ({
    title: { text: titolo, font: { size: 12, color: DIM }, standoff: 8 },
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
  const colorbar = titolo => ({
    title: { text: titolo, side: 'right', font: { size: 12, color: DIM } },
    thickness: 10, outlinewidth: 0, tickfont: { family: MONO, size: 11, color: FAINT },
  });
  function disegna(id, dati, lay) {
    const el = $(id);
    if (el.querySelector('.pl-empty')) el.innerHTML = '';
    return Plotly.react(el, dati, lay, CONFIG);
  }
  /** Al posto del grafico, un messaggio (dati assenti o tutti NaN). */
  function vuoto(id, msg) {
    const el = $(id);
    Plotly.purge(el);
    el._clic = false;
    el.innerHTML = msg ? `<p class="pl-empty">${esc(msg)}</p>` : '';
  }
  /** La frequenza fs (unità di visualizzazione) cade nella banda misurata di m? */
  function copre(m, fs) {
    const f = fv(m), mezzo = m.nF > 1 ? (f[m.nF - 1] - f[0]) / (m.nF - 1) / 2 : 0;
    return fs >= f[0] - mezzo - 1e-12 && fs <= f[m.nF - 1] + mezzo + 1e-12;
  }

  /* colore per misura: la corrente ha sempre la prima tinta, le sovrapposte le
     successive nell'ordine in cui sono state scelte (al più 4, mai tinte riciclate);
     togliendone una le altre non cambiano colore */
  const MAX_SOVR = SERIE.length - 1;
  const coloriSovr = new Map();
  function colore(id) {
    if (id === st.cur) return SERIE[0];
    return coloriSovr.get(id) || 'transparent';
  }
  function assegnaColore(id) {
    const usati = new Set(coloriSovr.values());
    const libero = SERIE.slice(1).find(c => !usati.has(c));
    if (libero) coloriSovr.set(id, libero);
  }
  const etichetta = m => m.camp ? `${m.camp} · ${m.nome}` : m.nome;
  const inPrimoPiano = () => [st.cur, ...[...st.sovr].filter(id => id !== st.cur && misure.has(id) && ha(misure.get(id), st.param) && stessoModello(misure.get(id)))].map(id => misure.get(id));
  const sovr = (id, on) => {
    if (on && st.sovr.size < MAX_SOVR) { st.sovr.add(id); assegnaColore(id); }
    else if (!on) { st.sovr.delete(id); coloriSovr.delete(id); }
  };

  /* =========================================================
     VISTE
     ========================================================= */

  function vistaPolare() {
    const fs = fSel(), tutte = inPrimoPiano();
    // le sovrapposte che non coprono questa frequenza si escludono invece di mostrare un'altra frequenza
    const lista = tutte.filter((m, n) => !n || copre(m, fs));
    const fuori = tutte.length - lista.length;
    const tagli = lista.map(m => {
      const k = vicino(fv(m), fs), g = taglio(m, gainDb(m, st.param), k);
      const [gm] = nanMax(g);
      return { m, k, g, v: st.norm ? g.map(x => x - gm) : g };
    });
    const top = Math.max(...tagli.map(t => nanMax(t.v)[0]));
    if (!isFinite(top)) {
      vuoto('p-polare', `Nessun valore valido di ${st.param} a questa frequenza.`);
      $('m-polare').textContent = fF(fs);
      return;
    }
    const rMax = st.norm ? 0 : Math.ceil(top / 5) * 5;
    const rMin = st.norm ? st.floor : rMax + st.floor;
    const u = st.norm ? 'dB' : UG();

    const tracce = tagli.map((t, n) => ({
      type: 'scatterpolar', mode: 'lines', name: etichetta(t.m),
      theta: Array.from(t.m.ang), r: t.v.map(x => isFinite(x) ? Math.max(x, rMin) : null),
      customdata: Array.from(t.v), connectgaps: false,
      line: { color: colore(t.m.id), width: n ? 1.6 : 2.2 },
      fill: n ? 'none' : 'toself', fillcolor: rgba(colore(t.m.id), 0.08),
      hovertemplate: `${hovA('theta')} · %{customdata:.2f} ${u}<extra>${etichetta(t.m)}</extra>`,
    }));
    const t0 = tagli[0], v0 = t0.v[st.ai];
    if (isFinite(v0)) {
      tracce.push({
        type: 'scatterpolar', mode: 'markers', theta: [aSel()], r: [Math.max(v0, rMin)],
        marker: { size: 9, color: SERIE[0], line: { color: '#07080a', width: 2 } },
        hovertemplate: `angolo scelto · ${hovA('theta')} · ${fmt(v0)} ${u}<extra></extra>`, showlegend: false,
      });
    }

    disegna('p-polare', tracce, layout({
      showlegend: lista.length > 1,
      margin: { l: 40, r: 40, t: lista.length > 1 ? 40 : 24, b: 24 },
      uirevision: 'polare',
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
          dtick: rMax - rMin > 15 ? 10 : 5, ticksuffix: ` ${u}`, tickfont: { family: MONO, size: 10, color: FAINT },
        },
      },
    }));
    const extra = tagli.slice(1).filter(t => Math.abs(fv(t.m)[t.k] - fs) > 1e-9 * Math.max(1, Math.abs(fs))).length;
    $('m-polare').textContent = `${fF(fs)} · ${st.norm ? 'normalizzato' : `${NG()} [${UG()}]`}`
      + (extra ? ` · ${extra === 1 ? '1 sovrapposta' : `${extra} sovrapposte`} alla frequenza più vicina` : '')
      + (fuori ? ` · ${fuori === 1 ? '1 sovrapposta esclusa' : `${fuori} sovrapposte escluse`}: fuori banda` : '');
  }

  function vistaMappa() {
    const m = cur(), G = gainDb(m, st.param);
    const key = `Z|${st.param}|${m.dist}`;
    const zDb = m.cache[key] || (m.cache[key] = matrice(m, G));
    const [gm] = nanMax(G);
    if (!isFinite(gm)) return vuoto('p-mappa', `Nessun valore valido di ${st.param} in tutta la misura.`);

    // dB: dal pavimento relativo al picco; lineare: in potenza, 10^(dB/10), da 0 al picco
    const lin = st.scala === 'lin';
    const kLin = `${key}|lin`;
    const z = !lin ? zDb : (m.cache[kLin] || (m.cache[kLin] = zDb.map(r => r.map(v => 10 ** (v / 10)))));
    const zmax = lin ? 10 ** (gm / 10) : gm;
    const zmin = lin ? 0 : gm + st.floor;
    const u = lin ? `${NG()} lineare` : `${NG()} [${UG()}]`;
    const hov = hovA('x') + ' · ' + hovF('y') + '<br>' + (lin ? '%{z:.3g}' : `%{z:.2f} ${UG()}`) + '<extra></extra>';

    disegna('p-mappa', [{
      type: 'surface', x: Array.from(m.ang), y: Array.from(fv(m)),
      z: z.map(r => r.map(v => isFinite(v) ? Math.max(v, zmin) : null)),
      colorscale: SEQ, cmin: zmin, cmax: zmax, colorbar: colorbar(u), hovertemplate: hov,
      lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1, roughness: 0.7 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: `mappa3d|${m.id}`,
      scene: scena({ xaxis: { title: 'angolo [°]' }, yaxis: { title: `frequenza [${UF.u}]` }, zaxis: { title: u, range: [zmin, zmax] } },
        { aspectmode: 'manual', aspectratio: { x: 1.4, y: 1.4, z: 0.6 }, camera: { eye: { x: -1.5, y: -1.5, z: 0.9 } } }),
    }));
  }

  function scena(assi, extra) {
    const base = { backgroundcolor: 'rgba(0,0,0,0)', gridcolor: GRID, zerolinecolor: AXIS, linecolor: AXIS,
      color: DIM, tickfont: { family: MONO, size: 10, color: FAINT }, showspikes: false };
    const out = {};
    for (const [k, v] of Object.entries(assi)) out[k] = { ...base, ...v, title: { text: v.title, font: { size: 12, color: DIM } } };
    return { ...out, ...extra };
  }

  function vistaFreq() {
    // sovrapposte: solo quelle che hanno misurato quest'angolo (entro mezzo passo)
    const as = aSel();
    const lista = inPrimoPiano().filter((m, n) => {
      if (!n) return true;
      const i = vicino(m.ang, as), passo = m.nA > 1 ? passoMin(m.ang) : 0;
      return Math.abs(m.ang[i] - as) <= passo / 2 + 1e-9;
    });
    const more = lista.length > 1, fuori = inPrimoPiano().length - lista.length;
    const linee = (fn, u) => lista.map(m => ({
      type: 'scatter', mode: 'lines', name: etichetta(m), x: Array.from(fv(m)), y: fn(m),
      line: { color: colore(m.id), width: 2 }, connectgaps: false,
      hovertemplate: `%{y:.2f} ${u}<extra>${etichetta(m)}</extra>`,
    }));
    const vline = [{ type: 'line', xref: 'x', yref: 'paper', x0: fSel(), x1: fSel(), y0: 0, y1: 1,
      line: { color: 'rgba(233,234,238,0.45)', width: 1, dash: 'dot' } }];
    const base = (ytit, extra = {}) => layout({
      showlegend: more, hovermode: 'x unified', shapes: vline, uirevision: 'freq',
      margin: { l: 60, r: 20, t: more ? 34 : 14, b: 44 },
      xaxis: asse(`frequenza [${UF.u}]`, { hoverformat: `.${UF.d}f` }), yaxis: asse(ytit), ...extra,
    });

    disegna('p-freq', linee(m => Array.from(colonna(m, gainDb(m, st.param), vicino(m.ang, as))), UG()), base(`${NG()} [${UG()}]`));
    disegna('p-gmax', linee(m => metrichePerFreq(m, st.param).gmax, UG()), base(`${NG()} max [${UG()}]`, { showlegend: false, margin: { l: 60, r: 20, t: 14, b: 44 } }));
    disegna('p-hpbw', linee(m => metrichePerFreq(m, st.param).hp, '°'), base('HPBW [°]', { showlegend: false, margin: { l: 60, r: 20, t: 14, b: 44 } }));
    $('m-freq').textContent = `all'angolo ${fA(as)}` + (more ? ' (o al più vicino)' : '')
      + (fuori ? ` · ${fuori} sovrapposte senza quest'angolo` : '');
  }

  function vistaConfronto() {
    const m = cur();
    const opz = [...misure.values()].filter(x => x.id !== m.id && ha(x, st.param) && stessoModello(x) && compatibili(m, x));
    riempiSelect($('sel-b'), opz, st.b);
    if (!opz.length) {
      $('cf-empty').hidden = false; $('cf-plot').hidden = true; $('cf-ctl').hidden = true; $('cf-table').innerHTML = '';
      return;
    }
    if (!opz.some(x => x.id === st.b)) st.b = (opz.find(x => x.camp === m.camp) || opz[0]).id;
    $('sel-b').value = st.b;
    $('cf-empty').hidden = true; $('cf-plot').hidden = false; $('cf-ctl').hidden = false;

    const b = misure.get(st.b), r = confronta(m, b, st.param, st.mask, st.split);
    // dB: Δ = A − B in dB; lineare: Δ = A − B in potenza lineare. Scala simmetrica al 99° percentile
    const lin = st.cfScala === 'lin', d = lin ? r.ds : r.dd;
    const z = Array.from({ length: m.nF }, (_, k) => Array.from({ length: m.nA }, (_, i) => {
      const v = d[i * m.nF + k]; return isFinite(v) ? v : null;
    }));
    const abs = Array.from(d).filter(isFinite).map(Math.abs).sort((p, q) => p - q);
    const lim = abs.length ? Math.max(abs[Math.floor(abs.length * 0.99)] || 1e-12, lin ? 1e-12 : 0.5) : 1;
    const u = lin ? `Δ${NG()} lineare` : 'Δ [dB]';
    disegna('p-cf', [{
      type: 'surface', x: Array.from(m.ang), y: Array.from(fv(m)), z,
      surfacecolor: z, cmin: -lim, cmax: lim, colorscale: DIV, colorbar: colorbar(u),
      hovertemplate: hovA('x') + ' · ' + hovF('y') + '<br>' + (lin ? 'Δ = %{z:+.3g}' : 'Δ = %{z:+.2f} dB') + '<extra></extra>',
      lighting: { ambient: 0.8, diffuse: 0.45, specular: 0.05, roughness: 0.8 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: `cf|${m.id}`,
      scene: scena({ xaxis: { title: 'angolo [°]' }, yaxis: { title: `frequenza [${UF.u}]` }, zaxis: { title: u, range: [-lim * 1.05, lim * 1.05] } },
        { aspectmode: 'manual', aspectratio: { x: 1.4, y: 1.4, z: 0.6 }, camera: { eye: { x: -1.5, y: -1.5, z: 0.9 } } }),
    }));
    $('m-cf').textContent = `A = ${etichetta(m)} · B = ${etichetta(b)} · scala ±${lin ? lim.toPrecision(2).replace('.', ',') : fmt(lim, 1) + ' dB'} (99° percentile)`;

    const th = ['banda', 'Δ medio', '|Δ| medio', 'Δ RMS', '|Δ| max', `|Δ${NG()}| medio`, `|Δ${NG()}| max`, 'punti'];
    const un = ['', ' dB', ' dB', ' dB', ' dB', ' % picco', ' % picco', ''];
    $('cf-table').innerHTML = `<table class="dtab"><caption>Statistiche del confronto (punti di rumore esclusi)</caption>
      <thead><tr>${th.map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>${r.righe.map(([n, s]) =>
        `<tr><td>${n}</td>${s.map((v, i) => `<td>${i === 6 ? v.toLocaleString('it-IT') : (i === 0 && v > 0 ? '+' : '') + fmt(v, 2)}<span class="unit">${un[i + 1]}</span></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function vistaLobo() {
    const tutte = [...misure.values()];
    riempiSelect($('sel-la'), tutte, st.la);
    riempiSelect($('sel-lb'), tutte, st.lb, '— uguale al taglio a 0° (simmetria di rotazione) —');
    const A = misure.get(st.la) || cur(), B = misure.get(st.lb) || A;
    $('sel-la').value = A.id; $('sel-lb').value = st.lb && misure.has(st.lb) ? st.lb : '';
    if (!stessoModello(A) || !stessoModello(B)) {
      vuoto('p-lobo', 'I due tagli devono essere entrambi con Friis o entrambi senza.');
      $('m-lobo').textContent = '';
      return;
    }
    const senza = [A, B].filter(m => !ha(m, st.param)).map(etichetta);
    if (senza.length) {
      vuoto('p-lobo', `${[...new Set(senza)].join(' e ')}: ${st.param} assente nel file.`);
      $('m-lobo').textContent = '';
      return;
    }

    const fs = fSel(), kA = vicino(fv(A), fs), kB = vicino(fv(B), fs);
    const fuoriBanda = [A, B].filter(m => !copre(m, fs)).map(etichetta);
    if (fuoriBanda.length) {
      vuoto('p-lobo', `${[...new Set(fuoriBanda)].join(' e ')}: ${fF(fs)} è fuori dalla banda misurata.`);
      $('m-lobo').textContent = '';
      return;
    }
    const veloce = st.play !== null;
    const L = lobo(preparaTaglio(A.ang, taglio(A, gainDb(A, st.param), kA), A.giro),
      preparaTaglio(B.ang, taglio(B, gainDb(B, st.param), kB), B.giro),
      st.loboDb, st.floor, veloce ? 61 : 121, veloce ? 121 : 241);
    let cmax = -Infinity;
    for (const riga of L.col) for (const v of riga) if (v > cmax) cmax = v;
    if (!isFinite(cmax)) {
      vuoto('p-lobo', `Nessun valore valido di ${st.param} a questa frequenza.`);
      $('m-lobo').textContent = '';
      return;
    }
    const cmin = st.loboDb ? cmax + st.floor : 0;
    const R = (L.rmax || 1) * 1.05;
    const asseL = t => ({ title: t, showticklabels: false, range: [-R, R] });

    disegna('p-lobo', [{
      type: 'surface', x: L.X, y: L.Y, z: L.Z, surfacecolor: L.col, colorscale: SEQ, cmin, cmax,
      colorbar: colorbar(st.loboDb ? `${NG()} [${UG()}]` : `${NG()} lineare`),
      hovertemplate: `%{surfacecolor:.2f} ${st.loboDb ? UG() : ''}<extra></extra>`,
      lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1, roughness: 0.7 },
    }], layout({
      margin: { l: 0, r: 0, t: 0, b: 0 }, uirevision: 'lobo',
      scene: scena({ xaxis: asseL('x · φ = 0°'), yaxis: asseL('y · φ = 90°'), zaxis: asseL('z · boresight') },
        { aspectmode: 'cube', camera: { eye: { x: 1.4, y: 1.4, z: 0.8 } } }),
    }));
    const fB = fv(B)[kB], diversa = Math.abs(fB - fv(A)[kA]) > 1e-9 * Math.abs(fB);
    $('m-lobo').textContent = `${fF(fv(A)[kA])} · copertura ${fmt(L.copertura, 0)} % delle direzioni`
      + (A === B ? ' · un solo taglio' : diversa ? ` · taglio a 90° a ${fF(fB)} (frequenza più vicina)` : '');
  }

  function vistaRifl() {
    const m = cur(), i = st.ai, soglia = -10;
    const db = nome => { const a = modulo(m, nome); return Array.from({ length: m.nF }, (_, k) => 20 * Math.log10(a[i * m.nF + k])); };
    const perc = nome => {
      const a = modulo(m, nome);
      return Array.from({ length: m.nF }, (_, k) => {
        let ok = 0, c = 0;
        for (let r = 0; r < m.nA; r++) { const v = a[r * m.nF + k]; if (isFinite(v)) { c++; if (20 * Math.log10(v) <= soglia) ok++; } }
        return c ? ok / c * 100 : NaN;
      });
    };
    const lin = (nome, y, n, u) => ({ type: 'scatter', mode: 'lines', name: nome, x: Array.from(fv(m)), y,
      line: { color: SERIE[n], width: 2 }, hovertemplate: `%{y:.2f} ${u}<extra>${nome}</extra>` });
    const base = (yt, extra = {}) => layout({
      showlegend: true, hovermode: 'x unified', uirevision: 'rifl', margin: { l: 60, r: 20, t: 34, b: 44 },
      xaxis: asse(`frequenza [${UF.u}]`, { hoverformat: `.${UF.d}f` }), yaxis: asse(yt), ...extra,
    });
    const hl = y => ({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: y, y1: y, line: { color: 'rgba(245,165,36,0.6)', width: 1, dash: 'dash' } });
    // colore fisso per parametro (S11 prima tinta, S22 seconda) anche se uno dei due manca
    const presenti = [['S11', 0], ['S22', 1]].filter(([k]) => ha(m, k));
    if (!presenti.length) {
      vuoto('p-rifl', 'Il file non contiene S11 né S22.');
      vuoto('p-rifl2', '');
      $('m-rifl').textContent = $('m-rifl2').textContent = '';
      return;
    }
    disegna('p-rifl', presenti.map(([k, n]) => lin(`|${k}|`, db(k), n, 'dB')), base('|S| [dB]', { shapes: [hl(soglia)] }));
    const pc = presenti.map(([k, n]) => [k, n, perc(k)]);
    disegna('p-rifl2', pc.map(([k, n, y]) => lin(k, y, n, '%')), base('angoli adattati [%]', { yaxis: asse('angoli adattati [%]', { range: [0, 101] }) }));
    const media = a => a.filter(isFinite).reduce((s, v) => s + v, 0) / a.filter(isFinite).length;
    $('m-rifl').textContent = `angolo ${fA(aSel())} · soglia ${soglia} dB tratteggiata`;
    $('m-rifl2').textContent = `media su tutta la griglia: ${pc.map(([k, , y]) => `${k} ${fmt(media(y), 0)} %`).join(' · ')}`
      + (presenti.length < 2 ? ` · ${presenti[0][0] === 'S11' ? 'S22' : 'S11'} assente nel file` : '');
  }

  function vistaAudit() {
    const m = cur(), a = audit(m), tot = m.nA * m.nF;
    const righe = a.righe.map(r => `<tr><td>${r.nome}</td><td>${r.n.toLocaleString('it-IT')}</td><td>${fmt(r.n / tot * 100, 2)}<span class="unit">%</span></td><td class="${r.n ? 'ko' : 'ok'}">${r.n ? 'violato' : 'ok'}</td></tr>`);
    for (const x of a.saltati) righe.push(`<tr><td>${x.nome}</td><td>—</td><td></td><td class="skip">non verificabile: manca ${x.manca.join(', ')}</td></tr>`);
    righe.push(`<tr><td>parametri S identici bit per bit</td><td>${a.doppi.length ? a.doppi.join(', ') : '—'}</td><td></td><td class="${a.doppi.length ? 'ko' : 'ok'}">${a.doppi.length ? 'sospetto' : 'ok'}</td></tr>`);
    $('au-table').innerHTML = `<table class="dtab"><caption>Controlli su ${tot.toLocaleString('it-IT')} punti (${m.nA} angoli × ${m.nF} frequenze)</caption>
      <thead><tr><th>controllo</th><th>punti</th><th>quota</th><th>esito</th></tr></thead><tbody>${righe.join('')}</tbody></table>`;

    const nmax = Math.max(1, a.nmax);
    const z = Array.from({ length: m.nF }, (_, k) => Array.from({ length: m.nA }, (_, i) => a.mappa[i * m.nF + k]));
    const s = 0.5 / (nmax + 0.5);
    disegna('p-audit', [{
      type: 'heatmap', x: Array.from(m.ang), y: Array.from(fv(m)), z, zmin: 0, zmax: nmax + 0.5,
      colorscale: [[0, OK_T], [s, OK_T], [s + 1e-6, KO_T], [1, KO]],
      colorbar: { ...colorbar('controlli violati'), tickvals: [...Array(nmax + 1).keys()] },
      hovertemplate: hovA('x') + ' · ' + hovF('y') + '<br>' + '%{z} controlli violati<extra></extra>',
    }], layout({ uirevision: `audit|${m.id}`, xaxis: asse('angolo [°]'), yaxis: asse(`frequenza [${UF.u}]`) }));
  }

  const VISTE = { polare: vistaPolare, mappa: vistaMappa, freq: vistaFreq, confronto: vistaConfronto, lobo: vistaLobo, rifl: vistaRifl, audit: vistaAudit };

  /* =========================================================
     INDICATORI E INTESTAZIONE
     ========================================================= */
  function indicatori() {
    const m = cur(), r = metriche(m.ang, taglio(m, gainDb(m, st.param), st.fi), m.giro);
    $('st-g-label').textContent = friis(m) ? 'Guadagno max' : `${NG()} max`;
    $('st-g').innerHTML = isFinite(r.gmax) ? `${fmt(r.gmax, 2)}<small>${UG()}</small>` : '—';
    $('st-g-sub').textContent = `a ${fA(r.amax)} · ${fF(fSel())}`;
    $('st-hpbw').innerHTML = r.hpbw != null ? `${fmt(r.hpbw, 1)}<small>°</small>` : '—';
    $('st-fb').innerHTML = r.fb != null ? `${fmt(r.fb, 1)}<small>dB</small>` : '—';
    $('st-fb-sub').textContent = r.fb != null ? 'picco contro direzione opposta' : 'direzione opposta al picco non misurata';

    const a = audit(m), box = $('st-audit-box');
    box.classList.toggle('is-ok', a.ok); box.classList.toggle('is-ko', !a.ok);
    $('st-audit').textContent = a.ok ? 'OK' : a.doppi.length && !a.totale ? 'sospetto' : `${a.totale.toLocaleString('it-IT')} punti`;
    $('st-audit-sub').textContent = a.ok ? (a.saltati.length ? `nessuna violazione · ${a.saltati.length} controlli non verificabili` : 'nessuna violazione') : a.doppi.length ? `${a.doppi.join(', ')} → scheda Audit` : 'in violazione → scheda Audit';
  }

  function intestazione() {
    const m = cur(), f = fv(m);
    $('h-camp').textContent = 'misura';
    $('h-nome').textContent = m.nome;
    const chip = (t, c = 'gray') => `<span class="tag tag-${c}">${esc(t)}</span>`;
    let pMin = Infinity, pMax = -Infinity;
    for (let i = 1; i < m.nA; i++) { const d = m.ang[i] - m.ang[i - 1]; pMin = Math.min(pMin, d); pMax = Math.max(pMax, d); }
    const passo = m.nA < 2 ? '1 angolo'
      : pMax - pMin < 1e-6 ? `passo ${fA(pMin)}` : `passo variabile ${fA(pMin)}–${fA(pMax)}`;
    const acq = m.meta.acquisizione || {};
    const ifbw = Object.entries(acq).find(([k]) => /if\s*band/i.test(k));
    $('h-chips').innerHTML = [
      chip(`${fA(m.ang[0])}…${fA(m.ang[m.nA - 1])} · ${passo}`, 'cyan'),
      chip(`${fF(f[0], false)}–${fF(f[m.nF - 1])} · ${m.nF} ${m.nF === 1 ? 'punto' : 'punti'}`, 'purple'),
      ifbw ? chip(`IFBW ${ifbw[1]}`) : '',
      friis(m) ? chip(`allineamento ${fA(allineamento(m, st.param).a0)}`, 'amber') : '',
      ...Object.entries(m.meta.attributi || {}).map(([k, v]) => chip(`${k}: ${v}`)),
    ].join('');
    $('dist-field').hidden = !friis(m);
    $('dist-note').textContent = !friis(m) ? '' : m.dist === m.meta.distanza_m
      ? 'dal pacchetto' : `modificata: nel pacchetto è ${fmt(m.meta.distanza_m, 2)} m`;
    $('split-unit').textContent = UF.u;
    $('h-note').textContent = m.meta.note || '';
  }

  function parametriDisponibili() {
    const m = cur();
    $('seg-param').querySelectorAll('button').forEach(b => {
      b.disabled = !ha(m, b.dataset.v);
      b.title = b.disabled ? 'assente nel file' : '';
      b.setAttribute('aria-checked', String(b.dataset.v === st.param));
    });
  }

  /* =========================================================
     DISEGNO (al più una volta per fotogramma)
     ========================================================= */
  let pendente = false;
  function aggiorna() {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(() => {
      pendente = false;
      if (!cur() || !window.Plotly) return;
      sincronizzaCursori();
      indicatori();
      VISTE[st.tab]();
    });
  }

  function sincronizzaCursori() {
    const m = cur();
    for (const [id, i, n] of [['in-f', st.fi, m.nF], ['in-a', st.ai, m.nA]]) {
      const el = $(id);
      el.max = n - 1; el.value = i;
      el.style.setProperty('--fill', `${n > 1 ? i / (n - 1) * 100 : 0}%`);
    }
    $('out-f').textContent = fF(fSel());
    $('out-a').textContent = fA(aSel());
    $('out-floor').textContent = `${st.floor} dB`;
    $('out-mask').textContent = `${st.mask} dB`;
    for (const id of ['in-floor', 'in-mask']) {
      const el = $(id);
      el.style.setProperty('--fill', `${(el.value - el.min) / (el.max - el.min) * 100}%`);
    }
  }

  function riempiSelect(sel, lista, valore, vuota) {
    const firma = (vuota || '') + lista.map(m => m.id).join('|');
    if (sel.dataset.firma !== firma) {
      sel.dataset.firma = firma;
      const gruppi = new Map();
      for (const m of lista) { if (!gruppi.has(m.camp)) gruppi.set(m.camp, []); gruppi.get(m.camp).push(m); }
      sel.innerHTML = (vuota ? `<option value="">${vuota}</option>` : '') + [...gruppi].map(([c, ms]) => {
        const o = ms.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('');
        return c ? `<optgroup label="${esc(c)}">${o}</optgroup>` : o;
      }).join('');
    }
    if (valore != null) sel.value = valore;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function listaSovrapposizioni() {
    const pieno = st.sovr.size >= MAX_SOVR;
    const html = [...misure.values()].filter(m => m.id !== st.cur).map(m => `
      <label class="check"><input type="checkbox" value="${esc(m.id)}" ${st.sovr.has(m.id) ? 'checked' : pieno ? 'disabled' : ''}>
        <span>${m.camp ? `<span class="camp">${esc(m.camp)}</span> ` : ''}${esc(m.nome)}</span>
        <i class="sw" style="--c:${colore(m.id)}"></i></label>`).join('');
    $('lst-sovr').innerHTML = html;
    $('n-misure').textContent = `${misure.size} ${misure.size === 1 ? 'misura' : 'misure'}`;
  }

  /* =========================================================
     SELEZIONE MISURA
     ========================================================= */
  function scegli(id) {
    const prima = cur();
    const f = prima ? prima.f[st.fi] : null, a = prima ? aSel() : 0;   // f in Hz
    st.cur = id;
    sovr(id, false);
    const m = cur();
    scale(m);
    if (!ha(m, st.param)) st.param = ['S21', 'S12'].find(k => ha(m, k));
    st.fi = f != null ? vicino(m.f, f) : Math.floor(m.nF / 2);
    st.ai = vicino(m.ang, a);
    // il taglio ortogonale lo sceglie l'utente: dai nomi dei file non si può sapere come è orientata la misura
    st.la = id;
    st.lb = null;
    $('in-dist').value = m.dist ?? '';
    parametriDisponibili();
    riempiSelect($('sel-misura'), [...misure.values()], id);
    listaSovrapposizioni();
    intestazione();
    aggiorna();
  }

  /* =========================================================
     CARICAMENTO
     ========================================================= */
  async function caricaFile(voci) {
    const err = [];
    let ultimo = null;
    for (const { nome, percorso, leggi } of voci) {
      if (!/\.npz$/i.test(nome)) continue;
      try {
        const m = costruisci(await Npz.leggi(await leggi()));
        misure.set(m.id, m);
        ultimo = m.id;
      } catch (e) {
        err.push(`${nome}: ${e.message}`);
      }
    }
    $('drop-err').textContent = $('lab-err').textContent = err.join(' · ');
    if (!misure.size) {
      if (!err.length) $('drop-err').textContent = 'Nessun file .npz trovato.';
      return;
    }
    $('drop').hidden = true;
    $('lab').hidden = false;
    scegli(st.cur && misure.has(st.cur) ? st.cur : [...misure.keys()].sort()[0]);
    if (err.length) console.warn(err);
    return ultimo;
  }

  const daFileList = fl => [...fl].map(f => ({
    nome: f.name, percorso: f.webkitRelativePath || f.name, dim: f.size, leggi: () => f.arrayBuffer(),
  }));
  const daCartella = voci => voci.some(v => v.percorso.split('/').filter(Boolean).length > 1);
  const dimensione = b => b > 1e6 ? `${fmt(b / 1e6, 1)} MB` : `${fmt(b / 1e3, 0)} kB`;

  /** Finestra di conferma nello stile del sito. righe = [[nome, dettaglio], …]. → Promise<boolean> */
  function conferma({ occhiello = '', titolo, testo = '', righe = [], si = 'Conferma', no = 'Annulla' }) {
    const d = $('dlg');
    $('dlg-occhiello').textContent = occhiello;
    $('dlg-titolo').textContent = titolo;
    $('dlg-testo').textContent = testo;
    $('dlg-lista').innerHTML = righe.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
    $('dlg-lista').hidden = !righe.length;
    $('dlg-si').textContent = si;
    $('dlg-no').textContent = no;
    d.returnValue = '';
    d.showModal();
    $('dlg-si').focus();
    return new Promise(ok => d.addEventListener('close', () => ok(d.returnValue === 'si'), { once: true }));
  }

  /** Nell'analisi si caricano solo pacchetti singoli, non cartelle. */
  async function caricaConConferma(voci) {
    if (daCartella(voci)) {
      $('drop-err').textContent = $('lab-err').textContent = 'Trascina i singoli pacchetti .npz, non una cartella.';
      return;
    }
    await caricaFile(voci);
  }


  async function daDrop(dt) {
    const out = [];
    const visita = async (entry, base) => {
      if (entry.isFile) {
        const f = await new Promise((ok, ko) => entry.file(ok, ko));
        out.push({ nome: f.name, percorso: `${base}/${f.name}`, dim: f.size, leggi: () => f.arrayBuffer() });
      } else if (entry.isDirectory) {
        const r = entry.createReader();
        let blocco;
        do {
          blocco = await new Promise((ok, ko) => r.readEntries(ok, ko));
          for (const e of blocco) await visita(e, `${base}/${entry.name}`);
        } while (blocco.length);
      }
    };
    const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return daFileList(dt.files);
    for (const e of entries) await visita(e, '');
    return out;
  }

  /* ?npz=percorso/a.npz,percorso/b.npz → carica file pubblicati accanto alla pagina */
  async function daUrl() {
    const p = new URLSearchParams(location.search).get('npz');
    if (!p) return;
    await caricaFile(p.split(',').map(u => u.trim()).filter(Boolean).map(u => ({
      nome: u.split('/').pop(), percorso: u,
      leggi: async () => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); },
    })));
  }

  /* =========================================================
     EVENTI
     ========================================================= */
  function seg(id, fn) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      fn(b.dataset.v);
      aggiorna();
    });
  }

  function anima(on) {
    clearInterval(st.play);
    st.play = on ? setInterval(() => { st.fi = (st.fi + 1) % cur().nF; aggiorna(); }, st.vel) : null;
    $('btn-play').setAttribute('aria-pressed', String(on));
    $('btn-play').querySelector('.play-lbl').textContent = on ? 'Pausa' : 'Anima in frequenza';
    if (!on) aggiorna();          // ridisegna il lobo a piena risoluzione
  }

  function collega() {
    const drop = $('drop');
    for (const ev of ['dragenter', 'dragover']) {
      document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); });
    }
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('is-over'); });
    document.addEventListener('drop', async e => {
      e.preventDefault();
      if (document.body.dataset.modo === 'pacchetto') return;     // ci pensa pacchetto.js
      drop.classList.remove('is-over');
      await caricaConConferma(await daDrop(e.dataTransfer));
    });
    for (const id of ['in-file', 'in-file-2']) {
      $(id).addEventListener('change', async e => { await caricaConConferma(daFileList(e.target.files)); e.target.value = ''; });
    }

    $('sel-misura').addEventListener('change', e => scegli(e.target.value));
    seg('seg-param', v => { st.param = v; intestazione(); });
    $('in-dist').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (v > 0 && friis(cur())) { cur().dist = v; intestazione(); aggiorna(); }
    });
    $('in-f').addEventListener('input', e => { st.fi = +e.target.value; aggiorna(); });
    $('in-a').addEventListener('input', e => { st.ai = +e.target.value; aggiorna(); });
    $('in-floor').addEventListener('input', e => { st.floor = +e.target.value; aggiorna(); });
    $('tg-norm').addEventListener('change', e => { st.norm = e.target.checked; aggiorna(); });
    $('btn-play').addEventListener('click', () => anima(st.play === null));
    seg('seg-vel', v => { st.vel = +v; if (st.play !== null) anima(true); });
    $('lst-sovr').addEventListener('change', e => {
      sovr(e.target.value, e.target.checked);
      listaSovrapposizioni();
      aggiorna();
    });

    seg('seg-cf-scala', v => { st.cfScala = v; });
    seg('seg-scala', v => { st.scala = v; });
    $('sel-b').addEventListener('change', e => { st.b = e.target.value; aggiorna(); });
    $('in-mask').addEventListener('input', e => { st.mask = +e.target.value; aggiorna(); });
    $('in-split').addEventListener('input', e => { const v = parseFloat(e.target.value); st.split = isFinite(v) ? v : null; aggiorna(); });
    $('sel-la').addEventListener('change', e => { st.la = e.target.value; aggiorna(); });
    $('sel-lb').addEventListener('change', e => { st.lb = e.target.value || null; aggiorna(); });
    $('tg-lobo-db').addEventListener('change', e => { st.loboDb = e.target.checked; aggiorna(); });

    $('tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      st.tab = b.dataset.tab;
      $('tabs').querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== st.tab; });
      aggiorna();
    });

    // clic sulle mappe: sposta il punto di lavoro
    const suClic = id => {
      const el = $(id);
      if (el._clic || !el.on) return;
      el._clic = true;
      el.on('plotly_click', ev => {
        const p = ev.points && ev.points[0];
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
        const m = cur();
        st.ai = vicino(m.ang, p.x);
        st.fi = vicino(fv(m), p.y);
        aggiorna();
      });
    };
    const origAu = VISTE.audit;
    VISTE.audit = () => { origAu(); suClic('p-audit'); };

    // tastiera: ← → frequenza, ↑ ↓ angolo, spazio animazione
    document.addEventListener('keydown', e => {
      if (!cur() || e.target.closest('input, select, textarea, button')) return;
      const m = cur();
      const mosse = { ArrowRight: () => st.fi = Math.min(st.fi + 1, m.nF - 1), ArrowLeft: () => st.fi = Math.max(st.fi - 1, 0),
        ArrowUp: () => st.ai = Math.min(st.ai + 1, m.nA - 1), ArrowDown: () => st.ai = Math.max(st.ai - 1, 0) };
      if (mosse[e.key]) { e.preventDefault(); mosse[e.key](); aggiorna(); }
      else if (e.key === ' ') { e.preventDefault(); anima(st.play === null); }
    });
  }

  /* sezioni della pagina: analisi dei pacchetti / creazione dei pacchetti */
  function modo(m) {
    document.body.dataset.modo = m;
    document.querySelectorAll('[data-sezione]').forEach(x => { x.hidden = x.dataset.sezione !== m; });
    document.querySelectorAll('#modi [data-v]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === m)));
    if (m === 'analisi') aggiorna();
  }
  $('modi').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) modo(b.dataset.v); });

  // interfaccia per pacchetto.js
  window.LabAntenne = {
    FORMATO, VERSIONE, costruisci, audit, allineamento, daDrop, daFileList, modo, conferma, dimensione,
    /** apre nell'analisi pacchetti già in memoria: [{ nome, blob }] */
    apri: async pacchetti => {
      modo('analisi');
      await caricaFile(pacchetti.map(p => ({ nome: p.nome, percorso: p.nome, leggi: () => p.blob.arrayBuffer() })));
    },
  };

  collega();
  modo('analisi');
  daUrl().catch(e => { $('drop-err').textContent = e.message; });
})();
