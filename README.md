# Survival Mode

Autonomous **paper-trading** agent with a live Survival Mode dashboard. Inspired by the “pay yourself or die” Grok bot: start with **$50**, try to cover a simulated **$200/month** hosting bill from profits, and **die** if the book hits $0.

אין כאן מסחר אמיתי — זה נייר בלבד. No API keys. No real orders.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Demo mode is on by default (about one cycle every 6 seconds, plus a short accelerated bootstrap so the log and chart are not empty on first load). For a 15-minute production cadence:

```bash
DEMO=0 CYCLE_MS=900000 npm run dev
```

## What it does

- Pulls **real** BTC / ETH / SOL / DOGE marks from public Kraken (CoinGecko fallback) and **real** event books from the public Polymarket Gamma API.
- Each module has its own flavor: BTC dip (BOLT), weather/prediction fade (BRAM), ETH momentum (ILSA), mean reversion (KETT), macro events (RIGO), alts scalping (TESS).
- Fair value is a short EMA vs a longer SMA. Trades open only when the gap clears a threshold; size scales with gap size and a simple reliability score (inverse recent volatility).
- If ETH is bleeding, ILSA can auto-pause and the book rotates toward BTC dips — the same survival pivot the original post described.
- 20% of **profits** (capped at $200) is reserved for the simulated hosting subscription.
- State is saved to `data/agent-state.json` so a refresh does not wipe the run.
- **Pause Agent**, per-module pause, **Emergency Liquidate**, and **Respawn** after death. Always marked **PAPER TRADING MODE**.

P&amp;L is honest. This will not reprint viral 9,680% screenshots. A small or mixed book is the expected result.

## Stack

Next.js (App Router) + TypeScript. Live updates over SSE with HTTP polling fallback.
