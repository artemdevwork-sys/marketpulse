# MarketPulse — Frontend Visual Prototype

**UX/UI validation only.** No production backend, no production analysis engine, no market-data vendor.

## Run it

```bash
python -m http.server 5173 --directory .
```

Run these commands from this repository's root. Then open **http://localhost:5173**

Alternative if you prefer Node:

```bash
npx --yes serve . -l 5173
```

Best viewed at **1440×900 or wider**. Below 1280px the watchlist panel collapses by design.

---

## What is real and what is not

| | Status |
|---|---|
| Candle data | **Synthetic.** Seeded deterministic generator in `js/market.js`, labelled `DEMO DATA` in the topbar and in the status bar. Replaced in production by a server-side vendor adapter. |
| Indicators (EMA, SMA, RSI, MACD, Bollinger, ATR, Stochastic, ADX, pivots) | **Real.** Standard TA maths, `js/indicators.js`. |
| 16 strategies, families, correlation adjustment, consensus, WAIT gates, entry derivation | **Real.** `js/engine.js`. Pure, deterministic, no randomness, no DOM. |
| Entry price / time / window / duration | **DEMO / UNRESOLVED.** Prototype placeholders so the interface can be designed; every one carries `status` and `basis` in the `Reading` and a `demo` tag in the UI. Null on WAIT. |
| Animation | **Replay only.** `js/presentation.js` receives a finished `Reading` and cannot compute, infer or alter any value. |
| Activity feed and alignment alerts | **Real transitions** computed by the engine on every simulated candle close. Nothing is invented. |
| History outcome column | Seeded placeholder marks in the demo rows only; live readings show `·` until labelled. |

Open the console: `MP.Engine.analyze(candles, opts)` returns the whole `Reading`. `MP.App.reading` is the current one.

---

## Prototype controls (bottom of screen)

- **Terminal / Mobile / Ad cut** — the three stages.
- **Free / Trader / Pro** — switches plan capability live; the terminal re-renders in place.

## Keyboard

| Key | Action |
|---|---|
| `Space` | Express analysis (~1.6s) |
| `⇧Space` | Full analysis (~7.2s) |
| `R` | Replay the last reading's cinematic |
| `⌘K` / `Ctrl+K` | Command palette (pairs, timeframes, commands) |
| `1`–`6` | Timeframe |
| `O` | Toggle system overlays |
| `Esc` | Abort the animation and jump to the result / close panels |

## Things worth trying

1. **Press ANALYZE on EUR/USD** — watch the nine phases name themselves along the top of the chart while each family resolves inside its own phase; it ends on a full-size `↑ UP · 5 MIN · ENTER 07:55` — duration is the life of the reading after entry, and carries a `demo` tag because its selection rule is not decided.
2. **Find a pair whose watchlist badge is grey and analyse it** — a `WAIT` verdict with a family table, the exact gates it failed, and a note that it did not use your allowance. Watch the `actionable` counter in the topbar stay put.
3. **Hover any row in the MATRIX tab** — the chart isolates that strategy's own evidence.
4. **Expand a matrix row** — rule, evidence values, family weight (masked on Free).
5. **Switch Free → Trader** — masks resolve in place; nothing moves.
6. **Switch to Pro and open LAB** — toggle strategies off and watch the family-balance meter warn you.
7. **Rail → STATS** — the correlation heatmap; the amber blocks are the whole argument for family weighting.
8. **Ad cut → Play** — 12 seconds of the real UI with the caption track.

---

## Files

```
index.html              markup for all three stages
css/tokens.css          colour, type, motion and layout tokens
css/terminal.css        terminal layout
css/analysis.css        analysis mode: matrix rail, consensus, verdict
css/mobile.css          mobile terminal + ad frame
js/market.js            DEMO data generation + live tick simulation + sessions
js/indicators.js        real TA maths (pure)
js/engine.js            ANALYSIS ENGINE — strategies, families, consensus, WAIT (pure)
js/chart.js             canvas chart + overlay renderer + subpanels + sparklines
js/presentation.js      PRESENTATION ENGINE — timeline replay of a Reading
js/ui.js                terminal wiring, panels, plans, paywall, views
js/mobile.js            mobile terminal
js/ad.js                12-second advertisement cut
js/app.js               bootstrap + stage switching
```

No build step, no dependencies, no network calls except the Google Fonts stylesheet (the page degrades to system fonts offline).
