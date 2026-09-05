import type { CryptoBar, CryptoBook, Signal } from "./types";
import { BREAKOUT_MAX_FRAC } from "./modules";
import { clamp } from "./math";

export const BREAKOUT_CONFIRM_BARS = 3;
export const BREAKOUT_LOOKBACK = 16;
export const BREAKOUT_STOP_PCT = 0.01;
export const BREAKOUT_FIRST_TARGET_PCT = 0.01;
export const BREAKOUT_TAKE_PCT = 0.02;
/** Skip if price has already run more than this above resistance. */
export const BREAKOUT_MAX_EXTENSION = 0.015;

export function completedBars(book: CryptoBook | undefined): CryptoBar[] {
  if (!book) return [];
  if (book.bars?.length) return book.bars;
  const hist = book.history ?? [];
  if (hist.length < 4) return [];
  // Last history print is the live tick — drop it when synthesizing bars.
  return hist.slice(0, -1).map((close) => ({ close, high: close, volume: 0 }));
}

export function priorResistance(bars: CryptoBar[]): number | null {
  if (bars.length < BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS) return null;
  const prior = bars.slice(-(BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS), -BREAKOUT_CONFIRM_BARS);
  const level = Math.max(...prior.map((b) => (b.high > 0 ? b.high : b.close)));
  return level > 0 ? level : null;
}

export function volumeConfirming(bars: CryptoBar[]): boolean | null {
  if (bars.length < BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS) return null;
  const prior = bars.slice(-(BREAKOUT_LOOKBACK + BREAKOUT_CONFIRM_BARS), -BREAKOUT_CONFIRM_BARS);
  const last3 = bars.slice(-BREAKOUT_CONFIRM_BARS);
  if (!last3.every((b) => b.volume > 0) || !prior.some((b) => b.volume > 0)) return null;
  const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
  if (!(avg > 0)) return null;
  const rising =
    last3[2].volume >= last3[0].volume &&
    last3[2].volume >= last3[1].volume * 0.95 &&
    last3[2].volume >= avg * 0.9;
  const aboveAvg = last3.filter((b) => b.volume >= avg * 0.9).length >= 2;
  return rising || aboveAvg;
}

export function breakoutLong(bars: CryptoBar[]): {
  resistance: number;
  volumeUsed: boolean;
} | null {
  const resistance = priorResistance(bars);
  if (resistance == null) return null;
  const last3 = bars.slice(-BREAKOUT_CONFIRM_BARS);
  if (last3.length < BREAKOUT_CONFIRM_BARS) return null;
  if (!last3.every((b) => b.close > resistance)) return null;
  const vol = volumeConfirming(bars);
  if (vol === false) return null;
  return { resistance, volumeUsed: vol === true };
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
  const bars = completedBars(book);
  const hit = breakoutLong(bars);
  if (!hit || !book) return null;
  const price = book.price || bars.at(-1)?.close || 0;
  if (!(price > 0)) return null;
  const ext = (price - hit.resistance) / hit.resistance;
  if (ext > BREAKOUT_MAX_EXTENSION) return null;
  const notional = sizeBreakout(equity);
  if (notional < 2.2) return null;
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
    reason: `3×15m close > res ${hit.resistance.toFixed(0)} · ${hit.volumeUsed ? "vol confirm" : "close confirm"}`,
  };
}
