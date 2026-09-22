import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODULES, PAPER_WEEK } from "./modules";
import {
  evaluateModule,
  opposingSiblingPosition,
  opposingSkipNote,
} from "./strategies";
import type { AgentState, CryptoBook, Position } from "./types";

function history(n: number, start: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function book(symbol: CryptoBook["symbol"], prices: number[]): CryptoBook {
  const price = prices[prices.length - 1];
  return { symbol, price, history: prices, tape: prices, bars: [] };
}

function pos(partial: Pick<Position, "moduleId" | "symbol" | "side"> & Partial<Position>): Position {
  return {
    id: partial.id ?? "p",
    moduleId: partial.moduleId,
    venue: "crypto",
    symbol: partial.symbol,
    label: partial.label ?? `${partial.symbol}`,
    side: partial.side,
    qty: partial.qty ?? 0.003,
    notional: partial.notional ?? 8,
    entry: partial.entry ?? 2650,
    mark: partial.mark ?? 2650,
    openedCycle: partial.openedCycle ?? 7,
    openedAt: partial.openedAt ?? 1,
    maxHold: 3,
    stopPct: 0.06,
    takePct: 0.04,
    partialTaken: false,
    reason: partial.reason ?? "",
  };
}

function state(positions: Position[], crypto: CryptoBook[]): AgentState {
  return {
    version: 4,
    paperWeek: PAPER_WEEK,
    status: "ALIVE",
    demo: false,
    cycleMs: 900_000,
    startedAt: 1,
    diedAt: null,
    lastCycleAt: 1,
    pid: 1,
    cycle: 7,
    cash: 50,
    initialCapital: 50,
    subscriptionMonthly: 200,
    subscriptionPaid: 0,
    wins: 0,
    losses: 0,
    resolvedCount: 0,
    modules: MODULES.map((m) => ({
      id: m.id,
      paused: m.flavor === "prediction" || m.flavor === "macro" || m.flavor === "alts",
      autoPaused: false,
      realizedPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      lastNote: "",
    })),
    positions,
    log: [],
    equityCurve: [],
    crypto,
    predictions: [],
    ready: true,
    booting: false,
    bootLines: [],
    lastFeedAt: 1,
    feedError: null,
    replayIndex: 0,
  };
}

/** Rising ETH, flat BTC — ILSA wants ETH long, KETT wants to fade ETH short (cycle-7 shape). */
function cycle7Books() {
  return [
    book("BTC", history(24, 81_000, 2)),
    book("ETH", history(24, 2500, 8)),
  ];
}

describe("ILSA/KETT same-symbol opposing-side gate", () => {
  it("logs the skip copy from live paper week 3 evidence", () => {
    assert.equal(
      opposingSkipNote("ilsa", { moduleId: "kett", symbol: "ETH", side: -1 }),
      "ILSA skip · opposite KETT ETH short open",
    );
    assert.equal(
      opposingSkipNote("kett", { moduleId: "ilsa", symbol: "ETH", side: 1 }),
      "KETT skip · opposite ILSA ETH long open",
    );
  });

  it("blocks the second module when the sibling already holds the opposite side of ETH", () => {
    const ilsaLong = pos({ moduleId: "ilsa", symbol: "ETH", side: 1 });
    const kettShort = pos({ moduleId: "kett", symbol: "ETH", side: -1 });
    const withIlsa = state([ilsaLong], []);
    const withKett = state([kettShort], []);

    assert.equal(opposingSiblingPosition(withIlsa, "kett", "ETH", -1)?.moduleId, "ilsa");
    assert.equal(opposingSiblingPosition(withKett, "ilsa", "ETH", 1)?.moduleId, "kett");
  });

  it("does not block same-side, a different symbol, or BOLT", () => {
    const ilsaLongEth = pos({ moduleId: "ilsa", symbol: "ETH", side: 1 });
    const s = state([ilsaLongEth], []);
    assert.equal(opposingSiblingPosition(s, "kett", "ETH", 1), undefined);
    assert.equal(opposingSiblingPosition(s, "kett", "BTC", -1), undefined);
    assert.equal(opposingSiblingPosition(s, "bolt", "ETH", -1), undefined);
    assert.equal(opposingSiblingPosition(s, "bolt", "BTC", 1), undefined);
  });

  it("reproduces the cycle-7 ETH cancel: both modules signal, shared path skips KETT", () => {
    const empty = state([], cycle7Books());
    const ilsa = evaluateModule("ilsa", empty, 50, 1);
    const kett = evaluateModule("kett", empty, 50, 1);
    assert.ok(ilsa, "ILSA should want ETH momentum without a sibling check");
    assert.ok(kett, "KETT should want a fade without a sibling check");
    assert.equal(ilsa.symbol, "ETH");
    assert.equal(ilsa.side, 1);
    assert.equal(kett.symbol, "ETH");
    assert.equal(kett.side, -1);

    // Shared order path: ILSA fills first (module order), then KETT is gated.
    const afterIlsa = state(
      [pos({ moduleId: ilsa.moduleId, symbol: ilsa.symbol, side: ilsa.side })],
      cycle7Books(),
    );
    const sibling = opposingSiblingPosition(afterIlsa, kett.moduleId, kett.symbol, kett.side);
    assert.ok(sibling);
    assert.equal(opposingSkipNote(kett.moduleId, sibling), "KETT skip · opposite ILSA ETH long open");

    // Symmetric: if KETT were already short ETH, ILSA's long is skipped.
    const afterKett = state(
      [pos({ moduleId: kett.moduleId, symbol: kett.symbol, side: kett.side })],
      cycle7Books(),
    );
    const blockIlsa = opposingSiblingPosition(afterKett, ilsa.moduleId, ilsa.symbol, ilsa.side);
    assert.ok(blockIlsa);
    assert.equal(opposingSkipNote(ilsa.moduleId, blockIlsa), "ILSA skip · opposite KETT ETH short open");
  });

  it("lets KETT still fade BTC while ILSA is long ETH", () => {
    const s = state([pos({ moduleId: "ilsa", symbol: "ETH", side: 1 })], []);
    assert.equal(opposingSiblingPosition(s, "kett", "BTC", -1), undefined);
  });

  it("does not touch paper-week / demo flags", () => {
    assert.equal(PAPER_WEEK, 3);
    const s = state([], []);
    assert.equal(s.paperWeek, 3);
    assert.equal(s.demo, false);
  });
});
