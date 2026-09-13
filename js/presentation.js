/* ============================================================
   MarketPulse — PRESENTATION ENGINE
   ------------------------------------------------------------
   Replays a Reading. That is all it does.

   HARD CONTRACT:
     • It receives a finished Reading object.
     • It performs no analytical arithmetic of any kind.
     • It contains no random number generator.
     • Cancelling it at any frame still yields the same result.
     • Changing any timing constant below cannot change a verdict.

   The only maths here is price -> pixel projection and easing.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- easing ---------------- */
  const E = {
    linear: t => t,
    standard: t => cubic(t, .2, 0, 0, 1),
    enter: t => cubic(t, .16, 1, .3, 1),
    exit: t => cubic(t, .4, 0, 1, 1),
    sweep: t => cubic(t, .32, 0, .24, 1),
    counter: t => cubic(t, .22, 1, .36, 1),
    outQuad: t => 1 - (1 - t) * (1 - t)
  };
  function cubic(t, x1, y1, x2, y2) {
    // adequate approximation for animation purposes
    let s = t;
    for (let i = 0; i < 5; i++) {
      const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      const d = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
      if (Math.abs(d) < 1e-6) break;
      s -= (x - t) / d;
      s = Math.max(0, Math.min(1, s));
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  }

  /* ---------------- timeline ---------------- */
  function Timeline() {
    this.events = [];
    this.tweens = [];
    this.duration = 0;
    this.cancelled = false;
  }
  Timeline.prototype.at = function (t, fn) {
    this.events.push({ t, fn, done: false });
    this.duration = Math.max(this.duration, t);
    return this;
  };
  Timeline.prototype.tween = function (t, dur, ease, fn) {
    this.tweens.push({ t, dur, ease: ease || E.standard, fn, started: false, finished: false });
    this.duration = Math.max(this.duration, t + dur);
    return this;
  };
  Timeline.prototype.play = function (onFrame, onDone, tailMs) {
    const self = this;
    const start = performance.now();
    const total = this.duration + (tailMs || 0);
    function frame(now) {
      if (self.cancelled) return;
      const el = (now - start) / 1000;
      self.events.forEach(ev => { if (!ev.done && el >= ev.t) { ev.done = true; ev.fn(); } });
      self.tweens.forEach(tw => {
        if (tw.finished) return;
        if (el < tw.t) return;
        const p = tw.dur <= 0 ? 1 : Math.min(1, (el - tw.t) / tw.dur);
        tw.fn(tw.ease(p), p);
        if (p >= 1) tw.finished = true;
      });
      if (onFrame) onFrame(el);
      if (el < total) requestAnimationFrame(frame);
      else if (onDone) onDone();
    }
    requestAnimationFrame(frame);
    return this;
  };
  Timeline.prototype.finishAll = function () {
    this.cancelled = true;
    this.events.forEach(ev => { if (!ev.done) { ev.done = true; ev.fn(); } });
    this.tweens.forEach(tw => { if (!tw.finished) { tw.fn(1, 1); tw.finished = true; } });
  };

  /* ---------------- helpers ---------------- */
  const q = s => document.querySelector(s);
  const on = (el, c) => el && el.classList.add(c);
  const off = (el, c) => el && el.classList.remove(c);

  function rollCounter(el, to, p) {
    el.textContent = Math.round(to * p);
  }
  function typeText(el, text, p) {
    const n = Math.round(text.length * p);
    el.innerHTML = text.slice(0, n) + (p < 1 ? '<span class="cur">▌</span>' : '');
  }

  /* ============================================================
     DESKTOP SEQUENCE
     env = { app, chart, reading, rows, famHeads, speed, onDone }
     ============================================================ */
  /* ============================================================
     DESKTOP FULL ANALYSIS — nine named phases, 7.80s
     ------------------------------------------------------------
     Every phase reveals artifacts the Analysis Engine already
     produced. Phase order, durations and easing are presentation
     concerns; not one of them can change a verdict. Strategy rows
     resolve inside the phase that corresponds to their family, so
     the user watches the market being examined one dimension at a
     time rather than sixteen rows resolving at random.
     ============================================================ */
  const PHASE_PLAN = [
    { id: 'scan',       at: 0.55, until: 1.85 },
    { id: 'structure',  at: 1.85, until: 2.55 },
    { id: 'trend',      at: 2.55, until: 3.30, fam: 'TREND' },
    { id: 'momentum',   at: 3.30, until: 3.95, fam: 'MOMENTUM' },
    { id: 'volatility', at: 3.95, until: 4.60, fam: 'VOLATILITY' },
    { id: 'levels',     at: 4.60, until: 5.45, fam: 'STRUCTURE,PATTERN' },
    { id: 'families',   at: 5.45, until: 6.30 },
    { id: 'consensus',  at: 6.30, until: 7.05 },
    { id: 'reading',    at: 7.05, until: 7.80 }
  ];

  function runDesktop(env) {
    const r = env.reading, chart = env.chart, app = env.app;
    const full = env.speed === 'full';
    const tl = new Timeline();
    const A = chart.anim;

    const rail = q('#matrixRail');
    const cons = q('#mrConsensus');
    const init = q('#initOverlay');
    const stamp = q('#snapshotStamp');
    const hair = q('#hairline');
    const vLayer = q('#verdictLayer');
    const vCard = q('#verdictCard');
    const speedFlag = q('#speedFlag');
    const phaseRail = q('#phaseRail');

    const plot = () => chart.plotArea();
    const startCount = chart.view.count;
    const targetCount = full ? 98 : 112;
    const famRows = env.byFamily || {};

    /* ---------- stage 0 · COMMIT (both speeds) ---------- */
    tl.at(0.00, () => {
      app.dataset.mode = 'analysis';
      chart.reading = r;
      const fresh = chart.resetAnim();
      Object.keys(fresh).forEach(k => { A[k] = fresh[k]; });
      on(hair, 'on');
      speedFlag.textContent = full ? 'FULL ANALYSIS · 9 PHASES' : 'EXPRESS';
      on(speedFlag, 'on');
      if (full) on(phaseRail, 'on');
    });
    tl.tween(0.00, full ? 7.40 : 1.40, E.linear, p => { hair.style.width = (p * 100) + '%'; });
    tl.tween(0.06, full ? 0.90 : 0.24, E.enter, p => {
      chart.view.count = Math.round(startCount + (targetCount - startCount) * p);
    });

    if (!full) return runExpress(tl, env, A, { rail, cons, vLayer, vCard, hair, stamp, phaseRail });

    /* phase scheduling: label rail + caption + family spotlight */
    PHASE_PLAN.forEach((ph, k) => {
      tl.at(ph.at, () => env.setPhase(k, r.phases[k], ph.fam ? ph.fam.split(',') : null));
      tl.tween(ph.at, ph.until - ph.at, E.linear, p => env.phaseProgress(k, p));
    });

    /* ---------- INITIALIZATION (0.00 - 0.55) ---------- */
    tl.at(0.05, () => on(init, 'on'));
    tl.tween(0.16, 0.30, E.outQuad, p => { A.pulseLast = p < .5 ? p * 2 : (1 - p) * 2; });
    tl.at(0.50, () => { off(init, 'on'); on(stamp, 'on'); A.pulseLast = 0; });

    /* ---------- PHASE 1 · MARKET SCAN (0.55 - 1.85) ---------- */
    tl.at(0.55, () => { A.scanAlpha = 1; A.inspectAlpha = 1; });
    tl.tween(0.55, 1.05, E.sweep, p => {
      const a = plot();
      A.scanX = a.x + a.w * p;
      A.candleWave = A.scanX;
      A.inspect = A.scanX;
    });
    tl.tween(1.58, 0.22, E.exit, p => {
      A.scanAlpha = 1 - p; A.inspectAlpha = 1 - p;
      if (p >= 1) { A.candleWave = -1; A.scanX = -1; A.inspect = -1; }
    });

    /* ---------- PHASE 2 · MARKET STRUCTURE (1.85 - 2.55) ---------- */
    tl.at(1.88, () => env.trendHud('structure'));
    r.overlays.structure.forEach((sp, k) => {
      tl.tween(1.88 + k * 0.045, 0.34, E.outQuad, p => { A.pivotPing[k] = p; });
    });
    tl.tween(1.95, 0.42, E.standard, p => { A.zigzag = p; });
    r.overlays.structure.forEach((sp, k) => {
      tl.tween(2.14 + k * 0.05, 0.16, E.enter, p => { A.struct[k] = p; });
    });

    /* matrix rail arrives just before the family phases begin */
    tl.at(2.38, () => on(rail, 'on'));
    env.rows.forEach((row, k) => {
      tl.at(2.42 + k * 0.018, () => row.el.classList.add('in', 'analyzing'));
    });

    /* ---------- PHASE 3 · TREND (2.55 - 3.30) ---------- */
    tl.at(2.58, () => env.trendHud('trend'));
    tl.tween(2.64, 0.52, E.enter, p => env.trendStrength(p));
    ['ema9', 'ema21', 'ema50'].forEach((id, k) => {
      tl.tween(2.55 + k * 0.07, 0.44, E.standard, p => { A.ema[id] = p; });
    });
    tl.tween(2.86, 0.34, E.standard, p => { A.channel = p; });
    resolveFamilyPhase(tl, env, A, chart, 'TREND', famRows, 2.76, 0.082, 3.22);

    /* ---------- PHASE 4 · MOMENTUM (3.30 - 3.95) ---------- */
    tl.tween(3.30, 0.24, E.standard, p => { A.momentum = p; });
    resolveFamilyPhase(tl, env, A, chart, 'MOMENTUM', famRows, 3.46, 0.09, 3.76);
    tl.tween(3.86, 0.20, E.exit, p => { A.momentum = 1 - p; });

    /* ---------- PHASE 5 · VOLATILITY (3.95 - 4.60) ---------- */
    tl.tween(3.95, 0.30, E.standard, p => { A.bb = p; });
    tl.tween(4.04, 0.40, E.standard, p => { A.volCorridor = p; });
    resolveFamilyPhase(tl, env, A, chart, 'VOLATILITY', famRows, 4.20, 0.11, 4.46);
    tl.tween(4.52, 0.22, E.exit, p => { A.volCorridor = 1 - p; });

    /* ---------- PHASE 6 · KEY LEVELS / PRICE ACTION (4.60 - 5.45) ---------- */
    r.overlays.levels.forEach((l, k) => {
      tl.tween(4.60 + k * 0.08, 0.28, E.standard, p => { A.levels[k] = p; });
    });
    tl.tween(4.98, 0.22, E.standard, p => { A.pattern = p; });
    resolveFamilyPhase(tl, env, A, chart, 'STRUCTURE', famRows, 4.74, 0.10, 5.16);
    resolveFamilyPhase(tl, env, A, chart, 'PATTERN', famRows, 5.16, 0.11, 5.40);

    /* ---------- PHASE 7 · STRATEGY FAMILIES (5.45 - 6.30) ---------- */
    tl.at(5.45, () => { env.spotlight(null); A.focus = null; });
    r.families.forEach((f, k) => {
      const t = 5.50 + k * 0.15;
      tl.at(t, () => {
        env.highlightFamily(f.key);
        A.focus = env.familyUses(f.key);
        chart.render();
      });
      tl.tween(t, 0.14, E.enter, p => env.fillContribution(f.key, p));
    });
    tl.at(6.24, () => { env.highlightFamily(null); A.focus = null; });

    /* ---------- PHASE 8 · CONSENSUS (6.30 - 7.05) ---------- */
    tl.at(6.30, () => on(cons, 'on'));
    const cn = r.consensus.counts;
    const mx = Math.max(cn.bull, cn.bear, cn.flat, 1);
    tl.tween(6.34, 0.40, E.enter, p => { q('#cbBull').style.width = (cn.bull / mx * 100 * p) + '%'; });
    tl.tween(6.40, 0.40, E.enter, p => { q('#cbBear').style.width = (cn.bear / mx * 100 * p) + '%'; });
    tl.tween(6.46, 0.40, E.enter, p => { q('#cbFlat').style.width = (cn.flat / mx * 100 * p) + '%'; });
    const indepText = cn.total + ' STRATEGIES · ' + r.families.length +
      ' FAMILIES · ' + r.consensus.independent + ' EFFECTIVE INDEPENDENT VOICES';
    tl.tween(6.54, 0.28, E.linear, p => typeText(q('#cIndep'), indepText, p));
    tl.tween(6.68, 0.38, E.counter, p => {
      rollCounter(q('#cScoreN'), r.consensus.agreement, p);
      const ring = q('#cRingArc');
      const C = 2 * Math.PI * 28;
      ring.style.strokeDasharray = C;
      ring.style.strokeDashoffset = C * (1 - (r.consensus.agreement / 100) * p);
    });
    tl.at(6.98, () => {
      q('#cQual').textContent = r.consensus.quality;
      q('#cQual').className = 'qv ' + qualClass(r);
      q('#cQualDesc').textContent = qualityNote(r);
      q('#cQualWrap').style.opacity = 1;
    });

    /* ---------- PHASE 9 · FINAL READING (7.05 - 7.80) ---------- */
    if (r.overlays.entry) {
      tl.tween(7.05, 0.22, E.standard, p => { A.entry = p; });
      tl.tween(7.12, 0.30, E.standard, p => { A.entryMark = p; });
    }
    tl.tween(7.14, 0.36, E.standard, p => { A.climax = p; });
    tl.tween(7.14, 0.30, E.standard, p => { A.chartDim = 1 - 0.52 * p; });
    tl.at(7.20, () => {
      on(vLayer, 'on');
      requestAnimationFrame(() => on(vCard, 'on'));
      if (env.onReveal) env.onReveal();
    });
    tl.at(7.80, () => { off(hair, 'on'); });

    // during the first second the side panels are collapsing and the plot is
    // growing, so the chart must re-measure rather than just repaint
    tl.play(el => { if (el < 1.05) chart.resize(); else chart.render(); },
      () => { if (env.onDone) env.onDone(); }, 0.10);
    return tl;
  }

  /* resolve every strategy of one family inside its own phase */
  function resolveFamilyPhase(tl, env, A, chart, famKey, famRows, at, stagger, headAt) {
    const rows = famRows[famKey] || [];
    rows.forEach((row, k) => {
      const t = at + k * stagger;
      tl.at(t, () => {
        resolveRow(row);
        A.focus = row.strategy.uses.length ? row.strategy.uses : null;
        chart.render();
      });
      tl.at(t + 0.26, () => { if (A.focus === row.strategy.uses) A.focus = null; });
    });
    const head = env.famHeads.filter(h => h.family.key === famKey)[0];
    if (head) tl.at(headAt, () => resolveFamily(head));
  }

  /* ============================================================
     EXPRESS — 1.60s. Same Reading, same overlays, no ceremony.
     ============================================================ */
  function runExpress(tl, env, A, els) {
    const r = env.reading, chart = env.chart;
    tl.at(0.08, () => { on(els.stamp, 'on'); });
    tl.tween(0.14, 0.14, E.standard, p => {
      r.overlays.levels.forEach((l, k) => A.levels[k] = p);
      A.bb = p; A.ema.ema9 = p; A.ema.ema21 = p; A.ema.ema50 = p;
      A.channel = p; A.pattern = p; A.entry = p; A.zigzag = p;
      r.overlays.structure.forEach((sp, k) => A.struct[k] = p);
    });
    tl.at(0.16, () => { env.trendHud('trend'); env.trendStrength(1); });
    tl.at(0.24, () => on(els.rail, 'on'));
    env.rows.forEach((row, k) => {
      tl.at(0.26 + k * 0.011, () => row.el.classList.add('in', 'analyzing'));
      tl.at(0.44 + k * 0.026, () => resolveRow(row));
    });
    env.famHeads.forEach((fh, k) => tl.at(0.72 + k * 0.03, () => {
      resolveFamily(fh); env.fillContribution(fh.family.key, 1);
    }));
    tl.at(0.94, () => on(els.cons, 'on'));
    const cn = r.consensus.counts;
    const mx = Math.max(cn.bull, cn.bear, cn.flat, 1);
    tl.tween(0.96, 0.22, E.enter, p => {
      q('#cbBull').style.width = (cn.bull / mx * 100 * p) + '%';
      q('#cbBear').style.width = (cn.bear / mx * 100 * p) + '%';
      q('#cbFlat').style.width = (cn.flat / mx * 100 * p) + '%';
    });
    tl.at(0.98, () => typeText(q('#cIndep'),
      cn.total + ' STRATEGIES · ' + r.families.length + ' FAMILIES · ' +
      r.consensus.independent + ' EFFECTIVE INDEPENDENT VOICES', 1));
    tl.tween(1.02, 0.24, E.counter, p => {
      rollCounter(q('#cScoreN'), r.consensus.agreement, p);
      const ring = q('#cRingArc'); const C = 2 * Math.PI * 28;
      ring.style.strokeDasharray = C;
      ring.style.strokeDashoffset = C * (1 - (r.consensus.agreement / 100) * p);
    });
    tl.at(1.18, () => {
      q('#cQual').textContent = r.consensus.quality;
      q('#cQual').className = 'qv ' + qualClass(r);
      q('#cQualDesc').textContent = qualityNote(r);
      q('#cQualWrap').style.opacity = 1;
    });
    if (r.overlays.entry) tl.tween(1.24, 0.16, E.standard, p => { A.entryMark = p; });
    tl.tween(1.28, 0.20, E.standard, p => { A.climax = p; A.chartDim = 1 - 0.52 * p; });
    tl.at(1.30, () => {
      on(els.vLayer, 'on');
      requestAnimationFrame(() => on(els.vCard, 'on'));
      off(els.hair, 'on');
      if (env.onReveal) env.onReveal();
    });
    tl.play(el => { if (el < 0.55) chart.resize(); else chart.render(); },
      () => { if (env.onDone) env.onDone(); }, 0.10);
    return tl;
  }

  function resolveRow(row) {
    const s = row.strategy;
    const cls = s.verdict === 'BULLISH' ? 'r-bull' : s.verdict === 'BEARISH' ? 'r-bear' : 'r-flat';
    row.el.classList.remove('analyzing');
    row.el.classList.add('done', cls, 'flash');
    setTimeout(() => row.el.classList.remove('flash'), 260);
    const unavail = s.availability && s.availability !== 'AVAILABLE';
    const word = unavail ? '— N/A'
      : s.verdict === 'BULLISH' ? '↑ BULLISH'
      : s.verdict === 'BEARISH' ? '↓ BEARISH'
        : (s.noSetup ? '○ NO SETUP' : '○ NEUTRAL');
    row.el.querySelector('.rw').textContent = word;
    row.el.querySelector('.mx-str').textContent = s.strength.toFixed(2);
  }

  function resolveFamily(fh) {
    const f = fh.family;
    const cls = f.direction === 'BULLISH' ? 'r-bull' : f.direction === 'BEARISH' ? 'r-bear' : 'r-flat';
    fh.el.classList.add('resolved', cls);
    const g = f.direction === 'BULLISH' ? '↑' : f.direction === 'BEARISH' ? '↓' : '○';
    fh.el.querySelector('.fh-v').textContent =
      g + ' ' + Math.max(f.counts.bull, f.counts.bear) + '/' + f.n + ' · ind ' + f.independent.toFixed(1);
  }

  function qualClass(r) {
    return r.consensus.quality === 'STRONG' ? 'up'
      : r.consensus.quality === 'CONFLICTED' ? 'warn'
        : r.consensus.quality === 'WEAK' ? 'flat' : 'tech';
  }
  function qualityNote(r) {
    const c = r.consensus;
    if (c.quality === 'CONFLICTED') return 'Bullish and bearish counts are close. The strategies do not agree.';
    if (c.quality === 'WEAK') return 'Agreement rests on too few independent voices.';
    if (c.quality === 'STRONG') return c.familiesAgreeing + ' of ' + r.families.length + ' families agree across low-correlation groups.';
    const dom = r.families.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    return 'Agreement is concentrated in the ' + dom.label.toLowerCase() + ' family.';
  }

  /* ============================================================
     MOBILE SEQUENCE (portrait, capped at 5.5s)
     ============================================================ */
  function runMobile(env) {
    const r = env.reading, chart = env.chart;
    const full = env.speed === 'full';
    const tl = new Timeline();
    const A = chart.anim;
    const rows = env.rows;

    tl.at(0.00, () => {
      chart.reading = r;
      chart.anim = chart.resetAnim(); Object.assign(A, chart.anim); chart.anim = A;
      env.el.classList.add('on');
    });

    if (full) {
      tl.tween(0.30, 0.70, E.sweep, p => {
        const a = chart.plotArea();
        A.scanAlpha = 1; A.scanX = a.x + a.w * p; A.candleWave = A.scanX;
      });
      tl.tween(1.00, 0.18, E.exit, p => { A.scanAlpha = 1 - p; if (p >= 1) { A.scanX = -1; A.candleWave = -1; } });
      r.overlays.levels.forEach((l, k) => tl.tween(1.15 + k * 0.07, 0.26, E.standard, p => { A.levels[k] = p; }));
      ['ema9', 'ema21', 'ema50'].forEach((id, k) => tl.tween(1.35 + k * 0.06, 0.36, E.standard, p => { A.ema[id] = p; }));
      r.overlays.structure.forEach((s, k) => tl.tween(1.70 + k * 0.05, 0.14, E.enter, p => { A.struct[k] = p; }));
      if (r.overlays.entry) tl.tween(2.00, 0.18, E.standard, p => { A.entry = p; });

      rows.forEach((row, k) => {
        tl.at(2.10 + k * 0.026, () => row.el.classList.add('in', 'analyzing'));
        tl.at(2.60 + k * 0.055, () => resolveMobileRow(row, A, chart));
      });
      tl.at(2.60 + rows.length * 0.055 + 0.10, () => { A.focus = null; });
      tl.at(4.40, () => env.consEl.classList.add('on'));
      tl.tween(4.45, 0.36, E.counter, p => {
        env.consEl.querySelector('.m-a-score').textContent = Math.round(r.consensus.agreement * p);
      });
      tl.tween(4.90, 0.22, E.standard, p => { A.chartDim = 1 - 0.4 * p; });
      tl.at(4.95, () => env.verdictEl.classList.add('on'));
      tl.at(5.50, () => { });
    } else {
      tl.tween(0.10, 0.12, E.standard, p => {
        r.overlays.levels.forEach((l, k) => A.levels[k] = p);
        A.ema.ema9 = p; A.ema.ema21 = p; A.ema.ema50 = p; A.entry = p;
        r.overlays.structure.forEach((s, k) => A.struct[k] = p);
      });
      rows.forEach((row, k) => {
        tl.at(0.12 + k * 0.010, () => row.el.classList.add('in', 'analyzing'));
        tl.at(0.35 + k * 0.022, () => resolveMobileRow(row, A, chart));
      });
      tl.at(0.90, () => env.consEl.classList.add('on'));
      tl.tween(0.92, 0.22, E.counter, p => {
        env.consEl.querySelector('.m-a-score').textContent = Math.round(r.consensus.agreement * p);
      });
      tl.tween(1.15, 0.16, E.standard, p => { A.chartDim = 1 - 0.4 * p; });
      tl.at(1.18, () => env.verdictEl.classList.add('on'));
    }

    tl.play(() => chart.render(), () => { if (env.onDone) env.onDone(); }, 0.2);
    return tl;
  }

  function resolveMobileRow(row, A, chart) {
    const s = row.strategy;
    const cls = s.verdict === 'BULLISH' ? 'r-bull' : s.verdict === 'BEARISH' ? 'r-bear' : 'r-flat';
    row.el.classList.remove('analyzing');
    row.el.classList.add('done', cls);
    row.el.querySelector('.r').textContent =
      s.verdict === 'BULLISH' ? '↑ BULL' : s.verdict === 'BEARISH' ? '↓ BEAR' : '○ FLAT';
    if (s.uses.length) { A.focus = s.uses; chart.render(); setTimeout(() => { A.focus = null; }, 240); }
  }

  global.MP = global.MP || {};
  global.MP.Presentation = { Timeline, E, runDesktop, runMobile, qualityNote, qualClass };
})(window);
