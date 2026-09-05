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
- Each module has its own flavor: BTC 15m breakout (BOLT), weather/prediction fade (BRAM, paused), ETH momentum (ILSA), mean reversion (KETT), macro events (RIGO, paused), alts scalping (TESS, secondary).
- **BOLT** goes long only after three consecutive completed 15-minute closes above a recent resistance (prior local high). Volume confirmation is used when Kraken provides it; otherwise the three closes are enough. Size is capped at ~5.5% of equity, with a ~1% hard stop, partial take near +1% (stop to breakeven), and a ~2% target.
- Fair value (EMA vs SMA) still drives ILSA / KETT / TESS. Prediction modules stay in the grid but start paused — Polymarket is owned by another agent.
- If ETH is bleeding, ILSA can auto-pause and the book rotates toward BTC breakouts.
- 20% of **profits** (capped at $200) is reserved for the simulated hosting subscription.
- State is saved to `data/agent-state.json` so a refresh does not wipe the run.
- **Pause Agent**, per-module pause, **Emergency Liquidate**, and **Respawn** after death. Always marked **PAPER TRADING MODE**.

P&amp;L is honest. This will not reprint viral 9,680% screenshots. A small or mixed book is the expected result.

## Stack

Next.js (App Router) + TypeScript. Live updates over SSE with HTTP polling fallback.
