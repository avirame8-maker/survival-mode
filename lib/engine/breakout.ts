import type { CryptoBar, CryptoBook, Signal } from "./types";
import { BREAKOUT_MAX_FRAC } from "./modules";
import { clamp } from "./math";

/** Two consecutive completed 15m closes, or one spike bar. */
export const BREAKOUT_CONFIRM_BARS = 2;
/** Shorter than week-2's 16 so resistance can refresh in sideways tape. */
export const BREAKOUT_LOOKBACK = 8;
export const BREAKOUT_STOP_PCT = 0.01;
export const BREAKOUT_FIRST_TARGET_PCT = 0.01;
export const BREAKOUT_TAKE_PCT = 0.02;
/** Skip if price has already run more than this above resistance. */
export const BREAKOUT_MAX_EXTENSION = 0.02;
/** Spike-path volume multiple vs the lookback average. Two-close confirm does not use this. */
export const BREAKOUT_VOL_SPIKE = 1.25;
export const BREAKOUT_ATR_PERIOD = 8;
/** ATR/price below this is a quiet range — spike path needs volume or range expansion. */
export const BREAKOUT_QUIET_ATR_PCT = 0.0012;
export const BREAKOUT_SPIKE_RANGE_ATR = 1.2;
export const BREAKOUT_SPIKE_EXT_MIN = 0.0015;
/** Spike path only: last clears resistance if it is within this many ATRs below res. */
export const BREAKOUT_SPIKE_ATR_BUFFER = 1;

export type BreakoutHit = {
  ok: true;
  resistance: number;
  mode: "two-close" | "spike";
  volumeUsed: boolean;
  atrBufferUsed: boolean;
  atrPct: number | null;
  volRatio: number | null;
  closes: number[];
};

export type BreakoutSkip = {
  ok: false;
  reason: string;
  resistance: number | null;
  closes: number[];
  volRatio: number | null;
  atrPct: number | null;
};

export type BreakoutDecision = BreakoutHit | BreakoutSkip;

export function completedBars(book: CryptoBook | undefined): CryptoBar[] {
  if (!book) return [];
  if (book.bars?.length) {
    return book.bars.map((b) => ({
      close: b.close,
      high: b.high > 0 ? b.high : b.close,
      low: b.low > 0 ? b.low : Math.min(b.close, b.open > 0 ? b.open : b.close),
      open: b.open > 0 ? b.open : b.close,
      volume: b.volume ?? 0,
    }));
  }
  const hist = book.history ?? [];
  if (hist.length < 4) return [];
  // Last history print is the live tick — drop it when synthesizing bars.
  return hist.slice(0, -1).map((close) => ({
    close,
    high: close,
    low: close,
    open: close,
    volume: 0,
  }));
}

export function priorResistance(bars: CryptoBar[], exclude = BREAKOUT_CONFIRM_BARS): number | null {
  if (bars.length < BREAKOUT_LOOKBACK + exclude) return null;
  const prior = bars.slice(-(BREAKOUT_LOOKBACK + exclude), -exclude);
  const level = Math.max(...prior.map((b) => (b.high > 0 ? b.high : b.close)));
  return level > 0 ? level : null;
}

export function volumeRatio(bars: CryptoBar[], lastN = 1): number | null {
  if (bars.length < BREAKOUT_LOOKBACK + lastN) return null;
  const prior = bars.slice(-(BREAKOUT_LOOKBACK + lastN), -lastN);
  const last = bars.slice(-lastN);
  if (!last.every((b) => b.volume > 0) || !prior.some((b) => b.volume > 0)) return null;
  const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
  if (!(avg > 0)) return null;
  return last[last.length - 1].volume / avg;
}

export function atrPct(bars: CryptoBar[], period = BREAKOUT_ATR_PERIOD): number | null {
  if (bars.length < period + 1) return null;
  const slice = bars.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const b = slice[i];
    const high = b.high > 0 ? b.high : b.close;
    const low = b.low > 0 ? b.low : Math.min(b.close, high);
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  if (!trs.length) return null;
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  const px = bars.at(-1)?.close ?? 0;
  if (!(px > 0)) return null;
  return atr / px;
}

function lastCloses(bars: CryptoBar[], n = 2): number[] {
  return bars.slice(-n).map((b) => b.close);
}

function barRange(b: CryptoBar): number {
  const high = b.high > 0 ? b.high : b.close;
  const low = b.low > 0 ? b.low : Math.min(b.close, b.open > 0 ? b.open : b.close);
  return Math.max(0, high - low);
}

function closeNearHigh(b: CryptoBar): boolean {
  const high = b.high > 0 ? b.high : b.close;
  const low = b.low > 0 ? b.low : Math.min(b.close, b.open > 0 ? b.open : b.close);
  const range = high - low;
  if (!(range > 0)) return true;
  return (b.close - low) / range >= 0.55;
}

function bullishBar(b: CryptoBar): boolean {
  if (!(b.open > 0)) return true;
  return b.close >= b.open;
}

/** Absolute 1×ATR in price units from the same ATR% the skip log prints. */
function atrAbsFromPct(lastClose: number, atrPct: number | null): number | null {
  if (atrPct == null || !(atrPct >= 0) || !(lastClose > 0)) return null;
  return atrPct * lastClose * BREAKOUT_SPIKE_ATR_BUFFER;
}

/**
 * Spike / ATR-expansion path only. Two-close stays strict (`close > res`).
 * With ATR: `last >= res - 1×ATR`. Without ATR: keep `last > res`.
 */
export function spikeClearsResistance(
  lastClose: number,
  resistance: number,
  atrPct: number | null,
): boolean {
  if (!(lastClose > 0) || !(resistance > 0)) return false;
  const atrAbs = atrAbsFromPct(lastClose, atrPct);
  if (atrAbs == null) return lastClose > resistance;
  return lastClose >= resistance - atrAbs;
}

export function diagnoseBreakout(book: CryptoBook | undefined): BreakoutDecision {
  const bars = completedBars(book);
  const closes = lastCloses(bars);
  const vol = volumeRatio(bars, 1);
  const atr = atrPct(bars);

  if (!book) {
    return { ok: false, reason: "no BTC book", resistance: null, closes, volRatio: vol, atrPct: atr };
  }
  if (bars.length < BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS) {
    return {
      ok: false,
      reason: `need ${BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS} bars have ${bars.length}`,
      resistance: null,
      closes,
      volRatio: vol,
      atrPct: atr,
    };
  }

  const resistance2 = priorResistance(bars, 2);
  const resistance1 = priorResistance(bars, 1);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const price = book.price || last.close || 0;
  const last2 = bars.slice(-2);

  if (resistance2 != null && last2.length === 2 && last2.every((b) => b.close > resistance2)) {
    const ext = price > 0 ? (price - resistance2) / resistance2 : 0;
    if (ext > BREAKOUT_MAX_EXTENSION) {
      return {
        ok: false,
        reason: `extended ${(ext * 100).toFixed(2)}% above res`,
        resistance: resistance2,
        closes,
        volRatio: vol,
        atrPct: atr,
      };
    }
    return {
      ok: true,
      resistance: resistance2,
      mode: "two-close",
      volumeUsed: vol != null && vol >= 1,
      atrBufferUsed: false,
      atrPct: atr,
      volRatio: vol,
      closes,
    };
  }

  const spikeCleared =
    resistance1 != null && price > 0 && spikeClearsResistance(last.close, resistance1, atr);
  const atrBufferUsed = spikeCleared && resistance1 != null && last.close <= resistance1;

  if (spikeCleared && resistance1 != null) {
    const ext = (price - resistance1) / resistance1;
    if (ext > BREAKOUT_MAX_EXTENSION) {
      return {
        ok: false,
        reason: `spike extended ${(ext * 100).toFixed(2)}% above res`,
        resistance: resistance1,
        closes,
        volRatio: vol,
        atrPct: atr,
      };
    }
    const atrAbs = atrAbsFromPct(last.close, atr);
    const rangeExpand = atrAbs != null && barRange(last) >= atrAbs * BREAKOUT_SPIKE_RANGE_ATR;
    const volSpike = vol != null && vol >= BREAKOUT_VOL_SPIKE;
    const strongExt = (last.close - resistance1) / resistance1 >= BREAKOUT_SPIKE_EXT_MIN;
    const quiet = atr != null && atr < BREAKOUT_QUIET_ATR_PCT;
    const spikeOk =
      bullishBar(last) &&
      closeNearHigh(last) &&
      (volSpike || (vol == null && rangeExpand && strongExt) || (rangeExpand && strongExt && !quiet));

    if (spikeOk) {
      return {
        ok: true,
        resistance: resistance1,
        mode: "spike",
        volumeUsed: volSpike,
        atrBufferUsed,
        atrPct: atr,
        volRatio: vol,
        closes,
      };
    }
  }

  const res = resistance2 ?? resistance1;
  const above = res != null ? last2.filter((b) => b.close > res).length : 0;
  const parts: string[] = [];
  if (res == null) parts.push("no resistance");
  else if (last.close <= res) {
    const nearMiss = spikeClearsResistance(last.close, res, atr);
    parts.push(
      nearMiss
        ? `last ${last.close.toFixed(0)} ≤ res · within 1×ATR`
        : `last ${last.close.toFixed(0)} ≤ res`,
    );
  } else parts.push(`${above}/2 closes > res`);
  if (prev && res != null && prev.close <= res && last.close > res) {
    parts.push("need 2nd close or vol spike");
  }
  if (vol != null) {
    const gate = `${BREAKOUT_VOL_SPIKE}×`;
    parts.push(
      vol >= BREAKOUT_VOL_SPIKE
        ? `vol ${vol.toFixed(2)}× ≥ ${gate}`
        : `vol ${vol.toFixed(2)}× < ${gate}`,
    );
  } else {
    parts.push("vol n/a");
  }
  if (atr != null && atr < BREAKOUT_QUIET_ATR_PCT) parts.push("quiet range");
  return {
    ok: false,
    reason: parts.join(" · "),
    resistance: res,
    closes,
    volRatio: vol,
    atrPct: atr,
  };
}

export function formatBreakoutSkip(d: BreakoutSkip): string {
  const res = d.resistance != null ? d.resistance.toFixed(0) : "—";
  const closes = d.closes.length ? d.closes.map((c) => c.toFixed(0)).join("/") : "—";
  const vol = d.volRatio != null ? `${d.volRatio.toFixed(2)}×` : "n/a";
  const atr = d.atrPct != null ? `${(d.atrPct * 100).toFixed(2)}%` : "n/a";
  return `BOLT skip · res ${res} · closes ${closes} · vol ${vol} · ATR ${atr} · ${d.reason}`;
}

export function sizeBreakout(equity: number): number {
  const raw = equity * BREAKOUT_MAX_FRAC;
  return clamp(raw, 0, equity * 0.06);
}

export function evaluateBtcBreakout(
  book: CryptoBook | undefined,
  equity: number,
  moduleId: string,
): Signal | null {
  const hit = diagnoseBreakout(book);
  if (!hit.ok || !book) return null;
  const bars = completedBars(book);
  const price = book.price || bars.at(-1)?.close || 0;
  if (!(price > 0)) return null;
  const notional = sizeBreakout(equity);
  if (notional < 2.2) return null;
  const volBit =
    hit.mode === "spike"
      ? hit.volumeUsed && hit.volRatio != null
        ? `vol ${hit.volRatio.toFixed(2)}× ≥ ${BREAKOUT_VOL_SPIKE}×`
        : "ATR expand"
      : hit.volumeUsed
        ? "vol confirm"
        : "close confirm";
  const setup = hit.mode === "two-close" ? "2×15m close" : "spike bar";
  const vsRes = hit.atrBufferUsed ? "≥ res − 1×ATR" : "> res";
  return {
    moduleId,
    venue: "crypto",
    symbol: "BTC",
    label: "BTC-USD BREAKOUT",
    side: 1,
    notional,
    entry: price,
    maxHold: 8,
    stopPct: BREAKOUT_STOP_PCT,
    takePct: BREAKOUT_TAKE_PCT,
    firstTargetPct: BREAKOUT_FIRST_TARGET_PCT,
    reason: `${setup} ${vsRes} ${hit.resistance.toFixed(0)} · ${volBit}`,
  };
}
