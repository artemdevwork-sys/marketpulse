/* ============================================================
   MarketPulse — prototype bootstrap & stage switching
   ============================================================ */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));

  function setStage(name) {
    ['terminal', 'mobile', 'ad'].forEach(k => {
      $('#stage' + k[0].toUpperCase() + k.slice(1)).classList.toggle('on', k === name);
    });
    $$('#stageSwitch .vs-btn').forEach(b => b.classList.toggle('active', b.dataset.stage === name));
    setTimeout(() => {
      if (name === 'terminal') {
        global.MP.App.chart.resize();
        global.MP.App.sub.rsi.resize(); global.MP.App.sub.macd.resize();
      }
      if (name === 'mobile') { global.MP.Mobile.resize(); global.MP.Mobile.renderPulse(); global.MP.Mobile.renderMonitor(); }
      if (name === 'ad') global.MP.Ad.resize();
    }, 40);
  }

  function boot() {
    global.MP.UI.init();
    global.MP.Mobile.init();
    global.MP.Ad.init();

    $$('#stageSwitch .vs-btn').forEach(b => b.onclick = () => setStage(b.dataset.stage));

    // first paint of the tab underline
    setTimeout(() => {
      const t = $('.tab.active'), u = $('#tabUnderline');
      u.style.width = t.offsetWidth + 'px';
      u.style.transform = 'translateX(' + t.offsetLeft + 'px)';
    }, 80);

    // seed the activity feed from real background monitor state
    setTimeout(() => {
      Object.keys(global.MP.App.monitor).slice(0, 4).forEach(sym => {
        const r = global.MP.App.monitor[sym].reading;
        if (!r) return;
        global.MP.App.feedItems.push({
          kind: 'market', sym, cls: r.verdict === 'UP' ? 'k-bull' : r.verdict === 'DOWN' ? 'k-bear' : 'k-warn',
          html: 'Monitoring · agreement <b>' + r.consensus.agreement + '</b> · ' + r.regime.label,
          ts: new Date()
        });
      });
      // force a feed re-render through the public path
      const f = document.querySelector('#activityFilters .afilter.active');
      if (f) f.click();
    }, 300);

    console.log('%cMarketPulse prototype', 'color:#3D7DFF;font-weight:700',
      '\nAnalysis Engine and Presentation Engine are separate modules.' +
      '\nEngine: MP.Engine.analyze(candles, opts) -> Reading (pure, deterministic).' +
      '\nPresentation: MP.Presentation.runDesktop(...) replays a Reading and cannot alter it.' +
      '\nMarket data is SYNTHETIC demo data; the indicator and strategy math is real.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.MP = global.MP || {};
  global.MP.setStage = setStage;
})(window);
