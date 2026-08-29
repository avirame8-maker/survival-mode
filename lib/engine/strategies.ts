import type { AgentState, CryptoBook, PredictionBook, Signal } from "./types";
import { MODULES } from "./modules";
import { clamp, ema, gapVsFair, reliability, sma } from "./math";

function crypto(state: AgentState, symbol: string): CryptoBook | undefined {
  return state.crypto.find((c) => c.symbol === symbol);
}

function fairBundle(book: CryptoBook | undefined) {
  if (!book || book.history.length < 6) return null;
  const fair = sma(book.history, 20) ?? book.price;
  const fast = ema(book.history, 5) ?? book.price;
  const gap = gapVsFair(book.price, fair);
  const rel = reliability(book.history);
  return { fair, fast, gap, rel, price: book.price };
}

function sizeFor(
  equity: number,
  gap: number,
  rel: number,
  baseFrac: number,
  boost = 1,
): number {
  const mag = Math.min(3.2, Math.abs(gap) / 0.0025);
  const raw = equity * baseFrac * mag * rel * boost;
  return clamp(raw, 2.5, equity * 0.18);
}

function alreadyOpen(state: AgentState, moduleId: string): boolean {
  return state.positions.some((p) => p.moduleId === moduleId);
}

function predPick(
  books: PredictionBook[],
  category: PredictionBook["category"] | "any",
): PredictionBook | undefined {
  const list = category === "any" ? books : books.filter((b) => b.category === category);
  return list.find((b) => b.history.length >= 2 && Math.abs(b.yes - 0.5) < 0.84);
}

export function evaluateModule(
  moduleId: string,
  state: AgentState,
  equity: number,
  boostBolt: number,
): Signal | null {
  if (alreadyOpen(state, moduleId)) return null;
  const def = MODULES.find((m) => m.id === moduleId);
  if (!def) return null;

  switch (def.flavor) {
    case "btc-dip": {
      const b = fairBundle(crypto(state, "BTC"));
      if (!b) return null;
      if (b.gap > -0.0022) return null;
      const notional = sizeFor(equity, b.gap, b.rel, 0.11, boostBolt);
      return {
        moduleId,
        venue: "crypto",
        symbol: "BTC",
        label: "BTC-USD DIP",
        side: 1,
        notional,
        entry: b.price,
        maxHold: 4,
        stopPct: 0.07,
        takePct: 0.045,
        reason: `gap ${ (b.gap * 100).toFixed(2) }% vs FV ${b.fair.toFixed(0)} · rel ${b.rel.toFixed(2)}`,
      };
    }
    case "eth-momentum": {
      const b = fairBundle(crypto(state, "ETH"));
      if (!b) return null;
      const mom = gapVsFair(b.fast, b.fair);
      if (Math.abs(mom) < 0.0018) return null;
      const side: 1 | -1 = mom > 0 ? 1 : -1;
      const notional = sizeFor(equity, mom, b.rel, 0.1);
      return {
        moduleId,
        venue: "crypto",
        symbol: "ETH",
        label: "ETH-USD MOM",
        side,
        notional,
        entry: b.price,
        maxHold: 3,
        stopPct: 0.065,
        takePct: 0.04,
        reason: `mom ${ (mom * 100).toFixed(2) }% · ${side > 0 ? "long" : "short"}`,
      };
    }
    case "mean-reversion": {
      const btc = fairBundle(crypto(state, "BTC"));
      const eth = fairBundle(crypto(state, "ETH"));
      const cand = (
        [
          btc ? { sym: "BTC" as const, b: btc } : null,
          eth ? { sym: "ETH" as const, b: eth } : null,
        ] as const
      )
        .filter((x): x is { sym: "BTC" | "ETH"; b: NonNullable<typeof btc> } => x !== null)
        .sort((a, b) => Math.abs(b.b.gap) - Math.abs(a.b.gap))[0];
      if (!cand) return null;
      if (Math.abs(cand.b.gap) < 0.0024) return null;
      const side: 1 | -1 = cand.b.gap > 0 ? -1 : 1;
      const notional = sizeFor(equity, cand.b.gap, cand.b.rel, 0.09);
      return {
        moduleId,
        venue: "crypto",
        symbol: cand.sym,
        label: `${cand.sym}-USD MR`,
        side,
        notional,
        entry: cand.b.price,
        maxHold: 3,
        stopPct: 0.06,
        takePct: 0.035,
        reason: `fade ${(cand.b.gap * 100).toFixed(2)}% vs FV`,
      };
    }
    case "alts": {
      const sol = fairBundle(crypto(state, "SOL"));
      const doge = fairBundle(crypto(state, "DOGE"));
      const cand = (
        [
          sol ? { sym: "SOL" as const, b: sol } : null,
          doge ? { sym: "DOGE" as const, b: doge } : null,
        ] as const
      )
        .filter((x): x is { sym: "SOL" | "DOGE"; b: NonNullable<typeof sol> } => x !== null)
        .sort((a, b) => Math.abs(b.b.gap) - Math.abs(a.b.gap))[0];
      if (!cand || Math.abs(cand.b.gap) < 0.003) return null;
      const side: 1 | -1 = cand.b.gap > 0 ? -1 : 1;
      const notional = sizeFor(equity, cand.b.gap, cand.b.rel, 0.07);
      return {
        moduleId,
        venue: "crypto",
        symbol: cand.sym,
        label: `${cand.sym}-USD SCALP`,
        side,
        notional,
        entry: cand.b.price,
        maxHold: 2,
        stopPct: 0.05,
        takePct: 0.03,
        reason: `scalp ${(cand.b.gap * 100).toFixed(2)}%`,
      };
    }
    case "prediction": {
      const m = predPick(state.predictions, "weather") ?? predPick(state.predictions, "any");
      if (!m || m.history.length < 2) return null;
      const prev = m.history[m.history.length - 2];
      const delta = m.yes - prev;
      if (Math.abs(delta) < 0.015) return null;
      const side: 1 | -1 = delta > 0 ? -1 : 1;
      const notional = clamp(equity * 0.08 * m.yes * 1.2, 2.25, equity * 0.14);
      return {
        moduleId,
        venue: "prediction",
        symbol: m.id,
        label: m.question,
        side,
        notional,
        entry: m.yes,
        maxHold: 4,
        stopPct: 0.22,
        takePct: 0.16,
        reason: `fade ${(delta * 100).toFixed(1)}¢ on yes=${m.yes.toFixed(3)}`,
      };
    }
    case "macro": {
      const m = predPick(state.predictions, "macro") ?? predPick(state.predictions, "other");
      if (!m || m.history.length < 2) return null;
      const prev = m.history[m.history.length - 2];
      const delta = m.yes - prev;
      if (Math.abs(delta) < 0.012) return null;
      const side: 1 | -1 = delta > 0 ? 1 : -1;
      const notional = clamp(equity * 0.09, 2.5, equity * 0.16);
      return {
        moduleId,
        venue: "prediction",
        symbol: m.id,
        label: m.question,
        side,
        notional,
        entry: m.yes,
        maxHold: 5,
        stopPct: 0.2,
        takePct: 0.18,
        reason: `follow ${(delta * 100).toFixed(1)}¢ yes=${m.yes.toFixed(3)}`,
      };
    }
    default:
      return null;
  }
}

export function markOf(state: AgentState, p: { venue: string; symbol: string; mark: number }): number {
  if (p.venue === "crypto") {
    return crypto(state, p.symbol)?.price ?? p.mark;
  }
  return state.predictions.find((m) => m.id === p.symbol)?.yes ?? p.mark;
}

export function unrealized(entry: number, mark: number, qty: number, side: 1 | -1): number {
  return (mark - entry) * qty * side;
}

export function scanNotes(state: AgentState): string[] {
  const notes: string[] = [];
  const btc = fairBundle(crypto(state, "BTC"));
  const eth = fairBundle(crypto(state, "ETH"));
  if (btc) {
    notes.push(
      `BTC last ${btc.price.toFixed(0)} · FV ${btc.fair.toFixed(0)} · gap ${(btc.gap * 100).toFixed(2)}%`,
    );
  }
  if (eth) {
    notes.push(
      `ETH last ${eth.price.toFixed(2)} · FV ${eth.fair.toFixed(2)} · gap ${(eth.gap * 100).toFixed(2)}%`,
    );
  }
  const rain = state.predictions.filter((p) => p.category === "weather");
  if (rain.length) notes.push(`Pricing ${rain.length} NOAA-linked rain markets…`);
  const macro = state.predictions.filter((p) => p.category === "macro");
  if (macro.length) {
    const top = macro[0];
    notes.push(`Macro tape: "${top.question.slice(0, 42)}" yes=${top.yes.toFixed(3)}`);
  }
  return notes;
}
