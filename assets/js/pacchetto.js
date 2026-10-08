/* =========================================================
   GABBRO — pacchetto.js
   Laboratorio antenne, sezione "Impacchetta grezzi".

   Dalle cartelle del VNA (un file per angolo) al pacchetto
   standard .npz v1 letto dall'analisi:
   - prende solo i .csv e .s2p (più _README.txt), un file per
     angolo; l'angolo viene dal nome: "…deg", ParserTouchstonePorts_N
     (centesimi di grado) o l'ultimo numero del nome;
   - CSV con colonne per nome o nell'ordine freq, S11 re/im, S21,
     S12, S22; Touchstone a 2 porte con riga # HZ S RI/MA/DB;
   - controlla che tutti gli angoli abbiano le stesse frequenze;
   - inizio, fine e passo della griglia sono rilevati dai file e
     modificabili: righe senza file → NaN, file fuori griglia esclusi;
   - legge _README.txt (chiave : valore) e lo confronta con i file;
   - scrive il pacchetto, lo rilegge con lo stesso codice
     dell'analisi e ne mostra l'audit.
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const L = window.LabAntenne;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d).replace('.', ',');
  const PARAM = ['S11', 'S21', 'S12', 'S22'];
  const UNITA = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };

  /* =========================================================
     RICONOSCIMENTO DEI FILE
     ========================================================= */
  // si prendono solo .csv e .s2p (più l'eventuale _README.txt); tutto il resto si ignora
  const RE_DATI = /\.(csv|s2p)$/i;
  const RE_README = /^_?readme.*\.txt$/i;
  const RE_DEG = /(-?\d+(?:[._]\d+)?)\s*deg/i;               // 002.00deg.csv, -07_00deg.csv, 180deg.csv
  const RE_TOUCH = /ParserTouchstonePorts_(-?\d+)/i;          // centesimi di grado
  const RE_NUM = /(-?\d+(?:\.\d+)?)(?!.*\d)/;                  // ultimo numero del nome

  function classifica(nome) {
    if (RE_README.test(nome)) return { tipo: 'readme' };
    const est = RE_DATI.exec(nome);
    if (!est) return null;
    const tipo = est[1].toLowerCase(), base = nome.slice(0, -4);
    let m = RE_DEG.exec(base);
    if (m) return { tipo, angolo: parseFloat(m[1].replace('_', '.')) + 0 };
    m = RE_TOUCH.exec(base);
    if (m) return { tipo, angolo: parseInt(m[1], 10) / 100 + 0 };
    m = RE_NUM.exec(base);
    if (m) return { tipo, angolo: parseFloat(m[1]) + 0, dedotto: true };
    return { tipo, angolo: NaN };
  }

  /* =========================================================
     PARSER
     Restituiscono { f: Float64Array [Hz], S: { S11: Float64Array(2n), … }, avvisi: [] }
     ========================================================= */
  function parseCsv(testo, nome) {
    const righe = testo.split(/\r?\n/).filter(r => r.trim() && !/^\s*[#!]/.test(r));
    if (!righe.length) throw new Error(`${nome}: file vuoto`);
    const sep = [',', ';', '\t'].reduce((a, c) => (righe[0].split(c).length > righe[0].split(a).length ? c : a), ',');
    const avvisi = [];
    let col = null, scala = 1;
    if (/[a-df-z]/i.test(righe[0])) {                    // intestazione (la "e" degli esponenti non conta)
      const h = righe.shift().split(sep).map(x => x.trim().toLowerCase().replace(/\s+/g, '_'));
      col = {};
      h.forEach((n, i) => {
        const fq = /^f(?:req(?:uency|uenza)?)?(?:_?\[?(hz|khz|mhz|ghz)\]?)?$/.exec(n);
        if (fq && col.f == null) { col.f = i; scala = UNITA[fq[1] || 'hz']; return; }
        const s = /^s(11|21|12|22)_?(re|real|im|imag)$/.exec(n);
        if (s) col[`S${s[1]}${s[2].startsWith('re') ? 're' : 'im'}`] = i;
      });
      const mancano = ['f', ...PARAM.flatMap(p => [`${p}re`, `${p}im`])].filter(k => col[k] == null);
      if (mancano.length) throw new Error(`${nome}: colonne non riconosciute (${mancano.join(', ')}) nell'intestazione "${h.join(sep)}"`);
    }
    const ordine = col ? null : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const n = righe.length, f = new Float64Array(n), S = {};
    PARAM.forEach(p => { S[p] = new Float64Array(2 * n); });
    righe.forEach((r, i) => {
      const v = r.split(sep).map(Number);
      const g = k => v[col ? col[k] : ordine[k]];
      if (!col && v.length < 9) throw new Error(`${nome}: riga ${i + 1} con ${v.length} colonne, ne servono 9`);
      f[i] = (col ? v[col.f] : v[0]) * scala;
      PARAM.forEach((p, j) => {
        S[p][2 * i] = col ? v[col[`${p}re`]] : g(1 + 2 * j);
        S[p][2 * i + 1] = col ? v[col[`${p}im`]] : g(2 + 2 * j);
      });
    });
    if (!col) avvisi.push('CSV senza intestazione: colonne lette nell\'ordine freq, S11, S21, S12, S22');
    if (f[n - 1] < 1e5 && scala === 1) avvisi.push('frequenze sotto 100 kHz con unità Hz: controlla l\'intestazione del CSV');
    return { f, S, avvisi };
  }

  function parseS2p(testo, nome) {
    // riga di opzioni Touchstone; valori predefiniti dello standard: GHZ S MA R 50
    let unita = 'ghz', fmtDati = 'ma';
    const num = [];
    for (const riga of testo.split(/\r?\n/)) {
      const r = riga.replace(/!.*/, '').trim();
      if (!r) continue;
      if (r.startsWith('#')) {
        for (const t of r.slice(1).trim().toLowerCase().split(/\s+/)) {
          if (UNITA[t]) unita = t;
          else if (['ri', 'ma', 'db'].includes(t)) fmtDati = t;
          else if (['y', 'z', 'h', 'g'].includes(t)) throw new Error(`${nome}: parametri ${t.toUpperCase()}, servono parametri S`);
        }
        continue;
      }
      if (r.startsWith('[')) continue;                   // parole chiave Touchstone 2.0
      for (const t of r.split(/\s+/)) num.push(Number(t));
    }
    if (num.length % 9) throw new Error(`${nome}: ${num.length} valori, non multiplo di 9 (serve un Touchstone a 2 porte)`);
    const n = num.length / 9, f = new Float64Array(n), S = {};
    PARAM.forEach(p => { S[p] = new Float64Array(2 * n); });
    const scala = UNITA[unita];
    for (let i = 0; i < n; i++) {
      f[i] = num[9 * i] * scala;
      PARAM.forEach((p, j) => {        // ordine Touchstone a 2 porte: S11 S21 S12 S22
        const a = num[9 * i + 1 + 2 * j], b = num[9 * i + 2 + 2 * j];
        let re = a, im = b;
        if (fmtDati !== 'ri') {
          const mod = fmtDati === 'db' ? 10 ** (a / 20) : a, fase = b * Math.PI / 180;
          re = mod * Math.cos(fase); im = mod * Math.sin(fase);
        }
        S[p][2 * i] = re; S[p][2 * i + 1] = im;
      });
    }
    return { f, S, avvisi: [] };
  }

  function parseReadme(testo) {
    const out = {};
    for (const r of testo.split(/\r?\n/)) {
      const m = /^\s*([^:─═]+?)\s+:\s+(.+?)\s*$/.exec(r);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  async function sha256(buf) {
    if (!crypto.subtle) return null;                     // contesti non sicuri (file://)
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* =========================================================
     MISURE (una per cartella)
     ========================================================= */
  let misure = [];      // { dir, nome, note, tipo, angoli: [{a, f, S}], acq, avvisi, gravi, hash, dist, amin, amax, passo, auto, incl, errore }
  let risultati = [];   // { nome, blob, url, m (misura costruita), audit }

  async function analizzaCartelle(voci) {
    const gruppi = new Map();
    for (const v of voci) {
      const parti = v.percorso.split('/').filter(Boolean);
      const dir = parti.slice(0, -1).join('/');
      if (!gruppi.has(dir)) gruppi.set(dir, []);
      gruppi.get(dir).push({ ...v, cls: classifica(v.nome) });
    }
    const nuove = [];
    let fatte = 0;
    const totale = voci.length;
    for (const [dir, files] of gruppi) {
      const dati = files.filter(x => x.cls && x.cls.tipo !== 'readme');
      if (!dati.length) continue;
      const tipi = [...new Set(dati.map(x => x.cls.tipo))];
      const parti = dir.split('/');
      const g = {
        dir, nome: parti[parti.length - 1] || 'misura', note: '',
        tipo: tipi.join('+'), angoli: [], acq: null, avvisi: [], gravi: [],
        amin: null, amax: null, passo: null, modello: 'friis', dist: null, incl: true, errore: null,
      };
      try {
        if (tipi.length > 1) throw new Error('nella stessa cartella ci sono sia CSV sia S2P');
        const readme = files.find(x => x.cls && x.cls.tipo === 'readme');
        if (readme) g.acq = parseReadme(new TextDecoder().decode(await readme.leggi()));

        const senza = dati.filter(x => !isFinite(x.cls.angolo)).map(x => x.nome);
        if (senza.length) g.avvisi.push(`${senza.length} file senza un angolo nel nome, ignorati${senza.length <= 3 ? `: ${senza.join(', ')}` : ''}`);
        if (dati.some(x => x.cls.dedotto)) g.avvisi.push('angoli presi dall\'ultimo numero nel nome dei file: controlla inizio, fine e passo');
        const visti = new Map(), firme = [];
        for (const x of dati.filter(x => isFinite(x.cls.angolo)).sort((p, q) => p.cls.angolo - q.cls.angolo)) {
          const buf = await x.leggi();
          firme.push(`${x.nome}:${await sha256(buf)}`);
          const r = (x.cls.tipo === 'csv' ? parseCsv : parseS2p)(new TextDecoder().decode(buf), x.nome);
          r.avvisi.forEach(a => { if (!g.avvisi.includes(a)) g.avvisi.push(a); });
          if (visti.has(x.cls.angolo)) {
            g.avvisi.push(`angolo ${fmt(x.cls.angolo)}° presente due volte (${visti.get(x.cls.angolo)}, ${x.nome}): tenuto il primo`);
            continue;
          }
          visti.set(x.cls.angolo, x.nome);
          g.angoli.push({ a: x.cls.angolo, f: r.f, S: r.S, file: x.nome });
          if (++fatte % 40 === 0) stato(`Lettura dei file… ${fatte}/${totale}`);
        }

        // stesse frequenze per tutti gli angoli
        const f0 = g.angoli[0].f;
        for (const x of g.angoli) {
          const ok = x.f.length === f0.length && x.f.every((v, i) => Math.abs(v - f0[i]) <= 1e-9 * Math.abs(f0[i]) + 1e-6);
          if (!ok) throw new Error(`${x.file} ha frequenze diverse da ${g.angoli[0].file}`);
        }
        for (let i = 1; i < f0.length; i++) if (!(f0[i] > f0[i - 1])) throw new Error(`${g.angoli[0].file}: frequenze non crescenti`);
        g.f = f0;
        // parametri S identici in tutti i file: errore del sistema di acquisizione, non della misura
        for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
          const [a, b] = [PARAM[p], PARAM[q]];
          if (g.angoli.every(x => x.S[a].every((v, i) => v === x.S[b][i]))) {
            g.gravi.push(`${a} e ${b} sono identici in tutti i file grezzi: probabile errore nel salvataggio dell'acquisizione`);
          }
        }
        g.hash = firme.every(s => !s.endsWith(':null')) ? await sha256(new TextEncoder().encode(firme.sort().join('\n'))) : null;
        // griglia rilevata (come build_angle_grid): estremi trovati e passo minimo fra due file
        g.amin = g.angoli[0].a;
        g.amax = g.angoli[g.angoli.length - 1].a;
        let passo = Infinity;
        for (let i = 1; i < g.angoli.length; i++) passo = Math.min(passo, g.angoli[i].a - g.angoli[i - 1].a);
        g.passo = isFinite(passo) ? +passo.toFixed(9) : 1;
        g.auto = { amin: g.amin, amax: g.amax, passo: g.passo };
      } catch (e) {
        g.errore = e.message;
      }
      nuove.push(g);
    }
    return nuove;
  }

  /** Griglia di uscita da inizio, fine e passo della misura. Ogni file va sulla riga del suo
      angolo; righe senza file → NaN; file fra due righe o fuori intervallo → esclusi. */
  function griglia(g) {
    const { amin, amax, passo } = g;
    if (!(passo > 0)) return { errore: 'il passo deve essere positivo' };
    if (!(amax >= amin)) return { errore: 'la fine deve essere maggiore o uguale all\'inizio' };
    const n = Math.round((amax - amin) / passo) + 1;
    if (n > 100000) return { errore: `${n.toLocaleString('it-IT')} righe: passo troppo piccolo` };
    const ang = Array.from({ length: n }, (_, i) => +(amin + i * passo).toFixed(9));
    const tol = Math.max(1e-6, passo * 1e-3);
    const righe = new Map();
    let fuoriGriglia = 0, fuoriIntervallo = 0;
    for (const x of g.angoli) {
      if (x.a < amin - tol || x.a > ang[n - 1] + tol) { fuoriIntervallo++; continue; }
      const k = Math.round((x.a - amin) / passo);
      if (Math.abs(ang[k] - x.a) > tol) { fuoriGriglia++; continue; }
      righe.set(k, x);
    }
    return { ang, righe, mancanti: n - righe.size, fuoriGriglia, fuoriIntervallo };
  }

  /** Confronto fra quanto dichiarato nel _README.txt e quanto trovato. */
  function controlliReadme(g) {
    const acq = g.acq || {}, out = [];
    const num = k => { const e = Object.entries(acq).find(([n]) => n.toLowerCase() === k); return e ? parseFloat(e[1]) : NaN; };
    const passo = num('angle step'), passi = num('total steps'), punti = num('points');
    if (isFinite(passo) && Math.abs(passo - g.auto.passo) > 1e-6) out.push(`passo dichiarato ${fmt(passo)}°, rilevato dai file ${fmt(g.auto.passo)}°`);
    if (isFinite(passi) && passi !== g.angoli.length) out.push(`angoli dichiarati ${passi}, file trovati ${g.angoli.length}`);
    if (isFinite(punti) && g.f && punti !== g.f.length) out.push(`punti in frequenza dichiarati ${punti}, trovati ${g.f.length}`);
    return out;
  }

  /* =========================================================
     INTERFACCIA
     ========================================================= */
  function stato(t) { $('pk-stato').textContent = t; }

  function disegnaMisure() {
    $('pk-lavoro').hidden = !misure.length;
    $('pk-drop').hidden = !!misure.length;
    $('pk-misure').innerHTML = misure.map((g, i) => {
      if (g.errore) {
        return `<article class="pk-card is-err"><header><strong>${esc(g.dir || g.nome)}</strong></header>
          <p class="pk-msg bad">${esc(g.errore)}</p></article>`;
      }
      const gr = griglia(g), fG = g.f[g.f.length - 1] >= 1e9 ? 1e9 : 1e6, uF = fG === 1e9 ? 'GHz' : 'MHz';
      const avvisi = [...g.avvisi, ...controlliReadme(g)];
      if (!gr.errore) {
        if (gr.mancanti) avvisi.push(`${gr.mancanti} righe della griglia senza file: saranno NaN`);
        if (gr.fuoriGriglia) avvisi.push(`${gr.fuoriGriglia} file fra due righe della griglia: esclusi (passo troppo grande?)`);
        if (gr.fuoriIntervallo) avvisi.push(`${gr.fuoriIntervallo} file fuori da inizio–fine: esclusi`);
      }
      const modificata = ['amin', 'amax', 'passo'].some(k => g[k] !== g.auto[k]);
      const num = (k, etichetta, unita, extra = '') => `<label class="pk-campo">
        <span class="pk-etichetta">${etichetta}<span class="unit">${unita}</span></span>
        <input type="number" data-k="${k}" value="${g[k] ?? ''}" step="any" ${extra}></label>`;
      const fatto = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
      return `<article class="pk-card${g.incl ? '' : ' is-off'}" data-i="${i}">
        <header class="pk-head">
          <input type="checkbox" class="pk-incl" data-k="incl" ${g.incl ? 'checked' : ''} aria-label="Includi la misura">
          <div class="pk-titolo">
            <input type="text" class="pk-nome" data-k="nome" value="${esc(g.nome)}" aria-label="Nome della misura" spellcheck="false">
            <span class="pk-dir" title="${esc(g.dir)}">${esc(g.dir)}</span>
          </div>
          <span class="tag tag-cyan pk-tipo">${g.angoli.length} file ${g.tipo.toUpperCase()}</span>
        </header>
        <div class="pk-corpo">
          <dl class="pk-fatti">
            ${fatto('griglia', gr.errore ? `<span class="bad">${esc(gr.errore)}</span>` : `${gr.ang.length} righe · ${gr.righe.size} con file`)}
            ${fatto('frequenze', `${fmt(g.f[0] / fG, 3)}–${fmt(g.f[g.f.length - 1] / fG, 3)} ${uF}<br><span class="dim">${g.f.length} punti</span>`)}
            ${fatto('readme', g.acq ? `${Object.keys(g.acq).length} voci lette` : '<span class="dim">assente</span>')}
          </dl>
          <div class="pk-form">
            <div class="pk-modello">
              <span class="pk-etichetta">Grandezza</span>
              <div class="seg" role="radiogroup" aria-label="Modello">
                <button type="button" role="radio" data-modello="friis" aria-checked="${g.modello === 'friis'}">Guadagno con Friis</button>
                <button type="button" role="radio" data-modello="nessuno" aria-checked="${g.modello === 'nessuno'}">|S| grezzo</button>
              </div>
              <span class="pk-spiega">${g.modello === 'friis'
                ? 'Due antenne uguali a distanza nota: G = |S21| · 4πR f / c, in dBi.'
                : 'Nessuna ipotesi sul setup: |S21| in dB, senza distanza.'}</span>
            </div>
            <div class="pk-campi${g.modello === 'friis' ? '' : ' senza-dist'}">
              ${g.modello === 'friis' ? num('dist', 'Distanza', 'm', 'min="0.001" placeholder="obbligatoria"') : ''}
              ${num('amin', 'Inizio', '°')}
              ${num('amax', 'Fine', '°')}
              ${num('passo', 'Passo', '°', 'min="0"')}
            </div>
            ${modificata ? `<p class="pk-auto">Rilevati dai file: ${fmt(g.auto.amin, 2)}…${fmt(g.auto.amax, 2)}°, passo ${fmt(g.auto.passo, 2)}° · <button type="button" class="link-btn" data-ripristina="${i}">ripristina</button></p>` : ''}
            <label class="pk-campo pk-note">
              <span class="pk-etichetta">Note</span>
              <input type="text" data-k="note" value="${esc(g.note)}" placeholder="facoltative" autocomplete="off">
            </label>
          </div>
        </div>
        ${avvisi.length || g.gravi.length
          ? `<ul class="diag pk-diag">${g.gravi.map(a => `<li class="bad">${esc(a)}</li>`).join('')}${avvisi.map(a => `<li class="warn">${esc(a)}</li>`).join('')}</ul>`
          : '<ul class="diag pk-diag"><li class="ok">nessuna anomalia nei file</li></ul>'}
      </article>`;
    }).join('');
  }

  function valida() {
    const err = [];
    const scelte = misure.filter(g => g.incl && !g.errore);
    if (!scelte.length) err.push('nessuna misura selezionata');
    const nomi = scelte.map(g => g.nome.trim());
    if (nomi.some(n => !n)) err.push('una misura non ha nome');
    const doppi = nomi.filter((n, i) => nomi.indexOf(n) !== i);
    if (doppi.length) err.push(`nomi ripetuti: ${[...new Set(doppi)].join(', ')}`);
    scelte.forEach(g => {
      const gr = griglia(g), n = g.nome.trim() || g.dir;
      if (g.modello === 'friis' && !(g.dist > 0)) err.push(`${n}: manca la distanza (o scegli |S| grezzo)`);
      if (gr.errore) err.push(`${n}: ${gr.errore}`);
      else if (!gr.righe.size) err.push(`${n}: nessun file sulla griglia`);
    });
    return { err, scelte };
  }

  async function crea() {
    const { err, scelte } = valida();
    if (err.length) { stato(`Impossibile creare i pacchetti: ${err.join(' · ')}`); return; }
    risultati.forEach(r => URL.revokeObjectURL(r.url));
    risultati = [];
    for (const g of scelte) {
      stato(`Creo ${g.nome}…`);
      const gr = griglia(g), nA = gr.ang.length, nF = g.f.length;
      const S = {};
      PARAM.forEach(p => { S[p] = new Float32Array(2 * nA * nF).fill(NaN); });
      for (const [i, x] of gr.righe) PARAM.forEach(p => S[p].set(x.S[p], i * nF * 2));
      // angolo di allineamento sui dati appena impacchettati (stesso calcolo dell'analisi, su S21)
      const al = L.allineamento({ nA, nF, ang: gr.ang, S: { S21: S.S21 }, cache: {} }, 'S21');
      const meta = {
        formato: L.FORMATO, versione: L.VERSIONE,
        misura: g.nome.trim(), modello: g.modello,
        ...(g.modello === 'friis' ? { distanza_m: g.dist } : {}),
        allineamento: { angolo_deg: al.a0, criterio: 'massimo di |S21|² mediato sulla banda',
          picco_per_frequenza_deg: { min: al.min, mediana: al.mediana, max: al.max } },
        note: g.note.trim(),
        unita: { frequenze: 'Hz', angoli: 'deg' },
        griglia: { angoli: nA, frequenze: nF, angoli_mancanti: gr.mancanti, passo_deg: g.passo,
          intervallo_deg: [gr.ang[0], gr.ang[nA - 1]], file_esclusi: gr.fuoriGriglia + gr.fuoriIntervallo },
        acquisizione: g.acq || {},
        sorgente: { formato: g.tipo, cartella: g.dir, file: gr.righe.size, sha256: g.hash },
        avvisi: g.gravi,
        creato: new Date().toISOString(),
        programma: 'https://sergabbro.github.io/tools/antenne.html',
      };
      const blob = await Npz.scrivi({
        frequenze: { dtype: '<f8', shape: [nF], data: g.f },
        angoli: { dtype: '<f8', shape: [nA], data: gr.ang },
        ...Object.fromEntries(PARAM.map(p => [p, { dtype: '<c8', shape: [nA, nF], data: S[p] }])),
        meta: { dtype: '<U', shape: [], data: [JSON.stringify(meta)] },
      });
      // verifica: il pacchetto si rilegge con lo stesso codice dell'analisi
      const m = L.costruisci(await Npz.leggi(await blob.arrayBuffer()));
      const nome = g.nome.trim().replace(/[^\w.-]+/g, '_') + '.npz';
      risultati.push({ nome, blob, url: URL.createObjectURL(blob), m, al, audit: L.audit(m) });
    }
    disegnaRisultati();
    stato(`${risultati.length} ${risultati.length === 1 ? 'pacchetto creato' : 'pacchetti creati'} e riletti correttamente.`);
  }

  function disegnaRisultati() {
    $('pk-risultati').hidden = !risultati.length;
    const n = risultati.length;
    $('pk-ris-titolo').textContent = n === 1 ? '1 pacchetto pronto' : `${n} pacchetti pronti`;
    $('pk-ris-tot').textContent = `${L.dimensione(risultati.reduce((s, r) => s + r.blob.size, 0))} in totale · già riletti e verificati`;
    $('pk-lista').innerHTML = risultati.map(r => {
      const a = r.audit, m = r.m, al = r.al;
      const esito = a.ok
        ? { c: 'ok', t: 'audit superato' }
        : a.doppi.length ? { c: 'bad', t: `${a.doppi.join(', ')} identici` }
        : { c: 'warn', t: `${a.totale.toLocaleString('it-IT')} punti fuori tolleranza` };
      return `<li class="pk-file">
        <div class="pk-file-nome">
          <strong>${esc(r.nome)}</strong>
          <div class="pk-file-tag">
            <span class="tag ${m.dist != null ? 'tag-cyan' : 'tag-purple'}">${m.dist != null ? `Friis · ${fmt(m.dist, 2)} m` : '|S| grezzo'}</span>
            <span class="tag tag-gray">${m.nA} × ${m.nF}</span>
            <span class="tag tag-gray">${L.dimensione(r.blob.size)}</span>
          </div>
        </div>
        <dl class="pk-file-fatti">
          <div><dt>allineamento</dt><dd>${fmt(al.a0, 1)}°</dd></div>
          <div><dt>picco in banda</dt><dd>${fmt(al.min, 1)}…${fmt(al.max, 1)}°</dd></div>
          <div><dt>audit</dt><dd><span class="pk-esito ${esito.c}">${esc(esito.t)}</span></dd></div>
        </dl>
        <a class="btn pk-scarica-uno" href="${r.url}" download="${esc(r.nome)}">Scarica</a>
      </li>`;
    }).join('');
  }

  /* =========================================================
     EVENTI
     ========================================================= */
  /** Riepilogo veloce (solo nomi dei file) da mostrare nella conferma. */
  function riepilogo(voci) {
    const gruppi = new Map();
    for (const v of voci) {
      const c = classifica(v.nome);
      if (!c || c.tipo === 'readme') continue;
      const dir = v.percorso.split('/').filter(Boolean).slice(0, -1).join('/');
      const r = gruppi.get(dir) || { n: 0, tipi: new Set(), byte: 0 };
      r.n++; r.tipi.add(c.tipo.toUpperCase()); r.byte += v.dim || 0;
      gruppi.set(dir, r);
    }
    return [...gruppi].sort((a, b) => a[0].localeCompare(b[0]));
  }

  async function aggiungi(voci) {
    $('pk-err').textContent = '';
    const gruppi = riepilogo(voci);
    if (!gruppi.length) {
      $('pk-err').textContent = 'Nessun file .csv o .s2p nella cartella.';
      if (misure.length) stato('Nessun file .csv o .s2p nella cartella.');
      return;
    }
    const radice = voci[0].percorso.split('/').filter(Boolean)[0];
    const file = gruppi.reduce((s, [, r]) => s + r.n, 0);
    const ok = await L.conferma({
      occhiello: 'Impacchetta',
      titolo: `${gruppi.length === 1 ? '1 misura trovata' : `${gruppi.length} misure trovate`} in ${radice}`,
      testo: `${file.toLocaleString('it-IT')} file .csv/.s2p, una misura per cartella. Gli altri file vengono ignorati. La lettura avviene nel browser.`,
      righe: gruppi.map(([dir, r]) => [dir.split('/').slice(1).join('/') || dir, `${r.n} file ${[...r.tipi].join('+')} · ${L.dimensione(r.byte)}`]),
      si: 'Leggi i file',
    });
    if (!ok) return;
    stato('Lettura dei file…');
    const nuove = await analizzaCartelle(voci);
    if (!nuove.length) {
      $('pk-err').textContent = 'Nessun file grezzo riconosciuto: servono file ±AAA.AAdeg.csv o ParserTouchstonePorts_N.s2p.';
      stato('');
      return;
    }
    const dirs = new Set(nuove.map(g => g.dir));
    misure = [...misure.filter(g => !dirs.has(g.dir)), ...nuove].sort((p, q) => p.dir.localeCompare(q.dir));
    risultati = [];
    $('pk-risultati').hidden = true;
    disegnaMisure();
    stato(`${misure.filter(g => !g.errore).length} misure pronte da impacchettare.`);
  }

  document.addEventListener('drop', async e => {
    if (document.body.dataset.modo !== 'pacchetto') return;
    e.preventDefault();
    $('pk-drop').classList.remove('is-over');
    await aggiungi(await L.daDrop(e.dataTransfer));
  });
  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, () => { if (document.body.dataset.modo === 'pacchetto') $('pk-drop').classList.add('is-over'); });
  }
  for (const id of ['pk-in', 'pk-in-2']) {
    $(id).addEventListener('change', async e => { await aggiungi(L.daFileList(e.target.files)); e.target.value = ''; });
  }

  $('pk-misure').addEventListener('input', e => {
    const card = e.target.closest('[data-i]'), k = e.target.dataset.k;
    if (!card || !k) return;
    const g = misure[+card.dataset.i];
    if (k === 'incl') g.incl = e.target.checked;
    else if (['amin', 'amax', 'passo', 'dist'].includes(k)) { const v = parseFloat(e.target.value); g[k] = isFinite(v) ? v : null; }
    else if (k === 'nome') { g.nome = e.target.value; }
    else g[k] = e.target.value;
  });
  // griglia e avvisi si ricalcolano quando un campo perde il fuoco (non a ogni tasto)
  $('pk-misure').addEventListener('change', e => { if (['incl', 'amin', 'amax', 'passo'].includes(e.target.dataset.k)) disegnaMisure(); });
  $('pk-misure').addEventListener('click', e => {
    const mod = e.target.closest('[data-modello]');
    if (mod) {
      misure[+mod.closest('[data-i]').dataset.i].modello = mod.dataset.modello;
      disegnaMisure();
      return;
    }
    const b = e.target.closest('[data-ripristina]');
    if (!b) return;
    Object.assign(misure[+b.dataset.ripristina], misure[+b.dataset.ripristina].auto);
    disegnaMisure();
  });
  $('pk-crea').addEventListener('click', () => crea().catch(e => stato(`Errore: ${e.message}`)));
  $('pk-svuota').addEventListener('click', () => {
    misure = []; risultati.forEach(r => URL.revokeObjectURL(r.url)); risultati = [];
    $('pk-risultati').hidden = true; stato(''); disegnaMisure();
  });
  $('pk-scarica').addEventListener('click', () => {
    // un clic per file, distanziati: i browser bloccano i download simultanei
    risultati.forEach((r, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = r.url; a.download = r.nome; document.body.append(a); a.click(); a.remove();
    }, i * 350));
  });
  $('pk-apri').addEventListener('click', () => L.apri(risultati.map(r => ({ nome: r.nome, blob: r.blob }))));
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-vai]');
    if (a) { e.preventDefault(); L.modo(a.dataset.vai); }
  });
})();
