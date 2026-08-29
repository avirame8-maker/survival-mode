export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sma(xs: number[], n: number): number | null {
  if (xs.length === 0) return null;
  const k = Math.min(Math.max(n, 1), xs.length);
  const slice = xs.slice(-k);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function ema(xs: number[], n: number): number | null {
  if (xs.length < 2) return xs.length ? xs[0] : null;
  const k = 2 / (n + 1);
  let e = xs[0];
  for (let i = 1; i < xs.length; i++) e = xs[i] * k + e * (1 - k);
  return e;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function returns(xs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i - 1] === 0) continue;
    out.push((xs[i] - xs[i - 1]) / xs[i - 1]);
  }
  return out;
}

export function gapVsFair(price: number, fair: number): number {
  if (!fair) return 0;
  return (price - fair) / fair;
}

export function reliability(history: number[]): number {
  const r = returns(history.slice(-16));
  const vol = stdev(r);
  return clamp(0.28 / (vol * 80 + 0.28), 0.3, 1.35);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function uptimeLabel(startedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const v = JSON.parse(value) as unknown;
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
