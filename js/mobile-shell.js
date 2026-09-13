/* ============================================================
   MarketPulse — MOBILE SHELL
   ------------------------------------------------------------
   Builds the phone presentation of the SAME terminal. It adds DOM
   and re-flows layout; it never moves an existing control and never
   touches analytical code.

   Design rules followed here:
     • every new control is a PROXY that clicks the real desktop
       control, so pair/timeframe/analyze behaviour is byte-identical
     • nothing is created above 767px, and everything is removed on
       the way back up, so desktop is untouched
     • no analytical value is computed, formatted or interpreted here

   NOTE: js/mobile.js is a different thing — it drives the in-page
   phone-mockup showcase used on desktop. This file is the real
   responsive shell.
   ============================================================ */
(function (global) {
  'use strict';

  const MQ = '(max-width: 767px)';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));

  const S = { built: false, observers: [], sheetOpen: false };

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------------------------------------------------------------
     Sections: a tappable header that collapses the element after it.
     --------------------------------------------------------------- */
  function addSection(target, label, hint, openByDefault) {
    if (!target || target.dataset.mSection === '1') return null;
    target.dataset.mSection = '1';
    const head = el('button', 'm-sec',
      '<span class="m-sec-l">' + label + '</span>' +
      (hint ? '<span class="m-sec-h">' + hint + '</span>' : '') +
      '<span class="m-sec-c">▾</span>');
    head.type = 'button';
    head.setAttribute('aria-expanded', openByDefault ? 'true' : 'false');
    target.parentNode.insertBefore(head, target);
    target.classList.add('m-body');
    if (!openByDefault) { target.classList.add('m-closed'); head.classList.add('closed'); }
    head.addEventListener('click', function () {
      const closed = target.classList.toggle('m-closed');
      head.classList.toggle('closed', closed);
      head.setAttribute('aria-expanded', closed ? 'false' : 'true');
      // a canvas that was display:none has no size; re-measure and repaint it
      if (!closed) {
        requestAnimationFrame(function () {
          resizeCharts();
          if (target.id === 'subpanels' && global.MP.UI && global.MP.UI.renderSub) {
            try { global.MP.UI.renderSub(); } catch (e) { }
          }
        });
      }
    });
    S.observers.push(function () {
      head.remove();
      target.classList.remove('m-body', 'm-closed');
      delete target.dataset.mSection;
    });
    return head;
  }

  /* ---------------------------------------------------------------
     Control row — pair / timeframe / ANALYZE, all proxies
     --------------------------------------------------------------- */
  function buildControls() {
    const bar = el('div', 'm-controls');
    bar.id = 'mControls';
    bar.innerHTML =
      '<button type="button" class="m-ctl m-pair" id="mPairBtn">' +
        '<span class="k">Pair</span><span class="v" id="mPairVal">EUR/USD</span>' +
      '</button>' +
      '<button type="button" class="m-ctl m-tf" id="mTfBtn">' +
        '<span class="k">TF</span><span class="v" id="mTfVal">5M</span>' +
      '</button>' +
      '<button type="button" class="m-analyze" id="mAnalyzeBtn">' +
        '<span class="glyph">▶</span><span id="mAnalyzeLabel">ANALYZE</span>' +
      '</button>';
    return bar;
  }

  /* timeframe bottom sheet — proxies the real .tf-btn elements */
  function buildTfSheet() {
    const wrap = el('div', 'm-sheet');
    wrap.id = 'mTfSheet';
    wrap.innerHTML =
      '<div class="m-sheet-panel">' +
        '<div class="m-sheet-head">Timeframe</div>' +
        '<div class="m-sheet-grid" id="mTfGrid"></div>' +
        '<button type="button" class="m-sheet-close" id="mTfClose">Close</button>' +
      '</div>';
    return wrap;
  }

  function fillTfSheet() {
    const grid = $('#mTfGrid');
    if (!grid) return;
    grid.innerHTML = '';
    $$('#tfGroup .tf-btn').forEach(function (src) {
      const locked = src.classList.contains('locked');
      const active = src.classList.contains('active');
      const label = (src.textContent || '').trim().replace(/\s*🔒\s*/, '');
      const b = el('button', 'm-tf-opt' + (active ? ' active' : '') + (locked ? ' locked' : ''),
        label + (locked ? ' <span class="lk">🔒</span>' : ''));
      b.type = 'button';
      b.addEventListener('click', function () {
        src.click();                 // real handler: switches, or opens the upsell
        closeSheet();
      });
      grid.appendChild(b);
    });
  }

  function openSheet() {
    fillTfSheet();
    const s = $('#mTfSheet');
    if (s) { s.classList.add('on'); S.sheetOpen = true; }
  }
  function closeSheet() {
    const s = $('#mTfSheet');
    if (s) { s.classList.remove('on'); S.sheetOpen = false; }
  }

  /* ---------------------------------------------------------------
     Bottom navigation — scroll to a section, nothing more
     --------------------------------------------------------------- */
  function buildNav() {
    const nav = el('nav', 'm-nav');
    nav.id = 'mNav';
    nav.innerHTML =
      navBtn('chart', 'Chart', '<path d="M2 14l4-5 3.5 3L16 4"/>') +
      navBtn('reading', 'Reading', '<circle cx="9" cy="9" r="6.5"/><path d="M9 5.5v4l2.6 1.6"/>') +
      navBtn('strategies', 'Strategies', '<path d="M3 14V8"/><path d="M7 14V4"/><path d="M11 14v-4"/><path d="M15 14V6"/>');
    return nav;
  }
  function navBtn(id, label, svg) {
    return '<button type="button" class="m-nav-b" data-mgo="' + id + '">' +
      '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">' + svg + '</svg>' +
      '<span>' + label + '</span></button>';
  }

  function scrollToSection(id) {
    const map = {
      chart: $('#chartArea'),
      reading: $('#paneReading'),
      strategies: $('#paneMatrix')
    };
    const target = map[id];
    if (!target) return;
    // open a collapsed section before scrolling to it
    if (target.classList.contains('m-closed')) {
      const head = target.previousElementSibling;
      if (head && head.classList.contains('m-sec')) head.click();
    }
    const head = target.previousElementSibling;
    const node = (head && head.classList.contains('m-sec')) ? head : target;
    const top = node.getBoundingClientRect().top + window.pageYOffset -
      (($('#mControls') ? $('#mControls').offsetHeight : 0) + 8);
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    $$('#mNav .m-nav-b').forEach(b => b.classList.toggle('active', b.dataset.mgo === id));
  }

  /* ---------------------------------------------------------------
     State sync — mirror the real controls onto the proxies
     --------------------------------------------------------------- */
  function sync() {
    const pv = $('#mPairVal'), tv = $('#mTfVal'), lbl = $('#mAnalyzeLabel');
    if (pv && $('#pairName')) pv.textContent = $('#pairName').textContent;
    if (tv) {
      const active = $('#tfGroup .tf-btn.active');
      tv.textContent = active ? (active.textContent || '').trim().replace(/\s*🔒\s*/, '') : '';
    }
    if (lbl && $('#analyzeLabel')) lbl.textContent = $('#analyzeLabel').textContent;
    const dock = $('#analyzeDock'), btn = $('#mAnalyzeBtn');
    if (dock && btn) btn.classList.toggle('disarmed', dock.classList.contains('disarmed'));
  }

  function watch() {
    if (!window.MutationObserver) return;
    const mo = new MutationObserver(sync);
    const pn = $('#pairName'), tg = $('#tfGroup'), ad = $('#analyzeDock');
    if (pn) mo.observe(pn, { childList: true, characterData: true, subtree: true });
    if (tg) mo.observe(tg, { attributes: true, subtree: true, attributeFilter: ['class'] });
    if (ad) mo.observe(ad, { attributes: true, attributeFilter: ['class'], subtree: true });
    S.observers.push(function () { mo.disconnect(); });
  }

  /* ---------------------------------------------------------------
     Chart re-measure. Debounced: mobile browsers fire resize on every
     URL-bar show/hide, and an unthrottled resize loop is the classic
     way to make a canvas app feel broken.
     --------------------------------------------------------------- */
  let rTimer = null;
  function resizeCharts() {
    const A = global.MP && global.MP.App;
    if (!A || !A.chart) return;
    try {
      A.chart.resize();
      if (A.sub) {
        if (A.sub.rsi) A.sub.rsi.resize();
        if (A.sub.macd) A.sub.macd.resize();
      }
      A.chart.render();
    } catch (e) { /* never let a resize break the page */ }
  }
  function onResize() {
    clearTimeout(rTimer);
    rTimer = setTimeout(resizeCharts, 120);
  }

  /* ---------------------------------------------------------------
     build / teardown
     --------------------------------------------------------------- */
  function build() {
    if (S.built) return;
    S.built = true;
    document.documentElement.classList.add('mp-mobile');

    // the in-page phone mockup and the ad cut are desktop showcases;
    // on a real phone the page itself is the mobile version
    if (global.MP && global.MP.setStage) {
      try { global.MP.setStage('terminal'); } catch (e) { }
    }

    const app = $('#app');
    const body = $('.body');
    if (!app || !body) return;

    // control row, directly under the header
    const controls = buildControls();
    app.insertBefore(controls, body);
    $('#mPairBtn').addEventListener('click', function () {
      const p = $('#pairSelect'); if (p) p.click();
    });
    $('#mTfBtn').addEventListener('click', openSheet);
    $('#mAnalyzeBtn').addEventListener('click', function () {
      const b = $('#btnAnalyze'); if (b) b.click();
    });

    const sheet = buildTfSheet();
    document.body.appendChild(sheet);
    $('#mTfClose').addEventListener('click', closeSheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

    // collapsible sections over existing content
    addSection($('#subpanels'), 'Indicators', 'RSI · MACD', false);
    addSection($('#paneReading'), 'Current reading', null, true);
    addSection($('#paneMatrix'), 'Strategies', '16 · 5 families', false);
    addSection($('#paneActivity'), 'Activity', null, false);
    addSection($('#leftPanel'), 'Market context', 'watchlist · sessions · regime', false);

    // bottom navigation
    const nav = buildNav();
    document.body.appendChild(nav);
    $$('#mNav .m-nav-b').forEach(function (b) {
      b.addEventListener('click', function () { scrollToSection(b.dataset.mgo); });
    });
    $('#mNav .m-nav-b').classList.add('active');

    watch();
    sync();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    S.observers.push(function () {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    });

    requestAnimationFrame(resizeCharts);
    setTimeout(function () {
      resizeCharts();
      if (global.MP.UI && global.MP.UI.renderSub) { try { global.MP.UI.renderSub(); } catch (e) { } }
    }, 250);
  }

  function teardown() {
    if (!S.built) return;
    S.built = false;
    document.documentElement.classList.remove('mp-mobile');
    S.observers.forEach(function (f) { try { f(); } catch (e) { } });
    S.observers = [];
    ['#mControls', '#mTfSheet', '#mNav'].forEach(function (sel) {
      const n = $(sel); if (n) n.remove();
    });
    requestAnimationFrame(resizeCharts);
  }

  function apply(matches) { matches ? build() : teardown(); }

  function init() {
    const mq = window.matchMedia(MQ);
    apply(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', e => apply(e.matches));
    else if (mq.addListener) mq.addListener(e => apply(e.matches));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  } else {
    setTimeout(init, 0);
  }

  global.MP = global.MP || {};
  global.MP.MobileShell = { build, teardown, sync, resizeCharts, scrollToSection };
})(window);
