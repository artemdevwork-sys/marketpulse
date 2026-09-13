/* ============================================================
   MarketPulse — INDICATOR LIBRARY
   ------------------------------------------------------------
   Real, standard technical-analysis math. Pure functions:
   candles in, series out. No I/O, no randomness, no rendering.

   In production this exact module runs inside the Analysis Engine
   package on the server (and on the client for Replay), which is
   what makes any reading reproducible.
   ============================================================ */
(function (global) {
  'use strict';

  const closes = c => c.map(x => x.c);
  const highs  = c => c.map(x => x.h);
  const lows   = c => c.map(x => x.l);

  function sma(vals, p) {
    const out = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= p) sum -= vals[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  function ema(vals, p) {
    const out = new Array(vals.length).fill(null);
    const k = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < vals.length; i++) {
      if (i === p - 1) {
        let s = 0; for (let j = 0; j < p; j++) s += vals[i - j];
        prev = s / p; out[i] = prev;
      } else if (i >= p) {
        prev = vals[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(vals, p) {
    const out = new Array(vals.length).fill(null);
    let ag = 0, al = 0;
    for (let i = 1; i < vals.length; i++) {
      const ch = vals[i] - vals[i - 1];
      const g = Math.max(0, ch), l = Math.max(0, -ch);
      if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; out[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } }
      else {
        ag = (ag * (p - 1) + g) / p;
        al = (al * (p - 1) + l) / p;
        out[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al));
      }
    }
    return out;
  }

  function macd(vals, f, s, sig) {
    const ef = ema(vals, f), es = ema(vals, s);
    const line = vals.map((_, i) => (ef[i] == null || es[i] == null) ? null : ef[i] - es[i]);
    const valid = line.map(v => v == null ? 0 : v);
    const sg = ema(valid, sig).map((v, i) => line[i] == null ? null : v);
    const hist = line.map((v, i) => (v == null || sg[i] == null) ? null : v - sg[i]);
    return { line, signal: sg, hist };
  }

  function stdev(vals, p) {
    const out = new Array(vals.length).fill(null);
    const m = sma(vals, p);
    for (let i = p - 1; i < vals.length; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) { const d = vals[i - j] - m[i]; s += d * d; }
      out[i] = Math.sqrt(s / p);
    }
    return out;
  }

  function bollinger(vals, p, mult) {
    const mid = sma(vals, p), sd = stdev(vals, p);
    return {
      mid,
      upper: mid.map((m, i) => m == null ? null : m + mult * sd[i]),
      lower: mid.map((m, i) => m == null ? null : m - mult * sd[i]),
      width: mid.map((m, i) => m == null ? null : (2 * mult * sd[i]) / m)
    };
  }

  function trueRange(c) {
    const out = [null];
    for (let i = 1; i < c.length; i++) {
      out.push(Math.max(
        c[i].h - c[i].l,
        Math.abs(c[i].h - c[i - 1].c),
        Math.abs(c[i].l - c[i - 1].c)
      ));
    }
    return out;
  }

  function atr(c, p) {
    const tr = trueRange(c);
    const out = new Array(c.length).fill(null);
    let prev = null;
    for (let i = 1; i < c.length; i++) {
      if (i === p) {
        let s = 0; for (let j = 1; j <= p; j++) s += tr[j];
        prev = s / p; out[i] = prev;
      } else if (i > p) {
        prev = (prev * (p - 1) + tr[i]) / p;
        out[i] = prev;
      }
    }
    return out;
  }

  function stochastic(c, kP, dP) {
    const k = new Array(c.length).fill(null);
    for (let i = kP - 1; i < c.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = 0; j < kP; j++) { hh = Math.max(hh, c[i - j].h); ll = Math.min(ll, c[i - j].l); }
      k[i] = hh === ll ? 50 : ((c[i].c - ll) / (hh - ll)) * 100;
    }
    const kv = k.map(v => v == null ? 50 : v);
    const d = sma(kv, dP).map((v, i) => k[i] == null ? null : v);
    return { k, d };
  }

  function adx(c, p) {
    const plusDM = [null], minusDM = [null];
    for (let i = 1; i < c.length; i++) {
      const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
      plusDM.push(up > dn && up > 0 ? up : 0);
      minusDM.push(dn > up && dn > 0 ? dn : 0);
    }
    const tr = trueRange(c);
    const smooth = (arr) => {
      const out = new Array(arr.length).fill(null);
      let prev = null;
      for (let i = 1; i < arr.length; i++) {
        if (i === p) { let s = 0; for (let j = 1; j <= p; j++) s += arr[j]; prev = s; out[i] = prev; }
        else if (i > p) { prev = prev - prev / p + arr[i]; out[i] = prev; }
      }
      return out;
    };
    const str = smooth(tr), sp = smooth(plusDM), sm = smooth(minusDM);
    const pdi = [], mdi = [], dx = [];
    for (let i = 0; i < c.length; i++) {
      if (str[i] == null || str[i] === 0) { pdi.push(null); mdi.push(null); dx.push(null); continue; }
      const a = 100 * sp[i] / str[i], b = 100 * sm[i] / str[i];
      pdi.push(a); mdi.push(b);
      dx.push((a + b) === 0 ? 0 : 100 * Math.abs(a - b) / (a + b));
    }
    const out = new Array(c.length).fill(null);
    let prev = null;
    for (let i = 0; i < c.length; i++) {
      if (dx[i] == null) continue;
      const startIdx = 2 * p;
      if (i === startIdx) {
        let s = 0, n = 0;
        for (let j = p; j <= i; j++) { if (dx[j] != null) { s += dx[j]; n++; } }
        prev = s / Math.max(1, n); out[i] = prev;
      } else if (i > startIdx && prev != null) {
        prev = (prev * (p - 1) + dx[i]) / p; out[i] = prev;
      }
    }
    return { adx: out, pdi, mdi };
  }

  /* ---------- swing pivots (fractal, real) ---------- */
  function pivots(c, lb) {
    const hi = [], lo = [];
    for (let i = lb; i < c.length - lb; i++) {
      let isH = true, isL = true;
      for (let j = 1; j <= lb; j++) {
        if (c[i].h <= c[i - j].h || c[i].h <= c[i + j].h) isH = false;
        if (c[i].l >= c[i - j].l || c[i].l >= c[i + j].l) isL = false;
      }
      if (isH) hi.push({ i, p: c[i].h, t: c[i].t });
      if (isL) lo.push({ i, p: c[i].l, t: c[i].t });
    }
    return { hi, lo };
  }

  /* ---------- support / resistance by pivot clustering ---------- */
  function levels(c, piv, tol) {
    const all = piv.hi.map(p => ({ ...p, kind: 'R' })).concat(piv.lo.map(p => ({ ...p, kind: 'S' })));
    const clusters = [];
    all.forEach(p => {
      const hit = clusters.find(cl => Math.abs(cl.price - p.p) <= tol);
      if (hit) {
        hit.touches++;
        hit.price = (hit.price * (hit.touches - 1) + p.p) / hit.touches;
        hit.lastI = Math.max(hit.lastI, p.i);
        if (p.kind === 'R') hit.r++; else hit.s++;
      } else {
        clusters.push({ price: p.p, touches: 1, lastI: p.i, firstI: p.i, r: p.kind === 'R' ? 1 : 0, s: p.kind === 'S' ? 1 : 0 });
      }
    });
    const last = c[c.length - 1].c;
    return clusters
      .filter(cl => cl.touches >= 2)
      .map(cl => ({
        price: cl.price,
        touches: cl.touches,
        lastI: cl.lastI,
        kind: cl.price > last ? 'resistance' : 'support',
        dist: Math.abs(cl.price - last)
      }))
      .sort((a, b) => a.dist - b.dist);
  }

  /* ---------- market structure (HH/HL/LH/LL) ---------- */
  function structure(piv) {
    const seq = piv.hi.map(p => ({ ...p, k: 'H' })).concat(piv.lo.map(p => ({ ...p, k: 'L' })))
      .sort((a, b) => a.i - b.i);
    const out = [];
    let lastH = null, lastL = null;
    seq.forEach(p => {
      if (p.k === 'H') {
        out.push({ ...p, label: lastH == null ? 'H' : (p.p > lastH ? 'HH' : 'LH') });
        lastH = p.p;
      } else {
        out.push({ ...p, label: lastL == null ? 'L' : (p.p > lastL ? 'HL' : 'LL') });
        lastL = p.p;
      }
    });
    return out;
  }

  /* ---------- candlestick patterns (real rules) ---------- */
  function lastPattern(c) {
    const n = c.length;
    if (n < 3) return null;
    const a = c[n - 2], b = c[n - 1];
    const body = x => Math.abs(x.c - x.o);
    const range = x => Math.max(1e-12, x.h - x.l);
    const bull = x => x.c > x.o;

    if (bull(b) && !bull(a) && b.c > a.o && b.o < a.c && body(b) > body(a))
      return { name: 'Bullish Engulfing', dir: 'BULLISH', at: n - 1, span: 2 };
    if (!bull(b) && bull(a) && b.c < a.o && b.o > a.c && body(b) > body(a))
      return { name: 'Bearish Engulfing', dir: 'BEARISH', at: n - 1, span: 2 };
    if (body(b) / range(b) < 0.32 && (Math.min(b.o, b.c) - b.l) / range(b) > 0.5)
      return { name: 'Hammer', dir: 'BULLISH', at: n - 1, span: 1 };
    if (body(b) / range(b) < 0.32 && (b.h - Math.max(b.o, b.c)) / range(b) > 0.5)
      return { name: 'Shooting Star', dir: 'BEARISH', at: n - 1, span: 1 };
    if (body(b) / range(b) < 0.12)
      return { name: 'Doji', dir: 'NEUTRAL', at: n - 1, span: 1 };
    if (body(b) / range(b) > 0.78)
      return { name: bull(b) ? 'Bullish Marubozu' : 'Bearish Marubozu', dir: bull(b) ? 'BULLISH' : 'BEARISH', at: n - 1, span: 1 };
    return null;
  }

  /* ---------- UTC-ALIGNED HIGHER-TIMEFRAME AGGREGATION ----------
     Replaces the old aggregate-by-array-index. Two guarantees:

       1. Bucket boundaries come from the UTC epoch, never from where the
          input array happens to begin. floor(t / toMs) * toMs is the same
          boundary for every caller, on every day, regardless of DST —
          because DST shifts local time, not epoch time.

       2. A bucket is emitted ONLY if it is complete: it must contain
          exactly toMin/fromMin candles AND its final slot must be filled.
          A partially formed HTF candle is never produced, and a bucket
          with an internal gap is dropped rather than invented.

     Returns { candles, dropped, expectedPerBucket }. */
  function aggregateUTC(candles, fromMin, toMin) {
    const result = { candles: [], dropped: 0, expectedPerBucket: 0, ok: false, reason: null };
    if (!candles || !candles.length) { result.reason = 'NO_INPUT'; return result; }
    if (!(toMin % fromMin === 0) || toMin < fromMin) { result.reason = 'NOT_DIVISIBLE'; return result; }

    const fromMs = fromMin * 60000, toMs = toMin * 60000;
    const need = toMin / fromMin;
    result.expectedPerBucket = need;

    const buckets = new Map();
    for (let i = 0; i < candles.length; i++) {
      const k = candles[i];
      const key = Math.floor(k.t / toMs) * toMs;
      let b = buckets.get(key);
      if (!b) {
        b = { t: key, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v || 0, n: 0, lastT: k.t, firstT: k.t };
        buckets.set(key, b);
      } else {
        if (k.t < b.firstT) { b.o = k.o; b.firstT = k.t; }   // defensive: input should be ascending
        b.h = Math.max(b.h, k.h);
        b.l = Math.min(b.l, k.l);
        if (k.t >= b.lastT) { b.c = k.c; b.lastT = k.t; }
        b.v += (k.v || 0);
      }
      b.n++;
    }

    const keys = Array.from(buckets.keys()).sort(function (a, b) { return a - b; });
    for (let i = 0; i < keys.length; i++) {
      const b = buckets.get(keys[i]);
      // complete = right number of members AND the final slot is present
      if (b.n !== need || (b.lastT + fromMs) !== (b.t + toMs)) { result.dropped++; continue; }
      result.candles.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
    result.ok = true;
    return result;
  }

  function linreg(vals, from, to) {
    let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = from; i <= to; i++) {
      if (vals[i] == null) continue;
      const x = i - from, y = vals[i];
      n++; sx += x; sy += y; sxy += x * y; sxx += x * x;
    }
    if (n < 2) return { slope: 0, intercept: vals[to] || 0 };
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { slope, intercept: (sy - slope * sx) / n };
  }

  global.MP = global.MP || {};
  global.MP.Ind = {
    closes, highs, lows,
    sma, ema, rsi, macd, stdev, bollinger, atr, trueRange, aggregateUTC,
    stochastic, adx, pivots, levels, structure, lastPattern, linreg
  };
})(window);
