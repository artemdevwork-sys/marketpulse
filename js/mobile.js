/* ============================================================
   MarketPulse — MOBILE TERMINAL (prototype)
   ------------------------------------------------------------
   Deliberately NOT the desktop terminal at 390px.
   Mobile's job: consumption, monitoring, and the share loop.
   ============================================================ */
(function (global) {
  'use strict';
  const M = global.MP.Market, Eng = global.MP.Engine, P = global.MP.Presentation;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  const Mob = { chart: null, aChart: null, pair: 'EUR/USD', running: null, reading: null, view: 'pulse' };

  const NOTES = [
    ['Different hierarchy, not a shrunken terminal',
      'Mobile leads with a <b>swipeable pair feed</b> — the format phone users already understand. Charting, drawing and the Strategy Lab stay on desktop, where they are actually usable.'],
    ['The analysis is portrait-native',
      'Chart on top, strategy rows streaming upward like a terminal log, consensus and verdict at thumb height. 9:16 is the native format of every short-video platform, so the mobile sequence <b>is</b> the advertisement.'],
    ['Capped at 5.5 seconds',
      'Shorter than desktop for attention, battery and thermals. Express remains one tap away, and the ticker throttles to 1 update/second on cellular.'],
    ['Share is the most frictionless action',
      'After the verdict, one tap produces a 1080×1920 card of the reading — chart, matrix, score, watermark, short link. Every share is distribution you did not pay for.'],
    ['Notifications are rationed',
      'Alignment alerts and session opens only. Maximum three per day, hard cap. One spammy push loses the user permanently.']
  ];

  function init() {
    Mob.chart = new global.MP.Chart($('#mChartCanvas'), $('#mChartOverlay'), { padR: 46, padB: 18, minimal: false });
    Mob.aChart = new global.MP.Chart($('#maCanvas'), $('#maOverlay'), { padR: 40, padB: 4, padT: 4, minimal: true });
    $('#phoneNotes').innerHTML = NOTES.map(n =>
      '<div class="pn-item"><div class="pn-k">' + n[0] + '</div><div class="pn-v">' + n[1] + '</div></div>').join('');

    $$('#mTabs .m-tab').forEach(b => b.onclick = () => setView(b.dataset.mv));
    renderPulse(); renderMonitor(); renderYou();
    setInterval(() => { if ($('#stageMobile').classList.contains('on')) refresh(); }, 900);
  }

  function resize() {
    if (!Mob.chart) return;
    Mob.chart.resize(); Mob.aChart.resize();
  }

  function setView(v) {
    Mob.view = v;
    $$('#mTabs .m-tab').forEach(b => b.classList.toggle('active', b.dataset.mv === v));
    ['pulse', 'chart', 'monitor', 'you'].forEach(k =>
      $('#mView' + k[0].toUpperCase() + k.slice(1)).classList.toggle('on', k === v));
    if (v === 'chart') {
      const A = global.MP.App;
      const m = A.monitor[Mob.pair];
      Mob.chart.setData(m.feed.candles, Mob.pair);
      $('#mcPair').textContent = Mob.pair;
      setTimeout(() => { Mob.chart.resize(); Mob.chart.render(); }, 30);
    }
  }

  function refresh() {
    const A = global.MP.App;
    $$('#mViewPulse .m-card').forEach(card => {
      const sym = card.dataset.sym;
      const m = A.monitor[sym];
      card.querySelector('[data-p]').textContent = M.fmtPrice(m.feed.last().c, sym);
    });
    if (Mob.view === 'chart') {
      const m = A.monitor[Mob.pair];
      Mob.chart.setData(m.feed.candles, Mob.pair);
      $('#mcPrice').textContent = M.fmtPrice(m.feed.last().c, Mob.pair);
    }
  }

  function renderPulse() {
    const A = global.MP.App;
    const cap = global.MP.UI.PLANS[A.plan];
    const host = $('#mViewPulse'); host.innerHTML = '';
    M.PAIRS.slice(0, 4).forEach(p => {
      const m = A.monitor[p.sym];
      const r = m.reading;
      const col = r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
      const card = el('div', 'm-card');
      card.dataset.sym = p.sym;
      card.innerHTML =
        '<div class="m-card-head"><span><span class="m-pair">' + p.sym + '</span><span class="m-tf">5M</span></span>' +
        '<span><span class="m-price" data-p>' + M.fmtPrice(m.feed.last().c, p.sym) + '</span></span></div>' +
        '<div class="m-chart"><canvas></canvas><canvas></canvas></div>' +
        '<div class="m-agr">' +
          '<div><div class="m-agr-n" style="color:' + col + '">' + r.consensus.agreement + '</div>' +
          '<div class="m-agr-k">' + r.verdict + '</div></div>' +
          '<div class="m-fams">' + r.families.map(f => {
            const c2 = f.direction === 'BULLISH' ? 'var(--bull)' : f.direction === 'BEARISH' ? 'var(--bear)' : 'var(--gray)';
            return '<div class="m-fam"><span class="k">' + f.label + '</span>' +
              '<span class="t"><i style="width:' + Math.min(100, Math.abs(f.score) * 100) + '%;background:' + c2 + '"></i></span>' +
              '<span class="v">' + (f.direction === 'BULLISH' ? '↑' : f.direction === 'BEARISH' ? '↓' : '○') + '</span></div>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="m-actions"><button class="m-btn" data-an="' + p.sym + '">▶ ANALYZE</button>' +
        '<button class="m-btn ghost">☆</button></div>';
      host.appendChild(card);

      const cvs = card.querySelectorAll('canvas');
      const ch = new global.MP.Chart(cvs[0], cvs[1], { padR: 40, padB: 14, padT: 6, minimal: true });
      ch.view.count = 70;
      ch.setData(m.feed.candles, p.sym);
      setTimeout(() => { ch.resize(); ch.render(); }, 40);
    });
    host.appendChild(el('div', 'm-hint', 'Swipe for more pairs · ' + (cap.quota === Infinity ? 'unlimited' : cap.quota - A.quotaUsed + ' of ' + cap.quota) + ' actionable readings left today · WAIT is free'));
    $$('#mViewPulse [data-an]').forEach(b => b.onclick = () => runMobileAnalysis(b.dataset.an, 'full'));
  }

  function renderMonitor() {
    const A = global.MP.App;
    const host = $('#mViewMonitor'); host.innerHTML = '';
    host.appendChild(el('div', 'panel-head', '<span class="lbl">Live monitor</span><span class="act">All pairs</span>'));
    M.PAIRS.forEach(p => {
      const m = A.monitor[p.sym], r = m.reading;
      const col = r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
      const row = el('div', 'm-mon-row');
      row.innerHTML =
        '<div class="m-mon-l"><div class="p">' + p.sym + '</div><div class="e">' + r.regime.label + ' · ' +
        r.consensus.familiesAgreeing + '/' + r.families.length + ' families</div></div>' +
        '<canvas class="m-mon-spark"></canvas>' +
        '<div class="m-mon-b" style="color:' + col + '">' + r.consensus.agreement + '</div>';
      host.appendChild(row);
      setTimeout(() => global.MP.sparkline(row.querySelector('canvas'),
        m.history.length > 1 ? m.history : [r.consensus.agreement, r.consensus.agreement], col, true), 40);
    });
    host.appendChild(el('div', 'm-hint', 'Alignment alerts and session opens only · max 3 push/day'));
  }

  function renderYou() {
    const A = global.MP.App;
    const host = $('#mViewYou');
    host.innerHTML =
      '<div class="panel-head"><span class="lbl">Account</span></div>' +
      '<div style="padding:14px 16px;display:flex;align-items:center;gap:12px">' +
        '<span class="avatar" style="width:40px;height:40px;font-size:14px">A</span>' +
        '<div><div style="font-size:14px;font-weight:600">artemdev</div>' +
        '<div class="mono" style="font-size:11px;color:var(--t3)" id="mPlanLine">Free plan</div></div></div>' +
      '<div class="panel-head"><span class="lbl">Recent readings</span></div>' +
      '<div id="mHistory"></div>' +
      '<div class="panel-head"><span class="lbl">Calibration</span></div>' +
      '<div style="padding:12px 16px" class="corr-note">' +
        '<b>We publish what happened next.</b><br>Including when the reading was wrong. Descriptive statistics only — no win rate, no profit claim.</div>';
    const h = $('#mHistory');
    global.MP.App.history.slice(0, 5).forEach(x => {
      const r = x.reading;
      const col = r.verdict === 'UP' ? 'var(--bull)' : r.verdict === 'DOWN' ? 'var(--bear)' : 'var(--amber)';
      h.appendChild(el('div', 'm-mon-row',
        '<div class="m-mon-l"><div class="p">' + x.pair + ' <span class="mono" style="font-size:10px;color:var(--t4)">' + x.tf + '</span></div>' +
        '<div class="e mono">' + M.fmtClock(x.ts) + ' · ' + r.regime.trend + '</div></div>' +
        '<div class="mono" style="font-size:11px;color:var(--t4)">' + (x.outcome ? x.outcome.join(' ') : '· · ·') + '</div>' +
        '<div class="m-mon-b" style="color:' + col + '">' + r.consensus.agreement + '</div>'));
    });
  }

  /* ---------- mobile analysis ---------- */
  function runMobileAnalysis(sym, speed) {
    if (Mob.running) return;
    const A = global.MP.App;
    const m = A.monitor[sym];
    const p = M.pairInfo(sym);
    const got = global.MP.UI.getReading(sym, '5m', m.feed.candles,
      { pair: sym, pip: p.pip, digits: p.digits, tfLabel: '5m', htfLabel: '15m', tfMin: 5 });
    const reading = global.MP.UI.chargeReading(got.reading, got.key);
    Mob.reading = reading; Mob.pair = sym;

    $('#maPair').textContent = sym + ' · 5M';
    $('#maSnap').textContent = 'SNAPSHOT ' + M.fmtTime(reading.snapshot.last_closed) + ' UTC · ' + reading.snapshot.candles + ' CANDLES';
    Mob.aChart.setData(m.feed.candles, sym);
    Mob.aChart.view.count = 60;
    Mob.aChart.reading = reading;
    setTimeout(() => Mob.aChart.resize(), 10);

    const host = $('#maMatrix'); host.innerHTML = '';
    const rows = [];
    reading.strategies.forEach(s => {
      const r = el('div', 'm-a-row',
        '<span class="d"></span><span class="n">' + s.name.toUpperCase() + '</span><span class="r">···</span>');
      host.appendChild(r); rows.push({ el: r, strategy: s });
    });

    $('#maIndep').textContent = reading.consensus.counts.total + ' STRATEGIES · ' + reading.consensus.independent + ' INDEPENDENT';
    $('#maConsensus').classList.remove('on');
    $('#maConsensus').querySelector('.m-a-score').textContent = '0';
    const v = $('#maVerdict'); v.classList.remove('on');
    const cap = global.MP.UI.PLANS[A.plan];
    const isWait = reading.verdict === 'WAIT';
    const col = isWait ? 'var(--amber)' : reading.verdict === 'UP' ? 'var(--bull)' : 'var(--bear)';
    const e = reading.entry;
    v.innerHTML =
      '<div class="g" style="color:' + col + '">' + (isWait ? '❚❚' : reading.verdict === 'UP' ? '↑' : '↓') + '</div>' +
      '<div class="w" style="color:' + col + '">' + reading.verdict + '</div>' +
      (isWait
        ? '<div class="n">No high-quality setup</div>' +
          '<div class="mono" style="font-size:10.5px;color:var(--bull);margin-top:8px">' +
          '✓ WAIT results don\'t use your allowance</div>'
        : '<div class="m-hero-facts">' +
            '<span><i>Duration</i><b>' + e.durationMin + ' MIN</b></span>' +
            '<span><i>Enter at</i><b>' + M.fmtTime(e.time) + '</b></span>' +
          '</div>' +
          '<div class="mono" style="font-size:10.5px;color:var(--t3);margin-top:8px">' +
            'ENTRY ' + M.fmtPrice(e.price, sym) + ' · WINDOW ' +
            M.fmtClock(new Date(e.windowStart)).slice(0, 8) + ' – ' +
            M.fmtClock(new Date(e.windowEnd)).slice(0, 8) + '</div>') +
      '<div class="n" style="font-size:12px;margin-top:8px">Strategy consensus ' +
        reading.consensus.agreement + ' / 100</div>' +
      '<button class="share">Share this reading</button>';
    v.querySelector('.share').onclick = () => closeMobileAnalysis();

    Mob.running = P.runMobile({
      el: $('#mAnalysis'), chart: Mob.aChart, reading, rows, speed,
      consEl: $('#maConsensus'), verdictEl: v,
      onDone: () => { Mob.running = null; }
    });
    $('#mAnalysis').onclick = e => { if (e.target === $('#mAnalysis')) closeMobileAnalysis(); };
  }

  function closeMobileAnalysis() {
    $('#mAnalysis').classList.remove('on');
    if (Mob.running) { Mob.running.finishAll(); Mob.running = null; }
    renderYou();
  }

  global.MP = global.MP || {};
  global.MP.Mobile = { init, resize, runMobileAnalysis, renderPulse, renderMonitor, renderYou, state: Mob };
})(window);
