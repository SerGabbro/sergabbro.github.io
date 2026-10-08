/* =========================================================
   GABBRO — npz.js
   Lettore di file .npz di NumPy (np.savez / np.savez_compressed)
   interamente nel browser, senza dipendenze.

   Un .npz è uno zip di file .npy: si legge la directory
   centrale (anche zip64, che NumPy usa sempre in scrittura),
   si decomprimono le voci con DecompressionStream e si
   interpreta l'intestazione .npy di ciascun array.

   Lettura: f4, f8, c8, c16, i1–i8, u1–u8, b1, U.
   Scrittura (Npz.scrivi): f4, f8, c8, c16, U; zip compresso
   senza zip64, leggibile da np.load.
   I complessi restano interlacciati (re, im, re, im, …).
   ========================================================= */
(() => {
  'use strict';

  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => Number(v.getBigUint64(o, true));

  /* ---------- zip ---------- */

  function voci(buf) {
    const v = new DataView(buf);
    // fine della directory centrale: firma 0x06054b50 negli ultimi 64 KiB
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('non è un archivio zip/npz');

    let n = u16(v, eocd + 10);
    let cdOff = u32(v, eocd + 16);
    // zip64: localizzatore subito prima dell'EOCD
    if ((cdOff === 0xffffffff || n === 0xffff) && eocd >= 20 && u32(v, eocd - 20) === 0x07064b50) {
      const e64 = u64(v, eocd - 12);
      n = u64(v, e64 + 32);
      cdOff = u64(v, e64 + 48);
    }

    const out = [];
    let p = cdOff;
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (u32(v, p) !== 0x02014b50) throw new Error('directory centrale corrotta');
      const metodo = u16(v, p + 10);
      let comp = u32(v, p + 20), size = u32(v, p + 24);
      const lNome = u16(v, p + 28), lExtra = u16(v, p + 30), lComm = u16(v, p + 32);
      let loc = u32(v, p + 42);
      const nome = dec.decode(new Uint8Array(buf, p + 46, lNome));

      // campo extra zip64 (id 0x0001): contiene solo i valori saturati, in quest'ordine
      let e = p + 46 + lNome;
      const eFine = e + lExtra;
      while (e + 4 <= eFine) {
        const id = u16(v, e), len = u16(v, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(v, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(v, q); q += 8; }
          if (loc === 0xffffffff) { loc = u64(v, q); }
        }
        e += 4 + len;
      }
      out.push({ nome, metodo, comp, size, loc });
      p += 46 + lNome + lExtra + lComm;
    }

    // l'inizio dei dati dipende dall'intestazione locale (il suo extra può differire)
    for (const x of out) {
      if (u32(v, x.loc) !== 0x04034b50) throw new Error(`intestazione locale corrotta: ${x.nome}`);
      x.dati = x.loc + 30 + u16(v, x.loc + 26) + u16(v, x.loc + 28);
    }
    return out;
  }

  async function estrai(buf, x) {
    const grezzi = new Uint8Array(buf, x.dati, x.comp);
    if (x.metodo === 0) return grezzi.slice().buffer;
    if (x.metodo !== 8) throw new Error(`compressione zip non supportata (${x.metodo}) in ${x.nome}`);
    if (typeof DecompressionStream === 'undefined') throw new Error('il browser non supporta DecompressionStream');
    const s = new Blob([grezzi]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(s).arrayBuffer();
  }

  /* ---------- npy ---------- */

  const TIPI = {
    f4: Float32Array, f8: Float64Array,
    c8: Float32Array, c16: Float64Array,
    i1: Int8Array, i2: Int16Array, i4: Int32Array, i8: BigInt64Array,
    u1: Uint8Array, u2: Uint16Array, u4: Uint32Array, u8: BigUint64Array,
    b1: Uint8Array,
  };

  function npy(buf, nome) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x93 || String.fromCharCode(...b.subarray(1, 6)) !== 'NUMPY') {
      throw new Error(`${nome}: non è un file .npy`);
    }
    const v = new DataView(buf);
    const ver = b[6];
    const lh = ver === 1 ? u16(v, 8) : u32(v, 8);
    const inizio = ver === 1 ? 10 : 12;
    const h = new TextDecoder(ver >= 3 ? 'utf-8' : 'latin1').decode(b.subarray(inizio, inizio + lh));

    const descr = /'descr'\s*:\s*'([^']+)'/.exec(h);
    const forma = /'shape'\s*:\s*\(([^)]*)\)/.exec(h);
    if (!descr || !forma) throw new Error(`${nome}: intestazione .npy non riconosciuta (array strutturato?)`);
    const fortran = /'fortran_order'\s*:\s*True/.test(h);
    const shape = forma[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    const n = shape.reduce((a, c) => a * c, 1);

    if (/O/.test(descr[1])) {
      throw new Error(`${nome}: array di oggetti Python (pickle), non leggibile fuori da Python: salvalo come array numerico`);
    }
    const m = /^([<>|=])([a-zA-Z])(\d+)$/.exec(descr[1]);
    if (!m) throw new Error(`${nome}: tipo ${descr[1]} non supportato`);
    const [, ordine, tipo, larg] = m;
    if (ordine === '>' && +larg > 1) throw new Error(`${nome}: big-endian non supportato`);

    const off = inizio + lh;
    if (tipo === 'U') {                       // stringhe UTF-32LE a larghezza fissa
      const w = +larg, dv = new DataView(buf, off), out = [];
      for (let i = 0; i < n; i++) {
        let s = '';
        for (let j = 0; j < w; j++) {
          const c = dv.getUint32((i * w + j) * 4, true);
          if (!c) break;
          s += String.fromCodePoint(c);
        }
        out.push(s);
      }
      return { dtype: descr[1], shape, fortran, complesso: false, data: out };
    }

    const chiave = tipo.toLowerCase() + larg;
    const T = TIPI[chiave === 'b1' ? 'b1' : chiave];
    if (!T) throw new Error(`${nome}: tipo ${descr[1]} non supportato`);
    const complesso = tipo === 'c';
    const len = complesso ? 2 * n : n;
    // copia allineata: l'offset dei dati non è sempre multiplo della dimensione dell'elemento
    const data = new T(buf.slice(off, off + len * T.BYTES_PER_ELEMENT));
    return { dtype: descr[1], shape, fortran, complesso, data };
  }

  /* ---------- API ---------- */

  /** Legge un .npz (ArrayBuffer) → { nome_array: { dtype, shape, fortran, complesso, data } } */
  async function leggiNpz(buf) {
    const out = {};
    for (const x of voci(buf)) {
      if (!x.nome.endsWith('.npy')) continue;
      out[x.nome.slice(0, -4)] = npy(await estrai(buf, x), x.nome);
    }
    return out;
  }

  /* ---------- scrittura ---------- */

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Un array → byte .npy v1.0. `a` = { dtype: '<f8'|'<f4'|'<c8'|'<c16'|'<U', shape: [...], data }.
      Per i complessi `data` è interlacciato (re, im); per '<U' è un array di stringhe. */
  function scriviNpy(a) {
    let corpo, descr = a.dtype;
    if (a.dtype === '<U') {
      const cps = a.data.map(s => [...s].map(c => c.codePointAt(0)));
      const w = Math.max(1, ...cps.map(c => c.length));
      descr = `<U${w}`;
      const u = new Uint32Array(cps.length * w);
      cps.forEach((c, i) => u.set(c, i * w));
      corpo = new Uint8Array(u.buffer);
    } else {
      const T = { '<f8': Float64Array, '<f4': Float32Array, '<c16': Float64Array, '<c8': Float32Array }[a.dtype];
      if (!T) throw new Error(`scrittura del tipo ${a.dtype} non supportata`);
      const v = a.data instanceof T ? a.data : T.from(a.data);
      corpo = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
    const forma = a.shape.length === 1 ? `(${a.shape[0]},)` : `(${a.shape.join(', ')})`;
    let h = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${forma}, }`;
    // intestazione allineata a 64 byte e chiusa da \n, come fa NumPy
    h += ' '.repeat(63 - ((10 + h.length) % 64)) + '\n';
    const out = new Uint8Array(10 + h.length + corpo.length);
    out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, h.length & 0xff, h.length >> 8]);
    for (let i = 0; i < h.length; i++) out[10 + i] = h.charCodeAt(i);
    out.set(corpo, 10 + h.length);
    return out;
  }

  async function comprimi(b) {
    const s = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /** { nome: array } → Blob .npz compresso (come np.savez_compressed). */
  async function scriviNpz(arrays) {
    const enc = new TextEncoder(), parti = [], centrale = [];
    let off = 0;
    for (const [nome, a] of Object.entries(arrays)) {
      const raw = scriviNpy(a), nomeB = enc.encode(`${nome}.npy`);
      const dati = typeof CompressionStream === 'undefined' ? raw : await comprimi(raw);
      const metodo = dati === raw ? 0 : 8, crc = crc32(raw);
      if (raw.length >= 0xffffffff) throw new Error(`${nome}: array troppo grande per uno zip senza zip64`);

      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(8, metodo, true);
      loc.setUint16(12, 0x21, true);                       // 1980-01-01, come NumPy
      loc.setUint32(14, crc, true); loc.setUint32(18, dati.length, true); loc.setUint32(22, raw.length, true);
      loc.setUint16(26, nomeB.length, true);
      parti.push(new Uint8Array(loc.buffer), nomeB, dati);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint16(10, metodo, true); cd.setUint16(14, 0x21, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, dati.length, true); cd.setUint32(24, raw.length, true);
      cd.setUint16(28, nomeB.length, true); cd.setUint32(42, off, true);
      centrale.push(new Uint8Array(cd.buffer), nomeB);
      off += 30 + nomeB.length + dati.length;
    }
    const lungCd = centrale.reduce((s, b) => s + b.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, centrale.length / 2, true); eocd.setUint16(10, centrale.length / 2, true);
    eocd.setUint32(12, lungCd, true); eocd.setUint32(16, off, true);
    return new Blob([...parti, ...centrale, new Uint8Array(eocd.buffer)], { type: 'application/octet-stream' });
  }

  window.Npz = { leggi: leggiNpz, scrivi: scriviNpz, npy };
})();
