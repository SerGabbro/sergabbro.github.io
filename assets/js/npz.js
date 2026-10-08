/* =========================================================
   GABBRO — npz.js
   Minimal NumPy .npz reader/writer for the browser, no dependencies.

   An .npz file is a zip archive of .npy files. Reading walks the
   zip central directory, inflates each entry with the native
   DecompressionStream and parses the .npy header. Writing builds
   the .npy bytes, deflates them with CompressionStream and lays
   out a plain (non-zip64) archive that np.load reads.

   Supported dtypes: f4, f8, c8, c16 and fixed-width unicode (U).
   Complex arrays stay interleaved (re, im, re, im, …).
   ========================================================= */
(() => {
  'use strict';

  const u16 = (view, at) => view.getUint16(at, true);
  const u32 = (view, at) => view.getUint32(at, true);

  const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50;

  /** Offset of the end-of-central-directory record (it sits in the last 64 KiB). */
  function findEnd(buf) {
    const view = new DataView(buf);
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (u32(view, i) === SIG_END) return i;
    }
    return -1;
  }

  /* ---------- reading ---------- */

  /** Zip entries: { name, method, compressedSize, dataStart }. */
  function entries(buf) {
    const view = new DataView(buf), end = findEnd(buf);
    if (end < 0) throw new Error('non è un archivio zip');
    const count = u16(view, end + 10), out = [], dec = new TextDecoder();
    let p = u32(view, end + 16);
    for (let k = 0; k < count; k++) {
      if (u32(view, p) !== SIG_CENTRAL) throw new Error('directory centrale corrotta');
      const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32);
      const local = u32(view, p + 42);
      if (u32(view, local) !== SIG_LOCAL) throw new Error('intestazione locale corrotta');
      out.push({
        name: dec.decode(new Uint8Array(buf, p + 46, nameLen)),
        method: u16(view, p + 10),
        compressedSize: u32(view, p + 20),
        // the local header has its own name/extra lengths, which may differ from the central ones
        dataStart: local + 30 + u16(view, local + 26) + u16(view, local + 28),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function extract(buf, entry) {
    const raw = new Uint8Array(buf, entry.dataStart, entry.compressedSize);
    if (entry.method === 0) return raw.slice().buffer;
    if (entry.method !== 8) throw new Error(`compressione zip non supportata in ${entry.name}`);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }

  const TYPED = { f4: Float32Array, f8: Float64Array, c8: Float32Array, c16: Float64Array };

  /** One .npy file → { dtype, shape, fortran, complex, data }. */
  function parseNpy(buf, name) {
    const bytes = new Uint8Array(buf), view = new DataView(buf);
    if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.subarray(1, 6)) !== 'NUMPY') {
      throw new Error(`${name}: non è un file .npy`);
    }
    const major = bytes[6];
    const headerLen = major === 1 ? u16(view, 8) : u32(view, 8);
    const start = major === 1 ? 10 : 12;
    const header = new TextDecoder(major >= 3 ? 'utf-8' : 'latin1').decode(bytes.subarray(start, start + headerLen));

    const descr = /'descr'\s*:\s*'([^']+)'/.exec(header);
    const shapeMatch = /'shape'\s*:\s*\(([^)]*)\)/.exec(header);
    if (!descr || !shapeMatch) throw new Error(`${name}: intestazione .npy non riconosciuta`);
    const fortran = /'fortran_order'\s*:\s*True/.test(header);
    const shape = shapeMatch[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    const count = shape.reduce((a, c) => a * c, 1);
    const offset = start + headerLen;

    const m = /^[<|=]([a-zA-Z])(\d+)$/.exec(descr[1]);
    if (!m) throw new Error(`${name}: tipo ${descr[1]} non supportato`);
    const [, kind, width] = m;

    if (kind === 'U') {                                   // fixed-width UTF-32LE strings
      const w = +width, chars = new DataView(buf, offset), data = [];
      for (let i = 0; i < count; i++) {
        let s = '';
        for (let j = 0; j < w; j++) {
          const c = chars.getUint32((i * w + j) * 4, true);
          if (!c) break;
          s += String.fromCodePoint(c);
        }
        data.push(s);
      }
      return { dtype: descr[1], shape, fortran, complex: false, data };
    }

    const Typed = TYPED[kind + width];
    if (!Typed) throw new Error(`${name}: tipo ${descr[1]} non supportato`);
    const complex = kind === 'c', len = complex ? 2 * count : count;
    // copy: the data offset is not always aligned to the element size
    const data = new Typed(buf.slice(offset, offset + len * Typed.BYTES_PER_ELEMENT));
    return { dtype: descr[1], shape, fortran, complex, data };
  }

  /** .npz ArrayBuffer → { arrayName: parsed .npy }. */
  async function read(buf) {
    const out = {};
    for (const entry of entries(buf)) {
      if (!entry.name.endsWith('.npy')) continue;
      out[entry.name.slice(0, -4)] = parseNpy(await extract(buf, entry), entry.name);
    }
    return out;
  }

  /** The zip archive comment ('' if there is none). */
  function comment(buf) {
    const end = findEnd(buf);
    if (end < 0) return '';
    const view = new DataView(buf);
    return new TextDecoder().decode(new Uint8Array(buf, end + 22, u16(view, end + 20)));
  }

  /* ---------- writing ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** { dtype: '<f8'|'<f4'|'<c8'|'<c16'|'<U', shape, data } → .npy v1.0 bytes.
      Complex data is interleaved (re, im); '<U' data is an array of strings. */
  function buildNpy(arr) {
    let body, descr = arr.dtype;
    if (arr.dtype === '<U') {
      const codes = arr.data.map(s => [...s].map(c => c.codePointAt(0)));
      const w = Math.max(1, ...codes.map(c => c.length));
      descr = `<U${w}`;
      const u = new Uint32Array(codes.length * w);
      codes.forEach((c, i) => u.set(c, i * w));
      body = new Uint8Array(u.buffer);
    } else {
      const Typed = { '<f8': Float64Array, '<f4': Float32Array, '<c16': Float64Array, '<c8': Float32Array }[arr.dtype];
      if (!Typed) throw new Error(`scrittura del tipo ${arr.dtype} non supportata`);
      const v = arr.data instanceof Typed ? arr.data : Typed.from(arr.data);
      body = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    }
    const shape = arr.shape.length === 1 ? `(${arr.shape[0]},)` : `(${arr.shape.join(', ')})`;
    let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shape}, }`;
    // like NumPy: pad the header with spaces so the data starts on a 64-byte boundary, end with \n
    header += ' '.repeat(63 - ((10 + header.length) % 64)) + '\n';
    const out = new Uint8Array(10 + header.length + body.length);
    out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, header.length & 0xff, header.length >> 8]);
    for (let i = 0; i < header.length; i++) out[10 + i] = header.charCodeAt(i);
    out.set(body, 10 + header.length);
    return out;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** { name: array } → compressed .npz Blob (like np.savez_compressed). Key order is
      archive order; `comment` goes into the zip comment (the .rfm format uses it). */
  async function write(arrays, { comment: text = '' } = {}) {
    const enc = new TextEncoder(), locals = [], centrals = [];
    let offset = 0;
    for (const [name, arr] of Object.entries(arrays)) {
      const raw = buildNpy(arr), nameBytes = enc.encode(`${name}.npy`);
      const data = await deflate(raw), crc = crc32(raw);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, SIG_LOCAL, true); local.setUint16(4, 20, true); local.setUint16(8, 8, true);
      local.setUint16(12, 0x21, true);                          // date 1980-01-01, like NumPy
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true);
      local.setUint16(26, nameBytes.length, true);
      locals.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, SIG_CENTRAL, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
      central.setUint16(10, 8, true); central.setUint16(14, 0x21, true);
      central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, raw.length, true);
      central.setUint16(28, nameBytes.length, true); central.setUint32(42, offset, true);
      centrals.push(new Uint8Array(central.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = centrals.reduce((s, b) => s + b.length, 0), count = centrals.length / 2;
    const commentBytes = enc.encode(text);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, SIG_END, true);
    end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    end.setUint16(20, commentBytes.length, true);
    return new Blob([...locals, ...centrals, new Uint8Array(end.buffer), commentBytes], { type: 'application/octet-stream' });
  }

  window.Npz = { read, write, comment };
})();
