/* ============================================================
   MarketPulse — ANALYSIS ENGINE (prototype)
   ------------------------------------------------------------
   PURE. Deterministic. No timers, no DOM, no randomness.

       analyze(candles, opts) -> Reading

   The Reading contains EVERYTHING the Presentation Engine will
   ever display, including overlay geometry in price/time space.
   The Presentation Engine may not compute anything — it replays.

   Strategy families exist because correlated strategies are not
   independent confirmations. Five EMA-derived strategies voting
   together is one opinion repeated five times, and the engine
   reports that honestly as "effective independent voices".
   ============================================================ */
(function (global) {
  'use strict';
  const I = global.MP.Ind;

  /* ---------------- family definitions ----------------
     rho = assumed intra-family correlation. Higher rho means
     extra members inside that family add less independence. */
  /* Family definitions now come from the versioned EngineConfig. The exported
     FAMILIES / FAM_ORDER remain for UI compatibility and mirror the default config.

     kind DIRECTIONAL : may cast an UP/DOWN vote, enters the consensus
     kind CONTEXT     : describes conditions only, never votes, never counted
                        as an independent confirmation.  See docs/10 §3. */
  function cfgFamilies(cfg) {
    const out = {};
    cfg.familyOrder.forEach(k => { out[k] = Object.assign({ key: k }, cfg.families[k]); });
    return out;
  }
  const DEFAULT_CFG = (global.MP && global.MP.EngineConfig) ? global.MP.EngineConfig.DEFAULT : null;
  const FAMILIES = DEFAULT_CFG ? cfgFamilies(DEFAULT_CFG) : {};
  const FAM_ORDER = DEFAULT_CFG ? DEFAULT_CFG.familyOrder.slice() : [];

  const B = 'BULLISH', S = 'BEARISH', N = 'NEUTRAL';
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const dirOf = v => v === B ? 1 : v === S ? -1 : 0;

  /* ---------------- strategy definitions ----------------
     Each returns { verdict, strength, rule, evidence[], uses[] } */
  const STRATEGIES = [

    /* ---------- TREND ---------- */
    { id: 'ema_trend', name: 'EMA Trend', fam: 'TREND', uses: ['ema9', 'ema21', 'ema50'],
      rule: 'EMA9 > EMA21 > EMA50 (stacked) and EMA21 slope positive over 20 bars',
      run(x) {
        const { e9, e21, e50, i, pip } = x;
        const stackedUp = e9[i] > e21[i] && e21[i] > e50[i];
        const stackedDn = e9[i] < e21[i] && e21[i] < e50[i];
        const slope = I.linreg(e21, i - 20, i).slope;
        const sep = Math.abs(e9[i] - e50[i]) / pip;
        const sepNorm = clamp01(sep / (x.atrPips * 1.4));
        const slopeNorm = clamp01(Math.abs(slope) / (x.atr[i] * 0.10));
        const ev = [
          { k: 'EMA 9',  v: x.fmt(e9[i]) + '  (' + ((e9[i] - e21[i]) / pip >= 0 ? '+' : '') + ((e9[i] - e21[i]) / pip).toFixed(1) + 'p vs EMA21)' },
          { k: 'EMA 21', v: x.fmt(e21[i]) + '  (' + ((e21[i] - e50[i]) / pip >= 0 ? '+' : '') + ((e21[i] - e50[i]) / pip).toFixed(1) + 'p vs EMA50)' },
          { k: 'EMA 50', v: x.fmt(e50[i]) + '  slope ' + (slope >= 0 ? '+' : '') + slope.toFixed(6) + ' / bar' },
          { k: 'Separation', v: sep.toFixed(1) + ' pips  (' + (sep / x.atrPips).toFixed(2) + '× ATR)' }
        ];
        if (stackedUp && slope > 0) return { verdict: B, strength: clamp01(0.45 + sepNorm * 0.35 + slopeNorm * 0.2), evidence: ev };
        if (stackedDn && slope < 0) return { verdict: S, strength: clamp01(0.45 + sepNorm * 0.35 + slopeNorm * 0.2), evidence: ev };
        return { verdict: N, strength: 0.18, evidence: ev.concat([{ k: 'Note', v: 'EMAs are not stacked — no trend condition' }]) };
      } },

    { id: 'ema_cross', name: 'EMA Crossover', fam: 'TREND', uses: ['ema9', 'ema21'],
      rule: 'EMA9 crossed EMA21 within the last 12 bars, still holding',
      run(x) {
        const { e9, e21, i } = x;
        let crossIdx = -1, dir = 0;
        for (let k = i; k > i - 12 && k > 1; k--) {
          if (e9[k] == null || e21[k] == null || e9[k - 1] == null) continue;
          const now = e9[k] - e21[k], prev = e9[k - 1] - e21[k - 1];
          if (now > 0 && prev <= 0) { crossIdx = k; dir = 1; break; }
          if (now < 0 && prev >= 0) { crossIdx = k; dir = -1; break; }
        }
        const bars = crossIdx < 0 ? null : i - crossIdx;
        const ev = crossIdx < 0
          ? [{ k: 'Last cross', v: 'none within 12 bars' }, { k: 'Spread', v: ((e9[i] - e21[i]) / x.pip).toFixed(1) + ' pips' }]
          : [{ k: 'Cross', v: (dir > 0 ? 'EMA9 above EMA21' : 'EMA9 below EMA21') + ' — ' + bars + ' bars ago' },
             { k: 'Cross price', v: x.fmt(x.c[crossIdx].c) },
             { k: 'Spread now', v: ((e9[i] - e21[i]) / x.pip).toFixed(1) + ' pips' }];
        if (crossIdx < 0) return { verdict: N, strength: 0.15, evidence: ev };
        const fresh = clamp01(1 - bars / 12);
        return { verdict: dir > 0 ? B : S, strength: clamp01(0.35 + fresh * 0.5), evidence: ev };
      } },

    { id: 'macd', name: 'MACD', fam: 'TREND', uses: ['macd'],
      rule: 'MACD line vs signal line, with histogram expansion',
      run(x) {
        const { m, i } = x;
        const line = m.line[i], sig = m.signal[i], h = m.hist[i], hPrev = m.hist[i - 1];
        const ev = [
          { k: 'MACD', v: line.toFixed(6) },
          { k: 'Signal', v: sig.toFixed(6) },
          { k: 'Histogram', v: (h >= 0 ? '+' : '') + h.toFixed(6) + (Math.abs(h) > Math.abs(hPrev) ? '  expanding' : '  contracting') }
        ];
        const mag = clamp01(Math.abs(h) / (x.atr[i] * 0.22));
        if (line > sig && h > 0) return { verdict: B, strength: clamp01(0.40 + mag * 0.45), evidence: ev };
        if (line < sig && h < 0) return { verdict: S, strength: clamp01(0.40 + mag * 0.45), evidence: ev };
        return { verdict: N, strength: 0.2, evidence: ev };
      } },

    { id: 'momentum', name: 'Momentum', fam: 'TREND', uses: ['ema21'],
      rule: 'Rate of change over 10 bars, normalised by ATR',
      run(x) {
        const { cl, i, atr } = x;
        const roc = cl[i] - cl[i - 10];
        const norm = roc / atr[i];
        const ev = [
          { k: 'ROC (10)', v: (roc >= 0 ? '+' : '') + (roc / x.pip).toFixed(1) + ' pips' },
          { k: 'ATR (14)', v: x.atrPips.toFixed(1) + ' pips' },
          { k: 'Normalised', v: (norm >= 0 ? '+' : '') + norm.toFixed(2) + ' ATR' }
        ];
        if (norm > 0.55) return { verdict: B, strength: clamp01(0.35 + Math.min(1, norm / 2.4) * 0.55), evidence: ev };
        if (norm < -0.55) return { verdict: S, strength: clamp01(0.35 + Math.min(1, -norm / 2.4) * 0.55), evidence: ev };
        return { verdict: N, strength: 0.2, evidence: ev.concat([{ k: 'Note', v: 'Movement under 0.55 ATR — no momentum condition' }]) };
      } },

    { id: 'mtf', name: 'Multi-Timeframe', fam: 'TREND', uses: ['ema21', 'ema50'],
      rule: 'Higher timeframe EMA21 vs EMA50 alignment with the current timeframe. ' +
            'HTF candles are UTC-boundary aligned and CLOSED ONLY — a partially formed ' +
            'higher-timeframe candle is never used.',
      run(x) {
        const h = x.htf;
        if (!h || !h.available) {
          return {
            unavailable: true,
            reason: h ? h.reason : 'HTF_NOT_BUILT',
            evidence: [
              { k: 'Higher TF', v: x.htfLabel + ' — unavailable' },
              { k: 'Reason', v: h ? h.detail : 'higher timeframe not built' },
              { k: 'Note', v: 'No verdict issued. A partial HTF candle is never inferred from.' }
            ]
          };
        }
        const j = h.e21.length - 1;
        const htfUp = h.e21[j] > h.e50[j];
        const ctfUp = x.e21[x.i] > x.e50[x.i];
        const gap = Math.abs(h.e21[j] - h.e50[j]) / x.pip;
        const ev = [
          { k: 'Higher TF', v: x.htfLabel + '  EMA21 ' + (htfUp ? 'above' : 'below') + ' EMA50 by ' + gap.toFixed(1) + 'p' },
          { k: 'HTF candles', v: h.candles.length + ' closed, newest opens ' + global.MP.Market.fmtTime(h.candles[h.candles.length - 1].t) + ' UTC' },
          { k: 'Current TF', v: x.tfLabel + '  EMA21 ' + (ctfUp ? 'above' : 'below') + ' EMA50' },
          { k: 'Alignment', v: htfUp === ctfUp ? 'aligned' : 'conflicting' }
        ];
        if (htfUp !== ctfUp) return { verdict: N, strength: 0.22, evidence: ev.concat([{ k: 'Note', v: 'Timeframes disagree — no directional read' }]) };
        return { verdict: htfUp ? B : S, strength: clamp01(0.42 + Math.min(1, gap / (x.atrPips * 2.2)) * 0.45), evidence: ev };
      } },

    /* ---------- MOMENTUM ---------- */
    { id: 'rsi', name: 'RSI Momentum', fam: 'MOMENTUM', uses: ['rsi'],
      rule: 'RSI(14) relative to 50, with 5-bar direction; overbought/oversold dampening',
      run(x) {
        const r = x.r, i = x.i;
        const d = r[i] - r[i - 5];
        const ev = [
          { k: 'RSI (14)', v: r[i].toFixed(2) },
          { k: '5-bar change', v: (d >= 0 ? '+' : '') + d.toFixed(2) },
          { k: 'Zone', v: r[i] > 70 ? 'overbought' : r[i] < 30 ? 'oversold' : r[i] > 55 ? 'bullish' : r[i] < 45 ? 'bearish' : 'neutral' }
        ];
        if (r[i] > 70 || r[i] < 30) return { verdict: N, strength: 0.25, evidence: ev.concat([{ k: 'Note', v: 'Extreme zone — momentum read suppressed' }]) };
        if (r[i] > 54 && d > 0) return { verdict: B, strength: clamp01(0.32 + (r[i] - 50) / 20 * 0.5), evidence: ev };
        if (r[i] < 46 && d < 0) return { verdict: S, strength: clamp01(0.32 + (50 - r[i]) / 20 * 0.5), evidence: ev };
        return { verdict: N, strength: 0.2, evidence: ev };
      } },

    { id: 'stoch', name: 'Stochastic', fam: 'MOMENTUM', uses: ['stoch'],
      rule: 'MOMENTUM CONTINUATION ONLY: %K crossing above/below %D while inside the ' +
            'mid-range band. The overbought/oversold extremes are reported as CONTEXT and ' +
            'do NOT vote — mean reversion is owned by the Mean Reversion strategy, and one ' +
            'strategy holding two opposite interpretations has no consistent meaning.',
      run(x) {
        const st = x.st, i = x.i;
        const p = x.cfg.strategies.stoch;
        const k = st.k[i], d = st.d[i];
        const extreme = k > p.midHigh ? 'OVERBOUGHT' : k < p.midLow ? 'OVERSOLD' : null;
        const ev = [
          { k: '%K', v: k.toFixed(2) },
          { k: '%D', v: d.toFixed(2) },
          { k: 'Zone', v: extreme ? extreme.toLowerCase() + ' (context only — no vote)' : 'mid-range' }
        ];
        const context = { mode: 'MOMENTUM_CONTINUATION', extreme: extreme, k: k, d: d };
        if (extreme) {
          return { verdict: N, strength: 0.15, context: context,
            evidence: ev.concat([{ k: 'Note', v: 'Extreme zone is reported as context. Momentum continuation is not read here.' }]) };
        }
        if (k > d + p.kdSpread) return { verdict: B, strength: clamp01(0.28 + (k - d) / 40), context: context, evidence: ev };
        if (k < d - p.kdSpread) return { verdict: S, strength: clamp01(0.28 + (d - k) / 40), context: context, evidence: ev };
        return { verdict: N, strength: 0.18, context: context, evidence: ev };
      } },

    { id: 'rsi_ema', name: 'RSI + EMA', fam: 'MOMENTUM', uses: ['rsi', 'ema21'],
      rule: 'Price on the trend side of EMA21 AND RSI confirming the same side of 50',
      run(x) {
        const above = x.cl[x.i] > x.e21[x.i];
        const rv = x.r[x.i];
        const dist = (x.cl[x.i] - x.e21[x.i]) / x.pip;
        const ev = [
          { k: 'Price vs EMA21', v: (dist >= 0 ? '+' : '') + dist.toFixed(1) + ' pips' },
          { k: 'RSI (14)', v: rv.toFixed(2) },
          { k: 'Confirmation', v: (above && rv > 50) || (!above && rv < 50) ? 'both agree' : 'split' }
        ];
        if (above && rv > 50) return { verdict: B, strength: clamp01(0.34 + Math.min(1, Math.abs(dist) / (x.atrPips * 1.6)) * 0.4), evidence: ev };
        if (!above && rv < 50) return { verdict: S, strength: clamp01(0.34 + Math.min(1, Math.abs(dist) / (x.atrPips * 1.6)) * 0.4), evidence: ev };
        return { verdict: N, strength: 0.2, evidence: ev };
      } },

    /* ---------- STRUCTURE ---------- */
    { id: 'sr', name: 'Support / Resistance', fam: 'STRUCTURE', uses: ['levels'],
      rule: 'Distance to nearest support vs nearest resistance, weighted by touch count',
      run(x) {
        const price = x.cl[x.i];
        const sup = x.levels.filter(l => l.kind === 'support')[0];
        const res = x.levels.filter(l => l.kind === 'resistance')[0];
        const ev = [];
        if (sup) ev.push({ k: 'Support', v: x.fmt(sup.price) + '  (−' + ((price - sup.price) / x.pip).toFixed(1) + 'p, ' + sup.touches + ' touches)' });
        if (res) ev.push({ k: 'Resistance', v: x.fmt(res.price) + '  (+' + ((res.price - price) / x.pip).toFixed(1) + 'p, ' + res.touches + ' touches)' });
        if (!sup || !res) { ev.push({ k: 'Note', v: 'Insufficient confirmed levels on both sides' }); return { verdict: N, strength: 0.2, evidence: ev }; }
        const dS = price - sup.price, dR = res.price - price;
        const ratio = dR / (dS + dR);
        ev.push({ k: 'Position', v: (ratio * 100).toFixed(0) + '% of the way to resistance' });
        if (ratio > 0.66) return { verdict: B, strength: clamp01(0.3 + (ratio - 0.66) * 1.5 + sup.touches * 0.04), evidence: ev };
        if (ratio < 0.34) return { verdict: S, strength: clamp01(0.3 + (0.34 - ratio) * 1.5 + res.touches * 0.04), evidence: ev };
        return { verdict: N, strength: 0.22, evidence: ev.concat([{ k: 'Note', v: 'Mid-range between levels — no edge' }]) };
      } },

    { id: 'structure', name: 'Market Structure', fam: 'STRUCTURE', uses: ['structure'],
      rule: 'Last four confirmed swing points form a higher-high/higher-low or lower-high/lower-low sequence',
      run(x) {
        const s = x.structure.slice(-4);
        if (s.length < 3) return { verdict: N, strength: 0.15, evidence: [{ k: 'Note', v: 'Not enough confirmed swings' }] };
        const labels = s.map(p => p.label);
        const ev = s.map(p => ({ k: p.label, v: x.fmt(p.p) + '  @ ' + x.timeAt(p.i) }));
        const up = labels.filter(l => l === 'HH' || l === 'HL').length;
        const dn = labels.filter(l => l === 'LL' || l === 'LH').length;
        ev.push({ k: 'Sequence', v: labels.join(' → ') });
        if (up >= 3 && up > dn) return { verdict: B, strength: clamp01(0.42 + up * 0.11), evidence: ev };
        if (dn >= 3 && dn > up) return { verdict: S, strength: clamp01(0.42 + dn * 0.11), evidence: ev };
        return { verdict: N, strength: 0.24, evidence: ev.concat([{ k: 'Note', v: 'Mixed structure — no clean trend sequence' }]) };
      } },

    { id: 'breakout', name: 'Breakout', fam: 'STRUCTURE', uses: ['levels', 'channel'],
      rule: 'Close beyond the 20-bar extreme with above-average range expansion',
      run(x) {
        const i = x.i, c = x.c;
        let hh = -Infinity, ll = Infinity;
        for (let k = i - 20; k < i; k++) { hh = Math.max(hh, c[k].h); ll = Math.min(ll, c[k].l); }
        const rng = c[i].h - c[i].l;
        const expansion = rng / x.atr[i];
        const ev = [
          { k: '20-bar high', v: x.fmt(hh) },
          { k: '20-bar low', v: x.fmt(ll) },
          { k: 'Close', v: x.fmt(c[i].c) },
          { k: 'Range', v: expansion.toFixed(2) + '× ATR' }
        ];
        if (c[i].c > hh && expansion > 0.9) return { verdict: B, strength: clamp01(0.4 + Math.min(1, expansion / 2.4) * 0.5), evidence: ev };
        if (c[i].c < ll && expansion > 0.9) return { verdict: S, strength: clamp01(0.4 + Math.min(1, expansion / 2.4) * 0.5), evidence: ev };
        // failed breakout / rejection is a real bearish-for-longs signal
        if (c[i].h > hh && c[i].c < hh) return { verdict: S, strength: 0.44, evidence: ev.concat([{ k: 'Note', v: 'High exceeded the range then closed back inside — rejection' }]) };
        if (c[i].l < ll && c[i].c > ll) return { verdict: B, strength: 0.44, evidence: ev.concat([{ k: 'Note', v: 'Low exceeded the range then closed back inside — rejection' }]) };
        return { verdict: N, strength: 0.16, evidence: ev.concat([{ k: 'Note', v: 'Price inside the 20-bar range — no breakout setup' }]) };
      } },

    { id: 'price_action', name: 'Price Action', fam: 'STRUCTURE', uses: ['pattern'],
      rule: 'Last three candles: net body direction and rejection-wick balance',
      run(x) {
        const c = x.c, i = x.i;
        const last3 = [c[i - 2], c[i - 1], c[i]];
        const netBody = last3.reduce((s, k) => s + (k.c - k.o), 0);
        const upWick = last3.reduce((s, k) => s + (k.h - Math.max(k.o, k.c)), 0);
        const dnWick = last3.reduce((s, k) => s + (Math.min(k.o, k.c) - k.l), 0);
        const ev = [
          { k: 'Net body (3)', v: (netBody >= 0 ? '+' : '') + (netBody / x.pip).toFixed(1) + ' pips' },
          { k: 'Upper wicks', v: (upWick / x.pip).toFixed(1) + ' pips' },
          { k: 'Lower wicks', v: (dnWick / x.pip).toFixed(1) + ' pips' },
          { k: 'Wick balance', v: dnWick > upWick ? 'buyers rejecting lows' : upWick > dnWick ? 'sellers rejecting highs' : 'balanced' }
        ];
        const bodyN = netBody / (x.atr[i] * 1.5);
        const wickN = (dnWick - upWick) / (x.atr[i] * 1.5);
        const score = bodyN * 0.65 + wickN * 0.35;
        if (score > 0.30) return { verdict: B, strength: clamp01(0.3 + Math.min(1, score) * 0.5), evidence: ev };
        if (score < -0.30) return { verdict: S, strength: clamp01(0.3 + Math.min(1, -score) * 0.5), evidence: ev };
        return { verdict: N, strength: 0.18, evidence: ev.concat([{ k: 'Note', v: 'No decisive price action — NO SETUP' }]), noSetup: true };
      } },

    /* ---------- VOLATILITY ---------- */
    { id: 'bollinger', name: 'Bollinger Bandwidth', fam: 'VOLATILITY', uses: ['bb'], context: true,
      rule: 'CONTEXT ONLY: bandwidth of BB(20,2) against its own 40-bar mean — squeeze, ' +
            'normal or expansion. Casts no directional vote. The old rule inverted its own ' +
            'sign twice across the %B range (>62% bullish but >94% bearish), and its %B ' +
            'displacement duplicated Mean Reversion. Width and displacement are now split: ' +
            'this strategy owns WIDTH (a volatility condition), Mean Reversion owns ' +
            'DISPLACEMENT (a directional read).',
      run(x) {
        const bb = x.bb, i = x.i, price = x.cl[i];
        const p = x.cfg.strategies.bollinger;
        const pos = (price - bb.lower[i]) / Math.max(1e-12, bb.upper[i] - bb.lower[i]);
        const wNow = bb.width[i];
        let wAvg = 0, n = 0;
        for (let k = i - p.bandwidthMeanBars; k <= i; k++) { if (bb.width[k] != null) { wAvg += bb.width[k]; n++; } }
        wAvg /= Math.max(1, n);
        const ratio = wNow / wAvg;
        const state = ratio < p.squeezeRatio ? 'SQUEEZE' : ratio > p.expansionRatio ? 'EXPANSION' : 'NORMAL';
        const ev = [
          { k: 'Upper', v: x.fmt(bb.upper[i]) },
          { k: 'Middle', v: x.fmt(bb.mid[i]) },
          { k: 'Lower', v: x.fmt(bb.lower[i]) },
          { k: 'Bandwidth', v: (wNow * 100).toFixed(3) + '%  (' + ratio.toFixed(2) + '× ' + p.bandwidthMeanBars + '-bar avg)' },
          { k: 'State', v: state },
          { k: '%B', v: (pos * 100).toFixed(1) + '%  (reported, not voted on)' }
        ];
        return { verdict: N, strength: 0, context: { state: state, ratio: Math.round(ratio * 1000) / 1000, percentB: Math.round(pos * 1000) / 1000 }, evidence: ev };
      } },

    { id: 'atr_regime', name: 'ATR Regime', fam: 'VOLATILITY', uses: [], context: true,
      rule: 'CONTEXT ONLY: ATR(14) against its own 50-bar mean — expanding, stable or ' +
            'contracting. Casts no directional vote. The old rule took its direction from ' +
            'close vs EMA21, which made a trend signal masquerade as an independent ' +
            'volatility voice and inflated cross-family agreement whenever volatility rose.',
      run(x) {
        const i = x.i, a = x.atr;
        const p = x.cfg.strategies.atr_regime;
        let avg = 0, n = 0;
        for (let k = i - p.meanBars; k <= i; k++) { if (a[k] != null) { avg += a[k]; n++; } }
        avg /= Math.max(1, n);
        const ratio = a[i] / avg;
        const state = ratio > p.expandRatio ? 'EXPANDING' : ratio < p.contractRatio ? 'CONTRACTING' : 'STABLE';
        const ev = [
          { k: 'ATR (14)', v: x.atrPips.toFixed(1) + ' pips' },
          { k: p.meanBars + '-bar avg', v: (avg / x.pip).toFixed(1) + ' pips' },
          { k: 'Ratio', v: ratio.toFixed(2) + '×' },
          { k: 'State', v: state },
          { k: 'Note', v: 'Volatility describes conditions. It does not point up or down.' }
        ];
        return { verdict: N, strength: 0, context: { state: state, ratio: Math.round(ratio * 1000) / 1000 }, evidence: ev };
      } },

    /* ---------- PATTERN ---------- */
    { id: 'candle', name: 'Candle Pattern', fam: 'PATTERN', uses: ['pattern'],
      rule: 'Recognised candlestick formation on the last closed candle',
      run(x) {
        const p = x.pattern;
        if (!p) return { verdict: N, strength: 0.12, evidence: [{ k: 'Detected', v: 'none on the last closed candle' }], noSetup: true };
        const ev = [
          { k: 'Detected', v: p.name },
          { k: 'Candle', v: x.timeAt(p.at) + '  O ' + x.fmt(x.c[p.at].o) + '  C ' + x.fmt(x.c[p.at].c) },
          { k: 'Body / range', v: (Math.abs(x.c[p.at].c - x.c[p.at].o) / Math.max(1e-12, x.c[p.at].h - x.c[p.at].l) * 100).toFixed(0) + '%' }
        ];
        if (p.dir === 'NEUTRAL') return { verdict: N, strength: 0.24, evidence: ev.concat([{ k: 'Note', v: 'Indecision candle — no directional read' }]) };
        return { verdict: p.dir, strength: 0.46, evidence: ev };
      } },

    { id: 'mean_rev', name: 'Mean Reversion', fam: 'PATTERN', uses: ['bb'],
      rule: 'Z-score of price against SMA20 — contrarian beyond ±1.8σ. Sole owner of the ' +
            'DISPLACEMENT reading from the SMA20/sigma distribution; Bollinger Bandwidth ' +
            'owns WIDTH and does not vote, so the two no longer double-count one signal.',
      run(x) {
        const i = x.i;
        const m = x.bb.mid[i], sd = (x.bb.upper[i] - m) / 2;
        const z = (x.cl[i] - m) / Math.max(1e-12, sd);
        const sigma = x.cfg.strategies.mean_rev.sigma;
        const ev = [
          { k: 'SMA 20', v: x.fmt(m) },
          { k: 'Std dev', v: (sd / x.pip).toFixed(1) + ' pips' },
          { k: 'Z-score', v: (z >= 0 ? '+' : '') + z.toFixed(2) + 'σ' }
        ];
        if (z > sigma) return { verdict: S, strength: clamp01(0.3 + (z - sigma) * 0.3), evidence: ev.concat([{ k: 'Note', v: 'Stretched above the mean — reversion pressure' }]) };
        if (z < -sigma) return { verdict: B, strength: clamp01(0.3 + (-z - sigma) * 0.3), evidence: ev.concat([{ k: 'Note', v: 'Stretched below the mean — reversion pressure' }]) };
        return { verdict: N, strength: 0.16, evidence: ev.concat([{ k: 'Note', v: 'Within ±' + sigma + 'σ — no reversion setup' }]) };
      } }
  ];

  /* ====================================================================
     DURATION — candidate ladder and DEMO selector
     --------------------------------------------------------------------
     The supported duration set and the selection algorithm are NOT
     finalised. The ladder below is a placeholder list of plausible
     forecast horizons, and demoSelectDuration is a placeholder mapping
     that exists only so the interface has a value to display.

     Deliberately does not take the chart timeframe as an input: the
     forecast horizon and the chart timeframe are separate concepts.
     ==================================================================== */
  const DURATION_LADDER_MIN = [1, 2, 3, 5, 10, 15, 30];

  function demoSelectDuration(agreement, volState, regimeTrend) {
    let idx = agreement >= 80 ? 4 : agreement >= 72 ? 3 : agreement >= 65 ? 2 : 1;
    if (volState === 'HIGH VOL') idx -= 1;   // faster markets invalidate sooner
    if (volState === 'LOW VOL') idx += 1;
    if (regimeTrend === 'RANGING') idx -= 1;
    idx = Math.max(0, Math.min(DURATION_LADDER_MIN.length - 1, idx));
    return DURATION_LADDER_MIN[idx];
  }

  /* ---------------- main entry point ---------------- */
  function analyze(candles, opts) {
    const t0 = performance.now();
    opts = opts || {};
    const EC = global.MP.EngineConfig;
    const cfg = opts.config || (EC ? EC.DEFAULT : null);
    if (!cfg) throw new Error('MP.EngineConfig is required (load engineConfig.js before engine.js)');
    if (opts.gatesMode) cfg.gates = Object.assign({}, cfg.gates, { mode: opts.gatesMode });
    const configHash = EC.hash(cfg);

    const pip = opts.pip || 0.0001;
    const digits = opts.digits || 5;
    const enabled = opts.enabled || null;              // PRO / ablation: subset of ids
    const weights = opts.weights || null;              // PRO: per-strategy weight override
    const FAMS = cfgFamilies(cfg);
    const famKind = k => (FAMS[k] ? FAMS[k].kind : 'DIRECTIONAL');

    // gate values come from config; opts.thresholds still overrides for compatibility
    const thresholds = Object.assign({
      agreementFloor: cfg.gates.agreementFloor,
      minFamilies: cfg.gates.minDirectionalFamilies,
      minIndependent: cfg.gates.minIndependentVoices,
      minDirectional: cfg.gates.minParticipatingStrategies
    }, opts.thresholds || {});

    const c = candles.slice(0, candles.length - 1);     // analyse CLOSED candles only

    /* ---- TECHNICAL REFUSAL ------------------------------------------
       A data failure must never look like an analytical NEUTRAL. If the
       caller supplied a dataQuality assessment that failed, or there are
       simply not enough closed bars for the shortest lookback in the
       engine, refuse outright. */
    const dq = opts.dataQuality || null;
    if ((dq && dq.ok === false) || c.length < cfg.warmup.hardMinBars) {
      return technicalRefusal({
        candles: c, cfg, configHash, opts, pip, digits,
        codes: dq && dq.ok === false ? dq.blockingCodes : ['INSUFFICIENT_HISTORY'],
        detail: dq && dq.ok === false
          ? 'data quality gate failed'
          : c.length + ' closed candles; hard minimum is ' + cfg.warmup.hardMinBars,
        dataQuality: dq
      });
    }

    const i = c.length - 1;
    const cl = I.closes(c);

    /* --- indicators (real math) --- */
    const e9 = I.ema(cl, 9), e21 = I.ema(cl, 21), e50 = I.ema(cl, 50);
    const s20 = I.sma(cl, 20);
    const r = I.rsi(cl, 14);
    const m = I.macd(cl, 12, 26, 9);
    const bb = I.bollinger(cl, 20, 2);
    const a = I.atr(c, 14);
    const st = I.stochastic(c, 14, 3);
    const ad = I.adx(c, 14);
    const piv = I.pivots(c, 3);
    const lv = I.levels(c, piv, a[i] * 0.9);
    const structure = I.structure(piv);
    const pattern = I.lastPattern(c);

    /* --- higher timeframe: UTC-aligned, CLOSED HTF candles only ---------
       Boundaries come from the epoch, not from where the array starts, and a
       partially formed HTF candle is never produced. If the window cannot
       supply enough complete HTF candles, MTF reports UNAVAILABLE rather than
       inferring from a partial bar. */
    const tfMin = opts.tfMin || 5;
    const htfLabel = cfg.mtf.pairing[opts.tfLabel] || null;
    const htfMin = htfLabel ? ({ '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240 })[htfLabel] : null;
    let htf = { available: false, reason: 'NO_PAIRING', detail: 'no higher timeframe configured for ' + opts.tfLabel };
    if (htfMin) {
      const agg = I.aggregateUTC(c, tfMin, htfMin);
      if (!agg.ok) {
        htf = { available: false, reason: agg.reason, detail: 'aggregation refused: ' + agg.reason };
      } else if (agg.candles.length < cfg.mtf.minHtfBars) {
        htf = {
          available: false, reason: 'INSUFFICIENT_HTF_HISTORY',
          detail: agg.candles.length + ' closed ' + htfLabel + ' candles; ' + cfg.mtf.minHtfBars + ' required',
          candles: agg.candles
        };
      } else {
        const htfCl = I.closes(agg.candles);
        htf = {
          available: true, reason: null, detail: null,
          e21: I.ema(htfCl, 21), e50: I.ema(htfCl, 50),
          candles: agg.candles, droppedPartial: agg.dropped, timeframe: htfLabel
        };
      }
    }

    const atrPips = a[i] / pip;
    const fmt = v => v.toFixed(digits);
    const timeAt = idx => global.MP.Market.fmtTime(c[idx].t);

    /* --- regime (real) --- */
    const adxV = ad.adx[i] || 0;
    const trending = adxV >= 22;
    let volState;
    let avgAtr = 0, na = 0;
    for (let k = i - 50; k <= i; k++) if (a[k] != null) { avgAtr += a[k]; na++; }
    avgAtr /= Math.max(1, na);
    const volRatio = a[i] / avgAtr;
    volState = volRatio > 1.2 ? 'HIGH VOL' : volRatio < 0.82 ? 'LOW VOL' : 'NORMAL';
    const regime = {
      trend: trending ? 'TRENDING' : 'RANGING',
      vol: volState,
      adx: adxV, volRatio,
      label: (trending ? 'TRENDING' : 'RANGING') + ' / ' + volState
    };

    const x = {
      c, cl, i, pip, digits, fmt, timeAt,
      e9, e21, e50, s20, r, m, bb, atr: a, st, ad, piv, levels: lv,
      structure, pattern, htf, atrPips, regime,
      cfg, tfMin, htfMin,
      tfLabel: opts.tfLabel || '', htfLabel: htfLabel || opts.htfLabel || ''
    };

    /* --- run strategies, with an explicit availability status ------------
       A strategy that could not be evaluated must NOT be recorded as a
       NEUTRAL verdict: 'I looked and saw nothing' and 'I could not look' are
       different statements, and only the first is evidence. */
    const results = [];
    STRATEGIES.forEach(def => {
      if (enabled && enabled.indexOf(def.id) < 0) return;
      const kind = famKind(def.fam);
      const base = {
        id: def.id, name: def.name, fam: def.fam, rule: def.rule, uses: def.uses,
        kind: kind,
        isContext: !!def.context,
        weight: weights && weights[def.id] != null ? weights[def.id] : 1
      };
      const need = cfg.warmup.perStrategy[def.id] || cfg.warmup.hardMinBars;

      if (c.length < need) {
        results.push(Object.assign({}, base, {
          availability: 'INSUFFICIENT_HISTORY',
          verdict: N, strength: 0, noSetup: false,
          requiredBars: need, availableBars: c.length,
          evidence: [{ k: 'Unavailable', v: c.length + ' closed candles; ' + need + ' required' },
                     { k: 'Note', v: 'Not evaluated. This is not a neutral market reading.' }]
        }));
        return;
      }

      let out;
      try { out = def.run(x); }
      catch (err) {
        results.push(Object.assign({}, base, {
          availability: 'UNAVAILABLE', unavailableReason: 'RUNTIME_ERROR',
          verdict: N, strength: 0, noSetup: false,
          evidence: [{ k: 'Unavailable', v: 'runtime error: ' + (err && err.message ? err.message : 'unknown') }]
        }));
        return;
      }

      if (out && out.unavailable) {
        results.push(Object.assign({}, base, {
          availability: 'UNAVAILABLE', unavailableReason: out.reason || 'UNAVAILABLE',
          verdict: N, strength: 0, noSetup: false,
          evidence: out.evidence || []
        }));
        return;
      }

      results.push(Object.assign({}, base, {
        availability: 'AVAILABLE',
        verdict: out.verdict,
        strength: Math.round(out.strength * 100) / 100,
        evidence: out.evidence,
        noSetup: !!out.noSetup,
        context: out.context || null
      }));
    });

    const availableResults = results.filter(s => s.availability === 'AVAILABLE');
    const directionalResults = availableResults.filter(s => s.kind === 'DIRECTIONAL');

    /* --- family resolution -------------------------------------------
       Only AVAILABLE strategies participate. CONTEXT families never produce a
       direction and never contribute independent voices. */
    const families = cfg.familyOrder.map(key => {
      const def = FAMS[key];
      const all = results.filter(s => s.fam === key);
      const members = all.filter(s => s.availability === 'AVAILABLE');
      if (!all.length) return null;
      if (def.kind === 'CONTEXT') {
        return {
          key, label: def.label, kind: 'CONTEXT', rho: def.rho, weight: 0,
          members: all.map(s => s.id),
          n: all.length, total: all.length, available: members.length, active: 0,
          counts: { bull: 0, bear: 0, flat: members.length },
          score: 0, direction: N, independent: 0, split: false,
          contextStates: members.filter(s => s.context).map(s => ({ id: s.id, context: s.context }))
        };
      }
      // Direction among the members that actually took a side, damped by how
      // many of the family's members participated at all. A family where two of
      // five strategies fire (both bearish) is bearish, but less so than one
      // where all five fire.
      let num = 0, den = 0, active = 0;
      members.forEach(s => {
        if (s.verdict === N) return;
        const w = s.weight;
        num += dirOf(s.verdict) * s.strength * w;
        den += s.strength * w;
        active++;
      });
      const pf = cfg.consensus.participationFloor;
      const participation = pf + (1 - pf) * (active / Math.max(1, members.length));
      const score = den === 0 ? 0 : (num / den) * participation;     // -1 .. +1
      const independent = active === 0 ? 0 : 1 + (active - 1) * (1 - def.rho);
      const counts = {
        bull: members.filter(s => s.verdict === B).length,
        bear: members.filter(s => s.verdict === S).length,
        flat: members.filter(s => s.verdict === N).length
      };
      const thr = cfg.consensus.familyDirectionThreshold;
      return {
        key, label: def.label, kind: 'DIRECTIONAL', rho: def.rho, weight: def.weight,
        members: members.map(s => s.id),
        n: members.length, total: all.length, available: members.length, active,
        unavailable: all.length - members.length,
        counts,
        score: Math.round(score * 1000) / 1000,
        direction: score > thr ? B : score < -thr ? S : N,
        independent: Math.round(independent * 100) / 100,
        split: counts.bull > 0 && counts.bear > 0
      };
    }).filter(Boolean);

    const directionalFamilies = families.filter(f => f.kind === 'DIRECTIONAL');
    const contextFamilies = families.filter(f => f.kind === 'CONTEXT');
    const availableDirectionalFamilies = directionalFamilies.filter(f => f.available > 0).length;

    /* --- consensus --- */
    // Families that produced no opinion at all do not vote against the others.
    // Their absence is reflected in familiesAgreeing and in independent voices,
    // not by dragging the directional score toward zero.
    let wNum = 0, wDen = 0;
    directionalFamilies.forEach(f => {
      if (f.active === 0) return;
      wNum += f.weight * f.score; wDen += f.weight;
    });
    const D = wDen === 0 ? 0 : wNum / wDen;                          // -1 .. +1

    // counts are taken over AVAILABLE DIRECTIONAL strategies only
    const bull = directionalResults.filter(s => s.verdict === B).length;
    const bear = directionalResults.filter(s => s.verdict === S).length;
    const flat = directionalResults.filter(s => s.verdict === N).length;
    // Agreement is measured among the strategies that actually took a side.
    // Neutrals do not "vote against" — they are accounted for separately, in the
    // participation gate and in the effective-independent-voices figure.
    const directional = bull + bear;
    const voteShare = directional ? Math.max(bull, bear) / directional : 0;

    const blend = cfg.consensus.agreementBlend;
    const agreement = Math.round(100 * (blend.directional * Math.min(1, Math.abs(D)) + blend.voteShare * voteShare));
    const independent = Math.round(directionalFamilies.reduce((s, f) => s + f.independent, 0) * 10) / 10;

    const dirSign = D > 0 ? 1 : D < 0 ? -1 : 0;
    const familiesAgreeing = directionalFamilies.filter(f => dirOf(f.direction) === dirSign && dirSign !== 0).length;

    /* --- WAIT logic (explicit, inspectable) --- */
    /* PRODUCTION gates are absolute — what a user actually gets.
       RESEARCH gates scale to what is enabled, so a single-family ablation is
       not automatically 100% WAIT. RESEARCH must never ship to users. */
    const research = cfg.gates.mode === 'RESEARCH';
    const effMinFamilies = research
      ? Math.min(thresholds.minFamilies, Math.max(1, availableDirectionalFamilies))
      : thresholds.minFamilies;
    const effMinIndependent = research
      ? Math.min(thresholds.minIndependent, Math.max(1, availableDirectionalFamilies * 0.8))
      : thresholds.minIndependent;
    const effMinDirectional = research
      ? Math.min(thresholds.minDirectional, Math.max(1, Math.ceil(directionalResults.length * 0.4)))
      : thresholds.minDirectional;

    const gates = [
      { k: 'agreement',   pass: agreement >= thresholds.agreementFloor, got: agreement, need: thresholds.agreementFloor },
      { k: 'families',    pass: familiesAgreeing >= effMinFamilies, got: familiesAgreeing, need: effMinFamilies },
      { k: 'independent', pass: independent >= effMinIndependent, got: independent, need: Math.round(effMinIndependent * 100) / 100 },
      { k: 'participation', pass: directional >= effMinDirectional, got: directional, need: effMinDirectional }
    ];
    let isWait = gates.some(g => !g.pass) || dirSign === 0;
    if (!isWait && regime.trend === 'RANGING' && adxV < 18 && agreement < 70) {
      isWait = true;
      gates.push({ k: 'regime', pass: false, got: 'RANGING / ADX ' + adxV.toFixed(1), need: 'agreement ≥ 70 in weak-ADX ranges' });
    }

    const verdict = isWait ? 'WAIT' : (dirSign > 0 ? 'UP' : 'DOWN');

    /* --- confluence quality --- */
    let quality;
    if (Math.abs(bull - bear) <= 2 && (bull + bear) > 6) quality = 'CONFLICTED';
    else if (independent >= 4.0 && familiesAgreeing >= 4) quality = 'STRONG';
    else if (independent >= 2.8 && familiesAgreeing >= 3) quality = 'MODERATE';
    else quality = 'WEAK';

    /* --- STRUCTURAL TREND READ ------------------------------------------
       Formalised from values ALREADY computed above. No new market maths:

         structure[]  -> confirmed swing sequence (HH / HL / LH / LL)
         e9/e21/e50   -> EMA stack state
         adxV         -> ADX(14)
         regime       -> TRENDING | RANGING  x  volatility bucket
         families     -> the trend family's resolved direction

       The Analysis Engine decides the label. The Presentation Engine may
       only animate it. */
    const hiPivots = structure.filter(x => x.label === 'HH' || x.label === 'LH' || x.label === 'H');
    const loPivots = structure.filter(x => x.label === 'HL' || x.label === 'LL' || x.label === 'L');
    const lastHi = hiPivots[hiPivots.length - 1];
    const lastLo = loPivots[loPivots.length - 1];
    const highsRead = (!lastHi || lastHi.label === 'H') ? 'UNCONFIRMED' : (lastHi.label === 'HH' ? 'HIGHER' : 'LOWER');
    const lowsRead = (!lastLo || lastLo.label === 'L') ? 'UNCONFIRMED' : (lastLo.label === 'HL' ? 'HIGHER' : 'LOWER');

    const emaStackUp = e9[i] > e21[i] && e21[i] > e50[i];
    const emaStackDn = e9[i] < e21[i] && e21[i] < e50[i];
    const trendFam = families.filter(f => f.key === 'TREND')[0];

    let trendLabel, trendSource;
    if (highsRead === 'HIGHER' && lowsRead === 'HIGHER') { trendLabel = 'UPTREND'; trendSource = 'STRUCTURE'; }
    else if (highsRead === 'LOWER' && lowsRead === 'LOWER') { trendLabel = 'DOWNTREND'; trendSource = 'STRUCTURE'; }
    else if (regime.trend === 'TRENDING' && emaStackUp && trendFam && trendFam.direction === B) { trendLabel = 'UPTREND'; trendSource = 'EMA+ADX'; }
    else if (regime.trend === 'TRENDING' && emaStackDn && trendFam && trendFam.direction === S) { trendLabel = 'DOWNTREND'; trendSource = 'EMA+ADX'; }
    else { trendLabel = 'SIDEWAYS'; trendSource = regime.trend === 'RANGING' ? 'REGIME' : 'NONE'; }

    // ADX convention: <20 weak, 20-30 moderate, >=30 strong
    const trendStrength = adxV >= 30 ? 'STRONG' : adxV >= 20 ? 'MODERATE' : 'WEAK';

    const trend = {
      label: trendLabel,                                   // UPTREND | DOWNTREND | SIDEWAYS
      glyph: trendLabel === 'UPTREND' ? '↑' : trendLabel === 'DOWNTREND' ? '↓' : '↔',
      title: trendLabel === 'SIDEWAYS' ? 'MARKET REGIME' : 'TREND DETECTED',
      strength: trendStrength,                             // WEAK | MODERATE | STRONG
      strengthPct: Math.max(4, Math.min(100, Math.round((adxV / 45) * 100))),
      adx: Math.round(adxV * 10) / 10,
      regime: regime.trend,                                // TRENDING | RANGING
      volatility: regime.vol,
      emaStack: emaStackUp ? 'STACKED UP' : emaStackDn ? 'STACKED DOWN' : 'MIXED',
      emaStackShort: emaStackUp ? 'UP' : emaStackDn ? 'DOWN' : 'MIXED',
      source: trendSource,                                 // STRUCTURE | EMA+ADX | REGIME | NONE
      structure: {
        highs: highsRead,                                  // HIGHER | LOWER | UNCONFIRMED
        lows: lowsRead,
        // Diagnostics only — pivots(lb) cannot confirm a swing until lb bars
        // after it printed, so structure is ALWAYS behind. Measured, not fixed.
        lastConfirmedSwingAgeBars: structure.length ? (i - structure[structure.length - 1].i) : null,
        lastConfirmedSwingTime: structure.length ? structure[structure.length - 1].t : null,
        pivotLookback: cfg.indicators.pivotLookback,
        highsLabel: highsRead === 'HIGHER' ? 'Higher Highs' : highsRead === 'LOWER' ? 'Lower Highs' : 'Highs unconfirmed',
        lowsLabel: lowsRead === 'HIGHER' ? 'Higher Lows' : lowsRead === 'LOWER' ? 'Lower Lows' : 'Lows unconfirmed',
        sequence: structure.slice(-4).map(x => x.label),
        note: trendLabel === 'SIDEWAYS' ? 'No clear directional structure'
            : trendSource === 'EMA+ADX' ? 'Swing structure mixed — direction from EMA stack and ADX'
            : null
      },
      basis: 'Confirmed swing sequence + EMA 9/21/50 stack + ADX(14) + regime classification — all computed by the engine.'
    };

    /* ====================================================================
       ENTRY & DURATION LOGIC  —  STATUS: DEMO / UNRESOLVED
       --------------------------------------------------------------------
       NOTHING IN THIS BLOCK IS AN APPROVED MARKETPULSE PRODUCTION RULE.

       These are prototype hypotheses that exist so the interface can be
       designed and evaluated. Every one of them must be replaced by
       validated logic, tested against real historical market data, before
       launch. Each value therefore carries its own `status` and `basis`
       so the UI can label it and so no downstream code can mistake a
       placeholder for a decided methodology.

       DURATION means: how long the directional reading is expected to
       APPLY, measured from the intended entry. It is deliberately NOT
       derived from the chart timeframe, and it is NOT a time-to-target
       estimate. A 5-minute chart may produce 2 MIN, 3 MIN or 5 MIN.
       ==================================================================== */
    let entry = null, forecast = null;
    if (!isWait) {
      const price = cl[i];
      const tfMin = opts.tfMin || 5;
      const tfMs = tfMin * 60000;
      const wantSupport = dirSign > 0;

      /* ---- ENTRY PRICE / ZONE — DEMO hypothesis ----
         nearest confirmed level on the pullback side, +/- 0.5 ATR(14).
         Needs historical validation before it can be called methodology. */
      const cand = lv.filter(l => wantSupport ? l.price < price : l.price > price)[0];
      const anchor = cand ? cand.price : (wantSupport ? price - a[i] * 0.6 : price + a[i] * 0.6);
      const band = a[i] * 0.5;

      /* ---- ENTRY TIME — DEMO hypothesis ----
         the open of the next candle after the analysed close. */
      const entryTs = c[i].t + tfMs * 2;

      /* ---- ENTRY WINDOW — DEMO hypothesis ----
         the first 10% of that candle, clamped 15-120s. */
      const windowSec = Math.max(15, Math.min(120, Math.round(tfMin * 60 * 0.10)));

      /* ---- DURATION — DEMO PLACEHOLDER, selection rule UNRESOLVED ----
         Maps consensus strength, volatility state and regime onto a
         candidate ladder purely so the UI has a number to present.
         Independent of tfMin by design. */
      const durationMin = demoSelectDuration(agreement, volState, regime.trend);

      /* context measurements — real, kept for later validation work, and
         explicitly NOT presented as the basis of the duration */
      let paceSum = 0, paceN = 0;
      for (let k = Math.max(1, i - 50); k <= i; k++) { paceSum += Math.abs(cl[k] - cl[k - 1]); paceN++; }
      const pace = (paceSum / Math.max(1, paceN)) / a[i];
      const target = lv.filter(l => wantSupport ? l.price > price : l.price < price)[0];
      const targetPrice = target ? target.price : (wantSupport ? price + a[i] * 2.2 : price - a[i] * 2.2);

      const DEMO = 'DEMO / UNRESOLVED — pending historical validation';

      forecast = {
        direction: dirSign > 0 ? 'UP' : 'DOWN',

        duration: {
          minutes: durationMin,
          ladderMin: DURATION_LADDER_MIN.slice(),
          meaning: 'How long the directional reading is expected to apply, measured from entry.',
          independentOfTimeframe: true,
          basis: 'demoSelectDuration(agreement, volatility, regime) — placeholder',
          futureModel: 'A validated model may pair the PRIMARY analysis timeframe ' +
            '(trend, structure, levels, families, consensus) with a LOWER EXECUTION ' +
            'timeframe used only for short-term momentum, entry confirmation, entry ' +
            'timing and duration selection — so a 5m chart could legitimately return ' +
            'a 3 MIN duration. NOT implemented, concept only, not validated.',
          inputs: { agreement, volatility: volState, regime: regime.trend },
          status: DEMO
        },

        entryTime: {
          at: entryTs,
          basis: 'open of the next candle after the analysed close — placeholder',
          status: DEMO
        },

        entryWindow: {
          start: entryTs,
          end: entryTs + windowSec * 1000,
          seconds: windowSec,
          basis: 'first 10% of the entry candle, clamped 15-120s — placeholder',
          status: DEMO
        },

        entryPrice: {
          price: anchor,
          source: cand ? (cand.touches + '-touch ' + cand.kind + ' level') : 'ATR offset from last close (no confirmed level)',
          basis: 'nearest confirmed level on the pullback side — hypothesis',
          status: DEMO
        },

        entryZone: {
          low: anchor - band,
          high: anchor + band,
          bandPips: Math.round((band / pip) * 10) / 10,
          basis: 'entry price +/- 0.5 x ATR(14) — hypothesis',
          status: DEMO
        },

        expiresAt: entryTs + durationMin * 60000,

        context: {
          measuredPaceAtrPerBar: Math.round(pace * 1000) / 1000,
          nearestOpposingLevel: targetPrice,
          nearestOpposingSource: target ? (target.touches + '-touch ' + target.kind + ' level') : 'none within range',
          distanceToOpposingPips: Math.round((Math.abs(targetPrice - anchor) / pip) * 10) / 10,
          note: 'Real measurements retained for future validation. NOT the basis of the duration above.'
        },

        status: DEMO
      };

      /* flattened alias kept so presentation code reads one shape.
         Same numbers, no additional logic. */
      entry = {
        price: forecast.entryPrice.price,
        low: forecast.entryZone.low,
        high: forecast.entryZone.high,
        bandPips: forecast.entryZone.bandPips,
        source: forecast.entryPrice.source,
        distancePips: Math.round(((price - anchor) / pip) * 10) / 10,
        time: forecast.entryTime.at,
        windowStart: forecast.entryWindow.start,
        windowEnd: forecast.entryWindow.end,
        windowSec: forecast.entryWindow.seconds,
        durationMin: forecast.duration.minutes,
        expiresAt: forecast.expiresAt,
        status: DEMO
      };
    }

    /* --- conflicts (internal disagreement, surfaced honestly) --- */
    const conflicts = [];
    families.forEach(f => {
      if (!f.split) return;
      const bulls = results.filter(s => s.fam === f.key && s.verdict === B).map(s => s.name);
      const bears = results.filter(s => s.fam === f.key && s.verdict === S).map(s => s.name);
      conflicts.push({
        family: f.label,
        text: bulls.join(' + ') + ' read bullish while ' + bears.join(' + ') + ' read bearish. ' +
              'Both conditions are live on the same candles.'
      });
    });

    /* --- overlay geometry (price/time space, no pixels) --- */
    const chan = I.linreg(cl, Math.max(0, i - 60), i);
    let resid = 0, rn = 0;
    for (let k = Math.max(0, i - 60); k <= i; k++) { const p = chan.intercept + chan.slope * (k - Math.max(0, i - 60)); resid += (cl[k] - p) ** 2; rn++; }
    const chanSd = Math.sqrt(resid / Math.max(1, rn));

    const overlays = {
      levels: lv.slice(0, 4).map(l => ({ id: 'levels', price: l.price, kind: l.kind, touches: l.touches })),
      ema: [
        { id: 'ema9',  period: 9,  color: '--ema9',  series: e9 },
        { id: 'ema21', period: 21, color: '--ema21', series: e21 },
        { id: 'ema50', period: 50, color: '--ema50', series: e50 }
      ],
      bb: { id: 'bb', upper: bb.upper, mid: bb.mid, lower: bb.lower },
      structure: structure.slice(-6).map(p => ({ id: 'structure', i: p.i, t: p.t, price: p.p, label: p.label })),
      pattern: pattern ? { id: 'pattern', at: pattern.at, span: pattern.span, name: pattern.name, dir: pattern.dir } : null,
      channel: {
        id: 'channel', from: Math.max(0, i - 60), to: i,
        slope: chan.slope, intercept: chan.intercept, sd: chanSd
      },
      entry: entry ? { id: 'entry', low: entry.low, high: entry.high, price: entry.price } : null
    };

    /* --- scan categories (each maps to a real computed value) --- */
    const categories = [
      { k: 'PRICE STRUCTURE',  v: structure.length ? structure[structure.length - 1].label + ' at ' + timeAt(structure[structure.length - 1].i) : '— NONE' },
      { k: 'TREND',            v: (D > 0 ? 'UP' : D < 0 ? 'DOWN' : 'FLAT') + ' · ADX ' + adxV.toFixed(1) },
      { k: 'MOMENTUM',         v: (r[i] > 50 ? 'POSITIVE' : 'NEGATIVE') + ' · RSI ' + r[i].toFixed(1) },
      { k: 'VOLATILITY',       v: (volRatio > 1.15 ? 'EXPANDING' : volRatio < 0.85 ? 'CONTRACTING' : 'STABLE') + ' · ATR ' + atrPips.toFixed(1) + 'p' },
      { k: 'KEY LEVELS',       v: lv.length ? lv.length + ' DETECTED' : '— NONE' },
      { k: 'CANDLE STRUCTURE', v: pattern ? pattern.name.toUpperCase() : '— NONE' },
      { k: 'MARKET REGIME',    v: regime.label }
    ];

    /* --- phase metadata for the Presentation Engine ---------------------
       Nine named phases. Each caption is built only from values computed
       above; the Presentation Engine reveals them, it does not author them. */
    const stackTxt = (e9[i] > e21[i] && e21[i] > e50[i]) ? 'stacked up'
                   : (e9[i] < e21[i] && e21[i] < e50[i]) ? 'stacked down' : 'mixed';
    const bbW = bb.width[i] != null ? (bb.width[i] * 100).toFixed(3) + '%' : '—';
    const nearest = lv[0];
    const famTxt = families.map(f => f.label.toLowerCase() + ' ' +
      (f.direction === B ? '↑' : f.direction === S ? '↓' : '○')).join(' · ');

    const phases = [
      { id: 'scan',       label: 'MARKET SCAN',
        caption: c.length + ' closed candles read · 50-bar lookback · feed OK' },
      { id: 'structure',  label: 'MARKET STRUCTURE',
        caption: (piv.hi.length + piv.lo.length) + ' swing points · ' +
                 structure.slice(-3).map(x => x.label).join(' → ') +
                 ' · ' + trend.structure.highsLabel.toLowerCase() + ', ' + trend.structure.lowsLabel.toLowerCase() },
      { id: 'trend',      label: 'TREND',
        caption: trend.label + ' · strength ' + trend.strength.toLowerCase() +
                 ' · ADX ' + adxV.toFixed(1) + ' · EMA 9/21/50 ' + stackTxt },
      { id: 'momentum',   label: 'MOMENTUM',
        caption: 'RSI ' + r[i].toFixed(1) + ' · MACD hist ' + m.hist[i].toFixed(6) +
                 ' · Stoch %K ' + st.k[i].toFixed(1) },
      { id: 'volatility', label: 'VOLATILITY',
        caption: 'ATR ' + atrPips.toFixed(1) + 'p · ' + (volRatio).toFixed(2) +
                 '× 50-bar avg · BB width ' + bbW },
      { id: 'levels',     label: 'KEY LEVELS / PRICE ACTION',
        caption: lv.length + ' levels detected' +
                 (nearest ? ' · nearest ' + fmt(nearest.price) + ' (' + nearest.touches + ' touches)' : '') +
                 ' · ' + (pattern ? pattern.name : 'no pattern') },
      { id: 'families',   label: 'STRATEGY FAMILIES',
        caption: famTxt },
      { id: 'consensus',  label: 'CONSENSUS',
        caption: agreement + '/100 · ' + independent + ' effective independent voices · ' + quality },
      { id: 'reading',    label: 'FINAL READING',
        caption: isWait
          ? 'WAIT · ' + gates.filter(g => !g.pass).length + ' gate(s) not met'
          : verdict + ' · ' + (entry ? entry.durationMin + ' min (demo rule) · enter ' +
              global.MP.Market.fmtTime(entry.time) : '') }
    ];

    /* --- engine log (real timestamps, real order) --- */
    const t1 = performance.now();
    const log = [];
    const stamp = ms => {
      const d = new Date(Date.now() - (t1 - ms));
      return global.MP.Market.fmtClock(d) + '.' + String(Math.floor((ms % 1) * 1000)).padStart(3, '0');
    };
    log.push({ t: t0, k: 'SNAPSHOT',   v: c.length + ' closed candles' });
    log.push({ t: t0, k: 'INDICATORS', v: '9 computed' });
    log.push({ t: t0, k: 'STRUCTURE',  v: structure.slice(-2).map(p => p.label).join(' · ') || 'none' });
    log.push({ t: t0, k: 'LEVELS',     v: lv.length + ' detected' });
    log.push({ t: t0, k: 'REGIME',     v: regime.label + ' · ADX ' + adxV.toFixed(1) });
    results.forEach(s => log.push({ t: t0, k: s.name.toUpperCase(), v: '→ ' + s.verdict + '  ' + s.strength.toFixed(2) }));
    log.push({ t: t1, k: 'FAMILIES',   v: families.map(f => f.label.toLowerCase() + ' ' + (f.direction === B ? '↑' : f.direction === S ? '↓' : '○')).join(' · ') });
    log.push({ t: t1, k: 'CONSENSUS',  v: agreement + ' / 100 · independent ' + independent });
    log.push({ t: t1, k: 'VERDICT',    v: verdict });

    const snapshotHash = hash32(c.map(k => k.t + ':' + k.c.toFixed(digits)).join('|'));

    /* context block: what the CONTEXT families observed. Conditions, never votes. */
    const contextBlock = {};
    contextFamilies.forEach(f => {
      (f.contextStates || []).forEach(cs => { contextBlock[cs.id] = cs.context; });
    });

    const availability = {
      strategies: {
        total: results.length,
        available: availableResults.length,
        directionalAvailable: directionalResults.length,
        insufficientHistory: results.filter(r2 => r2.availability === 'INSUFFICIENT_HISTORY').map(r2 => r2.id),
        unavailable: results.filter(r2 => r2.availability === 'UNAVAILABLE').map(r2 => ({ id: r2.id, reason: r2.unavailableReason }))
      },
      families: {
        total: families.length,
        directional: directionalFamilies.length,
        directionalAvailable: availableDirectionalFamilies,
        context: contextFamilies.length
      },
      bars: c.length,
      warmupRecommended: cfg.warmup.recommendedBars,
      warmupSatisfied: c.length >= cfg.warmup.recommendedBars
    };

    return {
      engine_version: '0.8.0-prototype',
      config_version: cfg.version,
      config_hash: configHash,
      gates_mode: cfg.gates.mode,
      technical_status: 'OK',
      availability,
      context: contextBlock,
      computed_at: new Date().toISOString(),
      compute_ms: Math.round((t1 - t0) * 1000) / 1000,
      snapshot: {
        hash: snapshotHash,
        candles: c.length,
        last_closed: c[i].t,
        last_close: cl[i],
        source: 'DEMO / SYNTHETIC — prototype only'
      },
      pair: opts.pair, timeframe: opts.tfLabel,
      regime,
      strategies: results,
      families,
      consensus: {
        directionalScore: Math.round(D * 1000) / 1000,
        agreement,
        // Explicit semantics. `agreement` is an ORDINAL HEURISTIC SCORE.
        // It is not a probability, not an expected win rate, and not
        // statistical confidence. It stays null-calibrated until a real
        // out-of-sample mapping is measured.
        agreementScore: agreement,
        agreementSemantics: cfg.consensus.agreementSemantics,
        calibratedProbability: null,
        independent, quality,
        counts: { bull, bear, flat, total: results.length },
        familiesAgreeing,
        gates, thresholds
      },
      /* canonical result fields (see docs 07) */
      direction: verdict,          // UP | DOWN | WAIT
      trend,                       // structural trend / regime read
      duration: forecast ? forecast.duration : null,
      entryTime: forecast ? forecast.entryTime : null,
      entryWindow: forecast ? forecast.entryWindow : null,
      entryPrice: forecast ? forecast.entryPrice : null,
      entryZone: forecast ? forecast.entryZone : null,
      forecast,                    // grouped, with per-field status
      logic_status: {
        strategies: 'PROTOTYPE — real TA maths, thresholds untuned',
        consensus: 'PROTOTYPE — family-weighted, rho values assumed not measured',
        agreement: 'ORDINAL HEURISTIC — not a probability, not calibrated',
        entry_and_duration: 'DEMO / UNRESOLVED — no approved production rule',
        gates: cfg.gates.mode === 'RESEARCH'
          ? 'RESEARCH GATES — thresholds scaled to enabled families. NOT a production decision.'
          : 'PRODUCTION GATES'
      },

      verdict, entry, conflicts, overlays, categories, phases, log,
      indicators: { e9, e21, e50, s20, r, m, bb, atr: a, st, adx: ad }
    };
  }

  /* A technical refusal is NOT an analytical WAIT. It carries no direction,
     no consensus and no entry, and is reported separately in statistics. */
  function technicalRefusal(o) {
    const c = o.candles;
    const last = c.length ? c[c.length - 1] : null;
    return {
      engine_version: '0.8.0-prototype',
      config_version: o.cfg.version,
      config_hash: o.configHash,
      gates_mode: o.cfg.gates.mode,
      technical_status: 'TECHNICAL_INVALID',
      technical_codes: o.codes,
      technical_detail: o.detail,
      computed_at: new Date().toISOString(),
      compute_ms: 0,
      snapshot: {
        hash: hash32(c.map(k => k.t + ':' + k.c).join('|')),
        candles: c.length,
        last_closed: last ? last.t : null,
        last_close: last ? last.c : null,
        source: 'unspecified'
      },
      pair: o.opts.pair, timeframe: o.opts.tfLabel,
      availability: { bars: c.length, strategies: { total: 0, available: 0, directionalAvailable: 0 } },
      context: {},
      regime: null, trend: null,
      strategies: [], families: [],
      consensus: {
        directionalScore: 0, agreement: null, agreementScore: null,
        agreementSemantics: o.cfg.consensus.agreementSemantics, calibratedProbability: null,
        independent: null, quality: null,
        counts: { bull: 0, bear: 0, flat: 0, total: 0 },
        familiesAgreeing: 0, gates: [], thresholds: {}
      },
      direction: 'NO_ANALYSIS',
      verdict: 'NO_ANALYSIS',
      duration: null, entryTime: null, entryWindow: null, entryPrice: null, entryZone: null,
      forecast: null, entry: null,
      conflicts: [],
      overlays: { levels: [], ema: [], bb: { upper: [], mid: [], lower: [] }, structure: [], pattern: null, channel: null, entry: null },
      categories: [], phases: [], log: [],
      indicators: { e9: [], e21: [], e50: [], s20: [], r: [], m: { line: [], signal: [], hist: [] }, bb: {}, atr: [], st: { k: [], d: [] }, adx: { adx: [] } },
      logic_status: {
        refusedBy: 'dataQuality/warmup',
        detail: o.detail,
        note: 'A technical failure. NOT an analytical WAIT.'
      },
      dataQuality: o.dataQuality || null
    };
  }

  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  global.MP = global.MP || {};
  global.MP.Engine = { analyze, FAMILIES, FAM_ORDER, STRATEGIES, cfgFamilies };
})(window);
