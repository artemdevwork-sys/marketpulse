/* ============================================================
   MarketPulse — CHART RENDERER (canvas)
   ------------------------------------------------------------
   Two stacked canvases:
     priceCanvas   — candles, scales, grid, crosshair
     overlayCanvas — everything the Analysis Engine produced,
                     plus the animation state driven by the
                     Presentation Engine.

   The renderer NEVER computes analytical values. It receives a
   Reading's overlay geometry in price/time space and projects it
   to pixels. That is the whole contract.
   ============================================================ */
(function (global) {
  'use strict';
  const M = global.MP.Market;

  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }
  function rgba(hex, a) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function Chart(priceCv, overlayCv, opts) {
    this.pc = priceCv; this.oc = overlayCv;
    this.pctx = priceCv.getContext('2d');
    this.octx = overlayCv.getContext('2d');
    this.opts = Object.assign({ padR: 62, padB: 22, padT: 8, padL: 8, minimal: false }, opts || {});
    this.candles = [];
    this.digits = 5; this.pip = 0.0001; this.sym = '';
    this.view = { count: 130, offset: 0 };
    this.hover = null;
    this.reading = null;
    this.showSystem = true;
    this.anim = this.resetAnim();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.userDrawings = [];
    this._bind();
    this.resize();
  }

  Chart.prototype.resetAnim = function () {
    return {
      scanX: -1, scanAlpha: 0,
      ema: { ema9: 0, ema21: 0, ema50: 0 },
      levels: [], struct: [], pattern: 0, entry: 0, channel: 0, bb: 0,
      focus: null, dimOthers: 1, chartDim: 1, pulseLast: 0,
      candleWave: -1,
      /* phase-driven analytical processes */
      inspect: -1,        // x of the travelling lookback window
      inspectAlpha: 0,
      pivotPing: [],      // 0..1 per structure point, fires before its label
      zigzag: 0,          // market-structure polyline draw progress
      momentum: 0,        // momentum instrument panel
      volCorridor: 0,     // +/- 1 ATR envelope
      entryMark: 0,       // entry time marker + entry price rail
      climax: 0           // 0..1 : how far non-entry evidence has receded
    };
  };

  Chart.prototype._bind = function () {
    const self = this;
    let dragging = false, lastX = 0;
    this.oc.style.pointerEvents = 'none';
    this.pc.addEventListener('mousemove', e => {
      const r = self.pc.getBoundingClientRect();
      self.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (dragging) {
        const dx = e.clientX - lastX; lastX = e.clientX;
        const cw = self.candleW();
        self.view.offset = Math.max(0, Math.min(self.candles.length - 20, self.view.offset - Math.round(dx / cw)));
      }
      self.render();
    });
    this.pc.addEventListener('mouseleave', () => { self.hover = null; self.render(); });
    this.pc.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; self.pc.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { dragging = false; self.pc.style.cursor = 'crosshair'; });
    this.pc.addEventListener('wheel', e => {
      e.preventDefault();
      const d = e.deltaY > 0 ? 1.12 : 0.89;
      self.view.count = Math.max(30, Math.min(300, Math.round(self.view.count * d)));
      self.render();
    }, { passive: false });
    this.pc.style.cursor = 'crosshair';
  };

  Chart.prototype.resize = function () {
    [this.pc, this.oc].forEach(cv => {
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * this.dpr));
      cv.height = Math.max(1, Math.round(r.height * this.dpr));
    });
    this.w = this.pc.width / this.dpr;
    this.h = this.pc.height / this.dpr;
    this.render();
  };

  Chart.prototype.setData = function (candles, sym) {
    this.candles = candles;
    if (sym) { this.sym = sym; const p = M.pairInfo(sym); this.digits = p.digits; this.pip = p.pip; }
    this.render();
  };

  Chart.prototype.plotArea = function () {
    const o = this.opts;
    return { x: o.padL, y: o.padT, w: this.w - o.padL - o.padR, h: this.h - o.padT - o.padB };
  };
  Chart.prototype.candleW = function () { return this.plotArea().w / this.view.count; };

  Chart.prototype.visible = function () {
    const end = this.candles.length - this.view.offset;
    const start = Math.max(0, end - this.view.count);
    return { start, end };
  };

  Chart.prototype.range = function () {
    const { start, end } = this.visible();
    let mn = Infinity, mx = -Infinity;
    for (let i = start; i < end; i++) {
      const c = this.candles[i]; if (!c) continue;
      mn = Math.min(mn, c.l); mx = Math.max(mx, c.h);
    }
    // include system overlay levels so drawn lines stay on screen
    if (this.reading && this.showSystem) {
      this.reading.overlays.levels.forEach(l => { mn = Math.min(mn, l.price); mx = Math.max(mx, l.price); });
      if (this.reading.overlays.entry) { mn = Math.min(mn, this.reading.overlays.entry.low); mx = Math.max(mx, this.reading.overlays.entry.high); }
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    const pad = (mx - mn) * 0.12 || this.pip * 10;
    return { min: mn - pad, max: mx + pad };
  };

  Chart.prototype.xOf = function (i) {
    const a = this.plotArea(), { start } = this.visible();
    return a.x + (i - start + 0.5) * this.candleW();
  };
  Chart.prototype.yOf = function (p, rg) {
    const a = this.plotArea();
    rg = rg || this.range();
    return a.y + (rg.max - p) / (rg.max - rg.min) * a.h;
  };
  Chart.prototype.priceAt = function (y, rg) {
    const a = this.plotArea(); rg = rg || this.range();
    return rg.max - (y - a.y) / a.h * (rg.max - rg.min);
  };

  /* ---------------- price layer ---------------- */
  Chart.prototype.render = function () {
    const ctx = this.pctx, a = this.plotArea(), rg = this.range();
    const { start, end } = this.visible();
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const bg = cssVar('--bg-canvas');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.w, this.h);

    if (this.anim.chartDim < 1) {
      // handled at the end by an overlay wash
    }

    /* grid + price scale */
    const gridC = cssVar('--grid');
    const steps = 6;
    ctx.strokeStyle = gridC; ctx.lineWidth = 1;
    ctx.font = '10px ' + (cssVar('--font-mono') || 'monospace');
    ctx.textBaseline = 'middle';
    for (let s = 0; s <= steps; s++) {
      const p = rg.min + (rg.max - rg.min) * s / steps;
      const y = Math.round(this.yOf(p, rg)) + .5;
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
      if (!this.opts.minimal) {
        ctx.fillStyle = cssVar('--t4');
        ctx.textAlign = 'left';
        ctx.fillText(p.toFixed(this.digits), a.x + a.w + 8, y);
      }
    }

    /* time scale */
    if (!this.opts.minimal) {
      const cw = this.candleW();
      const every = Math.max(1, Math.round(64 / cw));
      ctx.textAlign = 'center'; ctx.fillStyle = cssVar('--t4');
      for (let i = start; i < end; i++) {
        if (i % every !== 0) continue;
        const c = this.candles[i]; if (!c) continue;
        const x = this.xOf(i);
        if (x < a.x + 14 || x > a.x + a.w - 14) continue;
        ctx.beginPath(); ctx.strokeStyle = gridC;
        ctx.moveTo(Math.round(x) + .5, a.y); ctx.lineTo(Math.round(x) + .5, a.y + a.h); ctx.stroke();
        ctx.fillText(M.fmtTime(c.t), x, a.y + a.h + 11);
      }
    }

    /* candles */
    const cw = this.candleW();
    const bw = Math.max(1, Math.min(14, cw * 0.66));
    const bull = cssVar('--bull'), bear = cssVar('--bear');
    for (let i = start; i < end; i++) {
      const c = this.candles[i]; if (!c) continue;
      const x = this.xOf(i);
      const up = c.c >= c.o;
      let alpha = 0.9;
      // scan wave brightening
      if (this.anim.candleWave >= 0) {
        const d = Math.abs(x - this.anim.candleWave);
        if (d < 40) alpha = 0.9 + (1 - d / 40) * 0.35;
      }
      const col = up ? bull : bear;
      ctx.strokeStyle = rgba(col, Math.min(1, alpha + .08));
      ctx.fillStyle = rgba(col, Math.min(1, alpha));
      ctx.lineWidth = 1;
      const yH = this.yOf(c.h, rg), yL = this.yOf(c.l, rg);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, yH); ctx.lineTo(Math.round(x) + .5, yL); ctx.stroke();
      const yO = this.yOf(c.o, rg), yC = this.yOf(c.c, rg);
      const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(Math.round(x - bw / 2), Math.round(top), Math.round(bw), Math.round(hgt));
    }

    /* last price marker */
    const last = this.candles[this.candles.length - 1];
    if (last) {
      const y = this.yOf(last.c, rg);
      const up = last.c >= last.o;
      const col = up ? bull : bear;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(col, .45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, Math.round(y) + .5); ctx.lineTo(a.x + a.w, Math.round(y) + .5); ctx.stroke();
      ctx.setLineDash([]);
      if (!this.opts.minimal) {
        ctx.fillStyle = col;
        ctx.fillRect(a.x + a.w + 2, y - 8, this.opts.padR - 4, 16);
        ctx.fillStyle = '#04060A'; ctx.font = 'bold 10px ' + (cssVar('--font-mono') || 'monospace');
        ctx.textAlign = 'left';
        ctx.fillText(last.c.toFixed(this.digits), a.x + a.w + 6, y);
      }
    }

    /* crosshair */
    if (this.hover && !this.opts.minimal) {
      const hx = this.hover.x, hy = this.hover.y;
      if (hx < a.x + a.w) {
        ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx, a.y); ctx.lineTo(hx, a.y + a.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, hy); ctx.lineTo(a.x + a.w, hy); ctx.stroke();
        ctx.setLineDash([]);
        const p = this.priceAt(hy, rg);
        ctx.fillStyle = cssVar('--bg-elev-2');
        ctx.fillRect(a.x + a.w + 2, hy - 8, this.opts.padR - 4, 16);
        ctx.fillStyle = cssVar('--t1'); ctx.font = '10px ' + (cssVar('--font-mono') || 'monospace');
        ctx.textAlign = 'left'; ctx.fillText(p.toFixed(this.digits), a.x + a.w + 6, hy);
        const idx = Math.round((hx - a.x) / cw - 0.5) + start;
        const c = this.candles[idx];
        if (c) {
          const lbl = M.fmtTime(c.t);
          ctx.fillStyle = cssVar('--bg-elev-2');
          ctx.fillRect(hx - 22, a.y + a.h + 3, 44, 15);
          ctx.fillStyle = cssVar('--t1'); ctx.textAlign = 'center';
          ctx.fillText(lbl, hx, a.y + a.h + 11);
        }
      }
    }
    ctx.restore();
    this.renderOverlay();
  };

  /* ---------------- overlay layer ---------------- */
  Chart.prototype.renderOverlay = function () {
    const ctx = this.octx, a = this.plotArea(), rg = this.range();
    const { start, end } = this.visible();
    const A = this.anim;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const CLIMAX_KEEP = ['entry', 'levels'];
    const focusAlpha = (id) => {
      let base = 1;
      if (A.focus) base = A.focus.indexOf(id) >= 0 ? 1 : 0.22;
      // during the final-reading climax everything except the entry evidence
      // recedes, so the actionable information is unmistakable
      if (A.climax > 0 && CLIMAX_KEEP.indexOf(id) < 0) base *= (1 - A.climax * 0.82);
      return base;
    };

    const r = this.reading;
    if (r && this.showSystem) {
      const ov = r.overlays;

      /* --- Bollinger --- */
      if (A.bb > 0) {
        const fa = focusAlpha('bb') * A.bb;
        ctx.strokeStyle = rgba(cssVar('--bb'), .5 * fa); ctx.lineWidth = 1;
        [ov.bb.upper, ov.bb.lower].forEach(series => {
          ctx.beginPath(); let started = false;
          for (let i = start; i < end && i < series.length; i++) {
            const v = series[i]; if (v == null) continue;
            const x = this.xOf(i), y = this.yOf(v, rg);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      }

      /* --- channel --- */
      if (A.channel > 0) {
        const ch = ov.channel, fa = focusAlpha('channel') * A.channel;
        ctx.strokeStyle = rgba(cssVar('--blue'), .30 * fa);
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        [-1, 1].forEach(side => {
          ctx.beginPath();
          for (let i = ch.from; i <= ch.to; i++) {
            const p = ch.intercept + ch.slope * (i - ch.from) + side * ch.sd * 1.6;
            const x = this.xOf(i), y = this.yOf(p, rg);
            if (i === ch.from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      /* --- EMAs (progressive draw) --- */
      ov.ema.forEach(e => {
        const prog = A.ema[e.id] || 0;
        if (prog <= 0) return;
        const fa = focusAlpha(e.id);
        const col = cssVar(e.color);
        ctx.strokeStyle = rgba(col, .95 * fa);
        ctx.lineWidth = e.id === 'ema9' ? 1.4 : 1.2;
        ctx.beginPath();
        const total = end - start;
        const upto = start + Math.round(total * prog);
        let started = false;
        for (let i = start; i < Math.min(upto, end) && i < e.series.length; i++) {
          const v = e.series[i]; if (v == null) continue;
          const x = this.xOf(i), y = this.yOf(v, rg);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      /* --- support / resistance --- */
      ov.levels.forEach((l, k) => {
        const prog = A.levels[k] || 0;
        if (prog <= 0) return;
        const fa = focusAlpha('levels');
        const y = Math.round(this.yOf(l.price, rg)) + .5;
        const col = l.kind === 'support' ? cssVar('--bull') : cssVar('--bear');
        // zone band
        const band = Math.max(3, a.h * 0.008);
        ctx.fillStyle = rgba(col, .07 * fa * prog);
        ctx.fillRect(a.x, y - band, a.x + a.w * prog - a.x, band * 2);
        ctx.strokeStyle = rgba(col, .68 * fa);
        ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w * prog, y); ctx.stroke();
        ctx.setLineDash([]);
        if (prog > 0.92 && !this.opts.minimal) {
          const label = (l.kind === 'support' ? 'S' : 'R') + ' · ' + l.touches + 'T';
          ctx.font = 'bold 9px ' + (cssVar('--font-mono') || 'monospace');
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(label).width + 8;
          ctx.fillStyle = rgba(col, .16 * fa);
          ctx.fillRect(a.x + a.w - tw - 4, y - 7, tw, 14);
          ctx.fillStyle = rgba(col, fa);
          ctx.fillText(label, a.x + a.w - tw, y);
        }
      });

      /* --- entry zone --- */
      if (A.entry > 0 && ov.entry) {
        const fa = focusAlpha('entry') * A.entry;
        const yH = this.yOf(ov.entry.high, rg), yL = this.yOf(ov.entry.low, rg);
        const col = r.verdict === 'UP' ? cssVar('--bull') : cssVar('--bear');
        ctx.fillStyle = rgba(col, .10 * fa);
        ctx.fillRect(a.x, yH, a.w, yL - yH);
        ctx.strokeStyle = rgba(col, .5 * fa); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, Math.round(yH) + .5); ctx.lineTo(a.x + a.w, Math.round(yH) + .5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, Math.round(yL) + .5); ctx.lineTo(a.x + a.w, Math.round(yL) + .5); ctx.stroke();
        ctx.setLineDash([]);
        if (!this.opts.minimal) {
          ctx.font = 'bold 9px ' + (cssVar('--font-mono') || 'monospace');
          ctx.fillStyle = rgba(col, fa); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText('ENTRY ZONE', a.x + 8, (yH + yL) / 2);
        }
      }

      /* --- market structure labels --- */
      ov.structure.forEach((s, k) => {
        const al = A.struct[k] || 0;
        if (al <= 0) return;
        const fa = focusAlpha('structure') * al;
        if (s.i < start || s.i >= end) return;
        const x = this.xOf(s.i);
        const isHigh = s.label[0] === 'H' || s.label === 'LH';
        const y = this.yOf(s.price, rg) + (isHigh ? -12 : 12);
        const col = (s.label === 'HH' || s.label === 'HL') ? cssVar('--bull') :
                    (s.label === 'LL' || s.label === 'LH') ? cssVar('--bear') : cssVar('--gray');
        ctx.font = 'bold 9px ' + (cssVar('--font-mono') || 'monospace');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(s.label).width + 8;
        const sc = 0.7 + 0.3 * al;
        ctx.save();
        ctx.translate(x, y); ctx.scale(sc, sc);
        ctx.fillStyle = rgba(col, .16 * fa);
        ctx.fillRect(-w / 2, -7, w, 14);
        ctx.strokeStyle = rgba(col, .45 * fa); ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2, -7, w, 14);
        ctx.fillStyle = rgba(col, fa);
        ctx.fillText(s.label, 0, 0);
        ctx.restore();
        // tick to the pivot
        ctx.strokeStyle = rgba(col, .3 * fa);
        ctx.beginPath();
        ctx.moveTo(x, this.yOf(s.price, rg));
        ctx.lineTo(x, y + (isHigh ? 7 : -7));
        ctx.stroke();
      });

      /* --- pattern bracket --- */
      if (A.pattern > 0 && ov.pattern) {
        const p = ov.pattern, fa = focusAlpha('pattern') * A.pattern;
        const x0 = this.xOf(p.at - p.span + 1) - this.candleW() * .4;
        const x1 = this.xOf(p.at) + this.candleW() * .4;
        let lo = Infinity;
        for (let i = p.at - p.span + 1; i <= p.at; i++) if (this.candles[i]) lo = Math.min(lo, this.candles[i].l);
        const y = this.yOf(lo, rg) + 14;
        const col = p.dir === 'BULLISH' ? cssVar('--bull') : p.dir === 'BEARISH' ? cssVar('--bear') : cssVar('--gray');
        ctx.strokeStyle = rgba(col, .7 * fa); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 4);
        ctx.stroke();
        ctx.font = 'bold 8.5px ' + (cssVar('--font-mono') || 'monospace');
        ctx.fillStyle = rgba(col, fa); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(p.name.toUpperCase(), (x0 + x1) / 2, y + 4);
      }
    }

    /* --- market-structure zigzag (real pivot geometry) --- */
    if (r && this.showSystem && A.zigzag > 0 && r.overlays.structure.length > 1) {
      const pts = r.overlays.structure.filter(p => p.i >= start && p.i < end);
      if (pts.length > 1) {
        const fa = focusAlpha('structure');
        ctx.strokeStyle = rgba(cssVar('--blue'), .5 * fa);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        const total = pts.length - 1;
        const upto = total * A.zigzag;
        ctx.beginPath();
        ctx.moveTo(this.xOf(pts[0].i), this.yOf(pts[0].price, rg));
        const whole = Math.floor(upto);
        for (let k = 1; k <= whole && k < pts.length; k++) {
          ctx.lineTo(this.xOf(pts[k].i), this.yOf(pts[k].price, rg));
        }
        const frac = upto - whole;
        if (frac > 0 && pts[whole + 1]) {
          const x0 = this.xOf(pts[whole].i), y0 = this.yOf(pts[whole].price, rg);
          const x1 = this.xOf(pts[whole + 1].i), y1 = this.yOf(pts[whole + 1].price, rg);
          ctx.lineTo(x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac);
        }
        ctx.stroke();
      }
    }

    /* --- pivot pings: each confirmed swing announces itself --- */
    if (r && this.showSystem) {
      r.overlays.structure.forEach((sp, k) => {
        const pg = A.pivotPing[k] || 0;
        if (pg <= 0 || pg >= 1) return;
        if (sp.i < start || sp.i >= end) return;
        const x = this.xOf(sp.i), y = this.yOf(sp.price, rg);
        const col = (sp.label === 'HH' || sp.label === 'HL') ? cssVar('--bull')
          : (sp.label === 'LL' || sp.label === 'LH') ? cssVar('--bear') : cssVar('--gray');
        ctx.strokeStyle = rgba(col, (1 - pg) * .9);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 2 + pg * 11, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = rgba(col, (1 - pg) * .8);
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
      });
    }

    /* --- volatility corridor: EMA21 +/- 1 ATR --- */
    if (r && this.showSystem && A.volCorridor > 0) {
      const ind = r.indicators;
      const fa = focusAlpha('bb') * A.volCorridor;
      const from = Math.max(start, end - Math.round((end - start) * A.volCorridor));
      const lim = Math.min(end, ind.e21.length);
      ctx.fillStyle = rgba(cssVar('--amber'), .05 * fa);
      ctx.beginPath();
      let started = false;
      for (let i2 = from; i2 < lim; i2++) {
        const mid = ind.e21[i2], at = ind.atr[i2];
        if (mid == null || at == null) continue;
        const x = this.xOf(i2), y = this.yOf(mid + at, rg);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      for (let i2 = lim - 1; i2 >= from; i2--) {
        const mid = ind.e21[i2], at = ind.atr[i2];
        if (mid == null || at == null) continue;
        ctx.lineTo(this.xOf(i2), this.yOf(mid - at, rg));
      }
      if (started) { ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = rgba(cssVar('--amber'), .28 * fa);
      ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      [1, -1].forEach(sgn => {
        ctx.beginPath(); let st2 = false;
        for (let i2 = from; i2 < lim; i2++) {
          const mid = ind.e21[i2], at = ind.atr[i2];
          if (mid == null || at == null) continue;
          const x = this.xOf(i2), y = this.yOf(mid + sgn * at, rg);
          if (!st2) { ctx.moveTo(x, y); st2 = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    /* --- entry marker: the candle this reading becomes actionable on --- */
    if (r && this.showSystem && A.entryMark > 0 && r.entry) {
      const g = A.entryMark;
      const x = Math.min(a.x + a.w - 2, this.xOf(this.candles.length));
      const col = r.verdict === 'UP' ? cssVar('--bull') : cssVar('--bear');
      ctx.strokeStyle = rgba(col, .5 * g);
      ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + a.h); ctx.stroke();
      ctx.setLineDash([]);
      const yE = this.yOf(r.entry.price, rg);
      ctx.strokeStyle = rgba(col, .85 * g); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(a.x, yE); ctx.lineTo(a.x + a.w, yE); ctx.stroke();
      ctx.fillStyle = rgba(col, g);
      ctx.beginPath();
      ctx.moveTo(x - 5, yE - 5); ctx.lineTo(x + 5, yE); ctx.lineTo(x - 5, yE + 5);
      ctx.closePath(); ctx.fill();
      if (!this.opts.minimal) {
        ctx.font = 'bold 9px ' + (cssVar('--font-mono') || 'monospace');
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = rgba(col, g);
        ctx.fillText('ENTRY ' + global.MP.Market.fmtTime(r.entry.time) + ' UTC', a.x + 8, yE - 5);
      }
    }

    /* --- momentum instrument panel (real RSI / MACD / Stochastic) --- */
    if (r && A.momentum > 0) {
      const ind = r.indicators, n = ind.r.length - 1;
      const g = A.momentum;
      const pw = 196, ph = 62;
      // keep the momentum panel out of the protected newest-candle zone:
      // park it just right of the left evidence column, never past 66% width
      const pw_limit = a.x + a.w * 0.66 - pw;
      const px = Math.max(a.x + 8, Math.min(a.x + 362, pw_limit));
      const py = a.y + a.h - ph - 10;
      ctx.globalAlpha = g;
      ctx.fillStyle = 'rgba(9,12,18,.88)';
      ctx.strokeStyle = rgba(cssVar('--amber'), .26);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.fill(); ctx.stroke();

      ctx.font = '8px ' + (cssVar('--font-mono') || 'monospace');
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = cssVar('--t4');
      ctx.fillText('MOMENTUM', px + 8, py + 6);

      const cx = px + 32, cy = py + 44, rr = 15;
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, rr, Math.PI, Math.PI * 2); ctx.stroke();
      const rv = ind.r[n] == null ? 50 : ind.r[n];
      const rsiCol = rv > 70 ? cssVar('--bear') : rv < 30 ? cssVar('--bull') : cssVar('--blue');
      ctx.strokeStyle = rsiCol; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, rr, Math.PI, Math.PI + Math.PI * (rv / 100) * g); ctx.stroke();
      ctx.font = 'bold 11px ' + (cssVar('--font-mono') || 'monospace');
      ctx.fillStyle = cssVar('--t1'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText((rv * g).toFixed(0), cx, cy);
      ctx.font = '7px ' + (cssVar('--font-mono') || 'monospace');
      ctx.fillStyle = cssVar('--t4'); ctx.textBaseline = 'top';
      ctx.fillText('RSI 14', cx, cy + 3);

      const hx = px + 64, hy = py + 20, hw = 72, hh = 34;
      let mmax = 1e-12;
      for (let k = Math.max(0, n - 25); k <= n; k++) {
        if (ind.m.hist[k] != null) mmax = Math.max(mmax, Math.abs(ind.m.hist[k]));
      }
      const bw2 = hw / 26;
      for (let k = 0; k < 26; k++) {
        const v = ind.m.hist[n - 25 + k];
        if (v == null) continue;
        const bh = (v / mmax) * (hh / 2) * 0.9 * g;
        ctx.fillStyle = rgba(v >= 0 ? cssVar('--bull') : cssVar('--bear'), .78);
        ctx.fillRect(hx + k * bw2, hy + hh / 2 - Math.max(0, bh), Math.max(1, bw2 - 1), Math.abs(bh));
      }
      ctx.font = '7px ' + (cssVar('--font-mono') || 'monospace');
      ctx.fillStyle = cssVar('--t4'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('MACD', hx, py + 6);

      const sx = px + 152, sy = py + 20, sh = 34;
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(sx, sy, 8, sh);
      const kv = ind.st.k[n] == null ? 50 : ind.st.k[n];
      const kh = sh * (kv / 100) * g;
      ctx.fillStyle = kv > 80 ? cssVar('--bear') : kv < 20 ? cssVar('--bull') : cssVar('--blue');
      ctx.fillRect(sx, sy + sh - kh, 8, kh);
      ctx.fillStyle = cssVar('--t4'); ctx.textAlign = 'left';
      ctx.fillText('%K', sx + 12, sy + sh - 10);
      ctx.fillStyle = cssVar('--t2');
      ctx.fillText(kv.toFixed(0), sx + 12, sy + sh - 22);
      ctx.globalAlpha = 1;
    }

    /* --- travelling inspection window (the lookback being read) --- */
    if (A.inspectAlpha > 0 && A.inspect >= 0) {
      const w2 = Math.max(40, this.candleW() * 14);
      const x0 = Math.max(a.x, A.inspect - w2), x1 = A.inspect;
      ctx.strokeStyle = rgba(cssVar('--blue'), .30 * A.inspectAlpha);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, a.y + 4, x1 - x0, a.h - 8);
      ctx.fillStyle = rgba(cssVar('--blue'), .035 * A.inspectAlpha);
      ctx.fillRect(x0, a.y + 4, x1 - x0, a.h - 8);
    }

    /* --- user drawings (solid = yours) --- */
    this.userDrawings.forEach(d => {
      ctx.strokeStyle = rgba(cssVar('--amber'), .85); ctx.lineWidth = 1.4;
      if (d.type === 'hline') {
        const y = Math.round(this.yOf(d.price, rg)) + .5;
        ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
      }
    });

    /* --- last-candle pulse --- */
    if (A.pulseLast > 0) {
      const i = this.candles.length - 1;
      const c = this.candles[i];
      if (c && i >= start) {
        const x = this.xOf(i), yH = this.yOf(c.h, rg), yL = this.yOf(c.l, rg);
        const bw = Math.max(6, this.candleW() * 0.9);
        const g = A.pulseLast;
        ctx.strokeStyle = rgba(cssVar('--blue'), .9 * g);
        ctx.lineWidth = 1;
        const pad = 3 + (1 - g) * 5;
        ctx.strokeRect(x - bw / 2 - pad, yH - pad, bw + pad * 2, (yL - yH) + pad * 2);
      }
    }

    /* --- scan line --- */
    if (A.scanAlpha > 0 && A.scanX >= 0) {
      const grd = ctx.createLinearGradient(A.scanX - 34, 0, A.scanX, 0);
      grd.addColorStop(0, rgba(cssVar('--blue'), 0));
      grd.addColorStop(1, rgba(cssVar('--blue'), .22 * A.scanAlpha));
      ctx.fillStyle = grd;
      ctx.fillRect(A.scanX - 34, a.y, 34, a.h);
      ctx.strokeStyle = rgba(cssVar('--blue'), .8 * A.scanAlpha);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(A.scanX) + .5, a.y); ctx.lineTo(Math.round(A.scanX) + .5, a.y + a.h); ctx.stroke();
    }

    /* --- global dim during verdict reveal --- */
    if (A.chartDim < 1) {
      ctx.fillStyle = 'rgba(5,7,11,' + (1 - A.chartDim) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    ctx.restore();
  };

  /* ---------------- subpanel renderer ---------------- */
  function Subpanel(canvas, kind) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.kind = kind;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.data = null; this.chart = null;
  }
  Subpanel.prototype.resize = function () {
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.w = this.cv.width / this.dpr; this.h = this.cv.height / this.dpr;
  };
  Subpanel.prototype.render = function (chart, ind) {
    if (!ind) return;
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const padR = chart.opts.padR, padL = chart.opts.padL, padT = 16, padB = 6;
    const aw = this.w - padL - padR, ah = this.h - padT - padB;
    const { start, end } = chart.visible();
    const xOf = i => padL + (i - start + 0.5) * (aw / chart.view.count);

    ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + ah / 2); ctx.lineTo(padL + aw, padT + ah / 2); ctx.stroke();

    if (this.kind === 'rsi') {
      const r = ind.r;
      const yOf = v => padT + (100 - v) / 100 * ah;
      [30, 70].forEach(lv => {
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, yOf(lv)); ctx.lineTo(padL + aw, yOf(lv)); ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.strokeStyle = cssVar('--blue'); ctx.lineWidth = 1.2; ctx.beginPath();
      let st = false;
      for (let i = start; i < end && i < r.length; i++) {
        if (r[i] == null) continue;
        const x = xOf(i), y = yOf(r[i]);
        if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (this.kind === 'macd') {
      const m = ind.m;
      let mx = 0;
      for (let i = start; i < end && i < m.hist.length; i++) if (m.hist[i] != null) mx = Math.max(mx, Math.abs(m.hist[i]), Math.abs(m.line[i]));
      mx = mx || 1;
      const yOf = v => padT + ah / 2 - (v / mx) * (ah / 2) * 0.92;
      const bw = Math.max(1, aw / chart.view.count * 0.5);
      for (let i = start; i < end && i < m.hist.length; i++) {
        if (m.hist[i] == null) continue;
        const x = xOf(i), y = yOf(m.hist[i]), y0 = yOf(0);
        ctx.fillStyle = rgba(m.hist[i] >= 0 ? cssVar('--bull') : cssVar('--bear'), .5);
        ctx.fillRect(x - bw / 2, Math.min(y, y0), bw, Math.abs(y - y0));
      }
      [['line', cssVar('--blue')], ['signal', cssVar('--amber')]].forEach(([k, col]) => {
        ctx.strokeStyle = col; ctx.lineWidth = 1.1; ctx.beginPath();
        let st = false;
        for (let i = start; i < end && i < m[k].length; i++) {
          if (m[k][i] == null) continue;
          const x = xOf(i), y = yOf(m[k][i]);
          if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    }
    ctx.restore();
  };

  /* ---------------- sparkline ---------------- */
  function sparkline(canvas, values, color, fill) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    ctx.clearRect(0, 0, w, h);
    if (!values.length) return;
    const mn = Math.min.apply(null, values), mx = Math.max.apply(null, values);
    const yOf = v => h - 3 - (mx === mn ? .5 : (v - mn) / (mx - mn)) * (h - 6);
    const xOf = i => (i / Math.max(1, values.length - 1)) * w;
    if (fill) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(color, .22)); g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h);
      values.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath();
    values.forEach((v, i) => i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v)));
    ctx.stroke();
  }

  global.MP = global.MP || {};
  global.MP.Chart = Chart;
  global.MP.Subpanel = Subpanel;
  global.MP.sparkline = sparkline;
  global.MP.cssVar = cssVar;
  global.MP.rgba = rgba;
})(window);
