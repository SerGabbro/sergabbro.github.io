/* =========================================================
   GABBRO — antenna-pack.js
   Antenna lab, "pack" section (tools/antenna.html).

   Turns raw VNA folders (one file per angle) into .rfm packages
   (RF Measurement, v1) read by antenna.js: an NPZ with
   "meta" as first entry and the RFM1 signature in the zip comment,
   so np.load opens it too.
   - only .csv and .s2p files are used, everything else is ignored;
     the angle comes from the file name: "…deg", ParserTouchstonePorts_N
     (hundredths of a degree) or the last number in the name;
   - CSV columns by header name, or in the order freq, S11 re/im, S21,
     S12, S22; 2-port Touchstone with a "# HZ S RI/MA/DB" option line;
   - every angle must have the same frequencies;
   - grid start, end and step are detected from the files and editable:
     rows without a file become NaN, files off the grid are left out;
   - each package is read back with the analysis code before download.
   ========================================================= */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const LAB = window.AntennaLab;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d).replace('.', ',').replace(/^-(0,?0*)$/, '$1');
  const S_PARAMS = ['S11', 'S21', 'S12', 'S22'];      // also the 2-port Touchstone column order
  const UNIT_SCALE = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };

  /* =========================================================
     FILE RECOGNITION
     ========================================================= */
  const RE_DATA = /\.(csv|s2p)$/i;
  const RE_DEG = /(-?\d+(?:[._]\d+)?)\s*deg/i;              // 002.00deg.csv, -07_00deg.csv, 180deg.csv
  const RE_TOUCHSTONE = /ParserTouchstonePorts_(-?\d+)/i;   // hundredths of a degree
  const RE_LAST_NUMBER = /(-?\d+(?:\.\d+)?)(?!.*\d)/;

  /** → { kind: 'csv'|'s2p', angle } | null for any other file. */
  function classify(name) {
    const ext = RE_DATA.exec(name);
    if (!ext) return null;
    const kind = ext[1].toLowerCase(), stem = name.slice(0, -4);
    let m = RE_DEG.exec(stem);
    if (m) return { kind, angle: parseFloat(m[1].replace('_', '.')) + 0 };
    m = RE_TOUCHSTONE.exec(stem);
    if (m) return { kind, angle: parseInt(m[1], 10) / 100 + 0 };
    m = RE_LAST_NUMBER.exec(stem);
    return { kind, angle: m ? parseFloat(m[1]) + 0 : NaN };
  }

  /* =========================================================
     PARSERS → { f: Float64Array [Hz], S: { S11: Float64Array(2n) interleaved, … } }
     ========================================================= */
  function parseCsv(text, name) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !/^\s*[#!]/.test(l));
    if (!lines.length) throw new Error(`${name}: file vuoto`);
    const sep = [',', ';', '\t'].reduce((a, c) => (lines[0].split(c).length > lines[0].split(a).length ? c : a), ',');
    let col = null, scale = 1;
    if (/[a-df-z]/i.test(lines[0])) {                   // header row (the exponent "e" does not count)
      const header = lines.shift().split(sep).map(x => x.trim().toLowerCase().replace(/\s+/g, '_'));
      col = {};
      header.forEach((h, i) => {
        const fq = /^f(?:req(?:uency|uenza)?)?(?:_?\[?(hz|khz|mhz|ghz)\]?)?$/.exec(h);
        if (fq && col.f == null) { col.f = i; scale = UNIT_SCALE[fq[1] || 'hz']; return; }
        const s = /^s(11|21|12|22)_?(re|real|im|imag)$/.exec(h);
        if (s) col[`S${s[1]}${s[2].startsWith('re') ? 're' : 'im'}`] = i;
      });
      const missing = ['f', ...S_PARAMS.flatMap(p => [`${p}re`, `${p}im`])].filter(k => col[k] == null);
      if (missing.length) throw new Error(`${name}: colonne non riconosciute (${missing.join(', ')}) nell'intestazione "${header.join(sep)}"`);
    } else {                                             // no header: freq, then re/im of S11 S21 S12 S22
      col = { f: 0 };
      S_PARAMS.forEach((p, j) => { col[`${p}re`] = 1 + 2 * j; col[`${p}im`] = 2 + 2 * j; });
    }
    const n = lines.length, f = new Float64Array(n), S = {};
    S_PARAMS.forEach(p => { S[p] = new Float64Array(2 * n); });
    lines.forEach((line, i) => {
      const v = line.split(sep).map(Number);
      if (v.length < 9) throw new Error(`${name}: riga ${i + 1} con ${v.length} colonne, ne servono 9`);
      f[i] = v[col.f] * scale;
      for (const p of S_PARAMS) { S[p][2 * i] = v[col[`${p}re`]]; S[p][2 * i + 1] = v[col[`${p}im`]]; }
    });
    return { f, S };
  }

  function parseS2p(text, name) {
    // Touchstone option line; defaults from the standard: GHZ S MA R 50
    let unit = 'ghz', format = 'ma';
    const nums = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/!.*/, '').trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        for (const t of line.slice(1).trim().toLowerCase().split(/\s+/)) {
          if (UNIT_SCALE[t]) unit = t;
          else if (['ri', 'ma', 'db'].includes(t)) format = t;
          else if (['y', 'z', 'h', 'g'].includes(t)) throw new Error(`${name}: parametri ${t.toUpperCase()}, servono parametri S`);
        }
        continue;
      }
      if (line.startsWith('[')) continue;                // Touchstone 2.0 keywords
      for (const t of line.split(/\s+/)) nums.push(Number(t));
    }
    if (nums.length % 9) throw new Error(`${name}: ${nums.length} valori, non multiplo di 9 (serve un Touchstone a 2 porte)`);
    const n = nums.length / 9, f = new Float64Array(n), S = {};
    S_PARAMS.forEach(p => { S[p] = new Float64Array(2 * n); });
    for (let i = 0; i < n; i++) {
      f[i] = nums[9 * i] * UNIT_SCALE[unit];
      S_PARAMS.forEach((p, j) => {
        const a = nums[9 * i + 1 + 2 * j], b = nums[9 * i + 2 + 2 * j];
        let re = a, im = b;
        if (format !== 'ri') {
          const mag = format === 'db' ? 10 ** (a / 20) : a, phase = b * Math.PI / 180;
          re = mag * Math.cos(phase); im = mag * Math.sin(phase);
        }
        S[p][2 * i] = re; S[p][2 * i + 1] = im;
      });
    }
    return { f, S };
  }

  async function sha256(buf) {
    if (!crypto.subtle) return null;                     // not available outside secure contexts (file://)
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* =========================================================
     ITEMS (one per folder)
     ========================================================= */
  // { dir, name, notes, kind, model, angles: [{ a, f, S, file }], f, hash,
  //   distance, start, end, step, detected, include, error }
  let items = [];
  let results = [];      // { name, blob, url, m }

  function setStatus(text) { $('pack-status').textContent = text; }

  async function scanFolders(files) {
    const groups = new Map();
    for (const file of files) {
      const dir = file.path.split('/').filter(Boolean).slice(0, -1).join('/');
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push({ ...file, cls: classify(file.name) });
    }
    const scanned = [];
    let done = 0;
    for (const [dir, group] of groups) {
      const data = group.filter(x => x.cls);
      if (!data.length) continue;
      const kinds = [...new Set(data.map(x => x.cls.kind))];
      const it = {
        dir, name: dir.split('/').pop() || 'misura', notes: '', kind: kinds.join('+'), angles: [],
        model: 'friis', distance: null, include: true, error: null,
      };
      try {
        if (kinds.length > 1) throw new Error('nella stessa cartella ci sono sia CSV sia S2P');
        const seen = new Set(), checksums = [];
        for (const x of data.filter(x => isFinite(x.cls.angle)).sort((p, q) => p.cls.angle - q.cls.angle)) {
          const buf = await x.read();
          checksums.push(`${x.name}:${await sha256(buf)}`);
          const parsed = (x.cls.kind === 'csv' ? parseCsv : parseS2p)(new TextDecoder().decode(buf), x.name);
          if (seen.has(x.cls.angle)) continue;             // same angle twice: keep the first file
          seen.add(x.cls.angle);
          it.angles.push({ a: x.cls.angle, f: parsed.f, S: parsed.S, file: x.name });
          if (++done % 40 === 0) setStatus(`Lettura dei file… ${done}/${files.length}`);
        }
        if (!it.angles.length) throw new Error('nessun file con un angolo nel nome');

        const f0 = it.angles[0].f;
        for (const x of it.angles) {
          const same = x.f.length === f0.length && x.f.every((v, i) => Math.abs(v - f0[i]) <= 1e-9 * Math.abs(f0[i]) + 1e-6);
          if (!same) throw new Error(`${x.file} ha frequenze diverse da ${it.angles[0].file}`);
        }
        for (let i = 1; i < f0.length; i++) if (!(f0[i] > f0[i - 1])) throw new Error(`${it.angles[0].file}: frequenze non crescenti`);
        it.f = f0;
        it.hash = checksums.every(s => !s.endsWith(':null')) ? await sha256(new TextEncoder().encode(checksums.sort().join('\n'))) : null;

        // detected grid (like build_angle_grid): the extreme angles and the smallest step between two files
        it.start = it.angles[0].a;
        it.end = it.angles[it.angles.length - 1].a;
        let step = Infinity;
        for (let i = 1; i < it.angles.length; i++) step = Math.min(step, it.angles[i].a - it.angles[i - 1].a);
        it.step = isFinite(step) ? +step.toFixed(9) : 1;
        it.detected = { start: it.start, end: it.end, step: it.step };
      } catch (e) {
        it.error = e.message;
      }
      scanned.push(it);
    }
    return scanned;
  }

  /* =========================================================
     OUTPUT GRID
     ========================================================= */

  /** Output grid from start, end and step. Each file goes to the row of its angle; rows without
      a file → NaN; files between two rows or outside start–end → left out. */
  function buildGrid(it) {
    const { start, end, step } = it;
    if (!(step > 0)) return { error: 'il passo deve essere positivo' };
    if (!(end >= start)) return { error: 'la fine deve essere maggiore o uguale all\'inizio' };
    const n = Math.round((end - start) / step) + 1;
    if (n > 100000) return { error: `${n.toLocaleString('it-IT')} righe: passo troppo piccolo` };
    const ang = Array.from({ length: n }, (_, i) => +(start + i * step).toFixed(9));
    const tol = Math.max(1e-6, step * 1e-3);
    const rows = new Map();
    let offGrid = 0, outside = 0;
    for (const x of it.angles) {
      if (x.a < start - tol || x.a > ang[n - 1] + tol) { outside++; continue; }
      const k = Math.round((x.a - start) / step);
      if (Math.abs(ang[k] - x.a) > tol) { offGrid++; continue; }
      rows.set(k, x);
    }
    return { ang, rows, missing: n - rows.size, offGrid, outside };
  }

  /* =========================================================
     RENDERING
     ========================================================= */
  function renderItems() {
    $('pack-work').hidden = !items.length;
    $('pack-drop').hidden = !!items.length;
    $('pack-items').innerHTML = items.map((it, i) => {
      if (it.error) {
        return `<article class="pack-card is-error"><header><strong>${esc(it.dir || it.name)}</strong></header>
          <p class="pack-error">${esc(it.error)}</p></article>`;
      }
      const grid = buildGrid(it), fDiv = it.f[it.f.length - 1] >= 1e9 ? 1e9 : 1e6, fUnit = fDiv === 1e9 ? 'GHz' : 'MHz';
      const edited = ['start', 'end', 'step'].some(k => it[k] !== it.detected[k]);
      const numberField = (key, label, unit, extra = '') => `<label class="pack-field">
        <span class="pack-label">${label}<span class="unit">${unit}</span></span>
        <input type="number" data-k="${key}" value="${it[key] ?? ''}" step="any" ${extra}></label>`;
      const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
      const choice = (attr, value, current, label) =>
        `<button type="button" role="radio" data-${attr}="${value}" aria-checked="${value === current}">${label}</button>`;
      return `<article class="pack-card${it.include ? '' : ' is-off'}" data-i="${i}">
        <header class="pack-head">
          <input type="checkbox" class="pack-include" data-k="include" ${it.include ? 'checked' : ''} aria-label="Includi la misura">
          <div class="pack-title">
            <input type="text" class="pack-name" data-k="name" value="${esc(it.name)}" aria-label="Nome della misura" spellcheck="false">
            <span class="pack-dir" title="${esc(it.dir)}">${esc(it.dir)}</span>
          </div>
          <span class="tag tag-cyan pack-kind">${it.angles.length} file ${it.kind.toUpperCase()}</span>
        </header>
        <div class="pack-body">
          <dl class="pack-facts">
            ${fact('griglia', grid.error ? `<span class="bad">${esc(grid.error)}</span>` : `${grid.ang.length} righe · ${grid.rows.size} con file`)}
            ${fact('frequenze', `${fmt(it.f[0] / fDiv, 3)}–${fmt(it.f[it.f.length - 1] / fDiv, 3)} ${fUnit}<br><span class="dim">${it.f.length} punti</span>`)}
          </dl>
          <div class="pack-form">
            <div class="pack-model">
              <span class="pack-label">Grandezza</span>
              <div class="seg" role="radiogroup" aria-label="Modello">
                ${choice('model', 'friis', it.model, 'Guadagno con Friis')}${choice('model', 'raw', it.model, '|S| grezzo')}
              </div>
              <span class="pack-hint">${it.model === 'friis'
                ? 'Due antenne uguali a distanza nota: G = |S21| · 4πR f / c, in dBi.'
                : 'Nessuna ipotesi sul setup: |S21| in dB, senza distanza.'}</span>
            </div>
            <div class="pack-fields${it.model === 'friis' ? '' : ' no-distance'}">
              ${it.model === 'friis' ? numberField('distance', 'Distanza', 'm', 'min="0.001" placeholder="obbligatoria"') : ''}
              ${numberField('start', 'Inizio', '°')}
              ${numberField('end', 'Fine', '°')}
              ${numberField('step', 'Passo', '°', 'min="0"')}
            </div>
            ${edited ? `<p class="pack-detected">Rilevati dai file: ${fmt(it.detected.start, 2)}…${fmt(it.detected.end, 2)}°, passo ${fmt(it.detected.step, 2)}° · <button type="button" class="link-btn" data-reset="${i}">ripristina</button></p>` : ''}
            <label class="pack-field pack-notes">
              <span class="pack-label">Note</span>
              <input type="text" data-k="notes" value="${esc(it.notes)}" placeholder="facoltative" autocomplete="off">
            </label>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function validate() {
    const errors = [], chosen = items.filter(it => it.include && !it.error);
    if (!chosen.length) errors.push('nessuna misura selezionata');
    const names = chosen.map(it => it.name.trim());
    if (names.some(n => !n)) errors.push('una misura non ha nome');
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    if (repeated.length) errors.push(`nomi ripetuti: ${[...new Set(repeated)].join(', ')}`);
    for (const it of chosen) {
      const grid = buildGrid(it), label = it.name.trim() || it.dir;
      if (it.model === 'friis' && !(it.distance > 0)) errors.push(`${label}: manca la distanza (o scegli |S| grezzo)`);
      if (grid.error) errors.push(`${label}: ${grid.error}`);
      else if (!grid.rows.size) errors.push(`${label}: nessun file sulla griglia`);
    }
    return { errors, chosen };
  }

  async function createPackages() {
    const { errors, chosen } = validate();
    if (errors.length) { setStatus(`Impossibile creare i pacchetti: ${errors.join(' · ')}`); return; }
    results.forEach(r => URL.revokeObjectURL(r.url));
    results = [];
    for (const it of chosen) {
      setStatus(`Creo ${it.name}…`);
      const grid = buildGrid(it), { ang, rows } = grid, nA = ang.length, nF = it.f.length;
      const S = {};
      S_PARAMS.forEach(p => { S[p] = new Float32Array(2 * nA * nF).fill(NaN); });
      for (const [i, x] of rows) S_PARAMS.forEach(p => S[p].set(x.S[p], i * nF * 2));

      // the meta keys are part of the .rfm format (see antenna.js) and stay in Italian
      const meta = {
        formato: LAB.FORMAT, versione: LAB.VERSION,
        misura: it.name.trim(), modello: it.model === 'friis' ? 'friis' : 'nessuno',
        ...(it.model === 'friis' ? { distanza_m: it.distance } : {}),
        note: it.notes.trim(),
        unita: { frequenze: 'Hz', angoli: 'deg' },
        griglia: { angoli: nA, frequenze: nF, angoli_mancanti: grid.missing, passo_deg: it.step,
          intervallo_deg: [ang[0], ang[nA - 1]], file_esclusi: grid.offGrid + grid.outside },
        sorgente: { formato: it.kind, cartella: it.dir, file: grid.rows.size, sha256: it.hash },
        creato: new Date().toISOString(),
        programma: 'https://sergabbro.github.io/tools/antenna.html',
      };
      const blob = await Npz.write({
        meta: { dtype: '<U', shape: [], data: [JSON.stringify(meta)] },
        frequenze: { dtype: '<f8', shape: [nF], data: it.f },
        angoli: { dtype: '<f8', shape: [nA], data: ang },
        ...Object.fromEntries(S_PARAMS.map(p => [p, { dtype: '<c8', shape: [nA, nF], data: S[p] }])),
      }, { comment: `${LAB.SIGNATURE} RF Measurement · ${meta.misura}` });
      // check: the package must read back with the same code the analysis uses
      const m = LAB.buildMeasurement(await Npz.read(await blob.arrayBuffer()));
      const name = it.name.trim().replace(/[^\w.-]+/g, '_') + '.rfm';
      results.push({ name, blob, url: URL.createObjectURL(blob), m });
    }
    renderResults();
    setStatus(`${results.length} ${results.length === 1 ? 'pacchetto creato' : 'pacchetti creati'} e riletti correttamente.`);
  }

  function renderResults() {
    $('pack-results').hidden = !results.length;
    const n = results.length;
    $('pack-results-title').textContent = n === 1 ? '1 pacchetto pronto' : `${n} pacchetti pronti`;
    $('pack-results-total').textContent = `${LAB.formatSize(results.reduce((s, r) => s + r.blob.size, 0))} in totale · già riletti con l'analisi`;
    $('pack-list').innerHTML = results.map(r => `<li class="pack-file">
        <div class="pack-file-name">
          <strong>${esc(r.name)}</strong>
          <div class="pack-file-tags">
            <span class="tag ${r.m.distance != null ? 'tag-cyan' : 'tag-purple'}">${r.m.distance != null ? `Friis · ${fmt(r.m.distance, 2)} m` : '|S| grezzo'}</span>
            <span class="tag tag-gray">${r.m.nA} × ${r.m.nF}</span>
            <span class="tag tag-gray">${LAB.formatSize(r.blob.size)}</span>
          </div>
        </div>
        <a class="btn pack-download" href="${r.url}" download="${esc(r.name)}">Scarica</a>
      </li>`).join('');
  }

  /* =========================================================
     EVENTS
     ========================================================= */

  /** Quick summary from file names only, for the confirmation dialog. */
  function summarize(files) {
    const groups = new Map();
    for (const file of files) {
      const c = classify(file.name);
      if (!c) continue;
      const dir = file.path.split('/').filter(Boolean).slice(0, -1).join('/');
      const g = groups.get(dir) || { count: 0, kinds: new Set(), bytes: 0 };
      g.count++; g.kinds.add(c.kind.toUpperCase()); g.bytes += file.size || 0;
      groups.set(dir, g);
    }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  }

  async function addFolders(files) {
    $('pack-error').textContent = '';
    const groups = summarize(files);
    if (!groups.length) {
      $('pack-error').textContent = 'Nessun file .csv o .s2p nella cartella.';
      if (items.length) setStatus('Nessun file .csv o .s2p nella cartella.');
      return;
    }
    const root = files[0].path.split('/').filter(Boolean)[0];
    const total = groups.reduce((s, [, g]) => s + g.count, 0);
    const ok = await LAB.confirm({
      eyebrow: 'Impacchetta',
      title: `${groups.length === 1 ? '1 misura trovata' : `${groups.length} misure trovate`} in ${root}`,
      text: `${total.toLocaleString('it-IT')} file .csv/.s2p, una misura per cartella. Gli altri file vengono ignorati. La lettura avviene nel browser.`,
      rows: groups.map(([dir, g]) => [dir.split('/').slice(1).join('/') || dir, `${g.count} file ${[...g.kinds].join('+')} · ${LAB.formatSize(g.bytes)}`]),
      ok: 'Leggi i file',
    });
    if (!ok) return;
    setStatus('Lettura dei file…');
    const scanned = await scanFolders(files);
    const dirs = new Set(scanned.map(it => it.dir));
    items = [...items.filter(it => !dirs.has(it.dir)), ...scanned].sort((p, q) => p.dir.localeCompare(q.dir));
    results = [];
    $('pack-results').hidden = true;
    renderItems();
    setStatus(`${items.filter(it => !it.error).length} misure pronte da impacchettare.`);
  }

  const isPackMode = () => document.body.dataset.mode === 'pack';
  document.addEventListener('drop', async e => {
    if (!isPackMode()) return;
    e.preventDefault();
    $('pack-drop').classList.remove('is-over');
    await addFolders(await LAB.fromDrop(e.dataTransfer));
  });
  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, () => { if (isPackMode()) $('pack-drop').classList.add('is-over'); });
  }
  for (const id of ['pack-input', 'pack-input-more']) {
    $(id).addEventListener('change', async e => { await addFolders(LAB.fromFileList(e.target.files)); e.target.value = ''; });
  }

  const NUMERIC_KEYS = ['start', 'end', 'step', 'distance'];
  $('pack-items').addEventListener('input', e => {
    const card = e.target.closest('[data-i]'), key = e.target.dataset.k;
    if (!card || !key) return;
    const it = items[+card.dataset.i];
    if (key === 'include') it.include = e.target.checked;
    else if (NUMERIC_KEYS.includes(key)) { const v = parseFloat(e.target.value); it[key] = isFinite(v) ? v : null; }
    else it[key] = e.target.value;
  });
  // the grid is recomputed when a field is committed, not on every keystroke
  $('pack-items').addEventListener('change', e => {
    if (['include', 'start', 'end', 'step'].includes(e.target.dataset.k)) renderItems();
  });
  $('pack-items').addEventListener('click', e => {
    const card = e.target.closest('[data-i]');
    const it = card && items[+card.dataset.i];
    const model = e.target.closest('[data-model]'), reset = e.target.closest('[data-reset]');
    if (model) {
      it.model = model.dataset.model;
    } else if (reset) {
      Object.assign(it, it.detected);
    } else {
      return;
    }
    renderItems();
  });
  $('pack-create').addEventListener('click', () => createPackages().catch(e => setStatus(`Errore: ${e.message}`)));
  $('pack-clear').addEventListener('click', () => {
    items = [];
    results.forEach(r => URL.revokeObjectURL(r.url));
    results = [];
    $('pack-results').hidden = true;
    setStatus('');
    renderItems();
  });
  $('pack-download-all').addEventListener('click', () => {
    // one click per file, spaced out: browsers block simultaneous downloads
    results.forEach((r, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = r.url; a.download = r.name; document.body.append(a); a.click(); a.remove();
    }, i * 350));
  });
  $('pack-open').addEventListener('click', () => LAB.open(results.map(r => ({ name: r.name, blob: r.blob }))));
})();
