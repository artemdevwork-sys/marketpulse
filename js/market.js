/* ============================================================
   MarketPulse — MOCK MARKET DATA LAYER  (prototype only)
   ------------------------------------------------------------
   This file generates DEMO candles with a seeded PRNG so the
   prototype is deterministic and reproducible.

   IMPORTANT: this is NOT the production data layer. In production
   this module is replaced by a server-side vendor adapter. Nothing
   downstream (indicators, strategies, consensus) knows or cares
   where the candles came from — that separation is deliberate.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- seeded PRNG (mulberry32) ---------- */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- instrument definitions ---------- */
  /* `state` places each instrument at a chosen point of its regime cycle so the
     prototype always demonstrates trending-up, trending-down, ranging and
     conflicted markets simultaneously. Production data obviously has no such
     field — this exists only so every UI state is reachable in a demo. */
  const PAIRS = [
    { sym: 'EUR/USD', base: 1.10432, pip: 0.0001, digits: 5, vol: 1.00, free: true,  bias:  0.55, state: 'up' },
    { sym: 'GBP/USD', base: 1.27104, pip: 0.0001, digits: 5, vol: 1.22, free: true,  bias: -0.30, state: 'down' },
    { sym: 'USD/JPY', base: 151.842, pip: 0.01,   digits: 3, vol: 1.10, free: true,  bias:  0.70, state: 'up' },
    { sym: 'AUD/USD', base: 0.65718, pip: 0.0001, digits: 5, vol: 1.15, free: true,  bias: -0.10, state: 'range' },
    { sym: 'USD/CAD', base: 1.35216, pip: 0.0001, digits: 5, vol: 0.95, free: false, bias: -0.45, state: 'down' },
    { sym: 'EUR/GBP', base: 0.86894, pip: 0.0001, digits: 5, vol: 0.72, free: false, bias:  0.15, state: 'range' },
    { sym: 'USD/CHF', base: 0.88140, pip: 0.0001, digits: 5, vol: 0.90, free: false, bias:  0.25, state: 'up' },
    { sym: 'NZD/USD', base: 0.60312, pip: 0.0001, digits: 5, vol: 1.08, free: false, bias: -0.55, state: 'down' }
  ];

  const TIMEFRAMES = [
    { id: '1m',  min: 1,  free: false },
    { id: '3m',  min: 3,  free: false },
    { id: '5m',  min: 5,  free: true  },
    { id: '15m', min: 15, free: true  },
    { id: '30m', min: 30, free: false },
    { id: '1h',  min: 60, free: true  }
  ];

  const SESSIONS = [
    { id: 'SYD', name: 'Sydney',   open: 21, close: 6  },
    { id: 'TKY', name: 'Tokyo',    open: 0,  close: 9  },
    { id: 'LDN', name: 'London',   open: 7,  close: 16 },
    { id: 'NY',  name: 'New York', open: 12, close: 21 }
  ];

  // regime phase presets (demo only)
  const PHASE = { up: 0.625, down: 1.625, range: 1.375 };

  function pairInfo(sym) { return PAIRS.find(p => p.sym === sym) || PAIRS[0]; }
  function tfInfo(id) { return TIMEFRAMES.find(t => t.id === id) || TIMEFRAMES[2]; }

  /* ---------- candle series generation ----------
     Random walk with a slow-moving regime component, so the demo
     data actually contains trends, ranges and volatility clusters
     for the strategies to find. */
  function buildSeries(sym, tfId, count, phaseTarget) {
    const p = pairInfo(sym), tf = tfInfo(tfId);
    const rng = makeRng(hashStr(sym + '|' + tfId) ^ 0x9E3779B9);
    const stepMs = tf.min * 60000;
    const now = Date.now();
    const lastOpen = Math.floor(now / stepMs) * stepMs;

    const atrUnit = p.pip * (tf.min <= 3 ? 5 : tf.min <= 15 ? 11 : tf.min <= 30 ? 17 : 26) * p.vol;

    let price = p.base * (1 - 0.0016 * p.bias);
    let drift = p.bias * 0.06;
    let volMul = 1;
    const out = [];

    // each instrument sits at a different point of its own regime cycle, so the
    // demo shows trending, ranging and conflicted markets at the same time
    const cycles = 0.9 + (hashStr(sym + tfId) % 4) * 0.4;
    // choose the phase offset so the LAST candle sits where we want the regime
    const target = phaseTarget != null ? phaseTarget
                 : p.state === 'up' ? Math.PI * PHASE.up
                 : p.state === 'down' ? Math.PI * PHASE.down
                 : Math.PI * (hashStr(tfId) % 2 ? PHASE.range : PHASE.range + 1);
    const offset = target - Math.PI * 2 * cycles;

    for (let i = 0; i < count; i++) {
      // slow regime oscillation -> produces trending and ranging stretches
      const phase = (i / count) * Math.PI * 2 * cycles + offset;
      drift = drift * 0.965 + (Math.sin(phase) * 0.80 + gauss(rng) * 0.35) * 0.035;
      volMul = Math.max(0.5, Math.min(2.1, volMul * 0.97 + (0.5 + Math.abs(gauss(rng)) * 0.55) * 0.03));

      const o = price;
      const body = (drift * 1.0 + gauss(rng) * 0.82) * atrUnit * volMul;
      const c = o + body;
      const wickUp = Math.abs(gauss(rng)) * atrUnit * volMul * 0.46;
      const wickDn = Math.abs(gauss(rng)) * atrUnit * volMul * 0.46;
      const h = Math.max(o, c) + wickUp;
      const l = Math.min(o, c) - wickDn;
      const v = Math.round(140 + Math.abs(body / atrUnit) * 260 * volMul + rng() * 90);

      out.push({ t: lastOpen - (count - 1 - i) * stepMs, o, h, l, c, v });
      price = c;
    }
    return out;
  }

  /* ---------- live tick simulation ---------- */
  function Feed(sym, tfId, count) {
    this.sym = sym; this.tfId = tfId;
    this.info = pairInfo(sym);
    this.tf = tfInfo(tfId);
    this.candles = buildSeries(sym, tfId, count || 320);
    this.rng = makeRng(hashStr(sym + tfId + 'live'));
    this.subs = [];
    this.demoStepMs = 11000;   // demo: a new candle forms every 11s so the chart feels alive
    this.lastRoll = performance.now();
    this.spread = (this.info.pip * (0.5 + this.rng() * 1.4));
    this.atrUnit = this.info.pip * (this.tf.min <= 3 ? 5 : this.tf.min <= 15 ? 11 : this.tf.min <= 30 ? 17 : 26) * this.info.vol;
    // carry the generator's prevailing drift into the live simulation so the
    // regime the series was built in does not wash out after a minute of ticks
    const n = this.candles.length;
    const back = Math.min(30, n - 1);
    this.drift = (this.candles[n - 1].c - this.candles[n - 1 - back].c) / back / this.atrUnit;
    this.ticksPerCandle = 42;
  }
  Feed.prototype.on = function (fn) { this.subs.push(fn); return this; };
  Feed.prototype.emit = function (type) { this.subs.forEach(f => f(type, this)); };
  Feed.prototype.last = function () { return this.candles[this.candles.length - 1]; };

  Feed.prototype.tick = function (nowMs) {
    const c = this.last();
    const atrUnit = this.atrUnit;
    const move = (this.drift / this.ticksPerCandle) * atrUnit + gauss(this.rng) * atrUnit * 0.10;
    c.c = c.c + move;
    if (c.c > c.h) c.h = c.c;
    if (c.c < c.l) c.l = c.c;
    c.v += Math.round(this.rng() * 4);
    this.emit('tick');

    if (nowMs - this.lastRoll >= this.demoStepMs) {
      this.lastRoll = nowMs;
      const stepMs = this.tf.min * 60000;
      this.candles.push({ t: c.t + stepMs, o: c.c, h: c.c, l: c.c, c: c.c, v: 0 });
      if (this.candles.length > 420) this.candles.shift();
      // drift decays slowly toward zero: regimes end, they do not run forever
      this.drift = this.drift * 0.985 + gauss(this.rng) * 0.02;
      this.emit('close');
    }
  };
  Feed.prototype.progress = function (nowMs) {
    return Math.min(1, (nowMs - this.lastRoll) / this.demoStepMs);
  };
  Feed.prototype.secondsToClose = function (nowMs) {
    // presented on the real timeframe scale, driven by the demo clock
    const frac = 1 - this.progress(nowMs);
    return Math.max(0, Math.round(frac * this.tf.min * 60));
  };

  /* ---------- higher timeframe aggregation (real logic) ---------- */
  function aggregate(candles, factor) {
    const out = [];
    for (let i = 0; i < candles.length; i += factor) {
      const slice = candles.slice(i, i + factor);
      if (!slice.length) break;
      out.push({
        t: slice[0].t,
        o: slice[0].o,
        h: Math.max.apply(null, slice.map(c => c.h)),
        l: Math.min.apply(null, slice.map(c => c.l)),
        c: slice[slice.length - 1].c,
        v: slice.reduce((s, c) => s + c.v, 0)
      });
    }
    return out;
  }

  /* ---------- sessions ---------- */
  function sessionState(date) {
    const h = date.getUTCHours() + date.getUTCMinutes() / 60;
    return SESSIONS.map(s => {
      const open = s.open < s.close ? (h >= s.open && h < s.close) : (h >= s.open || h < s.close);
      let hrsTo;
      if (open) {
        hrsTo = (s.close - h + 24) % 24;
      } else {
        hrsTo = (s.open - h + 24) % 24;
      }
      return { id: s.id, name: s.name, open, hrs: hrsTo, span: [s.open, s.close] };
    });
  }
  function activeSession(date) {
    const st = sessionState(date).filter(s => s.open);
    if (!st.length) return { id: '—', name: 'Between sessions', open: false };
    // London/NY overlap is the notable one
    const ids = st.map(s => s.id);
    if (ids.indexOf('LDN') >= 0 && ids.indexOf('NY') >= 0) return { id: 'LDN+NY', name: 'London / New York overlap', open: true };
    return st[st.length - 1];
  }

  /* ---------- formatting ---------- */
  function fmtPrice(v, sym) {
    const p = pairInfo(sym);
    return v.toFixed(p.digits);
  }
  function fmtPips(v, sym) {
    const p = pairInfo(sym);
    return (v / p.pip).toFixed(1);
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  function fmtClock(d) {
    return String(d.getUTCHours()).padStart(2, '0') + ':' +
           String(d.getUTCMinutes()).padStart(2, '0') + ':' +
           String(d.getUTCSeconds()).padStart(2, '0');
  }

  global.MP = global.MP || {};
  global.MP.Market = {
    PAIRS, TIMEFRAMES, SESSIONS,
    pairInfo, tfInfo, buildSeries, Feed, aggregate,
    sessionState, activeSession,
    fmtPrice, fmtPips, fmtTime, fmtClock,
    makeRng, hashStr, PHASE
  };
})(window);
