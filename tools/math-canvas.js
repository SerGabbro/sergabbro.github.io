/* =========================================
   MATH CANVAS — math-canvas.js
   Fourier Series + Taylor Series
   ========================================= */

'use strict';

/* G() must be declared first — used by all renderers */
function G(id) { return document.getElementById(id); }

var PI  = Math.PI;
var TAU = 2 * PI;

/* =========================================
   PALETTE
   ========================================= */

function spectrumHue(n, N) {
  var t = N <= 1 ? 0 : (n - 1) / (N - 1);
  if (t < 0.5) return 180 - 140 * (t / 0.5);
  return 40 + 260 * ((t - 0.5) / 0.5);
}
function spectrumColor(n, N) {
  return 'hsl(' + spectrumHue(n, N).toFixed(1) + ',85%,62%)';
}

var COMP_COLORS = [
  '#f59e0b','#22d3ee','#4ade80','#f472b6','#a78bfa',
  '#fb7185','#60a5fa','#facc15','#34d399','#c084fc',
];

/* =========================================
   FOURIER MATH
   ========================================= */

function fourierHarmonic(type, n, t) {
  var x = TAU * t;
  switch (type) {
    case 'square':
      if (n % 2 === 0) return 0;
      return (4 / PI) * Math.sin(n * x) / n;
    case 'triangle':
      if (n % 2 === 0) return 0;
      return (8 / (PI * PI)) * Math.pow(-1, (n - 1) / 2) * Math.sin(n * x) / (n * n);
    case 'sawtooth':
      return (2 / PI) * Math.pow(-1, n + 1) * Math.sin(n * x) / n;
    case 'sawtooth_down':
      return -(2 / PI) * Math.pow(-1, n + 1) * Math.sin(n * x) / n;
    case 'pulse_25':
      return (2 / (n * PI)) * Math.sin(n * PI * 0.25) * Math.cos(n * x);
    case 'pulse_10':
      return (2 / (n * PI)) * Math.sin(n * PI * 0.10) * Math.cos(n * x);
    case 'semicircle':
      if (n === 1) return 0.5 * Math.sin(x);
      if (n % 2 === 1) return 0;
      return -(2 / PI) * Math.cos(n * x) / (4 * (n / 2) * (n / 2) - 1);
    case 'fullrect':
      if (n % 2 === 1) return 0;
      return -(4 / PI) * Math.cos(n * x) / (4 * (n / 2) * (n / 2) - 1);
    case 'parabola':
      return (4 * Math.pow(-1, n) / (n * n)) * Math.cos(n * x);
    case 'trapezoid': {
      var r = 0.4, d = 0.1;
      if (n % 2 === 0) return 0;
      return (4 / (n * n * PI * PI * d)) * Math.sin(n * PI * r) * Math.sin(n * PI * d) * Math.sin(n * x);
    }
    case 'staircase': {
      var bn = (4 / (n * PI)) * (
        0.25 * (Math.cos(0)             - Math.cos(n * PI * 0.25)) +
        0.5  * (Math.cos(n * PI * 0.25) - Math.cos(n * PI * 0.5))  +
        0.75 * (Math.cos(n * PI * 0.5)  - Math.cos(n * PI * 0.75)) +
        1.0  * (Math.cos(n * PI * 0.75) - Math.cos(n * PI))
      );
      return bn * Math.sin(n * x);
    }
    case 'weierstrass': {
      var k = n - 1;
      return Math.pow(0.5, k) * Math.cos(Math.pow(3, k) * x);
    }
  }
  return 0;
}

function fourierDC(type) {
  switch (type) {
    case 'semicircle': return 1 / PI;
    case 'fullrect':   return 2 / PI;
    case 'parabola':   return -PI * PI / 3;
    case 'pulse_25':   return 0.25;
    case 'pulse_10':   return 0.10;
    default:           return 0;
  }
}

function fourierSum(type, N, t) {
  var s = fourierDC(type);
  for (var n = 1; n <= N; n++) s += fourierHarmonic(type, n, t);
  return s;
}

function fourierAmp(type, n) {
  var M = 512, an = 0, bn = 0;
  for (var i = 0; i < M; i++) {
    var v = fourierHarmonic(type, n, i / M);
    var x = TAU * i / M;
    an += v * Math.cos(n * x);
    bn += v * Math.sin(n * x);
  }
  an *= 2 / M; bn *= 2 / M;
  return { amp: Math.sqrt(an * an + bn * bn), ph: Math.atan2(bn, an) };
}

/* =========================================
   TAYLOR MATH
   ========================================= */

function factorial(n) {
  var r = 1;
  for (var i = 2; i <= n; i++) r *= i;
  return r;
}

function taylorTerm(func, k, x) {
  switch (func) {
    case 'sin':    return Math.pow(-1, k) * Math.pow(x, 2*k+1) / factorial(2*k+1);
    case 'cos':    return Math.pow(-1, k) * Math.pow(x, 2*k)   / factorial(2*k);
    case 'exp':    return Math.pow(x, k)                        / factorial(k);
    case 'log':    if (k === 0) return 0; return Math.pow(-1, k+1) * Math.pow(x, k) / k;
    case 'sinh':   return Math.pow(x, 2*k+1) / factorial(2*k+1);
    case 'cosh':   return Math.pow(x, 2*k)   / factorial(2*k);
    case 'arctan': return Math.pow(-1, k) * Math.pow(x, 2*k+1) / (2*k+1);
    case 'erf':    return (2 / Math.sqrt(PI)) * Math.pow(-1, k) * Math.pow(x, 2*k+1) / (factorial(k) * (2*k+1));
  }
  return 0;
}

function taylorSum(func, terms, x) {
  var s = 0;
  for (var k = 0; k < terms; k++) {
    var v = taylorTerm(func, k, x);
    if (!Number.isFinite(v)) break;
    s += v;
  }
  return s;
}

function taylorExact(func, x) {
  switch (func) {
    case 'sin':    return Math.sin(x);
    case 'cos':    return Math.cos(x);
    case 'exp':    return Math.exp(x);
    case 'log':    return x > -1 ? Math.log(1 + x) : NaN;
    case 'sinh':   return Math.sinh(x);
    case 'cosh':   return Math.cosh(x);
    case 'arctan': return Math.atan(x);
    case 'erf': {
      var sign = Math.sign(x), ax = Math.abs(x);
      var t2 = 1 / (1 + 0.3275911 * ax);
      return sign * (1 - (((((1.061405429*t2 - 1.453152027)*t2) + 1.421413741)*t2 - 0.284496736)*t2 + 0.254829592)*t2 * Math.exp(-ax*ax));
    }
  }
  return NaN;
}

function taylorDefaults(func) {
  var map = {
    sin:    { xMax: 8,  yClamp: 1.5 },
    cos:    { xMax: 8,  yClamp: 1.5 },
    exp:    { xMax: 3,  yClamp: 22  },
    log:    { xMax: 2,  yClamp: 2.5 },
    sinh:   { xMax: 3,  yClamp: 12  },
    cosh:   { xMax: 3,  yClamp: 12  },
    arctan: { xMax: 10, yClamp: 1.8 },
    erf:    { xMax: 3,  yClamp: 1.2 },
  };
  return map[func] || { xMax: 6, yClamp: 5 };
}

/* =========================================
   CANVAS HELPERS
   ========================================= */

function setupCanvas(canvas) {
  var dpr  = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  return { ctx: ctx, w: rect.width, h: rect.height };
}

function drawGrid(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (var x = 50; x < w; x += 50) { ctx.moveTo(x+.5, 0); ctx.lineTo(x+.5, h); }
  for (var y = 40; y < h; y += 40) { ctx.moveTo(0, y+.5); ctx.lineTo(w, y+.5); }
  ctx.stroke(); ctx.restore();
}

function drawAxes(ctx, w, h, cx, cy) {
  ctx.save();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy+.5); ctx.lineTo(w, cy+.5);
  ctx.moveTo(cx+.5, 0); ctx.lineTo(cx+.5, h);
  ctx.stroke(); ctx.restore();
}

function drawCurve(ctx, pts, color, lw) {
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw || 2;
  ctx.beginPath();
  var pen = false;
  for (var i = 0; i < pts.length; i++) {
    var px = pts[i][0], py = pts[i][1];
    if (!Number.isFinite(py)) { pen = false; continue; }
    if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
  }
  ctx.stroke(); ctx.restore();
}

/* =========================================
   FOURIER RENDERER
   ========================================= */

function renderFourier() {
  var type      = G('f-wave').value;
  var N         = parseInt(G('f-harmonics').value, 10);
  var periods   = parseInt(G('f-periods').value,   10);
  var ampPct    = parseInt(G('f-amplitude').value,  10);
  var showComp  = G('f-show-components').checked;
  var showSpec  = G('f-show-spectrum').checked;
  var showPhase = G('f-show-phase').checked;

  var ms = setupCanvas(G('main-canvas'));
  if (!ms) return;
  var ctx = ms.ctx, w = ms.w, h = ms.h;

  ctx.clearRect(0, 0, w, h);
  drawGrid(ctx, w, h);
  drawAxes(ctx, w, h, 0, h / 2);

  /* period dividers */
  for (var p = 1; p < periods; p++) {
    var px = (p / periods) * w;
    ctx.save();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.moveTo(px+.5, 0); ctx.lineTo(px+.5, h);
    ctx.stroke(); ctx.restore();
  }

  var S = Math.max(1200, w * 2 | 0);
  var ys = new Float64Array(S + 1);
  var maxAbs = 1e-9;
  for (var i = 0; i <= S; i++) {
    ys[i] = fourierSum(type, N, (i / S) * periods);
    if (Math.abs(ys[i]) > maxAbs) maxAbs = Math.abs(ys[i]);
  }
  var scale = ((h / 2) * 0.86 * (ampPct / 100)) / maxAbs;
  var pts = [];
  for (var i = 0; i <= S; i++) pts.push([(i / S) * w, h / 2 - ys[i] * scale]);
  drawCurve(ctx, pts, '#f59e0b', 2);

  G('main-canvas-title').textContent = 'Fourier \u2014 ' + waveLabel(type);
  G('main-canvas-meta').textContent  = 'N=' + N + ' \u00b7 ' + periods + ' periodi';
  G('f-formula').innerHTML = fourierFormula(type);

  /* ── components ── */
  G('comp-card').style.display = showComp ? '' : 'none';
  if (showComp) {
    var cs = setupCanvas(G('comp-canvas'));
    if (cs) {
      var ctx2 = cs.ctx, cw = cs.w, ch = cs.h;
      ctx2.clearRect(0, 0, cw, ch); drawGrid(ctx2, cw, ch); drawAxes(ctx2, cw, ch, 0, ch / 2);

      var nonzero = [];
      for (var n = 1; n <= N && nonzero.length < 12; n++) {
        for (var pp = 0; pp < 8; pp++) {
          if (Math.abs(fourierHarmonic(type, n, pp / 8)) > 1e-11) { nonzero.push(n); break; }
        }
      }
      var gmax = 1e-9;
      var compData = nonzero.map(function(n) {
        var arr = new Float64Array(S + 1);
        for (var i = 0; i <= S; i++) {
          arr[i] = fourierHarmonic(type, n, (i / S) * periods);
          if (Math.abs(arr[i]) > gmax) gmax = Math.abs(arr[i]);
        }
        return arr;
      });
      var cscale = ((ch / 2) * 0.85) / gmax;
      nonzero.forEach(function(n, idx) {
        var p2 = [];
        for (var i = 0; i <= S; i++) p2.push([(i / S) * cw, ch / 2 - compData[idx][i] * cscale]);
        drawCurve(ctx2, p2, COMP_COLORS[idx % COMP_COLORS.length], 1.3);
      });
      G('comp-title').textContent = 'Componenti armoniche';
      G('comp-meta').textContent  = nonzero.length + ' non-zero su N=' + N;
      var leg = G('comp-legend'); leg.innerHTML = '';
      nonzero.forEach(function(n, idx) {
        var s = document.createElement('span'); s.className = 'legend-item';
        s.innerHTML = '<span class="leg-line" style="background:' + COMP_COLORS[idx % COMP_COLORS.length] + '"></span>n=' + n;
        leg.appendChild(s);
      });
    }
  }

  /* ── spectrum: pure lines + glow ── */
  G('spec-card').style.display = showSpec ? '' : 'none';
  if (showSpec) {
    var ss = setupCanvas(G('spec-canvas'));
    if (ss) {
      var sc = ss.ctx, sw = ss.w, sh = ss.h;
      sc.clearRect(0, 0, sw, sh); drawGrid(sc, sw, sh);
      var BASE = sh - 28, BARH = BASE - 6, PAD_L = 20, PAD_R = 10;
      var slot = (sw - PAD_L - PAD_R) / N;
      /* baseline */
      sc.save(); sc.strokeStyle = '#222'; sc.lineWidth = 1;
      sc.beginPath(); sc.moveTo(0, BASE+.5); sc.lineTo(sw, BASE+.5); sc.stroke(); sc.restore();
      /* amplitudes */
      var amps = new Float64Array(N), maxAmp = 1e-9;
      for (var n = 1; n <= N; n++) {
        amps[n-1] = fourierAmp(type, n).amp;
        if (amps[n-1] > maxAmp) maxAmp = amps[n-1];
      }
      var tickEvery = N <= 20 ? 1 : N <= 40 ? 5 : 10;
      for (var n = 1; n <= N; n++) {
        var amp = amps[n-1];
        if (amp < 1e-11) continue;
        var lineH = Math.max(2, (amp / maxAmp) * BARH);
        var cx    = PAD_L + (n - 0.5) * slot;
        var color = spectrumColor(n, N);
        /* glow */
        sc.save(); sc.strokeStyle = color; sc.lineWidth = 4;
        sc.globalAlpha = 0.14; sc.shadowColor = color; sc.shadowBlur = 10;
        sc.beginPath(); sc.moveTo(cx, BASE); sc.lineTo(cx, BASE - lineH); sc.stroke(); sc.restore();
        /* crisp line */
        sc.save(); sc.strokeStyle = color; sc.lineWidth = 1; sc.globalAlpha = 1;
        sc.beginPath(); sc.moveTo(cx+.5, BASE); sc.lineTo(cx+.5, BASE - lineH); sc.stroke(); sc.restore();
        /* top dot */
        sc.save(); sc.fillStyle = color;
        sc.beginPath(); sc.arc(cx+.5, BASE - lineH, 1.5, 0, TAU); sc.fill(); sc.restore();
        /* label */
        if (n === 1 || n % tickEvery === 0) {
          sc.save(); sc.fillStyle = '#3a3a3a';
          sc.font = '9px JetBrains Mono,monospace'; sc.textAlign = 'center';
          sc.fillText(n + 'f\u2080', cx, BASE + 14); sc.restore();
        }
      }
      G('spec-title').textContent = 'Spettro di ampiezza';
      G('spec-meta').textContent  = N + ' righe \u00b7 A\u2099 normalizzato';
      var sleg = G('spec-legend'); sleg.innerHTML = '';
      [1, Math.ceil(N/3), Math.ceil(2*N/3), N]
        .filter(function(v, i, a) { return a.indexOf(v) === i && v >= 1; })
        .forEach(function(n) {
          var s = document.createElement('span'); s.className = 'legend-item';
          s.innerHTML = '<span class="leg-bar" style="background:' + spectrumColor(n, N) + '"></span>' + n + 'f\u2080';
          sleg.appendChild(s);
        });
    }
  }

  /* ── phase spectrum ── */
  G('phase-card').style.display = showPhase ? '' : 'none';
  if (showPhase) {
    var ps = setupCanvas(G('phase-canvas'));
    if (ps) {
      var pc = ps.ctx, pw = ps.w, ph2 = ps.h;
      pc.clearRect(0, 0, pw, ph2); drawGrid(pc, pw, ph2); drawAxes(pc, pw, ph2, 0, ph2 / 2);
      var pslot = (pw - 20 - 10) / N, scH = ph2 / 2 - 8;
      for (var n = 1; n <= N; n++) {
        var c = fourierAmp(type, n);
        if (c.amp < 1e-11) continue;
        var pcx   = 20 + (n - 0.5) * pslot;
        var lh    = (Math.abs(c.ph) / PI) * scH;
        var color = spectrumColor(n, N);
        var y1    = c.ph >= 0 ? ph2 / 2 - lh : ph2 / 2 + lh;
        pc.save(); pc.strokeStyle = color; pc.lineWidth = 1; pc.globalAlpha = 0.85;
        pc.beginPath(); pc.moveTo(pcx+.5, ph2/2); pc.lineTo(pcx+.5, y1); pc.stroke();
        pc.fillStyle = color; pc.globalAlpha = 1;
        pc.beginPath(); pc.arc(pcx+.5, y1, 1.5, 0, TAU); pc.fill(); pc.restore();
      }
      G('phase-meta').textContent = 'fase \u2208 [\u2212\u03c0, \u03c0] \u00b7 ' + N + ' righe';
    }
  }
}

/* =========================================
   TAYLOR RENDERER
   ========================================= */

function renderTaylor() {
  var func     = G('t-func').value;
  var terms    = parseInt(G('t-terms').value, 10);
  var showOrig = G('t-show-original').checked;
  var showErr  = G('t-show-error').checked;

  var defs    = taylorDefaults(func);
  var mult    = 0.2 + (parseInt(G('t-range').value, 10) - 1) / 19 * 1.8;
  var xMax    = defs.xMax * mult;
  var xMin    = func === 'log' ? Math.max(-0.98, -xMax) : -xMax;

  var ms = setupCanvas(G('main-canvas'));
  if (!ms) return;
  var ctx = ms.ctx, w = ms.w, h = ms.h;
  ctx.clearRect(0, 0, w, h); drawGrid(ctx, w, h); drawAxes(ctx, w, h, w / 2, h / 2);

  var S  = Math.max(1000, w * 2 | 0);
  var xs = new Float64Array(S + 1);
  var ya = new Float64Array(S + 1);
  var ye = new Float64Array(S + 1);
  for (var i = 0; i <= S; i++) {
    xs[i] = xMin + (xMax - xMin) * (i / S);
    ya[i] = taylorSum(func, terms, xs[i]);
    ye[i] = taylorExact(func, xs[i]);
  }

  var yLim  = Math.max(1, defs.yClamp * Math.max(1, mult));
  var scale = ((h / 2) * 0.86) / yLim;
  var xToC  = function(x) { return ((x - xMin) / (xMax - xMin)) * w; };
  var yToC  = function(y) { return h / 2 - y * scale; };

  /* ticks */
  ctx.save(); ctx.fillStyle = '#383838';
  ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'center';
  var step = xMax > 6 ? Math.ceil(xMax / 5) : xMax > 2 ? 1 : 0.5;
  for (var v = Math.ceil(xMin / step) * step; v <= xMax + step * 0.01; v += step) {
    if (Math.abs(v) < step * 0.01) continue;
    ctx.fillText(v % 1 === 0 ? String(v) : v.toFixed(1), xToC(v), h / 2 + 11);
  }
  ctx.restore();

  if (showOrig) {
    var pts0 = [];
    for (var i = 0; i <= S; i++) {
      var v = ye[i];
      pts0.push([xToC(xs[i]), (Number.isFinite(v) && Math.abs(v) <= yLim * 1.1) ? yToC(v) : NaN]);
    }
    drawCurve(ctx, pts0, '#22d3ee', 1.5);
  }
  {
    var pts1 = [];
    for (var i = 0; i <= S; i++) {
      var v = ya[i];
      pts1.push([xToC(xs[i]), (Number.isFinite(v) && Math.abs(v) <= yLim * 1.25) ? yToC(v) : NaN]);
    }
    drawCurve(ctx, pts1, '#f59e0b', 2);
  }

  G('main-canvas-title').textContent = 'Taylor \u2014 ' + taylorLabel(func);
  G('main-canvas-meta').textContent  = terms + ' termini \u00b7 x \u2208 [' + xMin.toFixed(1) + ', ' + xMax.toFixed(1) + ']';
  G('t-formula').innerHTML = taylorFormula(func);

  /* progressive */
  G('comp-card').style.display = '';
  G('comp-title').textContent  = 'Approssimazioni progressive';
  G('comp-meta').textContent   = 'ogni curva = somma parziale';
  var cs2 = setupCanvas(G('comp-canvas'));
  if (cs2) {
    var cc = cs2.ctx, cw = cs2.w, ch = cs2.h;
    cc.clearRect(0, 0, cw, ch); drawGrid(cc, cw, ch); drawAxes(cc, cw, ch, cw / 2, ch / 2);
    var cscale = ((ch / 2) * 0.86) / yLim;
    var xc = function(x) { return ((x - xMin) / (xMax - xMin)) * cw; };
    var yc = function(y) { return ch / 2 - y * cscale; };
    var maxLvl = Math.min(10, terms), seen = {}, levels = [];
    for (var k = 0; k < maxLvl; k++) {
      var t = Math.max(1, Math.round(((k + 1) / maxLvl) * terms));
      if (!seen[t]) { seen[t] = true; levels.push(t); }
    }
    var leg = G('comp-legend'); leg.innerHTML = '';
    levels.forEach(function(t, idx) {
      var pts = [];
      for (var i = 0; i <= S; i++) {
        var v = taylorSum(func, t, xs[i]);
        pts.push([xc(xs[i]), (Number.isFinite(v) && Math.abs(v) <= yLim * 1.3) ? yc(v) : NaN]);
      }
      var color = COMP_COLORS[idx % COMP_COLORS.length];
      drawCurve(cc, pts, color, 1.3);
      var s = document.createElement('span'); s.className = 'legend-item';
      s.innerHTML = '<span class="leg-line" style="background:' + color + '"></span>' + t + 'T';
      leg.appendChild(s);
    });
    if (showOrig) {
      var pts2 = [];
      for (var i = 0; i <= S; i++) {
        var v = ye[i];
        pts2.push([xc(xs[i]), (Number.isFinite(v) && Math.abs(v) <= yLim * 1.1) ? yc(v) : NaN]);
      }
      drawCurve(cc, pts2, 'rgba(34,211,238,0.3)', 1.2);
    }
  }

  /* error */
  G('error-card').style.display = showErr ? '' : 'none';
  if (showErr) {
    var es = setupCanvas(G('error-canvas'));
    if (es) {
      var ec = es.ctx, ew = es.w, eh = es.h;
      ec.clearRect(0, 0, ew, eh); drawGrid(ec, ew, eh); drawAxes(ec, ew, eh, ew / 2, eh / 2);
      var maxErr = 1e-12, errs = new Float64Array(S + 1);
      for (var i = 0; i <= S; i++) {
        var e = (Number.isFinite(ye[i]) && Number.isFinite(ya[i])) ? ye[i] - ya[i] : NaN;
        errs[i] = e;
        if (Number.isFinite(e) && Math.abs(e) > maxErr) maxErr = Math.abs(e);
      }
      var esc = ((eh / 2) * 0.85) / maxErr;
      var xe2 = function(x) { return ((x - xMin) / (xMax - xMin)) * ew; };
      var ye2 = function(y) { return eh / 2 - y * esc; };
      var pts3 = [];
      for (var i = 0; i <= S; i++) {
        var e = errs[i];
        pts3.push([xe2(xs[i]), (Number.isFinite(e) && Math.abs(e) <= maxErr * 1.1) ? ye2(e) : NaN]);
      }
      drawCurve(ec, pts3, '#e63946', 1.5);
      G('error-meta').textContent = 'max|err| = ' + maxErr.toExponential(3);
    }
  }
}

/* =========================================
   LABEL HELPERS
   ========================================= */

function waveLabel(t) {
  var m = { square:'Onda quadra', triangle:'Onda triangolare',
    sawtooth:'Dente di sega \u2191', sawtooth_down:'Dente di sega \u2193',
    pulse_25:'Impulso 25%', pulse_10:'Impulso 10%',
    semicircle:'Sin rettificata \u00bdonda', fullrect:'Sin rettificata intera',
    parabola:'Parabolica', trapezoid:'Trapezoidale',
    staircase:'Scalare 4 gradini', weierstrass:'Weierstrass (a=0.5, b=3)' };
  return m[t] || t;
}
function taylorLabel(f) {
  var m = { sin:'sin(x)', cos:'cos(x)', exp:'e\u02e3', log:'ln(1+x)',
            sinh:'sinh(x)', cosh:'cosh(x)', arctan:'arctan(x)', erf:'erf(x)' };
  return m[f] || f;
}
function fourierFormula(t) {
  var m = {
    square:      'f(x) = (4/\u03c0) \u03a3 sin((2k+1)x)/(2k+1)',
    triangle:    'f(x) = (8/\u03c0\u00b2) \u03a3 (\u22121)<sup>k</sup> sin((2k+1)x)/(2k+1)\u00b2',
    sawtooth:    'f(x) = (2/\u03c0) \u03a3 (\u22121)<sup>n+1</sup> sin(nx)/n',
    sawtooth_down:'f(x) = \u2212(2/\u03c0) \u03a3 (\u22121)<sup>n+1</sup> sin(nx)/n',
    pulse_25:    'a\u2099 = (2/n\u03c0) sin(n\u03c0/4) cos(nx),  d=25%',
    pulse_10:    'a\u2099 = (2/n\u03c0) sin(n\u03c0/10) cos(nx),  d=10%',
    semicircle:  'f(x) = 1/\u03c0 + \u00bdsin(x) \u2212 (2/\u03c0)\u03a3 cos(2kx)/(4k\u00b2\u22121)',
    fullrect:    'f(x) = 2/\u03c0 \u2212 (4/\u03c0)\u03a3 cos(2kx)/(4k\u00b2\u22121)',
    parabola:    'f(x) = \u2212\u03c0\u00b2/3 + 4\u03a3 (\u22121)<sup>n</sup> cos(nx)/n\u00b2',
    trapezoid:   'b\u2099 = [4/(n\u00b2\u03c0\u00b2d)] sin(n\u03c0r) sin(n\u03c0d) sin(nx)',
    staircase:   'b\u2099 = (4/n\u03c0) \u03a3\u2096 A\u2096 [cos(n\u03c0(k-1)/4)\u2212cos(n\u03c0k/4)]',
    weierstrass: 'f(x) = \u03a3 a\u207f cos(b\u207fx),  a=0.5, b=3',
  };
  return '<span class="formula-label">Serie di Fourier</span>' + (m[t] || '');
}
function taylorFormula(f) {
  var m = {
    sin:    'sin x = \u03a3 (\u22121)<sup>k</sup> x<sup>2k+1</sup>/(2k+1)!',
    cos:    'cos x = \u03a3 (\u22121)<sup>k</sup> x<sup>2k</sup>/(2k)!',
    exp:    'e\u02e3 = \u03a3 x\u1d4f/k!',
    log:    'ln(1+x) = \u03a3 (\u22121)<sup>k+1</sup> x\u1d4f/k,  |x|\u22641',
    sinh:   'sinh x = \u03a3 x<sup>2k+1</sup>/(2k+1)!',
    cosh:   'cosh x = \u03a3 x<sup>2k</sup>/(2k)!',
    arctan: 'arctan x = \u03a3 (\u22121)<sup>k</sup> x<sup>2k+1</sup>/(2k+1)',
    erf:    'erf x = (2/\u221a\u03c0) \u03a3 (\u22121)<sup>k</sup> x<sup>2k+1</sup>/(k!(2k+1))',
  };
  return '<span class="formula-label">Taylor in x\u2080=0</span>' + (m[f] || '');
}

/* =========================================
   UI WIRING
   ========================================= */

var currentTab = 'fourier';

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  G('panel-fourier').classList.toggle('active', name === 'fourier');
  G('panel-taylor').classList.toggle('active',  name === 'taylor');
  G('error-card').style.display = 'none';
  if (name === 'taylor') {
    G('spec-card').style.display  = 'none';
    G('phase-card').style.display = 'none';
  }
  render();
}

function render() {
  if (currentTab === 'fourier') renderFourier();
  else renderTaylor();
}

function bindSlider(inputId, labelId, fmt) {
  var inp = G(inputId), lbl = G(labelId);
  var upd = function() { if (lbl) lbl.textContent = fmt ? fmt(inp.value) : inp.value; };
  upd();
  inp.addEventListener('input', function() { upd(); render(); });
}

function updateTaylorRangeLabel() {
  var func = G('t-func').value;
  var defs = taylorDefaults(func);
  var mult = 0.2 + (parseInt(G('t-range').value, 10) - 1) / 19 * 1.8;
  G('t-range-val').textContent = '\u00b1' + (defs.xMax * mult).toFixed(1);
}

document.addEventListener('DOMContentLoaded', function() {

  document.querySelectorAll('.tab').forEach(function(t) {
    t.addEventListener('click', function() { switchTab(t.dataset.tab); });
  });

  bindSlider('f-harmonics', 'f-harmonics-val');
  bindSlider('f-periods',   'f-periods-val');
  bindSlider('f-amplitude', 'f-amplitude-val', function(v) { return v + '%'; });
  ['f-wave','f-show-components','f-show-spectrum','f-show-phase'].forEach(function(id) {
    G(id).addEventListener('change', render);
  });

  bindSlider('t-terms', 't-terms-val');
  G('t-range').addEventListener('input', function() { updateTaylorRangeLabel(); render(); });
  G('t-func').addEventListener('change', function() {
    G('t-range').value = '10'; updateTaylorRangeLabel(); render();
  });
  ['t-show-original','t-show-error'].forEach(function(id) {
    G(id).addEventListener('change', render);
  });
  updateTaylorRangeLabel();

  /* keyboard */
  function primarySlider() { return G(currentTab === 'fourier' ? 'f-harmonics' : 't-terms'); }
  function nudge(sl, d) {
    var mn = +sl.min, mx = +sl.max, cur = +sl.value;
    var nxt = d === Infinity ? mx : d === -Infinity ? mn : Math.max(mn, Math.min(mx, cur + d));
    if (nxt === cur) return;
    sl.value = nxt; sl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('keydown', function(e) {
    var tgt = e.target;
    if (tgt && ((tgt.tagName === 'INPUT' && tgt.type !== 'range') || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.key === '1') { switchTab('fourier'); e.preventDefault(); return; }
    if (e.key === '2') { switchTab('taylor');  e.preventDefault(); return; }
    var sl = primarySlider(); if (!sl) return;
    var ok = true;
    switch (e.key) {
      case 'ArrowRight': nudge(sl, +1);        break;
      case 'ArrowLeft':  nudge(sl, -1);        break;
      case 'ArrowUp':    nudge(sl, +5);        break;
      case 'ArrowDown':  nudge(sl, -5);        break;
      case 'PageUp':     nudge(sl, +10);       break;
      case 'PageDown':   nudge(sl, -10);       break;
      case 'Home':       nudge(sl, -Infinity); break;
      case 'End':        nudge(sl, +Infinity); break;
      default: ok = false;
    }
    if (ok) e.preventDefault();
  });

  window.addEventListener('resize', function() {
    clearTimeout(window._rto);
    window._rto = setTimeout(render, 80);
  });

  /* defer render until layout is fully painted */
  requestAnimationFrame(function() { requestAnimationFrame(render); });
});
