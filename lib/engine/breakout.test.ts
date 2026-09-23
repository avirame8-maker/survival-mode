import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CryptoBar, CryptoBook } from "./types";
import {
  BREAKOUT_LOOKBACK,
  BREAKOUT_MAX_EXTENSION,
  BREAKOUT_QUIET_ATR_PCT,
  BREAKOUT_SPIKE_ATR_BUFFER,
  BREAKOUT_VOL_SPIKE,
  atrPct,
  completedBars,
  diagnoseBreakout,
  evaluateBtcBreakout,
  formatBreakoutSkip,
  priorResistance,
  sizeBreakout,
  spikeClearsResistance,
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

/**
 * One close just above resistance, bullish and near the high, with a controlled
 * volume multiple. Extension stays under the spike ATR-expand minimum so only
 * the volume gate can confirm.
 */
function spikeVolBook(volMultiple: number): CryptoBook {
  const prior = priorWithHigh(10_000, 9_900);
  const closes = [...prior, 9_980, 10_005];
  const highs = [...prior, 9_990, 10_008];
  const lows = [...prior, 9_960, 10_000];
  const opens = [...prior, 9_970, 10_001];
  const volumes = Array(closes.length).fill(100);
  volumes[volumes.length - 1] = 100 * volMultiple;
  return book(closes, { highs, lows, opens, volumes, price: 10_005 });
}

/**
 * Tight 15m tape with a single lookback wick at `res`.
 * `quiet` keeps ATR under BREAKOUT_QUIET_ATR_PCT; otherwise ATR is ~0.2%.
 */
function tightTape(opts: {
  res: number;
  lastClose: number;
  lastVol: number;
  lookbackVol?: number;
  quiet?: boolean;
  /** Live mark. Defaults to the completed bar close. */
  price?: number;
}): CryptoBook {
  const lookbackVol = opts.lookbackVol ?? 40;
  const n = BREAKOUT_LOOKBACK + 2;
  const pad = opts.quiet ? 3 : 80;
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const isResBar = i === 5;
    const close = isLast ? opts.lastClose : opts.res - 90 + (i % 3) * 8;
    const high = isResBar
      ? opts.res
      : isLast
        ? close + 12
        : Math.min(opts.res - 1, close + pad);
    const low = isLast ? close - pad * 0.9 : close - pad;
    const open = isLast ? Math.min(close - 18, low + 4) : close - pad * 0.15;
    closes.push(close);
    highs.push(high);
    lows.push(Math.min(low, open, close));
    opens.push(open);
    volumes.push(isLast ? opts.lastVol : lookbackVol);
  }
  return book(closes, { highs, lows, opens, volumes, price: opts.price ?? opts.lastClose });
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
      assert.equal(hit.atrBufferUsed, false);
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
      assert.equal(hit.atrBufferUsed, false);
    }
    assert.ok((volumeRatio(barsFrom(closes, { volumes }), 1) ?? 0) >= BREAKOUT_VOL_SPIKE);
  });

  it("enters a 1.26× volume spike that the 1.4× gate used to skip", () => {
    assert.equal(BREAKOUT_VOL_SPIKE, 1.25);
    const ratio = volumeRatio(completedBars(spikeVolBook(1.26)), 1);
    assert.equal(ratio?.toFixed(2), "1.26");
    assert.ok(ratio != null && ratio < 1.4 && ratio >= BREAKOUT_VOL_SPIKE);

    const hit = diagnoseBreakout(spikeVolBook(1.26));
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "spike");
      assert.equal(hit.volumeUsed, true);
      assert.equal(hit.resistance, 10_000);
    }
    const signal = evaluateBtcBreakout(spikeVolBook(1.26), 50, "bolt");
    assert.ok(signal);
    assert.match(signal.reason, /spike bar > res 10000/);
    assert.match(signal.reason, /vol 1\.26× ≥ 1\.25×/);
  });

  it("skips a vol spike whose completed bar closed above res when live price fell back through it", () => {
    const prior = priorWithHigh(120);
    const closes = [...prior, 118, 122];
    const highs = [...prior, 119, 123];
    const lows = [...prior, 117, 118];
    const opens = [...prior, 118, 119];
    const volumes = [...range(BREAKOUT_LOOKBACK, 40, 0), 30, 80];
    const cleared = diagnoseBreakout(book(closes, { highs, lows, opens, volumes }));
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.mode, "spike");
      assert.equal(cleared.volumeUsed, true);
      assert.equal(cleared.atrBufferUsed, false);
      assert.equal(cleared.resistance, 120);
    }
    for (const price of [119, 120]) {
      const b = book(closes, { highs, lows, opens, volumes, price });
      const d = diagnoseBreakout(b);
      assert.equal(d.ok, false);
      if (!d.ok) {
        assert.equal(d.reason, "live ≤ res · failed follow-through");
        assert.match(formatBreakoutSkip(d), /live ≤ res · failed follow-through/);
        assert.equal(d.resistance, 120);
      }
      assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
    }
  });

  it("skips two-close when the live mark dips back through resistance", () => {
    const prior = priorWithHigh(120);
    const b = book([...prior, 121, 122], { price: 119.5 });
    const d = diagnoseBreakout(b);
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.reason, "live ≤ res · failed follow-through");
      assert.match(formatBreakoutSkip(d), /BOLT skip · res 120/);
    }
    assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
  });

  it("still skips 0.65× and 1.0× volume on the spike path", () => {
    for (const mult of [0.65, 1]) {
      const d = diagnoseBreakout(spikeVolBook(mult));
      assert.equal(d.ok, false);
      if (!d.ok) {
        const label = mult.toFixed(2).replace(".", "\\.");
        assert.match(d.reason, new RegExp(`vol ${label}× < 1\\.25×`));
        assert.match(formatBreakoutSkip(d), new RegExp(`vol ${label}× < 1\\.25×`));
      }
      assert.equal(evaluateBtcBreakout(spikeVolBook(mult), 50, "bolt"), null);
    }
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

  it("enters on a volume spike when last is just under res but within 1.5×ATR", () => {
    const res = 80_752;
    const last = 80_733; // ~$19 / ~0.023% under res — the 2026-09-20 live near-miss
    // Completed bar stays inside the 1.5×ATR buffer; live mark must confirm above res.
    const b = tightTape({ res, lastClose: last, lastVol: 181, price: res + 20 });
    const bars = completedBars(b);
    const atr = atrPct(bars);
    const vol = volumeRatio(bars, 1);
    assert.ok(atr != null && atr >= BREAKOUT_QUIET_ATR_PCT);
    assert.ok((vol ?? 0) >= BREAKOUT_VOL_SPIKE);
    assert.ok(last < res);
    assert.ok(spikeClearsResistance(last, res, atr));
    const hit = diagnoseBreakout(b);
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "spike");
      assert.equal(hit.volumeUsed, true);
      assert.equal(hit.atrBufferUsed, true);
      assert.equal(hit.resistance, res);
    }
    const signal = evaluateBtcBreakout(b, 50, "bolt");
    assert.ok(signal);
    assert.ok(signal.entry > res);
    assert.match(signal.reason, /spike bar ≥ res − 1\.5×ATR 80752/);
    assert.match(signal.reason, /vol /);
  });

  it("enters a 1.26× volume spike about 1.4×ATR under resistance", () => {
    assert.equal(BREAKOUT_SPIKE_ATR_BUFFER, 1.5);
    assert.equal(BREAKOUT_VOL_SPIKE, 1.25);
    const res = 80_752;
    const last = 80_520; // ~1.40×ATR under res — outside the old 1× gate, inside 1.5×
    const b = tightTape({ res, lastClose: last, lastVol: 126, lookbackVol: 100, price: res + 20 });
    const bars = completedBars(b);
    const atr = atrPct(bars);
    const vol = volumeRatio(bars, 1);
    assert.equal(vol?.toFixed(2), "1.26");
    assert.ok(atr != null && atr >= BREAKOUT_QUIET_ATR_PCT);
    const atrAbs = atr * last;
    const dist = res - last;
    assert.ok(dist > atrAbs);
    assert.ok(dist <= atrAbs * BREAKOUT_SPIKE_ATR_BUFFER);
    assert.equal(spikeClearsResistance(last, res, atr), true);
    const hit = diagnoseBreakout(b);
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "spike");
      assert.equal(hit.volumeUsed, true);
      assert.equal(hit.atrBufferUsed, true);
      assert.equal(hit.resistance, res);
    }
    const signal = evaluateBtcBreakout(b, 50, "bolt");
    assert.ok(signal);
    assert.ok(signal.entry > res);
    assert.match(signal.reason, /spike bar ≥ res − 1\.5×ATR 80752/);
    assert.match(signal.reason, /vol 1\.26× ≥ 1\.25×/);
  });

  it("still skips a volume spike when last is more than 1.5×ATR below res", () => {
    const res = 80_752;
    const last = 80_200; // ~$552 under res, ~2.7×ATR on this tape
    const b = tightTape({ res, lastClose: last, lastVol: 181 });
    const atr = atrPct(completedBars(b));
    assert.ok(atr != null);
    assert.ok(res - last > atr * last * BREAKOUT_SPIKE_ATR_BUFFER);
    assert.equal(spikeClearsResistance(last, res, atr), false);
    const d = diagnoseBreakout(b);
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.match(d.reason, /last 80200 ≤ res/);
      assert.doesNotMatch(d.reason, /within 1\.5×ATR/);
      assert.match(d.reason, /vol 4\.\d+×/);
      assert.doesNotMatch(d.reason, /< 1\.25×/);
      assert.match(formatBreakoutSkip(d), /BOLT skip · res 80752/);
    }
    assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
  });

  it("keeps the two-close path strict — closes at/under res do not count even inside 1.5×ATR", () => {
    const prior = priorWithHigh(120);
    const weakVol = [...range(BREAKOUT_LOOKBACK, 40, 0), 8, 8];
    const under = diagnoseBreakout(book([...prior, 119.9, 119.95], { volumes: weakVol }));
    assert.equal(under.ok, false);
    if (!under.ok) {
      assert.match(under.reason, /last 120 ≤ res|last 119 ≤ res/);
      assert.doesNotMatch(under.reason, /2×15m/);
    }

    const hit = diagnoseBreakout(book([...prior, 121, 122], { volumes: weakVol }));
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.mode, "two-close");
      assert.equal(hit.atrBufferUsed, false);
    }
  });

  it("still skips a low-volume quiet range when last is under resistance", () => {
    const res = 80_752;
    const last = 80_733;
    const b = tightTape({ res, lastClose: last, lastVol: 28, quiet: true });
    const bars = completedBars(b);
    const atr = atrPct(bars);
    const vol = volumeRatio(bars, 1);
    assert.ok(atr != null && atr < BREAKOUT_QUIET_ATR_PCT);
    assert.ok(vol != null && vol < BREAKOUT_VOL_SPIKE);
    const d = diagnoseBreakout(b);
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.match(d.reason, /last 80733 ≤ res/);
      assert.match(d.reason, /vol .* < 1\.25×/);
      assert.match(d.reason, /quiet range/);
      assert.match(formatBreakoutSkip(d), /BOLT skip · res 80752/);
    }
    assert.equal(evaluateBtcBreakout(b, 50, "bolt"), null);
  });
});
