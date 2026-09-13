/* ============================================================
   MarketPulse — TERMINAL UI (prototype)
   ============================================================ */
(function (global) {
  'use strict';
  const M = global.MP.Market, Eng = global.MP.Engine, P = global.MP.Presentation;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  /* ---------------- plan capabilities ---------------- */
  const PLANS = {
    free: {
      label: 'Free', price: '$0',
      pairs: 4, tfs: ['5m', '15m', '1h'], quota: 5,
      evidence: false, strength: false, entry: true, math: false,
      independent: false, familyDetail: false, conflicts: false,
      lab: false, monitorPairs: 4, drawings: 3, history: 7, mtf: false,
      indicators: 3, layouts: 0, alerts: 0, sparkline: false
    },
    trader: {
      label: 'Trader', price: '$19',
      pairs: 8, tfs: ['1m', '3m', '5m', '15m', '30m', '1h'], quota: 300,
      evidence: true, strength: true, entry: true, math: true,
      independent: true, familyDetail: true, conflicts: true,
      lab: false, monitorPairs: 8, drawings: Infinity, history: 90, mtf: true,
      indicators: 12, layouts: 3, alerts: 5, sparkline: true
    },
    pro: {
      label: 'Pro', price: '$49',
      pairs: 8, tfs: ['1m', '3m', '5m', '15m', '30m', '1h'], quota: Infinity,
      evidence: true, strength: true, entry: true, math: true,
      independent: true, familyDetail: true, conflicts: true,
      lab: true, monitorPairs: 8, drawings: Infinity, history: Infinity, mtf: true,
      indicators: 12, layouts: Infinity, alerts: 50, sparkline: true, weighted: true
    }
  };

  /* ---------------- app state ---------------- */
  const App = {
    plan: 'free',
    pair: 'EUR/USD',
    tf: '5m',
    feed: null,
    chart: null,
    sub: {},
    reading: null,
    running: null,
    quotaUsed: 0,
    monitor: {},          // sym -> { feed, reading, history[], lastEvent }
    history: [],
    feedItems: [],
    lastAnalysisAt: 0,
    feeds: {},            // pair -> tf -> Feed   (one shared simulation)
    seenKeys: {},         // snapshot keys THIS user has already analysed
    readingCache: {},     // snapshot key -> Reading (see getReading)
    cacheOrder: [],
    enginePasses: 0
  };
  App.cap = () => PLANS[App.plan];

  /* ============================================================
     READING CACHE
     ------------------------------------------------------------
     An analysis is deterministic per (pair, timeframe, closed
     candle). The key below is the identity of the market snapshot
     and is cheap to compute without running the engine, so a
     repeated request for an unchanged market reuses the Reading
     instead of recomputing it — and does not spend the user's
     actionable allowance a second time.

     In production this same key becomes the server-side cache key,
     so one computation per pair x timeframe x closed candle serves
     every user looking at it.
     ============================================================ */
  function snapshotKey(pair, tf, candles) {
    const closed = candles[candles.length - 2] || candles[candles.length - 1];
    const d = M.pairInfo(pair).digits;
    return pair + '|' + tf + '|' + closed.t + '|' + closed.c.toFixed(d);
  }

  function getReading(pair, tf, candles, opts) {
    const key = snapshotKey(pair, tf, candles);
    if (App.readingCache[key]) return { reading: App.readingCache[key], cached: true, key };
    const r = Eng.analyze(candles, opts);
    App.readingCache[key] = r;
    App.cacheOrder.push(key);
    while (App.cacheOrder.length > 240) delete App.readingCache[App.cacheOrder.shift()];
    return { reading: r, cached: false, key };
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function feedFor(pair, tf) {
    App.feeds[pair] = App.feeds[pair] || {};
    if (!App.feeds[pair][tf]) App.feeds[pair][tf] = new M.Feed(pair, tf, 320);
    return App.feeds[pair][tf];
  }

  function init() {
    App.feed = feedFor(App.pair, App.tf);
    App.chart = new global.MP.Chart($('#priceCanvas'), $('#overlayCanvas'), {});
    App.chart.setData(App.feed.candles, App.pair);
    App.sub.rsi = new global.MP.Subpanel($('#rsiCanvas'), 'rsi');
    App.sub.macd = new global.MP.Subpanel($('#macdCanvas'), 'macd');

    buildTimeframes();
    buildWatchlist();
    buildSessions();
    buildCategories();
    buildMonitorFeeds();
    renderFamilyStrip();
    renderLegend();
    renderReadingEmpty();
    renderRestMatrix(null);
    bindEvents();
    applyPlan();
    seedHistory();

    window.addEventListener('resize', () => {
      App.chart.resize();
      App.sub.rsi.resize(); App.sub.macd.resize();
      renderSub();
      global.MP.Mobile && global.MP.Mobile.resize();
    });
    setTimeout(() => { App.chart.resize(); App.sub.rsi.resize(); App.sub.macd.resize(); renderSub(); }, 60);

    tickLoop();
    setInterval(uiClock, 1000);
    uiClock();
  }

  /* ============================================================
     TOPBAR / CHROME
     ============================================================ */
  function buildTimeframes() {
    const g = $('#tfGroup'); g.innerHTML = '';
    M.TIMEFRAMES.forEach(t => {
      const locked = App.cap().tfs.indexOf(t.id) < 0;
      const b = el('button', 'tf-btn' + (t.id === App.tf ? ' active' : '') + (locked ? ' locked' : ''),
        t.id.toUpperCase() + (locked ? ' <span class="lockicon">🔒</span>' : ''));
      b.onclick = () => {
        if (locked) return openUpsell('timeframe', t.id);
        setTimeframe(t.id);
      };
      g.appendChild(b);
    });
  }

  function buildWatchlist() {
    const w = $('#watchlist'); w.innerHTML = '';
    M.PAIRS.forEach((p, idx) => {
      const locked = !p.free && App.cap().pairs < 8;
      const row = el('div', 'wl-row' + (p.sym === App.pair ? ' active' : '') + (locked ? ' locked' : '') + (idx < 3 ? ' starred' : ''));
      row.dataset.sym = p.sym;
      row.innerHTML =
        '<span class="wl-star">' + (idx < 3 ? '★' : '☆') + '</span>' +
        '<span class="wl-pair">' + p.sym + (locked ? ' <span style="font-size:8px">🔒</span>' : '') + '</span>' +
        '<span class="wl-price" data-price>' + p.base.toFixed(p.digits) + '</span>' +
        '<span class="wl-badge b-none" data-badge>——</span>';
      row.onclick = () => locked ? openUpsell('pair', p.sym) : setPair(p.sym);
      w.appendChild(row);
    });
    $('#wlCount').textContent = App.cap().pairs + ' / ' + M.PAIRS.length;
    Object.keys(App.monitor).forEach(sym => {
      const m = App.monitor[sym];
      if (m && m.reading) updateWatchlistBadge(sym, m.reading);
    });
  }

  function buildSessions() {
    const c = $('#sessions'); c.innerHTML = '';
    M.sessionState(new Date()).forEach(s => {
      const row = el('div', 'sess-row' + (s.open ? ' open' : ''));
      const span = (s.span[1] - s.span[0] + 24) % 24 || 24;
      row.innerHTML =
        '<span class="nm">' + s.id + '</span>' +
        '<span class="sess-bar"><i class="sess-fill ' + (s.open ? 'open' : 'closed') + '" style="left:' +
        (s.span[0] / 24 * 100) + '%;width:' + (span / 24 * 100) + '%"></i></span>' +
        '<span class="st">' + (s.open ? 'open' : s.hrs.toFixed(1) + 'h') + '</span>';
      c.appendChild(row);
    });
    const act = M.activeSession(new Date());
    $('#sessionName').textContent = act.id;
    $('#sessionChip').classList.toggle('closed', !act.open);
  }

  function buildCategories() {
    const c = $('#catCluster'); c.innerHTML = '';
    ['PRICE STRUCTURE', 'TREND', 'MOMENTUM', 'VOLATILITY', 'KEY LEVELS', 'CANDLE STRUCTURE', 'MARKET REGIME']
      .forEach(k => {
        c.appendChild(el('div', 'cat',
          '<span class="cdot"></span><span class="ck">' + k + '</span><span class="cv">—</span>'));
      });
  }

  function renderLegend() {
    const p = M.pairInfo(App.pair);
    $('#chartLegend').innerHTML =
      '<div class="leg-row"><b>' + App.pair + ' · ' + App.tf.toUpperCase() + '</b></div>' +
      '<div class="leg-row"><i class="leg-swatch" style="background:var(--ema9)"></i>EMA 9</div>' +
      '<div class="leg-row"><i class="leg-swatch" style="background:var(--ema21)"></i>EMA 21</div>' +
      '<div class="leg-row"><i class="leg-swatch" style="background:var(--ema50)"></i>EMA 50</div>';
  }

  function uiClock() {
    buildSessions();
    $('#feedMs').textContent = (34 + Math.round(Math.abs(Math.sin(Date.now() / 9000)) * 22)) + 'ms';
    if ($('#mClock')) $('#mClock').textContent = M.fmtClock(new Date()).slice(0, 5);
    updateValidity();
  }

  /* ============================================================
     LIVE LOOP
     ============================================================ */
  function tickLoop() {
    const now = performance.now();
    // tick every feed exactly once, whoever is looking at it
    Object.keys(App.feeds).forEach(pair => {
      const byTf = App.feeds[pair];
      Object.keys(byTf).forEach(tf => byTf[tf].tick(now));
    });
    updatePriceUI();
    if (App.chart && !App.running) App.chart.render();
    setTimeout(tickLoop, 260);
  }

  let lastPrice = 0;
  function updatePriceUI() {
    const c = App.feed.last();
    const p = M.pairInfo(App.pair);
    const pm = $('#priceMain');
    pm.textContent = c.c.toFixed(p.digits);
    if (c.c > lastPrice) { pm.classList.remove('tick-down'); pm.classList.add('tick-up'); }
    else if (c.c < lastPrice) { pm.classList.remove('tick-up'); pm.classList.add('tick-down'); }
    setTimeout(() => pm.classList.remove('tick-up', 'tick-down'), 130);
    lastPrice = c.c;

    const first = App.feed.candles[App.feed.candles.length - 60] || App.feed.candles[0];
    const chg = (c.c - first.c) / first.c * 100;
    const ce = $('#priceChg');
    ce.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    ce.className = 'price-chg ' + (chg >= 0 ? 'up' : 'down');

    const secs = App.feed.secondsToClose(performance.now());
    $('#priceMeta').textContent = 'spread ' + (App.feed.spread / p.pip).toFixed(1) +
      ' · close ' + String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    $('#tickerPrice').textContent = c.c.toFixed(p.digits);

    // watchlist prices
    $$('#watchlist .wl-row').forEach(r => {
      const m = App.monitor[r.dataset.sym];
      if (!m) return;
      const pi = M.pairInfo(r.dataset.sym);
      r.querySelector('[data-price]').textContent = m.feed.last().c.toFixed(pi.digits);
    });
  }

  /* ---------- background monitor: one analysis per pair, recomputed on candle close ---------- */
  function buildMonitorFeeds() {
    M.PAIRS.forEach(p => {
      const f = feedFor(p.sym, '5m');
      App.monitor[p.sym] = { feed: f, reading: null, history: [], lastRegime: null, lastAgr: null };
      f.on((type) => { if (type === 'close') recomputeMonitor(p.sym); });
      recomputeMonitor(p.sym, true);
    });
  }

  /* ======================================================================
     BACKGROUND ENGINE PASS — BOUNDARIES (do not relax without a decision)
     ----------------------------------------------------------------------
     Runs one engine pass per pair on every closed candle. Its ONLY job is to
     maintain the terminal's live analytical state and visual context:
     watchlist agreement badges, the family-state strip, the engine heartbeat
     and passive market-state lines in the activity feed.

     It MUST NOT:
       1. generate automatic actionable UP / DOWN signals for the user
       2. deliver alerts or toasts for actionable signals
       3. use push, email or messaging of any kind
       4. consume Free allowance          -> it never calls chargeReading()
       5. trigger the Full Analysis        -> it never calls P.runDesktop()
       6. be treated as a user-requested reading
                                           -> it never sets App.reading
                                           -> it never writes App.seenKeys

     Allowance is charged only in runAnalysis() and mobile runMobileAnalysis(),
     both of which are user-initiated. The cache this pass warms is an
     infrastructure detail and is deliberately separate from allowance.

     The core actionable workflow stays: SELECT PAIR -> SELECT TIMEFRAME ->
     PRESS ANALYZE -> UP / DOWN / WAIT.
     ====================================================================== */
  function recomputeMonitor(sym, silent) {
    const m = App.monitor[sym];
    const p = M.pairInfo(sym);
    const r = getReading(sym, '5m', m.feed.candles, {
      pair: sym, pip: p.pip, digits: p.digits, tfLabel: '5m', htfLabel: '15m', tfMin: 5
    }).reading;
    const prev = m.reading;
    App.enginePasses++;
    heartbeat();
    if (sym === App.pair) renderFamilyStrip();
    m.reading = r;
    m.history.push(r.consensus.agreement);
    if (m.history.length > 40) m.history.shift();

    updateWatchlistBadge(sym, r);

    if (silent || !prev) return;

    /* real state transitions only — never invented events */
    if (prev.regime.label !== r.regime.label) {
      pushFeed('market', sym, 'Regime change: <b>' + prev.regime.label + ' → ' + r.regime.label + '</b>',
        r.regime.trend === 'TRENDING' ? 'k-tech' : 'k-flat');
    }
    /* The background pass reports CONSENSUS STATE, never a verdict. Announcing
       "WAIT -> UP" here would be an automatic actionable signal delivered to
       the user, which is out of scope. Direction is issued only by a reading
       the user asked for. */
    if (prev.verdict !== r.verdict) {
      pushFeed('market', sym, 'Consensus state changed · agreement <b>' +
        prev.consensus.agreement + ' → ' + r.consensus.agreement + '</b> · ' +
        r.consensus.familiesAgreeing + ' of ' + r.families.length + ' families aligned', 'k-tech');
    }
    const dA = r.consensus.agreement - prev.consensus.agreement;
    if (Math.abs(dA) >= 9) {
      pushFeed('market', sym, 'Agreement <b>' + prev.consensus.agreement + ' → ' + r.consensus.agreement + '</b>' +
        ' · ' + r.consensus.familiesAgreeing + ' families aligned', 'k-tech');
    }
    if (prev.consensus.familiesAgreeing < 4 && r.consensus.familiesAgreeing >= 4 && r.verdict !== 'WAIT') {
      alignmentAlert(sym, r);
    }
    const prevStruct = prev.overlays.structure.slice(-1)[0], nowStruct = r.overlays.structure.slice(-1)[0];
    if (prevStruct && nowStruct && prevStruct.label !== nowStruct.label) {
      pushFeed('market', sym, 'Market structure: <b>' + nowStruct.label + '</b> confirmed at ' + M.fmtPrice(nowStruct.price, sym), 'k-tech');
    }
  }

  function heartbeat() {
    const el = document.getElementById('sbHeartbeat');
    if (!el) return;
    el.innerHTML = 'Engine · pass <b>' + M.fmtClock(new Date()) + '</b> · ' +
      M.PAIRS.length + ' pairs · <b>' + (M.PAIRS.length * Eng.STRATEGIES.length) + '</b> strategy evaluations';
    el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat');
  }

  /* live family state for the selected pair — recomputed on every closed
     candle by the background monitor, never by a timer */
  let famStripPrev = {};
  function renderFamilyStrip() {
    const host = document.getElementById('famStrip');
    if (!host) return;
    const m = App.monitor[App.pair];
    if (!m || !m.reading) { host.innerHTML = ''; return; }
    host.innerHTML = '';
    m.reading.families.forEach(f => {
      const col = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
      const w = Math.min(50, Math.abs(f.score) * 50);
      const left = f.score >= 0 ? 50 : 50 - w;
      const g = f.direction === 'BULLISH' ? '↑' : f.direction === 'BEARISH' ? '↓' : '○';
      const row = el('div', 'fs-row' + (famStripPrev[f.key] && famStripPrev[f.key] !== f.direction ? ' changed' : ''),
        '<span class="k">' + f.label + '</span>' +
        '<span class="t"><i style="left:' + left + '%;width:' + w + '%;background:' + col + '"></i></span>' +
        '<span class="v" style="color:' + col + '">' + g + ' ' + Math.abs(f.score).toFixed(2) + '</span>');
      host.appendChild(row);
      famStripPrev[f.key] = f.direction;
    });
  }

  function updateWatchlistBadge(sym, r) {
    const row = $('#watchlist .wl-row[data-sym="' + CSS.escape(sym) + '"]');
    if (!row) return;
    const b = row.querySelector('[data-badge]');
    const cls = r.verdict === 'UP' ? 'b-up' : r.verdict === 'DOWN' ? 'b-down' : 'b-wait';
    const txt = r.verdict === 'WAIT' ? r.consensus.agreement + '○' :
      r.consensus.agreement + (r.verdict === 'UP' ? '↑' : '↓');
    if (b.textContent !== txt) {
      row.classList.remove('flash-up', 'flash-down');
      void row.offsetWidth;
      row.classList.add(r.verdict === 'DOWN' ? 'flash-down' : 'flash-up');
    }
    b.className = 'wl-badge ' + cls; b.textContent = txt;
  }

  /* Automatic monitoring alerts (toasts, and later push/email) are OUT OF
     CURRENT SCOPE. The core workflow is user-initiated: select pair ->
     select timeframe -> ANALYZE. The code is retained behind this flag so
     the concept can be re-enabled deliberately, not by accident. */
  const MONITORING_ALERTS_ENABLED = false;

  function alignmentAlert(sym, r) {
    if (!MONITORING_ALERTS_ENABLED) return;
    // never cover a freshly revealed reading — the result outranks the alert
    if (App.running || Date.now() - App.lastAnalysisAt < 7000) {
      pushFeed('market', sym, 'Cross-family alignment detected · <b>' +
        r.consensus.familiesAgreeing + ' families</b> (alert held back during a reading)', 'k-warn');
      return;
    }
    const t = el('div', 'toast');
    t.innerHTML =
      '<div class="tt">⌁ Cross-family alignment</div>' +
      '<div class="tb"><b>' + sym + '</b> · 5M<br>' +
      r.consensus.familiesAgreeing + ' of ' + r.families.length + ' families now agree<br>' +
      '<span class="m">Agreement ' + r.consensus.agreement + ' · independent ' + r.consensus.independent + '</span></div>' +
      '<div class="ta">OPEN ANALYSIS →</div>';
    t.onclick = () => { setPair(sym); t.remove(); };
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 9000);
    pushFeed('market', sym, 'Cross-family alignment detected · <b>' + r.consensus.familiesAgreeing + ' families</b>', 'k-warn');
  }

  /* ============================================================
     ACTIVITY FEED
     ============================================================ */
  function pushFeed(kind, sym, html, cls) {
    const item = { kind, sym, html, cls, ts: new Date() };
    App.feedItems.unshift(item);
    if (App.feedItems.length > 60) App.feedItems.pop();
    renderFeed();
  }
  let feedFilter = 'all';
  function renderFeed() {
    const f = $('#feed');
    const items = App.feedItems.filter(i =>
      feedFilter === 'all' ? true :
        feedFilter === 'engine' ? i.kind === 'engine' :
          feedFilter === 'market' ? i.kind === 'market' :
            i.sym === App.pair);
    f.innerHTML = '';
    items.forEach((i, idx) => {
      const r = el('div', 'feed-row ' + (i.cls || 'k-flat') + (idx === 0 ? ' enter' : ''));
      r.innerHTML = '<span class="ts">' + M.fmtClock(i.ts) + '</span>' +
        '<span class="tx">' + (i.sym ? '<b>' + i.sym + '</b> · ' : '') + i.html + '</span>';
      f.appendChild(r);
    });
  }

  /* ============================================================
     PAIR / TIMEFRAME
     ============================================================ */
  function setPair(sym) {
    App.pair = sym;
    App.feed = feedFor(sym, App.tf);
    App.chart.setData(App.feed.candles, sym);
    App.chart.reading = null;
    App.chart.anim = App.chart.resetAnim();
    App.reading = null;
    $('#pairName').textContent = sym;
    $('#tickerPair').textContent = sym;
    $$('#watchlist .wl-row').forEach(r => r.classList.toggle('active', r.dataset.sym === sym));
    renderLegend(); renderReadingEmpty(); renderRestMatrix(null); renderSub();
    $('#chartLegend').classList.remove('shift'); $('#snapshotStamp').classList.remove('on');
    $('#phaseCaption').classList.remove('on');
    $('#catCluster').classList.remove('on');
    setTrendHud('off');
    famStripPrev = {};
    renderFamilyStrip();
    armAnalyze();
    // prime regime panel from the background monitor reading
    const m = App.monitor[sym];
    if (m && m.reading) renderRegime(m.reading);
  }

  function setTimeframe(tf) {
    App.tf = tf;
    App.feed = feedFor(App.pair, tf);
    App.chart.setData(App.feed.candles, App.pair);
    App.chart.reading = null; App.chart.anim = App.chart.resetAnim();
    App.reading = null;
    $$('#tfGroup .tf-btn').forEach(b => b.classList.toggle('active', b.textContent.trim().toLowerCase().startsWith(tf)));
    $('#tickerTf').textContent = tf.toUpperCase();
    renderLegend(); renderReadingEmpty(); renderRestMatrix(null); renderSub();
    $('#chartLegend').classList.remove('shift'); $('#snapshotStamp').classList.remove('on');
    armAnalyze();
  }

  function renderRegime(r) {
    $('#regimeTag').textContent = r.regime.trend;
    $('#regimeTag').className = 'regime-tag ' + r.regime.trend.toLowerCase();
    $('#regimeVol').textContent = r.regime.vol;
    $('#regimeAdx').textContent = r.regime.adx.toFixed(1);
    $('#regimeAtr').textContent = (r.indicators.atr[r.indicators.atr.length - 1] / M.pairInfo(App.pair).pip).toFixed(1) + 'p';
    $('#regimeVolR').textContent = r.regime.volRatio.toFixed(2) + '×';
  }

  function renderSub() {
    const p = M.pairInfo(App.pair);
    const r = App.reading || Eng.analyze(App.feed.candles, { pair: App.pair, pip: p.pip, digits: p.digits, tfLabel: App.tf });
    App.sub.rsi.render(App.chart, r.indicators);
    App.sub.macd.render(App.chart, r.indicators);
    const i = r.indicators.r.length - 1;
    $('#spRsi').textContent = r.indicators.r[i].toFixed(2);
    $('#spMacd').textContent = r.indicators.m.hist[i].toFixed(6);
    renderRegime(r);
  }

  /* ============================================================
     ANALYSIS
     ============================================================ */
  function armAnalyze() {
    const dock = $('#analyzeDock');
    const fresh = App.reading && (Date.now() - App.lastAnalysisAt) < 1000 * 60 * M.tfInfo(App.tf).min;
    dock.classList.toggle('disarmed', !!fresh);
    $('#analyzeLabel').textContent = fresh ? 'Reanalyze' : 'Analyze';
  }

  function runAnalysis(speed) {
    if (App.running) return;
    const cap = App.cap();
    if (App.quotaUsed >= cap.quota) return openUpsell('quota');

    const p = M.pairInfo(App.pair);
    /* ---- ANALYSIS ENGINE: computed first, complete, before a single frame ---- */
    const got = getReading(App.pair, App.tf, App.feed.candles, {
      pair: App.pair, pip: p.pip, digits: p.digits,
      tfLabel: App.tf, htfLabel: htfLabel(App.tf), tfMin: M.tfInfo(App.tf).min
    });
    const reading = got.reading;

    /* ---- ALLOWANCE ------------------------------------------------------
       Only actionable UP / DOWN readings spend a credit. WAIT is free.
       The charge is keyed on whether THIS USER has already analysed this
       snapshot, not on whether the engine had to run: the background monitor
       may already have computed it, and that must not hand out free credits
       or suppress a legitimate one. ---- */
    chargeReading(reading, got.key);

    App.reading = reading;
    App.settled = false;              // this analysis has not been settled yet
    App.holdArmed = false;
    App.lastAnalysisAt = Date.now();
    App.history.unshift({ ts: new Date(), pair: App.pair, tf: App.tf, reading, outcome: null });
    if (reading._cached) showReusedChip();

    $('#sbHash').textContent = reading.snapshot.hash;
    $('#initPair').textContent = App.pair + ' · ' + App.tf.toUpperCase();
    $('#initSnap').textContent = M.fmtTime(reading.snapshot.last_closed) + ' UTC · ' + reading.snapshot.candles + ' candles';
    $('#initFeed').textContent = $('#feedMs').textContent + ' · OK · DEMO';
    $('#initEngine').textContent = reading.engine_version;
    $('#initStrat').textContent = reading.consensus.counts.total + ' · families ' + reading.families.length;
    $('#snapshotStamp').innerHTML = '<b>SNAPSHOT</b> ' + M.fmtTime(reading.snapshot.last_closed) +
      ' UTC · ' + reading.snapshot.candles + ' candles · ' + reading.snapshot.hash;
    $('#mrCount').textContent = reading.consensus.counts.total + ' STRATEGIES · ' + reading.families.length + ' FAMILIES';
    $('#cnBull').textContent = reading.consensus.counts.bull;
    $('#cnBear').textContent = reading.consensus.counts.bear;
    $('#cnFlat').textContent = reading.consensus.counts.flat;

    /* Nothing may compete with the chart during the sequence: close the pair
       palette, the upgrade panel, the math slide-over, any rail view and any
       pending toast. They return afterwards on their own. */
    closePalette();
    closeUpsell();
    $('#mathOver').classList.remove('on');
    $('#viewOverlay').classList.remove('on');
    $('#speedMenu').classList.remove('on');
    $('#toasts').innerHTML = '';
    $$('.rail-btn').forEach(x => x.classList.toggle('active', x.dataset.view === 'terminal'));

    // measure the side panel while it is still on screen; the verdict card
    // docks into it once the readable hold ends
    const rp = $('#rightPanel').getBoundingClientRect();
    App.sidePanelRect = { left: rp.left, top: rp.top, width: rp.width };

    buildPhaseRail(reading);
    const built = buildMatrixRail(reading);
    buildVerdictCard(reading);
    resetAnalysisChrome();
    updateQuota();

    /* ---- PRESENTATION ENGINE: replays what is already decided ---- */
    App.running = P.runDesktop(Object.assign(presentationEnv(reading, built), {
      speed: speed,
      onDone: () => finishAnalysis(reading)
    }));

    // engine log into the activity feed (real timestamps from the engine)
    reading.log.forEach(l => App.feedItems.push({
      kind: 'engine', sym: App.pair, cls: 'k-tech',
      html: '<b>' + l.k + '</b> ' + l.v, ts: new Date()
    }));
    App.feedItems = App.feedItems.slice(0, 60);
  }

  /* everything the Presentation Engine is allowed to touch */
  function presentationEnv(reading, built) {
    return {
      app: $('#app'), chart: App.chart, reading: reading,
      rows: built.rows, famHeads: built.famHeads, byFamily: built.byFamily,
      setPhase: setPhase,
      phaseProgress: phaseProgress,
      spotlight: spotlightFamilies,
      highlightFamily: k => spotlightFamilies(k ? [k] : null),
      familyUses: k => familyUses(reading, k),
      fillContribution: (k, p) => fillContribution(reading, k, p),
      trendHud: step => setTrendHud(step, reading),
      trendStrength: p => setTrendStrength(p, reading),
      onReveal: () => beginHold(reading)
    };
  }

  /* ---- TREND / MARKET REGIME HUD -------------------------------------
     Renders reading.trend, which the Analysis Engine produced. This function
     chooses no label, no strength and no structure state — it only decides
     when each already-decided value becomes visible. */
  function trendClass(v) { return v === 'HIGHER' ? 'hi' : v === 'LOWER' ? 'lo' : 'na'; }

  function setTrendHud(step, reading) {
    const hud = $('#trendHud');
    if (!hud) return;
    if (step === 'off') {
      hud.className = 'trend-hud';
      return;
    }
    if (!reading || !reading.trend) return;
    const t = reading.trend;

    if (step === 'structure') {
      hud.className = 'trend-hud on scanning';
      $('#thTitle').textContent = 'Market structure';
      $('#thGlyph').textContent = '';
      $('#thLabel').textContent = '';
      $('#thStruct').innerHTML =
        '<span class="sl ' + trendClass(t.structure.highs) + '"><b></b>' + t.structure.highsLabel + '</span>' +
        '<span class="sl ' + trendClass(t.structure.lows) + '"><b></b>' + t.structure.lowsLabel + '</span>';
      $('#thStrengthVal').textContent = '—';
      $('#thStrengthFill').style.width = '0%';
      $('#thMeta').textContent = 'SEQUENCE ' + t.structure.sequence.join(' → ');
      return;
    }

    if (step === 'trend') {
      const dir = t.label === 'UPTREND' ? 'up' : t.label === 'DOWNTREND' ? 'down' : 'range';
      hud.className = 'trend-hud on resolved ' + dir;
      $('#thTitle').textContent = t.title;                       // TREND DETECTED | MARKET REGIME
      $('#thGlyph').textContent = t.glyph;                       // ↑ ↓ ↔
      $('#thLabel').textContent = t.label === 'SIDEWAYS' ? 'SIDEWAYS / RANGE' : t.label;
      $('#thStruct').innerHTML =
        '<span class="sl ' + trendClass(t.structure.highs) + '"><b></b>' + t.structure.highsLabel + '</span>' +
        '<span class="sl ' + trendClass(t.structure.lows) + '"><b></b>' + t.structure.lowsLabel + '</span>' +
        (t.structure.note ? '<span class="sl na"><b></b>' + t.structure.note + '</span>' : '');
      $('#thStrengthVal').textContent = t.strength;
      $('#thMeta').textContent = 'ADX ' + t.adx.toFixed(1) + ' · ' + t.regime + ' · EMA ' + t.emaStackShort;
      return;
    }

    if (step === 'compact') hud.classList.add('compact');
  }

  function setTrendStrength(p, reading) {
    const fill = document.getElementById('thStrengthFill');
    if (fill && reading && reading.trend) fill.style.width = (reading.trend.strengthPct * p) + '%';
  }

  function buildPhaseRail(reading) {
    const host = $('#phaseRail'); host.innerHTML = '';
    reading.phases.forEach((ph, k) => {
      host.appendChild(el('div', 'ph',
        '<span class="ph-label"><i>' + (k + 1) + '</i>' + ph.label + '</span>' +
        '<span class="ph-track"><i class="ph-fill"></i></span>'));
    });
  }

  function setPhase(k, phase, fams) {
    const rail = $('#phaseRail');
    Array.prototype.forEach.call(rail.children, (c, i) => {
      c.classList.toggle('active', i === k);
      c.classList.toggle('done', i < k);
    });
    const cap = $('#phaseCaption');
    cap.classList.remove('on');
    setTimeout(() => {
      cap.querySelector('.pc-n').textContent = 'PHASE ' + (k + 1) + ' · ' + phase.label;
      cap.querySelector('.pc-v').textContent = phase.caption;
      cap.classList.add('on');
    }, 90);
    spotlightFamilies(fams);
  }

  function phaseProgress(k, p) {
    const c = $('#phaseRail').children[k];
    if (c) c.querySelector('.ph-fill').style.width = (p * 100) + '%';
  }

  function spotlightFamilies(list) {
    const mr = $('#matrixRail');
    if (!list || !list.length) {
      mr.classList.remove('spotlight');
      $$('#mrBody .fam-group').forEach(g => g.classList.remove('active'));
      return;
    }
    mr.classList.add('spotlight');
    $$('#mrBody .fam-group').forEach(g => g.classList.toggle('active', list.indexOf(g.dataset.fam) >= 0));
  }

  function familyUses(reading, key) {
    const uses = [];
    reading.strategies.filter(s => s.fam === key).forEach(s =>
      s.uses.forEach(u => { if (uses.indexOf(u) < 0) uses.push(u); }));
    return uses.length ? uses : null;
  }

  function fillContribution(reading, key, p) {
    const f = reading.families.find(x => x.key === key);
    const head = $('#mrBody .fam-head[data-fam="' + key + '"]');
    if (!f || !head) return;
    const totalW = reading.families.reduce((a, x) => a + x.weight, 0);
    const share = Math.abs(f.score) * f.weight / totalW;
    head.querySelector('.fh-contrib i').style.width = Math.min(100, share * 260 * p) + '%';
  }

  function showReusedChip() {
    const bar = $('.chipbar');
    if (bar.querySelector('.reused')) return;
    const c = el('div', 'chip reused', '<span>REUSED SNAPSHOT</span>');
    c.title = 'The market has not produced a new closed candle, so the stored Reading was reused. No credit spent.';
    bar.insertBefore(c, bar.firstChild);
    setTimeout(() => c.remove(), 5000);
  }

  function htfLabel(tf) {
    const order = ['1m', '3m', '5m', '15m', '30m', '1h'];
    const i = order.indexOf(tf);
    return order[Math.min(order.length - 1, i + 2)];
  }

  function resetAnalysisChrome() {
    ['#matrixRail', '#mrConsensus', '#verdictLayer', '#verdictCard', '#catCluster', '#initOverlay',
     '#snapshotStamp', '#speedFlag', '#phaseRail', '#phaseCaption']
      .forEach(s => $(s).classList.remove('on'));
    $('#matrixRail').classList.remove('spotlight');
    setTrendHud('off');
    $('#verdictCard').classList.remove('holding');
    $('#verdictCard').style.cssText = '';
    $('#catCluster').classList.remove('docked');
    $$('#catCluster .cat').forEach(c => { c.classList.remove('resolved'); c.querySelector('.cv').textContent = '—'; });
    ['#cbBull', '#cbBear', '#cbFlat'].forEach(s => $(s).style.width = '0%');
    $('#cIndep').innerHTML = '';
    $('#cScoreN').textContent = '0';
    $('#cQualWrap').style.opacity = 0;
    $('#hairline').style.width = '0%';
  }

  /* ======================================================================
     FINAL RESULT — climax -> readable hold -> dock into the side panel
     ----------------------------------------------------------------------
     The central card stays for RESULT_HOLD_MS with the background held
     calm, then flies into the READING panel rather than vanishing. The
     hold is skippable: the card's Continue button and Esc settle it at once.
     ====================================================================== */
  const RESULT_HOLD_MS = 4200;

  /* Called by the Presentation Engine at the moment the card is revealed, so
     the readable hold is measured from the reveal rather than from the end of
     the timeline. */
  function beginHold(reading) {
    if (App.settled || App.holdArmed) return;
    App.holdArmed = true;
    $('#app').classList.add('reading-hold');
    $('#verdictCard').classList.add('holding');
    clearTimeout(App.holdTimer);
    App.holdTimer = setTimeout(() => settleReading(reading), RESULT_HOLD_MS);
  }

  function finishAnalysis(reading) {
    if (App.settled) return;          // the user already skipped the hold
    beginHold(reading);               // safety net if onReveal never fired
  }

  function settleReading(reading) {
    if (App.settled || !reading) return;
    App.settled = true;
    App.holdArmed = false;
    clearTimeout(App.holdTimer);

    const app = $('#app');
    app.classList.remove('reading-hold');
    app.dataset.mode = 'idle';
    $('#matrixRail').classList.remove('on');
    $('#speedFlag').classList.remove('on');
    $('#verdictCard').classList.remove('holding');
    setTrendHud('off');

    // the persistent side result is built first, so the card has somewhere to go
    renderReadingPane(reading);
    renderRestMatrix(reading);
    renderSub();
    renderFeed();
    switchTab('reading');

    $('#phaseCaption').classList.remove('on');
    $('#phaseRail').classList.remove('on');
    $$('#catCluster .cat').forEach((c, k) => {
      const cat = reading.categories[k]; if (!cat) return;
      c.classList.add('resolved');
      c.querySelector('.cv').textContent = cat.v;
    });
    $('#catCluster').classList.add('on', 'docked');
    $('#snapshotStamp').classList.add('on');
    $('#chartLegend').classList.add('shift');

    // setTimeout rather than rAF: the dock must run even if the tab is
    // throttling animation frames
    setTimeout(dockVerdictCard, 20);

    // camera returns; overlays REMAIN on the chart, entry evidence stays dominant
    const from = App.chart.view.count, to = 130, t0 = performance.now();
    const climaxFrom = App.chart.anim.climax, climaxTo = reading.entry ? 0.20 : 0;
    (function back(now) {
      const p = Math.min(1, (now - t0) / 500);
      App.chart.view.count = Math.round(from + (to - from) * p);
      App.chart.anim.chartDim = 1 - (1 - App.chart.anim.chartDim) * (1 - p);
      App.chart.anim.climax = climaxFrom + (climaxTo - climaxFrom) * p;
      App.chart.resize();                       // the plot is shrinking back
      if (p < 1) requestAnimationFrame(back);
      else {
        App.chart.anim.chartDim = 1;
        App.chart.resize();
        App.sub.rsi.resize(); App.sub.macd.resize(); renderSub();
        App.running = null; armAnalyze();
      }
    })(performance.now());
  }

  /* fly the central card into the READING panel's result hero */
  function dockVerdictCard() {
    const card = $('#verdictCard');
    const layer = $('#verdictLayer');
    const r = App.sidePanelRect;
    const c = card.getBoundingClientRect();
    const done = () => {
      card.style.cssText = '';
      card.classList.remove('on');
      layer.classList.remove('on');
    };
    if (!r || !c.width) { card.classList.remove('on'); setTimeout(done, 280); return; }

    const targetX = r.left + r.width / 2;
    const targetY = r.top + 64;                       // the rp-hero sits under the tabs
    const scale = Math.max(0.34, Math.min(0.92, (r.width - 26) / c.width));
    const dx = targetX - (c.left + c.width / 2);
    const dy = targetY - (c.top + c.height / 2);

    card.style.transition =
      'transform 620ms cubic-bezier(.16,1,.3,1), opacity 420ms 200ms cubic-bezier(.4,0,1,1)';
    card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    card.style.opacity = '0';
    setTimeout(done, 660);
  }

  /* ---------- matrix rail construction ---------- */
  function buildMatrixRail(reading) {
    const body = $('#mrBody'); body.innerHTML = '';
    $('#matrixRail').classList.toggle('no-strength', !App.cap().strength);
    const rows = [], famHeads = [], byFamily = {};
    let idx = 0;
    Eng.FAM_ORDER.forEach(key => {
      const fam = reading.families.find(f => f.key === key);
      if (!fam) return;
      const grp = el('div', 'fam-group');
      grp.dataset.fam = key;
      const head = el('div', 'fam-head',
        '<span class="fh-k">' + fam.label + ' <span style="opacity:.55">ρ ' + fam.rho.toFixed(2) + '</span></span>' +
        '<span class="fh-line"></span>' +
        '<span class="fh-contrib"><i></i></span>' +
        '<span class="fh-v"></span>');
      head.dataset.fam = key;
      grp.appendChild(head);
      byFamily[key] = [];
      const members = reading.strategies.filter(s => s.fam === key);
      members.forEach(s => {
        const row = el('div', 'mx-row',
          '<span class="mx-dot"></span>' +
          '<span class="mx-name">' + s.name + '</span>' +
          '<span class="mx-res"><span class="rw">ANALYZING</span></span>' +
          '<span class="mx-str"></span>');
        grp.appendChild(row);
        const rec = { el: row, strategy: s, index: idx };
        rows.push(rec); byFamily[key].push(rec);
        idx++;
      });
      famHeads.push({ el: head, family: fam, lastIndex: idx - 1 });
      body.appendChild(grp);
    });
    return { rows, famHeads, byFamily };
  }

  /* ---------- verdict card — the climax of the Full Analysis ----------
     Hierarchy is fixed and non-negotiable:
       DIRECTION -> DURATION -> ENTER AT -> WINDOW -> PRICE/ZONE -> CONSENSUS
     Every one of those five actionable values comes from reading.entry,
     which the engine derived. Nothing here is generated for display. */
  function buildVerdictCard(r) {
    const cap = App.cap();
    const card = $('#verdictCard');
    const isWait = r.verdict === 'WAIT' || r.verdict === 'NO_ANALYSIS';
    const cls = isWait ? 'v-wait' : r.verdict === 'UP' ? 'v-up' : 'v-down';
    card.className = 'verdict-card ' + cls;

    const pairLine =
      '<div class="vc-pairline"><b>' + App.pair + '</b><span class="dd"></span>' +
      App.tf.toUpperCase() + '<span class="dd"></span>SNAPSHOT ' +
      M.fmtTime(r.snapshot.last_closed) + ' UTC' +
      (r._cached ? '<span class="dd"></span><span style="color:var(--blue)">REUSED</span>' : '') +
      '</div>';

    const famBar =
      '<div class="vc-fambar">' + r.families.map(f => {
        const c = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
        const w = Math.min(100, Math.abs(f.score) * 100);
        return '<span class="fb"><i style="width:' + w + '%;background:' + c + '"></i></span>';
      }).join('') + '</div>' +
      '<div class="vc-famlabels">' + r.families.map(f => '<span>' + f.label.slice(0, 4) + '</span>').join('') + '</div>';

    const consensusBlock =
      '<div class="vc-consensus">' +
        '<div><div class="big" style="color:' + verdictColour(r) + '">' + r.consensus.agreement +
          '<small> / 100</small></div><div class="k">Strategy consensus</div></div>' +
        '<div><div class="k">' + r.consensus.familiesAgreeing + ' of ' + r.families.length + ' families agree · ' +
          (cap.independent ? r.consensus.independent : '•.•') + ' of ' + r.consensus.counts.total +
          ' independent voices</div>' + famBar + '</div>' +
      '</div>';

    if (isWait) {
      const famCells = r.families.map(f => {
        const c = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
        const word = f.split ? 'Mixed'
          : f.direction === 'BULLISH' ? 'Bullish'
          : f.direction === 'BEARISH' ? 'Bearish'
          : f.active === 0 ? 'No setup' : 'Neutral';
        return '<div class="cell"><span class="k">' + f.label + '</span>' +
          '<span class="v" style="color:' + c + '">' + word + '</span></div>';
      }).join('');
      const failed = r.consensus.gates.filter(g => !g.pass);

      card.innerHTML = pairLine +
        '<div class="vc-hero" style="grid-template-columns:auto">' +
          '<div class="vc-dir"><span class="g">❚❚</span><span class="w">WAIT</span></div>' +
        '</div>' +
        '<div class="vc-sub" style="margin-bottom:14px">No high-quality setup · no entry issued</div>' +
        '<div class="vc-wait-grid">' + famCells + '</div>' +
        '<div class="vc-note"><b>Reason</b><br>' + failed.map(g => gateText(g)).join('<br>') + '</div>' +
        consensusBlock +
        (App.plan === 'free'
          ? '<div class="vc-freehint">✓ <b>WAIT results don\'t use your allowance.</b> ' +
            (App.cap().quota - App.quotaUsed) + ' actionable readings still available today.</div>'
          : '') +
        actionRow(r, cap) +
        '<div class="vc-disclaimer">MarketPulse declined this setup. Analytical output on DEMO data. Not investment advice.</div>' +
        '<div class="vc-hold"><i></i></div>';

      wireCard(card, r);
      return;
    }

    /* ---------- actionable ---------- */
    const granted = r._entryGranted !== false;
    const e = r.entry;
    const glyph = r.verdict === 'UP' ? '↑' : '↓';
    const enterAt = M.fmtTime(e.time);
    const winFrom = M.fmtClock(new Date(e.windowStart));
    const winTo = M.fmtClock(new Date(e.windowEnd));

    const hero =
      '<div class="vc-hero">' +
        '<div class="vc-dir"><span class="g">' + glyph + '</span><span class="w">' + r.verdict + '</span></div>' +
        '<div class="rule"></div>' +
        '<div class="vc-fact"><span class="k">Duration <em class="demo-tag">demo</em></span>' +
          '<span class="v">' + e.durationMin + ' MIN</span>' +
          '<span class="s">reading applies for ' + e.durationMin + ' min from entry</span></div>' +
        '<div class="rule"></div>' +
        '<div class="vc-fact"><span class="k">Enter at <em class="demo-tag">demo</em></span>' +
          '<span class="v' + (granted ? '' : ' locked') + '">' + (granted ? enterAt : '••:••') + '</span>' +
          '<span class="s">' + (granted ? 'UTC · next candle open' : 'daily allowance used') + '</span></div>' +
      '</div>';

    const entryBar = granted
      ? '<div class="vc-entrybar">' +
          '<div class="cell"><div class="k">Entry window <em class="demo-tag">demo</em></div><div class="v">' + winFrom + ' — ' + winTo + '</div>' +
            '<div class="sub">first ' + e.windowSec + 's of the candle</div></div>' +
          '<div class="cell"><div class="k">Entry price <em class="demo-tag">demo</em></div><div class="v">' + M.fmtPrice(e.price, App.pair) + '</div>' +
            '<div class="sub">zone ' + M.fmtPrice(e.low, App.pair) + ' – ' + M.fmtPrice(e.high, App.pair) + ' · ±' + e.bandPips + 'p</div></div>' +
        '</div>'
      : '<div class="vc-entrybar locked" data-upsell="quota">' +
          '<div class="cell"><div class="k">🔒 Entry window</div><div class="v"><span class="masked">••:••:•• — ••:••:••</span></div>' +
            '<div class="sub">5 actionable readings used today</div></div>' +
          '<div class="cell"><div class="k">🔒 Entry price</div><div class="v"><span class="masked">' + maskPrice(e.price) + '</span></div>' +
            '<div class="sub">the level is computed — Trader removes the cap</div></div>' +
        '</div>';

    card.innerHTML = pairLine + hero + entryBar + consensusBlock +
      '<div class="vc-note" style="font-size:10.5px">' +
        '<b>Entry &amp; duration logic: DEMO / UNRESOLVED.</b><br>' +
        'Entry level from ' + e.source + ' ± 0.5 ATR — a prototype hypothesis. ' +
        'Duration is a placeholder mapping of consensus (' + r.consensus.agreement + '), volatility (' +
        r.regime.vol.toLowerCase() + ') and regime (' + r.regime.trend.toLowerCase() + ') onto a candidate ladder, ' +
        'independent of the ' + App.tf + ' chart timeframe. None of this is approved production methodology.</div>' +
      actionRow(r, cap) +
      '<div class="vc-disclaimer">Derived from DEMO market data. Analytical output. Not investment advice.</div>' +
      '<div class="vc-hold"><i></i></div>';

    wireCard(card, r);
  }

  function verdictColour(r) {
    return r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
  }

  function actionRow(r, cap) {
    return '<div class="vc-actions">' +
      (cap.math ? '<button class="btn-ghost" data-act="math">Show the math</button>'
                : '<button class="btn-ghost" data-upsell="math">🔒 Show the math</button>') +
      '<button class="btn-ghost" data-act="share">Share reading</button>' +
      '<button class="btn-ghost" data-act="close">Continue</button>' +
      '</div>';
  }

  function wireCard(card, r) {
    card.querySelectorAll('[data-upsell]').forEach(b => b.onclick = () => openUpsell(b.dataset.upsell));
    const mathBtn = card.querySelector('[data-act="math"]');
    if (mathBtn) mathBtn.onclick = () => openMath(r);
    const shareBtn = card.querySelector('[data-act="share"]');
    if (shareBtn) shareBtn.onclick = () =>
      pushFeed('engine', App.pair, 'Reading <b>r_' + r.snapshot.hash + '</b> link copied (prototype)', 'k-tech');
    const closeBtn = card.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.onclick = () => settleReading(App.reading);
  }

  function gateText(g) {
    if (g.k === 'agreement') return 'Agreement ' + g.got + ' is below the ' + g.need + ' floor.';
    if (g.k === 'families') return 'Only ' + g.got + ' of the required ' + g.need + ' families agree.';
    if (g.k === 'independent') return 'Effective independent voices ' + g.got + ' — below the ' + g.need + ' minimum. The agreement that exists is concentrated in correlated strategies.';
    if (g.k === 'participation') return 'Only ' + g.got + ' of ' + (App.reading ? App.reading.consensus.counts.total : 16) + ' strategies took a side — the required minimum is ' + g.need + '. Most strategies report no setup here.';
    if (g.k === 'regime') return 'Weak-ADX range (' + g.got + '); this regime requires ' + g.need + '.';
    return '';
  }

  function maskPrice(v) {
    const s = M.fmtPrice(v, App.pair);
    return s.slice(0, 4) + '•'.repeat(Math.max(1, s.length - 4));
  }

  function entryWindow(r) {
    const step = M.tfInfo(App.tf).min * 60000;
    const from = new Date(r.snapshot.last_closed + step);
    const to = new Date(r.snapshot.last_closed + step * 3);
    return { from: M.fmtTime(from.getTime()), to: M.fmtTime(to.getTime()) };
  }

  function updateValidity() {
    const v = document.getElementById('validityVal');
    if (!v || !App.reading) return;
    const s = App.feed.secondsToClose(performance.now());
    v.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /* ============================================================
     RIGHT PANEL — READING
     ============================================================ */
  function renderReadingEmpty() {
    $('#paneReading').innerHTML =
      '<div class="reading-empty">' +
      '<svg class="re-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="20" cy="20" r="15"/><path d="M12 24l5-7 4 3 7-9"/></svg>' +
      '<div class="re-t">No reading yet</div>' +
      '<div class="re-d">' + M.PAIRS.length + ' pairs are being monitored in the background. Press ANALYZE to run all ' +
      Eng.STRATEGIES.length + ' strategies against the current ' + App.tf.toUpperCase() + ' snapshot of ' + App.pair + '.</div>' +
      '</div>';
  }

  function renderReadingPane(r) {
    const cap = App.cap();
    const isWait = r.verdict === 'WAIT' || r.verdict === 'NO_ANALYSIS';
    const dirCls = isWait ? 'wait' : r.verdict === 'UP' ? 'up' : 'down';
    const glyph = isWait ? '❚❚' : r.verdict === 'UP' ? '↑' : '↓';
    const cn = r.consensus.counts;
    const mx = Math.max(cn.bull, cn.bear, cn.flat, 1);
    const col = isWait ? 'var(--amber)' : r.verdict === 'UP' ? 'var(--bull)' : 'var(--bear)';
    const C = 2 * Math.PI * 30;

    const famRows = r.families.map(f => {
      const g = f.direction === 'BULLISH' ? '↑' : f.direction === 'BEARISH' ? '↓' : '○';
      const c = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
      const glyphs = ['bull', 'bear', 'flat'].map(k => {
        const n = f.counts[k];
        const gg = k === 'bull' ? '↑' : k === 'bear' ? '↓' : '○';
        const cc = k === 'bull' ? 'var(--bull)' : k === 'bear' ? 'var(--bear)' : 'var(--gray)';
        return new Array(n).fill('<span style="color:' + cc + '">' + gg + '</span>').join('');
      }).join('');
      return '<div class="fam-row" data-fam="' + f.key + '">' +
        '<span class="fk">' + f.label + '</span>' +
        '<span class="fam-glyphs">' + glyphs + '</span>' +
        '<span class="fv" style="color:' + c + '">' + g + ' ' + Math.abs(f.score).toFixed(2) + '</span>' +
        '</div>';
    }).join('');

    const indepCell = cap.independent
      ? '<div class="meta-cell hl"><div class="mk">Independent voices</div><div class="mv">' + r.consensus.independent + ' <small>/ ' + cn.total + '</small></div></div>'
      : '<div class="meta-cell" data-upsell="independent" style="cursor:pointer"><div class="mk">Independent voices 🔒</div><div class="mv"><span class="masked">•.•</span> <small>/ ' + cn.total + '</small></div></div>';

    let premium = '';
    if (!isWait) {
      const win = entryWindow(r);
      premium = '<div class="prem-block">' +
        (r._entryGranted !== false
          ? '<div class="prem-item"><div class="prem-k">Entry point</div><div class="prem-v">' + M.fmtPrice(r.entry.price, App.pair) + '</div></div>' +
            '<div class="prem-item"><div class="prem-k">Entry zone</div><div class="prem-v">' + M.fmtPrice(r.entry.low, App.pair) + ' – ' + M.fmtPrice(r.entry.high, App.pair) + '</div></div>' +
            '<div class="prem-item"><div class="prem-k">Entry window</div><div class="prem-v">' +
              M.fmtClock(new Date(r.entry.windowStart)) + ' – ' + M.fmtClock(new Date(r.entry.windowEnd)) + ' UTC</div></div>' +
            '<div class="prem-item"><div class="prem-k">Duration <em class="demo-tag">demo rule</em></div>' +
              '<div class="prem-v">' + r.entry.durationMin + ' min <span style="font-size:10px;color:var(--t4)">from entry</span></div></div>'
          : '<div class="prem-item"><div class="prem-k">🔒 Entry point</div><div class="prem-v locked" data-upsell="quota"><span class="shimmer"></span>' + maskPrice(r.entry.price) + '</div></div>' +
            '<div class="prem-item"><div class="prem-k">🔒 Entry window</div><div class="prem-v locked" data-upsell="quota"><span class="shimmer"></span>••:••:•• – ••:••:••</div></div>') +
        '<div class="prem-item"><div class="prem-k">Validity</div><div class="prem-v"><span id="validityVal">—</span> <span style="font-size:10px;color:var(--t4)">→ next ' + App.tf + ' close</span></div></div>' +
        '</div>';
    }

    const heroBlock = isWait
      ? '<div class="rp-hero wait"><span class="g">❚❚</span><span class="w">WAIT</span>' +
        '<span class="sub">No high-quality setup</span></div>'
      : '<div class="rp-hero ' + (r.verdict === 'UP' ? 'up' : 'down') + '">' +
          '<span class="g">' + (r.verdict === 'UP' ? '↑' : '↓') + '</span>' +
          '<span class="w">' + r.verdict + '</span>' +
          '<span class="fact"><i>Duration <em class="demo-tag">demo</em></i><b>' + r.entry.durationMin + ' MIN</b></span>' +
          '<span class="fact"><i>Enter at</i><b>' +
            (r._entryGranted === false ? '••:••' : M.fmtTime(r.entry.time)) + '</b></span>' +
        '</div>';

    $('#paneReading').innerHTML =
      heroBlock +
      '<div class="verdict-strip">' +
        '<div class="score-row">' +
          '<div class="score-ring"><svg width="74" height="74" viewBox="0 0 74 74">' +
            '<circle cx="37" cy="37" r="30" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3"/>' +
            '<circle cx="37" cy="37" r="30" fill="none" stroke="' + col + '" stroke-width="3" stroke-linecap="round" ' +
            'style="stroke-dasharray:' + C + ';stroke-dashoffset:' + C * (1 - r.consensus.agreement / 100) + '"/>' +
          '</svg><div class="sv"><span class="n" style="color:' + col + '">' + r.consensus.agreement + '</span><span class="d">/100</span></div></div>' +
          '<div class="bars">' +
            bar('Bullish', cn.bull, mx, 'f-bull') + bar('Bearish', cn.bear, mx, 'f-bear') + bar('Neutral', cn.flat, mx, 'f-flat') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="meta-grid">' +
        '<div class="meta-cell"><div class="mk">Confluence quality</div><div class="mv">' + r.consensus.quality + '</div></div>' +
        indepCell +
        '<div class="meta-cell"><div class="mk">Regime</div><div class="mv" style="font-size:11px">' + r.regime.label + '</div></div>' +
        '<div class="meta-cell"><div class="mk">Compute time</div><div class="mv">' + r.compute_ms + '<small>ms</small></div></div>' +
      '</div>' +
      '<div class="family-list"><div class="lbl" style="margin-bottom:6px">Family breakdown</div>' + famRows + '</div>' +
      (cap.conflicts && r.conflicts.length
        ? '<div class="corr-note"><b>Internal conflict · ' + r.conflicts[0].family + '</b><br>' + r.conflicts[0].text + '</div>'
        : '') +
      '<div class="corr-note"><b>Why ' + r.consensus.independent + ' and not ' + cn.total + '?</b><br>' +
        'Strategies inside a family measure the same thing. The engine discounts each family by its assumed internal correlation (ρ) before combining.' +
        (cap.independent ? '' : ' <span style="color:var(--amber);cursor:pointer" data-upsell="independent">See the full breakdown →</span>') +
      '</div>' +
      premium +
      '<div class="btn-row">' +
        (cap.math ? '<button class="btn-ghost" data-act="math">Show the math</button>' : '<button class="btn-ghost" data-upsell="math">🔒 Show the math</button>') +
        '<button class="btn-ghost" data-act="replay">Replay</button>' +
      '</div>' +
      (App.plan === 'free' ? freePaywallBlock(r) : '');

    $('#paneReading').querySelectorAll('[data-upsell]').forEach(b => b.onclick = () => openUpsell(b.dataset.upsell));
    const mb = $('#paneReading').querySelector('[data-act="math"]'); if (mb) mb.onclick = () => openMath(r);
    const rb = $('#paneReading').querySelector('[data-act="replay"]'); if (rb) rb.onclick = () => replay();
    $$('#paneReading .fam-row').forEach(row => {
      row.onmouseenter = () => focusFamily(row.dataset.fam, r);
      row.onmouseleave = () => { App.chart.anim.focus = null; App.chart.render(); };
    });
    updateValidity();
  }

  function bar(k, n, mx, cls) {
    return '<div class="bar-row"><span class="bk">' + k + '</span>' +
      '<span class="bar-track"><i class="bar-fill ' + cls + '" style="width:' + (n / mx * 100) + '%"></i></span>' +
      '<span class="bn">' + n + '</span></div>';
  }

  function focusFamily(key, r) {
    const uses = [];
    r.strategies.filter(s => s.fam === key).forEach(s => s.uses.forEach(u => { if (uses.indexOf(u) < 0) uses.push(u); }));
    App.chart.anim.focus = uses.length ? uses : null;
    App.chart.render();
  }

  function freePaywallBlock(r) {
    return '<div class="paywall-inline">' +
      '<div class="pi-h">🔒 Locked on Free</div>' +
      '<div class="pi-list">' +
        '<div class="pi-item">Per-strategy evidence <span class="pv">16 rows</span></div>' +
        '<div class="pi-item">Strategy strength values <span class="pv">0.00 – 1.00</span></div>' +
        '<div class="pi-item">Actionable readings per day <span class="pv">5 → 300</span></div>' +
        '<div class="pi-item">Effective independent voices <span class="pv">•.• / ' + r.consensus.counts.total + '</span></div>' +
        '<div class="pi-item">Show the math <span class="pv">snapshot ' + r.snapshot.hash + '</span></div>' +
      '</div>' +
      '<div class="btn-row" style="padding:0">' +
        '<button class="btn-ghost btn-amber" data-upsell="verdict">See what Trader unlocks</button>' +
      '</div>' +
      '<div class="pi-foot">Free keeps the full nine-phase analysis, the direction, the duration, the entry timing, the consensus score and all 16 strategy verdicts. WAIT results never use your allowance.</div>' +
      '</div>';
  }

  function flashPaywall() {
    const b = $('#paneReading .paywall-inline');
    if (!b) return;
    b.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ============================================================
     RIGHT PANEL — RESTING STRATEGY MATRIX
     ============================================================ */
  function renderRestMatrix(r) {
    const pane = $('#paneMatrix');
    if (!r) {
      pane.innerHTML = '<div class="reading-empty"><div class="re-t">Matrix is empty</div>' +
        '<div class="re-d">Run an analysis to populate the strategy matrix. Families are shown with their assumed internal correlation, so you can see how much of the agreement is genuinely independent.</div></div>';
      return;
    }
    const cap = App.cap();
    let html = '<div class="rest-matrix">';
    r.families.forEach(f => {
      const dirCol = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
      const g = f.direction === 'BULLISH' ? '↑' : f.direction === 'BEARISH' ? '↓' : '○';
      const contribution = Math.abs(f.score) * f.weight;
      html += '<div class="rm-fam">' +
        '<div class="rm-fam-head">' +
          '<span class="rm-fam-l"><span class="rm-fam-k">' + f.label + '</span>' +
            '<span class="rm-corr' + (f.rho > 0.6 ? ' high' : '') + '">ρ ' + f.rho.toFixed(2) + '</span>' +
            '<span class="rm-corr">ind ' + f.independent.toFixed(1) + '/' + f.n + '</span></span>' +
          '<span class="rm-fam-r"><span class="rm-fam-v" style="color:' + dirCol + '">' + g + ' ' + f.score.toFixed(2) + '</span>' +
            '<span class="rm-contrib" title="contribution to final consensus"><i style="width:' + Math.min(100, contribution * 100) + '%;background:' + dirCol + '"></i></span></span>' +
        '</div>';
      r.strategies.filter(s => s.fam === f.key).forEach(s => {
        const unavail = s.availability && s.availability !== 'AVAILABLE';
        const cls = unavail ? 'b-flat' : s.verdict === 'BULLISH' ? 'b-bull' : s.verdict === 'BEARISH' ? 'b-bear' : 'b-flat';
        const word = unavail ? '— N/A'
          : s.verdict === 'BULLISH' ? '↑ BULLISH' : s.verdict === 'BEARISH' ? '↓ BEARISH'
          : (s.noSetup ? '○ NO SETUP' : '○ NEUTRAL');
        html += '<div class="rm-row ' + cls + '" data-sid="' + s.id + '">' +
          '<span class="d"></span><span class="n">' + s.name + '</span>' +
          '<span class="r">' + word + '</span>' +
          '<span class="s">' + (cap.strength ? s.strength.toFixed(2) : '••') + '</span>' +
          '<span class="c">▸</span></div>';
        html += '<div class="rm-detail" data-det="' + s.id + '">' +
          '<div class="rd-block"><div class="rd-k">Rule</div><div class="rd-v">' + s.rule + '</div></div>' +
          '<div class="rd-block"><div class="rd-k">Evidence</div><div class="rd-v' + (cap.evidence ? '' : ' masked-line') + '">' +
            s.evidence.map(e => cap.evidence
              ? '<span class="hi">' + e.k + '</span>  ' + e.v
              : e.k + '  ' + String(e.v).replace(/[0-9]/g, '•')).join('<br>') +
          '</div></div>' +
          (cap.evidence ? '' : '<div class="rd-v" style="color:var(--amber);cursor:pointer" data-upsell="evidence">🔒 Unlock the numbers behind every strategy →</div>') +
          '<div class="rd-block"><div class="rd-k">Family</div><div class="rd-v">' + f.label + ' · ρ ' + f.rho.toFixed(2) +
            ' · this family contributes ' + (f.weight / r.families.reduce((a, x) => a + x.weight, 0) * 100).toFixed(0) + '% of the final weighting</div></div>' +
          '<div class="rd-actions"><button class="rd-btn" data-show="' + s.id + '">Show on chart</button>' +
          (cap.math ? '<button class="rd-btn" data-act="math">Show the math</button>' : '') + '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="corr-note" style="margin:12px 14px 18px"><b>Reading this matrix</b><br>' +
      'ρ is the assumed correlation inside a family. The Trend family has ρ 0.82 — its five strategies are close to one opinion. ' +
      'The Structure family has ρ 0.45, so agreement there carries more weight. Final consensus is built from family results, not from a flat vote.</div>';
    pane.innerHTML = html;

    $$('#paneMatrix .rm-row').forEach(row => {
      const sid = row.dataset.sid;
      const s = r.strategies.find(x => x.id === sid);
      row.onclick = () => {
        const det = pane.querySelector('[data-det="' + sid + '"]');
        det.classList.toggle('open'); row.classList.toggle('open');
      };
      row.onmouseenter = () => { App.chart.anim.focus = s.uses.length ? s.uses : null; App.chart.render(); };
      row.onmouseleave = () => { App.chart.anim.focus = null; App.chart.render(); };
    });
    $$('#paneMatrix [data-show]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const s = r.strategies.find(x => x.id === b.dataset.show);
      App.chart.anim.focus = s.uses.length ? s.uses : null; App.chart.render();
      setTimeout(() => { App.chart.anim.focus = null; App.chart.render(); }, 2200);
    });
    $$('#paneMatrix [data-upsell]').forEach(b => b.onclick = e => { e.stopPropagation(); openUpsell(b.dataset.upsell); });
    $$('#paneMatrix [data-act="math"]').forEach(b => b.onclick = e => { e.stopPropagation(); openMath(r); });
  }

  /* ============================================================
     UPSELL / MATH
     ============================================================ */
  const UPSELL_COPY = {
    entry: { k: 'Entry point', t: 'The level is computed. It just is not shown yet.',
      d: 'The entry point is the confirmed support/resistance level the strategies clustered around, plus a 0.5 ATR band. It is derived from the same snapshot you just analysed — nothing extra is calculated when you upgrade, the mask simply comes off.' },
    quota: { k: 'Actionable allowance', t: 'You have used today\'s 5 actionable readings.',
      d: 'Free includes five actionable UP / DOWN readings per day, with the full nine-phase analysis, the duration and the entry timing. WAIT results never count against it, and re-running an unchanged market snapshot never counts twice. Trader raises the limit to 300 a day across all pairs and timeframes.' },
    evidence: { k: 'Strategy evidence', t: 'See the numbers behind all 16 verdicts.',
      d: 'Every strategy carries the exact values that produced its verdict: EMA separations in pips, RSI readings, level touch counts, ATR ratios. Free shows you what each strategy concluded. Trader shows you why.' },
    independent: { k: 'Independent voices', t: 'How much of that agreement is actually independent?',
      d: 'Five trend strategies agreeing is close to one opinion repeated five times. The engine discounts each family by its internal correlation and reports the effective number of independent voices. It is the honest version of the headline score.' },
    math: { k: 'Show the math', t: 'The raw reading, including the snapshot hash.',
      d: 'Open the complete computed object: every indicator value, every strategy result, the family resolution, the consensus arithmetic and the snapshot hash. Two people analysing the same closed candle get byte-identical output.' },
    pair: { k: 'Currency pair', t: 'This pair is on Trader and above.',
      d: 'Free covers the four majors. Trader adds crosses and the full monitor across all pairs, with agreement sparklines so you can see alignment building rather than just existing.' },
    timeframe: { k: 'Timeframe', t: 'Short timeframes are on Trader.',
      d: 'Free includes 5m, 15m and 1h. Trader adds 1m, 3m and 30m, plus the multi-timeframe matrix so you can see when your timeframe disagrees with the one above it.' },
    verdict: { k: 'Full analysis', t: 'You have the conclusion. Trader gives you the reasoning.',
      d: 'Everything you just watched stays free forever — the animation, the direction, the consensus score, all 16 verdicts. What Trader adds is the evidence, the entry level, the independence figure and your own analysis history with outcomes.' },
    lab: { k: 'Strategy Lab', t: 'Build your own consensus.', pro: true,
      d: 'Choose which strategies participate, weight them, set your own thresholds and consensus method, then see how your configuration would have read the market historically — including a warning when your set is dangerously trend-heavy.' }
  };

  function openUpsell(key, extra) {
    const c = UPSELL_COPY[key] || UPSELL_COPY.verdict;
    $('#upsellKicker').textContent = c.k;
    $('#upsellBody').innerHTML =
      '<h3>' + c.t + '</h3><p class="lead">' + c.d + '</p>' +
      planCard('trader', c.pro ? false : true) +
      planCard('pro', !!c.pro) +
      '<p style="font-size:10.5px;color:var(--t4);line-height:1.6;margin-top:14px">' +
      'No fake urgency, no countdown, no discount timer. Cancel in one click. ' +
      'Prices shown are the proposed structure from the product plan.</p>';
    $('#upsell').classList.add('on');
    $$('#upsellBody .plan-card').forEach(pc => pc.onclick = () => { setPlan(pc.dataset.plan); closeUpsell(); });
  }
  function closeUpsell() { $('#upsell').classList.remove('on'); }

  function planCard(plan, rec) {
    const feats = {
      trader: ['All 16 strategy evidence rows', 'Entry point, zone and window', 'Effective independent voices',
        'All 8 pairs · all 6 timeframes', '300 analyses/day · 90-day history with outcomes',
        'Multi-timeframe matrix · alerts · Show the math'],
      pro: ['Everything in Trader', 'Strategy Lab — pick and weight your own strategies',
        'Custom consensus method &amp; thresholds', 'Regime-conditional weighting',
        'Correlation heatmap and per-regime statistics', 'Unlimited history, export and read-only API']
    };
    return '<div class="plan-card ' + (plan === 'pro' ? 'pro' : '') + (rec ? ' rec' : '') + '" data-plan="' + plan + '">' +
      '<div class="pc-top"><span class="pc-name">' + PLANS[plan].label + '</span>' +
      '<span class="pc-price">' + PLANS[plan].price + '<small>/mo</small></span></div>' +
      '<ul class="pc-list">' + feats[plan].map(f => '<li>' + f + '</li>').join('') + '</ul></div>';
  }

  function openMath(r) {
    const j = {
      engine_version: r.engine_version, computed_at: r.computed_at, compute_ms: r.compute_ms,
      snapshot: r.snapshot, pair: r.pair, timeframe: r.timeframe, regime: r.regime,
      consensus: r.consensus, verdict: r.verdict, entry: r.entry,
      families: r.families,
      strategies: r.strategies.map(s => ({ id: s.id, fam: s.fam, verdict: s.verdict, strength: s.strength, evidence: s.evidence }))
    };
    $('#mathPre').textContent = JSON.stringify(j, null, 2);
    $('#mathOver').classList.add('on');
  }

  /* ============================================================
     OVERLAY VIEWS
     ============================================================ */
  function openView(name) {
    const cap = App.cap();
    if (name === 'terminal') { $('#viewOverlay').classList.remove('on'); return; }
    if (name === 'lab' && !cap.lab) return openUpsell('lab');
    const body = $('#voBody');
    $('#viewOverlay').classList.add('on');
    if (name === 'monitor') { $('#voTitle').textContent = 'Live Market Monitor'; $('#voSub').textContent = 'Exploratory — outside current scope'; renderMonitor(body); }
    if (name === 'history') { $('#voTitle').textContent = 'Analysis History'; $('#voSub').textContent = cap.history === Infinity ? 'Unlimited retention' : cap.history + '-day retention on ' + cap.label; renderHistory(body); }
    if (name === 'stats') { $('#voTitle').textContent = 'Strategy Statistics'; $('#voSub').textContent = 'Correlation between strategies · why the vote is discounted'; renderStats(body); }
    if (name === 'lab') { $('#voTitle').textContent = 'Strategy Lab'; $('#voSub').textContent = 'PRO · compose your own consensus'; renderLab(body); }
    if (name === 'alerts') { $('#voTitle').textContent = 'Alerts'; $('#voSub').textContent = cap.alerts + ' rules on ' + cap.label; renderAlerts(body); }
  }

  function renderMonitor(body) {
    const cap = App.cap();
    body.innerHTML =
      '<div class="scope-note">' +
        '<b>Outside the current product scope.</b> Automatic monitoring, signal discovery and alert ' +
        'delivery (push, email, messaging) are not part of MarketPulse today. The core workflow is ' +
        'user-initiated: select a pair, select a timeframe, press ANALYZE. This view is kept only as a ' +
        'design exploration, and the background pass it reads from also powers the watchlist badges ' +
        'and the family state strip.' +
      '</div>' +
      '<div class="mon-grid" id="monGrid"></div>';
    const grid = $('#monGrid');
    M.PAIRS.forEach((p, idx) => {
      const m = App.monitor[p.sym];
      const locked = idx >= cap.monitorPairs;
      const r = m.reading;
      const col = r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
      const card = el('div', 'mon-card' + (locked ? ' locked' : ''));
      card.innerHTML =
        '<div class="mon-top"><span class="mon-pair">' + p.sym + (locked ? ' 🔒' : '') + '</span>' +
        '<span class="mon-price mono">' + M.fmtPrice(m.feed.last().c, p.sym) + '</span></div>' +
        '<div class="mon-spark"><canvas></canvas></div>' +
        '<div class="mon-stat"><span class="mon-agr"><span class="n" style="color:' + col + '">' +
          (locked ? '••' : r.consensus.agreement) + '</span><span class="k">agreement ' +
          (r.verdict === 'UP' ? '↑' : r.verdict === 'DOWN' ? '↓' : '○') +
          '<br>' + r.consensus.familiesAgreeing + '/' + r.families.length + ' families</span></span>' +
        '<span style="text-align:right"><span class="k" style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--t4)">Regime</span><br>' +
        '<span class="mono" style="font-size:10.5px;color:var(--t2)">' + r.regime.label + '</span></span></div>' +
        '<div class="mon-ev"><span class="t">' + (cap.sparkline ? 'agreement, last ' + m.history.length + ' closes' : 'sparkline on Trader') + '</span></div>' +
        '<button class="mon-btn">' + (locked ? 'UPGRADE' : 'ANALYZE') + '</button>';
      card.onclick = () => { locked ? openUpsell('pair', p.sym) : (setPair(p.sym), openView('terminal'), $$('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'terminal'))); };
      grid.appendChild(card);
      const cv = card.querySelector('canvas');
      setTimeout(() => {
        if (cap.sparkline && !locked) global.MP.sparkline(cv, m.history.length > 1 ? m.history : [r.consensus.agreement, r.consensus.agreement], col, true);
        else global.MP.sparkline(cv, [1, 1], 'rgba(110,123,143,.25)', false);
      }, 20);
    });
  }

  function renderHistory(body) {
    const cap = App.cap();
    const rows = App.history.slice(0, 40).map(h => {
      const r = h.reading;
      const col = r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
      const g = r.verdict === 'UP' ? '↑' : r.verdict === 'DOWN' ? '↓' : '❚❚';
      const out = h.outcome;
      const outCells = cap.history > 7
        ? (out ? out.map(o => '<td class="m" style="color:' + (o === '↑' ? 'var(--bull)' : o === '↓' ? 'var(--bear)' : 'var(--t4)') + '">' + o + '</td>').join('')
               : '<td class="m masked">·</td><td class="m masked">·</td><td class="m masked">·</td>')
        : '<td class="masked">••</td><td class="masked">••</td><td class="masked">••</td>';
      return '<tr><td class="m">' + M.fmtClock(h.ts) + '</td><td>' + h.pair + '</td><td class="m">' + h.tf + '</td>' +
        '<td class="m" style="color:' + col + '">' + g + ' ' + r.verdict + '</td>' +
        '<td class="m">' + r.consensus.agreement + '</td>' +
        '<td class="m">' + (cap.independent ? r.consensus.independent : '<span class="masked">•.•</span>') + '</td>' +
        '<td class="m" style="font-size:10px">' + r.regime.label + '</td>' + outCells + '</tr>';
    }).join('');
    body.innerHTML =
      '<table class="dtable"><thead><tr>' +
      '<th>Time UTC</th><th>Pair</th><th>TF</th><th>Verdict</th><th>Agr</th><th>Ind</th><th>Regime</th>' +
      '<th>+1</th><th>+3</th><th>+5</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10" style="color:var(--t4);padding:20px">No readings yet — run an analysis.</td></tr>') +
      '</tbody></table>' +
      '<div class="corr-note" style="margin-top:16px">' +
      (cap.history > 7
        ? '<b>Outcome columns</b><br>Filled in automatically once the relevant candles close: did price close higher or lower 1, 3 and 5 candles after the reading. Factual only — no P&amp;L, no win rate, no interpretation.'
        : '<b>🔒 Outcome tracking is on Trader</b><br>Your own past readings, labelled with what actually happened next. This is the most persuasive data about the product, and it is your data. <span style="color:var(--amber);cursor:pointer" data-upsell="verdict">See Trader →</span>') +
      '</div>';
    $$('#voBody [data-upsell]').forEach(b => b.onclick = () => openUpsell(b.dataset.upsell));
  }

  function renderStats(body) {
    const ids = Eng.STRATEGIES.map(s => s.id);
    const names = Eng.STRATEGIES.map(s => s.name);
    const fams = Eng.STRATEGIES.map(s => s.fam);
    // correlation proxy: same family -> family rho; cross-family -> low
    let html = '<div style="display:grid;grid-template-columns:150px 1fr;gap:2px;max-width:760px">';
    html += '<div></div><div class="heat" style="grid-template-columns:repeat(' + ids.length + ',1fr)">';
    for (let c = 0; c < ids.length; c++) html += '<div class="heat-lab" style="writing-mode:vertical-rl;font-size:7.5px;height:64px;align-items:flex-end">' + names[c] + '</div>';
    html += '</div>';
    for (let r0 = 0; r0 < ids.length; r0++) {
      html += '<div class="heat-lab" style="justify-content:flex-end;padding-right:6px">' + names[r0] + '</div>';
      html += '<div class="heat" style="grid-template-columns:repeat(' + ids.length + ',1fr)">';
      for (let c = 0; c < ids.length; c++) {
        let v;
        if (r0 === c) v = 1;
        else if (fams[r0] === fams[c]) v = Eng.FAMILIES[fams[r0]].rho;
        else v = 0.12 + ((r0 * 7 + c * 3) % 5) * 0.03;
        const a = 0.06 + v * 0.55;
        const col = v > 0.6 ? '255,176,32' : v > 0.35 ? '61,125,255' : '110,123,143';
        html += '<div class="heat-cell" style="background:rgba(' + col + ',' + a + ')">' + (v >= 0.35 ? v.toFixed(2).slice(1) : '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="corr-note" style="margin-top:18px;max-width:760px"><b>How to read this</b><br>' +
      'Amber blocks are strategies that measure nearly the same thing. Five of them agreeing is not five confirmations. ' +
      'The engine collapses each of those blocks into a single family voice before computing the final consensus — that is the entire argument for family-weighted consensus, in one picture.</div>';
    if (App.plan !== 'pro') {
      html += '<div class="corr-note" style="margin-top:10px;max-width:760px;border-color:rgba(255,176,32,.3);background:rgba(255,176,32,.05)">' +
        '<b style="color:var(--amber)">🔒 PRO adds regime-conditional statistics</b><br>' +
        'Per-strategy behaviour split by TRENDING / RANGING and by volatility bucket. Most strategies are useful in one regime and noise in another, and PRO lets you weight them accordingly. ' +
        '<span style="color:var(--amber);cursor:pointer" data-upsell="lab">See Pro →</span></div>';
    }
    body.innerHTML = html;
    $$('#voBody [data-upsell]').forEach(b => b.onclick = () => openUpsell(b.dataset.upsell));
  }

  function renderLab(body) {
    const r = App.reading || App.monitor[App.pair].reading;
    const state = App.labState || (App.labState = {
      enabled: Eng.STRATEGIES.map(s => s.id),
      weights: Eng.STRATEGIES.reduce((o, s) => (o[s.id] = 1, o), {})
    });
    let left = '';
    Eng.FAM_ORDER.forEach(k => {
      left += '<div class="lab-fam"><div class="lab-fam-h">' + Eng.FAMILIES[k].label + ' · ρ ' + Eng.FAMILIES[k].rho.toFixed(2) + '</div>';
      Eng.STRATEGIES.filter(s => s.fam === k).forEach(s => {
        const on = state.enabled.indexOf(s.id) >= 0;
        left += '<div class="lab-item"><span class="lab-check' + (on ? ' on' : '') + '" data-tog="' + s.id + '">' + (on ? '✓' : '') + '</span>' +
          '<span style="color:' + (on ? 'var(--t1)' : 'var(--t4)') + '">' + s.name + '</span>' +
          '<span class="lab-w"><input type="range" min="0" max="20" value="' + Math.round(state.weights[s.id] * 10) + '" data-w="' + s.id + '">' +
          '<span class="wv">' + state.weights[s.id].toFixed(1) + '</span></span></div>';
      });
      left += '</div>';
    });

    body.innerHTML =
      '<div class="lab-grid">' +
        '<div class="lab-col" style="overflow-y:auto">' +
          '<div class="lbl" style="margin-bottom:8px">Strategy set — "My ' + App.pair + ' ' + App.tf + '"</div>' + left +
        '</div>' +
        '<div class="lab-col" id="labRight"></div>' +
      '</div>';

    function refresh() {
      const p = M.pairInfo(App.pair);
      const custom = Eng.analyze(App.feed.candles, {
        pair: App.pair, pip: p.pip, digits: p.digits, tfLabel: App.tf, htfLabel: htfLabel(App.tf),
        enabled: state.enabled, weights: state.weights
      });
      const base = App.reading || App.monitor[App.pair].reading;
      // family balance of the user's set
      const totalW = state.enabled.reduce((a, id) => a + state.weights[id], 0) || 1;
      const balance = Eng.FAM_ORDER.map(k => {
        const w = Eng.STRATEGIES.filter(s => s.fam === k && state.enabled.indexOf(s.id) >= 0)
          .reduce((a, s) => a + state.weights[s.id], 0);
        return { k, label: Eng.FAMILIES[k].label, pct: w / totalW };
      });
      const dominant = balance.slice().sort((a, b) => b.pct - a.pct)[0];
      const col = v => v === 'UP' ? 'var(--bull)' : v === 'DOWN' ? 'var(--bear)' : 'var(--amber)';

      $('#labRight').innerHTML =
        '<div class="lbl" style="margin-bottom:8px">Live preview · ' + App.pair + ' ' + App.tf + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div style="border:1px solid rgba(61,125,255,.3);border-radius:5px;padding:10px;background:rgba(61,125,255,.04)">' +
            '<div class="lbl">Your set</div><div class="mono" style="font-size:20px;font-weight:700;color:' + col(custom.verdict) + '">' +
            custom.verdict + ' ' + custom.consensus.agreement + '</div>' +
            '<div class="mono" style="font-size:10px;color:var(--t3)">independent ' + custom.consensus.independent + ' · ' + custom.consensus.quality + '</div></div>' +
          '<div style="border:1px solid var(--line-2);border-radius:5px;padding:10px">' +
            '<div class="lbl">Default set</div><div class="mono" style="font-size:20px;font-weight:700;color:' + col(base.verdict) + '">' +
            base.verdict + ' ' + base.consensus.agreement + '</div>' +
            '<div class="mono" style="font-size:10px;color:var(--t3)">independent ' + base.consensus.independent + ' · ' + base.consensus.quality + '</div></div>' +
        '</div>' +
        '<div class="lbl" style="margin-bottom:6px">Family balance</div>' +
        balance.map(b => '<div class="balance-row"><span style="color:var(--t2)">' + b.label + '</span>' +
          '<span class="balance-track"><i class="balance-fill" style="width:' + (b.pct * 100) + '%;background:' +
          (b.pct > 0.5 ? 'var(--amber)' : 'var(--blue)') + '"></i></span>' +
          '<span class="mono" style="color:var(--t3);font-size:10px">' + (b.pct * 100).toFixed(0) + '%</span></div>').join('') +
        '<div style="height:14px"></div>' +
        (dominant.pct > 0.45
          ? '<div class="warn-box"><b>⚠ Your set is ' + (dominant.pct * 100).toFixed(0) + '% weighted to the ' + dominant.label.toLowerCase() + ' family.</b><br>' +
            'Effective independence drops to ' + custom.consensus.independent + ' (default ' + base.consensus.independent + '). ' +
            'A set concentrated in one family will produce more confident-looking readings that are supported by fewer genuinely independent measurements.</div>'
          : '<div class="corr-note"><b>Balanced set.</b><br>No single family exceeds 45% of the weighting. Cross-family agreement in this configuration is meaningful rather than repeated.</div>') +
        '<div style="height:14px"></div>' +
        '<div class="lbl" style="margin-bottom:6px">Consensus method</div>' +
        '<div style="display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--t2)">' +
          '<label><input type="radio" name="cm" disabled> Simple majority</label>' +
          '<label><input type="radio" name="cm" checked> Family-weighted <span style="color:var(--t4)">(current)</span></label>' +
          '<label><input type="radio" name="cm" disabled> Correlation-adjusted</label>' +
          '<label><input type="radio" name="cm" disabled> Regime-conditional</label>' +
        '</div>' +
        '<div style="height:12px"></div>' +
        '<div class="corr-note">Historical behaviour, thresholds and set publishing are specified in the product plan; this preview demonstrates the live-comparison interaction and the family-balance guard.</div>';
    }

    $$('#voBody [data-tog]').forEach(c => c.onclick = () => {
      const id = c.dataset.tog;
      const i = state.enabled.indexOf(id);
      if (i >= 0) state.enabled.splice(i, 1); else state.enabled.push(id);
      renderLab(body);
    });
    $$('#voBody [data-w]').forEach(sl => sl.oninput = () => {
      state.weights[sl.dataset.w] = sl.value / 10;
      sl.parentNode.querySelector('.wv').textContent = (sl.value / 10).toFixed(1);
      refresh();
    });
    refresh();
  }

  function renderAlerts(body) {
    const cap = App.cap();
    body.innerHTML =
      '<div style="max-width:640px">' +
      (cap.alerts === 0
        ? '<div class="corr-note" style="border-color:rgba(255,176,32,.3);background:rgba(255,176,32,.05)"><b style="color:var(--amber)">🔒 Alerts are on Trader</b><br>' +
          'Alerts fire only on genuine state transitions computed by the engine — agreement crossing a threshold, family alignment increasing, a regime change, a structure break. Never on a state, which would be spammable. Hard cap: 1 per pair per 30 minutes.</div>'
        : '<table class="dtable"><thead><tr><th>Rule</th><th>Pair</th><th>Condition</th><th>Channel</th><th>Status</th></tr></thead><tbody>' +
          '<tr><td>Cross-family alignment</td><td>EUR/USD</td><td class="m">families agreeing ≥ 4</td><td>Push</td><td class="up">Active</td></tr>' +
          '<tr><td>Agreement threshold</td><td>GBP/USD</td><td class="m">agreement crosses 70 ↑</td><td>Email</td><td class="up">Active</td></tr>' +
          '<tr><td>Regime change</td><td>USD/JPY</td><td class="m">RANGING → TRENDING</td><td>Push</td><td class="up">Active</td></tr>' +
          '<tr><td>Structure break</td><td>AUD/USD</td><td class="m">new LL confirmed</td><td>Push</td><td class="flat">Paused</td></tr>' +
          '</tbody></table>' +
          '<div class="corr-note" style="margin-top:14px"><b>Transitions only.</b> Every rule above describes a change of state, not a state. ' + cap.alerts + ' rules available on ' + cap.label + '.</div>') +
      '</div>';
  }

  /* ============================================================
     PLAN
     ============================================================ */
  function setPlan(p) {
    App.plan = p;
    App.quotaUsed = Math.min(App.quotaUsed, PLANS[p].quota);
    applyPlan();
    if (App.reading) { renderReadingPane(App.reading); renderRestMatrix(App.reading); buildVerdictCard(App.reading); }
    $$('#planSwitch .vs-btn').forEach(b => b.classList.toggle('active', b.dataset.plan === p));
  }

  function applyPlan() {
    const cap = App.cap();
    $('#app').dataset.plan = App.plan;
    $('#planBadge').dataset.plan = App.plan;
    $('#planBadge').textContent = cap.label;
    if ($('#mPlan')) $('#mPlan').textContent = cap.label;
    $('#labLock').style.display = cap.lab ? 'none' : 'block';
    buildTimeframes(); buildWatchlist(); updateQuota();
    // free: fewer indicator subpanels
    $('#subpanels').style.display = 'flex';
    $$('#drawTools .dt-btn').forEach((b, i) => {
      const gated = cap.drawings === 3 && i > 2 && i < 10;
      b.classList.toggle('locked', gated && App.plan === 'free' && i > 4);
    });
    if (App.tf && cap.tfs.indexOf(App.tf) < 0) setTimeframe(cap.tfs[0]);
    if (M.pairInfo(App.pair) && !M.pairInfo(App.pair).free && cap.pairs < 8) setPair('EUR/USD');
  }

  function updateQuota() {
    const cap = App.cap();
    const left = cap.quota === Infinity ? Infinity : cap.quota - App.quotaUsed;
    $('#quotaVal').textContent = cap.quota === Infinity ? 'UNLIMITED' : left + ' / ' + cap.quota;
    const lbl = document.getElementById('quotaLbl');
    if (lbl) lbl.textContent = cap.quota === Infinity ? '' : 'actionable';
    $('#quotaChip').classList.toggle('spent', left === 0);
  }

  /* ============================================================
     HISTORY SEED (from real background readings)
     ============================================================ */
  function seedHistory() {
    const now = Date.now();
    M.PAIRS.slice(0, 5).forEach((p, i) => {
      const m = App.monitor[p.sym];
      if (!m.reading) return;
      const dirs = ['↑', '↓', '·'];
      App.history.push({
        ts: new Date(now - (i + 1) * 1000 * 60 * 17),
        pair: p.sym, tf: '5m', reading: m.reading,
        outcome: [dirs[(i * 3) % 3], dirs[(i * 5 + 1) % 3], dirs[(i * 7 + 2) % 3]]
      });
    });
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bindEvents() {
    $('#btnAnalyze').onclick = () => runAnalysis(preferredSpeed());
    $('#btnSpeed').onclick = e => { e.stopPropagation(); $('#speedMenu').classList.toggle('on'); };
    $$('#speedMenu .speed-item').forEach(b => b.onclick = () => {
      $('#speedMenu').classList.remove('on');
      if (b.dataset.speed === 'replay') return replay();
      runAnalysis(b.dataset.speed);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#analyzeDock')) $('#speedMenu').classList.remove('on');
    });

    $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.pane));
    $$('.rail-btn').forEach(b => b.onclick = () => {
      const v = b.dataset.view;
      if (v === 'lab' && !App.cap().lab) return openUpsell('lab');
      $$('.rail-btn').forEach(x => x.classList.toggle('active', x === b));
      openView(v);
    });
    $('#voClose').onclick = () => {
      $('#viewOverlay').classList.remove('on');
      $$('.rail-btn').forEach(x => x.classList.toggle('active', x.dataset.view === 'terminal'));
    };
    $('#upsellClose').onclick = closeUpsell;
    $('#mathClose').onclick = () => $('#mathOver').classList.remove('on');
    $('#accountBtn').onclick = () => openUpsell('verdict');
    $('#quotaChip').onclick = () => openUpsell('quota');
    $('#btnOverlays').onclick = function () {
      App.chart.showSystem = !App.chart.showSystem;
      this.classList.toggle('active', App.chart.showSystem);
      App.chart.render();
    };
    $('#btnIndicators').onclick = () => {
      $('#subpanels').style.display = $('#subpanels').style.display === 'none' ? 'flex' : 'none';
      setTimeout(() => { App.chart.resize(); App.sub.rsi.resize(); App.sub.macd.resize(); renderSub(); }, 30);
    };
    $$('#drawTools .dt-btn[data-tool]').forEach(b => b.onclick = function () {
      if (this.classList.contains('locked')) return openUpsell('verdict');
      if (['overlays', 'indicators'].indexOf(this.dataset.tool) >= 0) return;
      $$('#drawTools .dt-btn[data-tool]').forEach(x => x.classList.remove('active'));
      this.classList.add('active');
    });
    $$('#activityFilters .afilter').forEach(b => b.onclick = () => {
      feedFilter = b.dataset.f;
      $$('#activityFilters .afilter').forEach(x => x.classList.toggle('active', x === b));
      renderFeed();
    });
    $('#pairSelect').onclick = openPalette;

    $$('#planSwitch .vs-btn').forEach(b => b.onclick = () => setPlan(b.dataset.plan));

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') closePalette();
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); runAnalysis(e.shiftKey ? 'full' : 'express'); }
      else if (e.key === 'r' || e.key === 'R') replay();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      else if (e.key === 'Escape') {
        closePalette(); closeUpsell();
        $('#mathOver').classList.remove('on');
        if (App.running && !App.settled && $('#app').dataset.mode === 'analysis'
            && !$('#app').classList.contains('reading-hold')) {
          // abort mid-animation: land on the finished result, then hold it
          App.running.finishAll();
          finishAnalysis(App.reading);
        } else if (!App.settled) {
          settleReading(App.reading);          // skip the readable hold
        }
      }
      else if (e.key === 'o' || e.key === 'O') $('#btnOverlays').click();
      else if (/^[1-6]$/.test(e.key)) {
        const t = M.TIMEFRAMES[+e.key - 1];
        if (App.cap().tfs.indexOf(t.id) < 0) openUpsell('timeframe', t.id); else setTimeframe(t.id);
      }
    });
  }

  function preferredSpeed() {
    // Full for the first run of a session or after 10 min idle; Express for repeats.
    if (!App.reading) return 'full';
    if (Date.now() - App.lastAnalysisAt > 10 * 60 * 1000) return 'full';
    return 'express';
  }

  function replay() {
    if (!App.reading || App.running) return;
    buildPhaseRail(App.reading);
    const built = buildMatrixRail(App.reading);
    buildVerdictCard(App.reading);
    resetAnalysisChrome();
    App.running = P.runDesktop(Object.assign(presentationEnv(App.reading, built), {
      speed: 'full',
      onDone: () => finishAnalysis(App.reading)
    }));
  }

  function switchTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.pane === name));
    $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane' + name[0].toUpperCase() + name.slice(1)));
    const t = $('.tab[data-pane="' + name + '"]');
    const u = $('#tabUnderline');
    u.style.width = t.offsetWidth + 'px';
    u.style.transform = 'translateX(' + t.offsetLeft + 'px)';
  }

  /* ---------- command palette ---------- */
  function openPalette() {
    $('#cmdk').classList.add('on');
    $('#cmdkInput').value = '';
    renderPalette('');
    setTimeout(() => $('#cmdkInput').focus(), 10);
  }
  function closePalette() { $('#cmdk').classList.remove('on'); }
  function renderPalette(qs) {
    const cap = App.cap();
    const list = $('#cmdkList');
    const t = qs.toLowerCase();
    let html = '<div class="cmdk-group">Pairs</div>';
    M.PAIRS.filter(p => p.sym.toLowerCase().includes(t)).forEach(p => {
      const locked = !p.free && cap.pairs < 8;
      const m = App.monitor[p.sym];
      html += '<div class="cmdk-item" data-pair="' + p.sym + '">' +
        '<span>' + p.sym + '</span>' +
        '<span class="mono" style="color:var(--t3);font-size:11px">' + M.fmtPrice(m.feed.last().c, p.sym) + '</span>' +
        '<span class="k">' + (locked ? '🔒 Trader' : (m.reading ? m.reading.consensus.agreement + ' ' + m.reading.verdict : '')) + '</span></div>';
    });
    html += '<div class="cmdk-group">Timeframes</div>';
    M.TIMEFRAMES.filter(x => x.id.includes(t)).forEach(x => {
      const locked = cap.tfs.indexOf(x.id) < 0;
      html += '<div class="cmdk-item" data-tf="' + x.id + '"><span>' + x.id.toUpperCase() + '</span><span class="k">' + (locked ? '🔒 Trader' : 'switch') + '</span></div>';
    });
    html += '<div class="cmdk-group">Commands</div>' +
      '<div class="cmdk-item" data-cmd="full"><span>Run full analysis</span><span class="k">⇧Space</span></div>' +
      '<div class="cmdk-item" data-cmd="express"><span>Run express analysis</span><span class="k">Space</span></div>' +
      '<div class="cmdk-item" data-cmd="monitor"><span>Open Live Market Monitor</span><span class="k"></span></div>' +
      '<div class="cmdk-item" data-cmd="stats"><span>Open strategy correlation heatmap</span><span class="k"></span></div>';
    list.innerHTML = html;
    $$('#cmdkList [data-pair]').forEach(i => i.onclick = () => {
      const p = M.pairInfo(i.dataset.pair);
      if (!p.free && cap.pairs < 8) { closePalette(); return openUpsell('pair'); }
      setPair(i.dataset.pair); closePalette();
    });
    $$('#cmdkList [data-tf]').forEach(i => i.onclick = () => {
      if (cap.tfs.indexOf(i.dataset.tf) < 0) { closePalette(); return openUpsell('timeframe'); }
      setTimeframe(i.dataset.tf); closePalette();
    });
    $$('#cmdkList [data-cmd]').forEach(i => i.onclick = () => {
      const c = i.dataset.cmd; closePalette();
      if (c === 'full' || c === 'express') runAnalysis(c);
      else { $$('.rail-btn').forEach(x => x.classList.toggle('active', x.dataset.view === c)); openView(c); }
    });
  }
  document.addEventListener('input', e => { if (e.target.id === 'cmdkInput') renderPalette(e.target.value); });
  document.addEventListener('click', e => { if (e.target.id === 'cmdk') closePalette(); });

  global.MP = global.MP || {};
  global.MP.App = App;
  /* helpers the mobile view reuses so allowance behaviour is identical there */
  function chargeReading(reading, key) {
    const cap = App.cap();
    const actionable = reading.verdict !== 'WAIT';
    const already = !!App.seenKeys[key];
    App.seenKeys[key] = true;
    const remaining = cap.quota === Infinity ? Infinity : cap.quota - App.quotaUsed;
    if (actionable && !already) {
      if (remaining > 0) { App.quotaUsed++; reading._entryGranted = true; }
      else reading._entryGranted = false;
    } else if (actionable && reading._entryGranted == null) {
      reading._entryGranted = remaining > 0;
    }
    reading._cached = already;
    updateQuota();
    return reading;
  }

  global.MP.UI = { init, setPlan, setPair, runAnalysis, openView, PLANS, getReading, chargeReading, renderSub };
})(window);
