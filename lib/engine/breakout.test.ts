import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CryptoBar, CryptoBook } from "./types";
import {
  BREAKOUT_LOOKBACK,
  BREAKOUT_MAX_EXTENSION,
  BREAKOUT_VOL_SPIKE,
  completedBars,
  diagnoseBreakout,
  evaluateBtcBreakout,
  formatBreakoutSkip,
  priorResistance,
  sizeBreakout,
  volumeRatio,
} from "./breakout";

function barsFrom(
  closes: number[],
  opts?: { highs?: number[]; lows?: number[]; opens?: number[]; volumes?: number[] },
): CryptoBar[] {
  return closes.map((close, i) => ({
    close,
    high: opts?.highs?.[i] ?? close,
    low: opts?.lows?.[i] ?? close,
    open: opts?.opens?.[i] ?? close,
    volume: opts?.volumes?.[i] ?? 0,
  }));
}

function book(
  closes: number[],
  extras?: { highs?: number[]; lows?: number[]; opens?: number[]; volumes?: number[]; price?: number },
): CryptoBook {
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

/** 8-bar range with a local high inside the lookback window. */
function priorWithHigh(high = 120, base = 100): number[] {
  const prior = range(BREAKOUT_LOOKBACK, base);
  prior[4] = high;
  return prior;
}

describe("BTC 15m breakout", () => {
  it("needs lookback + 2 confirm bars before a resistance exists", () => {
    assert.equal(priorResistance(barsFrom(range(8, 100))), null);
    assert.equal(priorResistance(barsFrom(range(9, 100))), null);
  });

  it("uses the prior local high as resistance (excludes the last 2 bars)", () => {
    const prior = priorWithHigh(120);
    const last2 = [121, 122];
    assert.equal(priorResistance(barsFrom([...prior, ...last2])), 120);
  });

  it("enters long after two consecutive closes above resistance", () => {
    const prior = priorWithHigh(120);
    const miss = diagnoseBreakout(book([...prior, 119, 121]));
    assert.equal(miss.ok, false);
    const hit = diagnoseBreakout(book([...prior, 121, 122]));
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.resistance, 120);
      assert.equal(hit.mode, "two-close");
      assert.equal(hit.volumeUsed, false);
    }
  });

  it("does not require volume confirmation on the two-close path", () => {
    const prior = priorWithHigh(120);
    const closes = [...prior, 121, 122];
    const weakVol = [...range(BREAKOUT_LOOKBACK, 40, 0), 8, 8];
    const hit = diagnoseBreakout(book(closes, { volumes: weakVol }));
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "two-close");
      assert.equal(hit.volumeUsed, false);
    }
  });

  it("enters on one strong breakout bar with a volume spike", () => {
    const prior = priorWithHigh(120);
    const closes = [...prior, 118, 122];
    const highs = [...prior, 119, 123];
    const lows = [...prior, 117, 118];
    const opens = [...prior, 118, 119];
    const volumes = [...range(BREAKOUT_LOOKBACK, 40, 0), 30, 80];
    const hit = diagnoseBreakout(book(closes, { highs, lows, opens, volumes }));
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "spike");
      assert.equal(hit.volumeUsed, true);
      assert.equal(hit.resistance, 120);
    }
    assert.ok((volumeRatio(barsFrom(closes, { volumes }), 1) ?? 0) >= BREAKOUT_VOL_SPIKE);
  });

  it("skips a single close above resistance without a volume/ATR spike", () => {
    const prior = priorWithHigh(120);
    const d = diagnoseBreakout(book([...prior, 118, 121], { volumes: [...range(BREAKOUT_LOOKBACK, 40, 0), 30, 35] }));
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.match(d.reason, /need 2nd close or vol spike|1\/2 closes/);
      assert.match(formatBreakoutSkip(d), /BOLT skip · res 120/);
      assert.match(formatBreakoutSkip(d), /closes /);
      assert.match(formatBreakoutSkip(d), /vol /);
    }
  });

  it("treats missing volume as close-confirm on two-close, ATR-expand on spike", () => {
    const prior = priorWithHigh(120);
    const two = diagnoseBreakout(book([...prior, 121, 122]));
    assert.equal(two.ok, true);
    if (two.ok) assert.equal(two.volumeUsed, false);

    const tight = [100.0, 100.1, 100.2, 100.15, 100.3, 100.25, 100.4, 100.85, 100.5, 101.1];
    const highs = [100.12, 100.18, 100.28, 100.22, 100.38, 100.32, 100.48, 100.9, 100.58, 101.25];
    const lows = [99.92, 100.02, 100.1, 100.08, 100.18, 100.16, 100.28, 100.42, 100.38, 100.35];
    const opens = [100.0, 100.08, 100.16, 100.18, 100.22, 100.28, 100.32, 100.5, 100.48, 100.52];
    const spike = diagnoseBreakout(book(tight, { highs, lows, opens }));
    assert.equal(spike.ok, true);
    if (spike.ok) {
      assert.equal(spike.mode, "spike");
      assert.equal(spike.volumeUsed, false);
    }
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
    const prior = priorWithHigh(81_000, 80_000);
    const b = book([...prior, 81_100, 81_200], { price: 81_210 });
    const signal = evaluateBtcBreakout(b, 50, "bolt");
    assert.ok(signal);
    assert.equal(signal.side, 1);
    assert.equal(signal.symbol, "BTC");
    assert.equal(signal.label, "BTC-USD BREAKOUT");
    assert.ok(signal.notional <= 50 * 0.06);
    assert.equal(signal.stopPct, 0.01);
    assert.equal(signal.takePct, 0.02);
    assert.equal(signal.firstTargetPct, 0.01);
    assert.match(signal.reason, /2×15m close > res 81000/);
  });

  it("does not chase an already-extended breakout", () => {
    const prior = priorWithHigh(81_000, 80_000);
    const run = 81_000 * (1 + BREAKOUT_MAX_EXTENSION + 0.01);
    const b = book([...prior, run, run], { price: run });
    assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
    const d = diagnoseBreakout(b);
    assert.equal(d.ok, false);
    if (!d.ok) assert.match(d.reason, /extended/);
  });

  it("returns no signal when history is too short", () => {
    assert.equal(evaluateBtcBreakout(book(range(6, 100)), 50, "bolt"), null);
    const d = diagnoseBreakout(book(range(6, 100)));
    assert.equal(d.ok, false);
    if (!d.ok) assert.match(formatBreakoutSkip(d), /need 10 bars have 6/);
  });
});
