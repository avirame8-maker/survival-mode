import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CryptoBar, CryptoBook } from "./types";
import {
  BREAKOUT_MAX_EXTENSION,
  breakoutLong,
  completedBars,
  evaluateBtcBreakout,
  priorResistance,
  sizeBreakout,
  volumeConfirming,
} from "./breakout";

function barsFrom(
  closes: number[],
  opts?: { highs?: number[]; volumes?: number[] },
): CryptoBar[] {
  return closes.map((close, i) => ({
    close,
    high: opts?.highs?.[i] ?? close,
    volume: opts?.volumes?.[i] ?? 0,
  }));
}

function book(closes: number[], extras?: { highs?: number[]; volumes?: number[]; price?: number }): CryptoBook {
  const completed = barsFrom(closes, extras);
  return {
    symbol: "BTC",
    price: extras?.price ?? closes[closes.length - 1],
    history: [...closes, extras?.price ?? closes[closes.length - 1]],
    tape: [],
    bars: completed,
  };
}

function range(n: number, start: number, step = 0): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("BTC 15m breakout", () => {
  it("needs lookback + 3 confirm bars before a resistance exists", () => {
    assert.equal(priorResistance(barsFrom(range(10, 100))), null);
  });

  it("uses the prior local high as resistance (excludes the last 3 bars)", () => {
    const prior = range(16, 100);
    prior[7] = 120;
    const last3 = [121, 122, 123];
    assert.equal(priorResistance(barsFrom([...prior, ...last3])), 120);
  });

  it("enters long only after three consecutive closes above resistance", () => {
    const prior = range(16, 100);
    prior[7] = 120;
    assert.equal(breakoutLong(barsFrom([...prior, 119, 121, 122])), null);
    assert.equal(breakoutLong(barsFrom([...prior, 121, 119, 122])), null);
    const hit = breakoutLong(barsFrom([...prior, 121, 122, 123]));
    assert.ok(hit);
    assert.equal(hit.resistance, 120);
    assert.equal(hit.volumeUsed, false);
  });

  it("requires confirming volume when volume is present", () => {
    const prior = range(16, 100);
    prior[7] = 120;
    const closes = [...prior, 121, 122, 123];
    const weakVol = [...range(16, 100, 0), 10, 10, 10];
    assert.equal(breakoutLong(barsFrom(closes, { volumes: weakVol })), null);

    const strongVol = [...range(16, 40, 0), 50, 55, 80];
    const hit = breakoutLong(barsFrom(closes, { volumes: strongVol }));
    assert.ok(hit);
    assert.equal(hit.volumeUsed, true);
  });

  it("treats missing volume as close-confirm only", () => {
    const prior = range(16, 100);
    prior[7] = 120;
    assert.equal(volumeConfirming(barsFrom([...prior, 121, 122, 123])), null);
    const hit = breakoutLong(barsFrom([...prior, 121, 122, 123]));
    assert.ok(hit);
    assert.equal(hit.volumeUsed, false);
  });

  it("ignores the live tick when synthesizing completed bars", () => {
    const completed = range(19, 100);
    completed[7] = 130;
    const live: CryptoBook = {
      symbol: "BTC",
      price: 999,
      history: [...completed, 999],
      tape: [],
      bars: [],
    };
    const bars = completedBars(live);
    assert.equal(bars.length, completed.length);
    assert.equal(bars.at(-1)?.close, completed.at(-1));
  });

  it("sizes from bankroll with a hard cap of 6%", () => {
    assert.equal(sizeBreakout(50), 2.75);
    assert.ok(sizeBreakout(50) <= 50 * 0.06);
    assert.ok(sizeBreakout(1000) <= 60);
  });

  it("emits a long-only paper signal with conservative stops and partial target", () => {
    const prior = range(16, 80_000);
    prior[4] = 81_000;
    const b = book([...prior, 81_100, 81_200, 81_250], { price: 81_260 });
    const signal = evaluateBtcBreakout(b, 50, "bolt");
    assert.ok(signal);
    assert.equal(signal.side, 1);
    assert.equal(signal.symbol, "BTC");
    assert.equal(signal.label, "BTC-USD BREAKOUT");
    assert.ok(signal.notional <= 50 * 0.06);
    assert.equal(signal.stopPct, 0.01);
    assert.equal(signal.takePct, 0.02);
    assert.equal(signal.firstTargetPct, 0.01);
    assert.match(signal.reason, /3×15m close > res 81000/);
  });

  it("does not chase an already-extended breakout", () => {
    const prior = range(16, 80_000);
    prior[4] = 81_000;
    const run = 81_000 * (1 + BREAKOUT_MAX_EXTENSION + 0.01);
    const b = book([...prior, run, run, run], { price: run });
    assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
  });

  it("returns no signal when history is too short", () => {
    assert.equal(evaluateBtcBreakout(book(range(8, 100)), 50, "bolt"), null);
  });
});
