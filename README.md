# Survival Mode

Autonomous **paper-trading** agent with a live Survival Mode dashboard. Inspired by the “pay yourself or die” Grok bot: start with **$50**, try to cover a simulated **$200/month** hosting bill from profits, and **die** if the book hits $0.

אין כאן מסחר אמיתי — זה נייר בלבד. No API keys. No real orders.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default cadence is a **15-minute paper week** (`DEMO=0`, `CYCLE_MS=900000`): $50 start, no live money, no API keys. For an accelerated dashboard while developing:

```bash
DEMO=1 CYCLE_MS=6000 npm run dev
```

## What it does

- Pulls **real** BTC / ETH / SOL / DOGE marks from public Kraken (CoinGecko fallback) and **real** event books from the public Polymarket Gamma API.
- Each module has its own flavor: BTC 15m breakout (BOLT, primary), weather/prediction fade (BRAM, paused), ETH momentum (ILSA), mean reversion (KETT), macro events (RIGO, paused), alts scalping (TESS, paused by default).
- **BOLT** goes long after **two consecutive completed 15-minute closes** above a recent 8-bar resistance, **or** one strong breakout bar with a volume spike (≥1.25× lookback average) / ATR range expansion. On the volume-spike / ATR-expansion path only, the completed bar must close at or above resistance (`last >= res` when ATR is known; `last > res` when ATR is missing). The spike path no longer allows a close below resistance. The two-close path stays strict (`close > res`). Spike and two-close still need the live mark above resistance at fill time — a completed bar that cleared is skipped if price has fallen back through the level (`live ≤ res · failed follow-through`). Weak volume no longer blocks the two-close path. Size is capped at ~5.5% of equity (hard cap 6%), with a ~1% hard stop, partial take near +1% (stop to breakeven), and a ~2% target. Each skip is logged (resistance, last closes, volume, ATR) for daily research.
- Fair value (EMA vs SMA) still drives ILSA / KETT. They will not open opposite sides of the same symbol at once (the second paper entry is skipped and logged). TESS stays in the grid but starts paused so BTC/ETH drive the book (smaller size if manually resumed). Prediction modules stay paused — Polymarket is owned by another agent.
- If ETH is bleeding, ILSA can auto-pause and the book rotates toward BTC breakouts. ~6% of equity is reserved for BOLT when it is flat.
- 20% of **profits** (capped at $200) is reserved for the simulated hosting subscription.
- State is saved to `data/agent-state.json` so a refresh does not wipe the run. Production uses a week-scoped Vercel Blob (`paper-week-3-state.json`).
- **Pause Agent**, per-module pause, **Emergency Liquidate**, and **Respawn** after death. Always marked **PAPER TRADING MODE** / **NO LIVE MONEY**.

P&amp;L is honest. This will not reprint viral 9,680% screenshots. A small or mixed book is the expected result.

## Stack

Next.js (App Router) + TypeScript. Live updates over SSE with HTTP polling fallback.
