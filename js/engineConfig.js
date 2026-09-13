/* ============================================================
   MarketPulse — ENGINE CONFIG (versioned)
   ------------------------------------------------------------
   Every analytical constant that was previously a scattered
   literal now lives here so a backtest can record exactly what it
   ran and reproduce it later.

   VALUES ARE UNCHANGED from v0.7.0-prototype. They are still
   hand-chosen heuristics that have never been fitted or tested.
   Moving them here does not make them validated — it makes them
   addressable, hashable and sweepable on a training split.

   Do not tune anything in this file against demo data.
   ============================================================ */
(function (global) {
  'use strict';

  const CONFIG_V0_1 = {
    version: '0.1-validation',
    note: 'Ported unchanged from v0.7.0-prototype literals. UNTUNED and UNVALIDATED.',

    /* ---- family model ------------------------------------------------
       kind DIRECTIONAL : may cast an UP/DOWN vote and enters the consensus
       kind CONTEXT     : describes market condition only. Never votes.
                          See docs/10 §3 for why volatility is context. */
    families: {
      TREND:      { label: 'Trend',      kind: 'DIRECTIONAL', rho: 0.82, weight: 1.00 },
      MOMENTUM:   { label: 'Momentum',   kind: 'DIRECTIONAL', rho: 0.70, weight: 0.90 },
      STRUCTURE:  { label: 'Structure',  kind: 'DIRECTIONAL', rho: 0.45, weight: 1.10 },
      VOLATILITY: { label: 'Volatility', kind: 'CONTEXT',     rho: 0.50, weight: 0.00 },
      PATTERN:    { label: 'Pattern',    kind: 'DIRECTIONAL', rho: 0.40, weight: 0.70 }
    },
    familyOrder: ['TREND', 'MOMENTUM', 'STRUCTURE', 'VOLATILITY', 'PATTERN'],

    /* ---- consensus ---- */
    consensus: {
      familyDirectionThreshold: 0.18,   // |familyScore| below this = family is NEUTRAL
      participationFloor: 0.5,          // score damping: floor + (1-floor) * active/n
      agreementBlend: { directional: 0.55, voteShare: 0.45 },
      // agreementScore is an ORDINAL HEURISTIC. It is not a probability,
      // not an expected win rate and not statistical confidence.
      agreementSemantics: 'ORDINAL_HEURISTIC',
      calibratedProbability: null
    },

    /* ---- decision gates ----------------------------------------------
       mode PRODUCTION : absolute thresholds. What a user gets.
       mode RESEARCH   : thresholds scale to the enabled family/strategy
                         count so ablation experiments are possible.
                         NEVER ship RESEARCH to users. */
    gates: {
      mode: 'PRODUCTION',
      agreementFloor: 58,
      minDirectionalFamilies: 3,
      minIndependentVoices: 2.2,
      minParticipatingStrategies: 6,
      weakRegime: { adxBelow: 18, requiresAgreement: 70 }
    },

    /* ---- multi-timeframe ---------------------------------------------
       Explicit pairing, UTC-aligned, closed HTF candles only.
       Replaces the old hard-coded "aggregate by array index, factor 3". */
    mtf: {
      pairing: { '1m': '5m', '3m': '15m', '5m': '15m', '15m': '1h', '30m': '4h', '1h': '4h' },
      minHtfBars: 60           // EMA50 on the HTF needs >= 50; 60 gives headroom
    },

    /* ---- warm-up: minimum CLOSED bars a strategy needs to be AVAILABLE
       Derived from the longest real lookback in each rule, not guessed. */
    warmup: {
      hardMinBars: 64,         // longest lookback in the engine (64-bar ATR mean)
      recommendedBars: 120,
      perStrategy: {
        ema_trend: 71,         // EMA50 (50) + 20-bar slope regression on EMA21
        ema_cross: 34,         // EMA21 (21) + 12-bar cross window + 1
        macd: 36,              // EMA26 + 9 signal + 1
        momentum: 25,          // ATR14 + ROC10
        mtf: 55,               // LTF side only; HTF availability checked separately
        rsi: 20,               // RSI14 + 5-bar delta
        stoch: 18,             // Stoch(14,3)
        rsi_ema: 22,           // RSI14 + EMA21
        sr: 45,                // enough pivots (lb=3) to cluster >=2 touches
        structure: 45,
        breakout: 22,          // 20-bar range + ATR14
        price_action: 17,      // 3 candles + ATR14
        bollinger: 61,         // BB20 + 40-bar bandwidth mean
        atr_regime: 65,        // ATR14 + 50-bar ATR mean
        candle: 16,            // 3 candles + ATR14 for context
        mean_rev: 21           // SMA20 + sigma
      }
    },

    /* ---- indicator parameters ---- */
    indicators: {
      ema: [9, 21, 50], sma: 20,
      rsi: 14, macd: [12, 26, 9], bollinger: [20, 2],
      atr: 14, stoch: [14, 3], adx: 14,
      pivotLookback: 3,
      levelToleranceAtr: 0.9,
      levelMinTouches: 2
    },

    /* ---- strategy thresholds (previously inline literals) ---- */
    strategies: {
      ema_trend: { slopeBars: 20 },
      ema_cross: { window: 12 },
      momentum: { rocBars: 10, atrThreshold: 0.55 },
      rsi: { bull: 54, bear: 46, deltaBars: 5, extremeHigh: 70, extremeLow: 30 },
      stoch: { kdSpread: 3, midLow: 20, midHigh: 80 },
      sr: { upperRatio: 0.66, lowerRatio: 0.34 },
      structure: { swingsExamined: 4, minAgreeing: 3 },
      breakout: { rangeBars: 20, expansionAtr: 0.9 },
      price_action: { candles: 3, bodyWeight: 0.65, wickWeight: 0.35, threshold: 0.30 },
      bollinger: { squeezeRatio: 0.82, expansionRatio: 1.18, bandwidthMeanBars: 40 },
      atr_regime: { meanBars: 50, expandRatio: 1.15, contractRatio: 0.85 },
      mean_rev: { sigma: 1.8 },
      regime: { adxTrending: 22, volHigh: 1.2, volLow: 0.82, atrMeanBars: 50 }
    },

    /* ---- trend read ---- */
    trend: { strengthStrongAdx: 30, strengthModerateAdx: 20, adxScaleMax: 45 },

    /* ---- entry & duration: DEMO / UNRESOLVED, untouched by this phase ---- */
    entryDemo: {
      status: 'DEMO / UNRESOLVED — pending historical validation',
      zoneAtr: 0.5,
      entryWindowFraction: 0.10, entryWindowMinSec: 15, entryWindowMaxSec: 120,
      durationLadderMin: [1, 2, 3, 5, 10, 15, 30]
    }
  };

  /** Research variant: identical analytics, gates scale to what is enabled. */
  function researchConfig(base) {
    const c = clone(base || CONFIG_V0_1);
    c.gates.mode = 'RESEARCH';
    return c;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function hash(cfg) {
    const s = stableStringify(cfg);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }

  global.MP = global.MP || {};
  global.MP.EngineConfig = {
    DEFAULT: CONFIG_V0_1,
    researchConfig,
    clone,
    hash,
    stableStringify
  };
})(typeof window !== 'undefined' ? window : globalThis);
