/* ============================================================
   MarketPulse — ADVERTISEMENT CUT (prototype)
   ------------------------------------------------------------
   The 12-second window of the real Full Analysis Experience that
   makes the strongest screen-recording ad. Nothing here is a
   separate "marketing animation": it is the product UI, recomposed
   for 9:16 with caption timing.
   ============================================================ */
(function (global) {
  'use strict';
  const M = global.MP.Market, Eng = global.MP.Engine, P = global.MP.Presentation;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  const AD_LEN = 12.0;

  const SHOTS = [
    { t: 0.0, n: 'Hook — the scan', d: 'A scan line crosses live candles while seven analysis categories resolve with real values. Legible in the first 800ms with sound off, which is the only thing that matters on a feed.' },
    { t: 2.0, n: 'Phases 2-6 — the market is examined', d: 'Structure, trend, momentum, volatility and key levels, in that order. Each phase draws its own evidence: pivots ping, EMAs stroke on, the ATR corridor opens, levels draw left-to-right. Every line is a real computed object.' },
    { t: 4.0, n: 'Sixteen verdicts land', d: 'Strategy rows resolve one after another, each flashing its own indicators on the chart as it lands. This is the single most watchable stretch of the product.' },
    { t: 7.5, n: 'The argument', d: 'Consensus bars plus the line nobody else can show: effective independent voices. This is the shot that makes a sceptical trader stop scrolling.' },
    { t: 9.4, n: 'The verdict', d: 'Direction, duration and entry time at full size — the three facts a viewer can read in one frame. A WAIT ending is the stronger ad: most tools always have an answer.' },
    { t: 11.0, n: 'End card', d: 'Logo, URL, and the disclaimer on screen. 1.0s. Never a profit claim, never a win rate.' }
  ];

  const Ad = { chart: null, running: null, reading: null, landscape: false };

  function init() {
    Ad.chart = new global.MP.Chart($('#adCanvas'), $('#adOverlay'), { padR: 40, padB: 4, padT: 4, minimal: true });
    $('#adNotes').innerHTML =
      '<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:4px">' +
      '<b style="color:var(--t1);font-size:12px;letter-spacing:.08em;text-transform:uppercase">The 12-second cut</b><br>' +
      'Taken directly from the Full Analysis Experience. No separate marketing render — press play and this is the product.</div>' +
      SHOTS.map((s, i) => '<div class="ad-shot" data-shot="' + i + '">' +
        '<div class="t"><span class="nm">' + s.n + '</span><span class="tc">' + s.t.toFixed(1) + 's</span></div>' +
        '<div class="ds">' + s.d + '</div></div>').join('') +
      '<div class="corr-note" style="margin-top:6px"><b>Hygiene</b><br>60fps capture · real live data · never sped up in post · ' +
      'first frame legible with sound off · ends on the URL for 1.0s · no profit, win-rate or accuracy claim anywhere.</div>';

    $('#adPlay').onclick = play;
    $('#adOrient').onclick = () => {
      Ad.landscape = !Ad.landscape;
      $('#adFrame').classList.toggle('landscape', Ad.landscape);
      $('#adOrient').textContent = Ad.landscape ? 'Switch to 9:16' : 'Switch to 16:9';
      $('.ad-timeline').style.width = Ad.landscape ? '720px' : '372px';
      setTimeout(() => Ad.chart.resize(), 60);
    };
  }

  function resize() { if (Ad.chart) Ad.chart.resize(); }

  function play() {
    if (Ad.running) { Ad.running.cancelled = true; Ad.running = null; }
    const A = global.MP.App;
    const sym = 'EUR/USD';
    const m = A.monitor[sym];
    const p = M.pairInfo(sym);
    const r = Eng.analyze(m.feed.candles, { pair: sym, pip: p.pip, digits: p.digits, tfLabel: '5m', htfLabel: '15m' });
    Ad.reading = r;

    $('#adPair').textContent = sym + ' · 5M';
    $('#adSnap').textContent = 'SNAPSHOT ' + M.fmtTime(r.snapshot.last_closed) + ' UTC · ' + r.snapshot.candles + ' CANDLES · ' + r.snapshot.hash;
    Ad.chart.setData(m.feed.candles, sym);
    Ad.chart.view.count = 58;
    Ad.chart.reading = r;
    Ad.chart.anim = Ad.chart.resetAnim();
    const An = Ad.chart.anim;
    setTimeout(() => Ad.chart.resize(), 10);

    /* matrix rows */
    const host = $('#adMatrix'); host.innerHTML = '';
    const rows = [];
    r.strategies.forEach(s => {
      const row = el('div', 'm-a-row',
        '<span class="d"></span><span class="n">' + s.name.toUpperCase() + '</span><span class="r">···</span>');
      host.appendChild(row); rows.push({ el: row, strategy: s });
    });

    $('#adConsensus').classList.remove('on');
    $('#adConsensus').querySelector('.m-a-score').textContent = '0';
    $('#adVerdict').classList.remove('on');
    $('#adEndcard').classList.remove('on');
    $('#adAnalysis').classList.remove('verdict-phase');
    $('#adCaption').classList.remove('on');

    const isWait = r.verdict === 'WAIT';
    const col = isWait ? 'var(--amber)' : r.verdict === 'UP' ? 'var(--bull)' : 'var(--bear)';
    $('#adVerdict').innerHTML =
      '<div class="g" style="color:' + col + '">' + (isWait ? '❚❚' : r.verdict === 'UP' ? '↑' : '↓') + '</div>' +
      '<div class="w" style="color:' + col + '">' + r.verdict + '</div>' +
      (isWait
        ? '<div class="n">No high-quality setup</div>'
        : '<div class="m-hero-facts big">' +
            '<span><i>Duration</i><b>' + r.entry.durationMin + ' MIN</b></span>' +
            '<span><i>Enter</i><b>' + M.fmtTime(r.entry.time) + '</b></span>' +
          '</div>') +
      '<div class="n" style="margin-top:8px">Strategy consensus ' + r.consensus.agreement + ' / 100</div>';
    $('#adPhase').textContent = '';

    const tl = new P.Timeline();
    const cap = (t, html, until) => {
      tl.at(t, () => { $('#adCaption').innerHTML = html; $('#adCaption').classList.add('on'); });
      if (until) tl.at(until, () => $('#adCaption').classList.remove('on'));
    };

    /* ---- shot 1 · scan ---- */
    tl.tween(0.35, 1.05, P.E.sweep, pr => {
      const a = Ad.chart.plotArea();
      An.scanAlpha = 1; An.scanX = a.x + a.w * pr; An.candleWave = An.scanX;
    });
    r.categories.forEach((c, k) => {
      tl.at(0.45 + k * 0.12, () => { });
    });
    tl.tween(1.42, 0.2, P.E.exit, pr => { An.scanAlpha = 1 - pr; if (pr >= 1) { An.scanX = -1; An.candleWave = -1; } });
    tl.at(0.35, () => { $('#adPhase').textContent = 'PHASE 1 · MARKET SCAN'; });
    cap(0.80, 'SIXTEEN STRATEGIES.<span class="sm">Nine phases. One consensus.</span>', 1.95);

    /* ---- shot 2 · overlays draw ---- */
    r.overlays.levels.forEach((l, k) => tl.tween(2.00 + k * 0.11, 0.34, P.E.standard, pr => { An.levels[k] = pr; }));
    ['ema9', 'ema21', 'ema50'].forEach((id, k) => tl.tween(2.45 + k * 0.09, 0.50, P.E.standard, pr => { An.ema[id] = pr; }));
    r.overlays.structure.forEach((s, k) => tl.tween(3.00 + k * 0.07, 0.16, P.E.enter, pr => { An.struct[k] = pr; }));
    if (r.overlays.entry) tl.tween(3.45, 0.22, P.E.standard, pr => { An.entry = pr; });
    tl.at(2.00, () => { $('#adPhase').textContent = 'PHASE 2-6 · STRUCTURE · TREND · MOMENTUM · VOLATILITY · LEVELS'; });
    cap(2.25, 'IT DRAWS WHAT IT FOUND.<span class="sm">Levels · EMAs · market structure</span>', 3.90);

    /* ---- shot 3 · matrix ---- */
    rows.forEach((row, k) => {
      tl.at(4.00 + k * 0.030, () => row.el.classList.add('in', 'analyzing'));
      tl.at(4.62 + k * 0.170, () => {
        const s = row.strategy;
        const cls = s.verdict === 'BULLISH' ? 'r-bull' : s.verdict === 'BEARISH' ? 'r-bear' : 'r-flat';
        row.el.classList.remove('analyzing');
        row.el.classList.add('done', cls);
        row.el.querySelector('.r').textContent =
          s.verdict === 'BULLISH' ? '↑ BULL' : s.verdict === 'BEARISH' ? '↓ BEAR' : '○ FLAT';
        An.focus = s.uses.length ? s.uses : null;
      });
    });
    tl.at(7.40, () => { An.focus = null; });
    tl.at(4.00, () => { $('#adPhase').textContent = 'PHASE 7 · STRATEGY FAMILIES'; });
    cap(4.85, 'EVERY VERDICT, LIVE.<span class="sm">Each one lights up its own evidence</span>', 7.30);

    /* ---- shot 4 · the argument ---- */
    tl.at(7.50, () => { $('#adConsensus').classList.add('on'); $('#adPhase').textContent = 'PHASE 8 · CONSENSUS'; });
    tl.tween(7.55, 0.50, P.E.counter, pr => {
      $('#adConsensus').querySelector('.m-a-score').textContent = Math.round(r.consensus.agreement * pr);
    });
    cap(7.95, 'SIX TREND INDICATORS AGREEING<span class="sm">is one opinion, six times. We count ' +
      r.consensus.independent + ' independent voices — not ' + r.consensus.counts.total + '.</span>', 9.35);

    /* ---- shot 5 · verdict ---- */
    tl.tween(9.30, 0.26, P.E.standard, pr => { An.chartDim = 1 - 0.45 * pr; });
    tl.at(9.40, () => {
      $('#adVerdict').classList.add('on');
      $('#adAnalysis').classList.add('verdict-phase');
      $('#adPhase').textContent = 'PHASE 9 · FINAL READING';
    });
    cap(9.85, isWait
      ? 'IT SAYS WAIT.<span class="sm">Most tools always have an answer.</span>'
      : r.verdict + ' · ' + r.entry.durationMin + ' MIN · ENTER ' + M.fmtTime(r.entry.time) +
        '<span class="sm">' + r.consensus.quality.toLowerCase() + ' confluence · ' + r.regime.label.toLowerCase() + '</span>',
      10.90);

    /* ---- shot 6 · end card ---- */
    tl.at(11.00, () => $('#adEndcard').classList.add('on'));
    tl.at(AD_LEN, () => { });

    Ad.running = tl.play(
      (t) => {
        Ad.chart.render();
        $('#adTimecode').textContent = '00:' + t.toFixed(1).padStart(4, '0');
        $('#adTlFill').style.width = Math.min(100, t / AD_LEN * 100) + '%';
        let active = 0;
        SHOTS.forEach((s, i) => { if (t >= s.t) active = i; });
        $$('#adNotes .ad-shot').forEach((n, i) => n.classList.toggle('active', i === active));
      },
      () => { Ad.running = null; },
      0.1
    );
  }

  global.MP = global.MP || {};
  global.MP.Ad = { init, play, resize };
})(window);
