import type { CryptoBook, CryptoSymbol, PredictionBook } from "./types";
import { MAX_HISTORY, MAX_PRED } from "./modules";
import { num, parseJsonArray } from "./math";

const UA = "survival-mode-paper-bot/1.0";

async function getJson(url: string, timeout = 9000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

const KRAKEN_PAIRS: Record<CryptoSymbol, string> = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  DOGE: "XDGUSD",
};

function krakenResultKey(result: Record<string, unknown>, pair: string): unknown {
  if (result[pair]) return result[pair];
  const keys = Object.keys(result);
  const hit = keys.find((k) => k.includes(pair.replace("USD", "")) || k.endsWith(pair));
  return hit ? result[hit] : Object.values(result)[0];
}

async function krakenTickers(): Promise<Record<CryptoSymbol, number> | null> {
  try {
    const pairs = Object.values(KRAKEN_PAIRS).join(",");
    const json = (await getJson(
      `https://api.kraken.com/0/public/Ticker?pair=${pairs}`,
    )) as { error?: string[]; result?: Record<string, { c?: string[] }> };
    if (!json.result) return null;
    const out = {} as Record<CryptoSymbol, number>;
    for (const [sym, pair] of Object.entries(KRAKEN_PAIRS) as [CryptoSymbol, string][]) {
      const row = krakenResultKey(json.result as Record<string, unknown>, pair) as { c?: string[] };
      const px = num(row?.c?.[0]);
      if (px > 0) out[sym] = px;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function krakenOhlc(symbol: CryptoSymbol, interval = 15): Promise<number[] | null> {
  try {
    const pair = KRAKEN_PAIRS[symbol];
    const json = (await getJson(
      `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`,
    )) as { result?: Record<string, unknown> };
    if (!json.result) return null;
    const rows = krakenResultKey(json.result, pair);
    if (!Array.isArray(rows)) return null;
    const closes: number[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const close = num(row[4]);
      if (close > 0) closes.push(close);
    }
    return closes.length ? closes.slice(-MAX_HISTORY) : null;
  } catch {
    return null;
  }
}

const CG_IDS: Record<CryptoSymbol, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
};

async function coingeckoTickers(): Promise<Record<CryptoSymbol, number> | null> {
  try {
    const ids = Object.values(CG_IDS).join(",");
    const json = (await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    )) as Record<string, { usd?: number }>;
    const out = {} as Record<CryptoSymbol, number>;
    for (const [sym, id] of Object.entries(CG_IDS) as [CryptoSymbol, string][]) {
      const px = num(json[id]?.usd);
      if (px > 0) out[sym] = px;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function coingeckoHistory(symbol: CryptoSymbol): Promise<number[] | null> {
  try {
    const id = CG_IDS[symbol];
    const json = (await getJson(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`,
      12000,
    )) as { prices?: [number, number][] };
    const prices = json.prices ?? [];
    const closes = prices.map((p) => num(p[1])).filter((n) => n > 0);
    if (!closes.length) return null;
    const step = Math.max(1, Math.floor(closes.length / MAX_HISTORY));
    const sampled: number[] = [];
    for (let i = 0; i < closes.length; i += step) sampled.push(closes[i]);
    return sampled.slice(-MAX_HISTORY);
  } catch {
    return null;
  }
}

function asPrediction(
  id: string,
  question: string,
  yes: number,
  volume: number,
  category: PredictionBook["category"],
  prev?: PredictionBook,
): PredictionBook | null {
  if (!question || yes <= 0.01 || yes >= 0.99) return null;
  const history = prev?.history ? [...prev.history] : [];
  history.push(yes);
  return {
    id,
    question,
    yes,
    volume,
    category,
    history: history.slice(-24),
  };
}

function categorize(q: string): PredictionBook["category"] {
  const s = q.toLowerCase();
  if (/(rain|snow|temp|weather|hurricane|noaa)/.test(s)) return "weather";
  if (/(fed|rate|election|president|gdp|cpi|war|trump|harris|vance)/.test(s)) return "macro";
  return "other";
}

async function polymarketSearch(q: string): Promise<PredictionBook[]> {
  const json = (await getJson(
    `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=10`,
  )) as { events?: Array<{ id?: string; title?: string; markets?: unknown[] }> };
  const out: PredictionBook[] = [];
  for (const ev of json.events ?? []) {
    for (const raw of (ev.markets ?? []) as Record<string, unknown>[]) {
      const prices = parseJsonArray(raw.outcomePrices).map((x) => num(x));
      const yes = prices[0] ?? 0;
      const question = String(raw.question ?? ev.title ?? "");
      const id = String(raw.id ?? raw.conditionId ?? `${ev.id}-${question}`);
      const book = asPrediction(id, question, yes, num(raw.volumeNum ?? raw.volume), categorize(question));
      if (book) out.push(book);
    }
  }
  return out;
}

async function polymarketVolume(): Promise<PredictionBook[]> {
  const json = (await getJson(
    "https://gamma-api.polymarket.com/events?limit=12&active=true&closed=false&order=volume24hr&ascending=false",
  )) as Array<{ title?: string; markets?: Record<string, unknown>[] }>;
  const out: PredictionBook[] = [];
  if (!Array.isArray(json)) return out;
  for (const ev of json) {
    for (const raw of ev.markets ?? []) {
      const prices = parseJsonArray(raw.outcomePrices).map((x) => num(x));
      const yes = prices[0] ?? 0;
      const question = String(raw.question ?? ev.title ?? "");
      const id = String(raw.id ?? raw.conditionId ?? question);
      const book = asPrediction(id, question, yes, num(raw.volumeNum ?? raw.volume), categorize(question));
      if (book) out.push(book);
    }
  }
  return out;
}

export async function fetchPredictions(prev: PredictionBook[]): Promise<PredictionBook[]> {
  const prevMap = new Map(prev.map((p) => [p.id, p]));
  try {
    const batches = await Promise.allSettled([
      polymarketSearch("rain"),
      polymarketSearch("Fed"),
      polymarketVolume(),
    ]);
    const merged = new Map<string, PredictionBook>();
    for (const b of batches) {
      if (b.status !== "fulfilled") continue;
      for (const m of b.value) {
        const old = prevMap.get(m.id);
        const next = asPrediction(m.id, m.question, m.yes, m.volume, m.category, old);
        if (next) merged.set(next.id, next);
      }
    }
    const list = [...merged.values()];
    list.sort((a, b) => {
      const rank = (c: PredictionBook["category"]) => (c === "weather" ? 0 : c === "macro" ? 1 : 2);
      const d = rank(a.category) - rank(b.category);
      return d !== 0 ? d : b.volume - a.volume;
    });
    return list.slice(0, MAX_PRED);
  } catch {
    return prev;
  }
}

export async function fetchCrypto(prev: CryptoBook[]): Promise<CryptoBook[]> {
  const prevMap = new Map(prev.map((c) => [c.symbol, c]));
  const symbols: CryptoSymbol[] = ["BTC", "ETH", "SOL", "DOGE"];

  const [tickers, histories] = await Promise.all([
    (async () => (await krakenTickers()) ?? (await coingeckoTickers()))(),
    Promise.all(
      symbols.map(async (sym) => {
        const h = (await krakenOhlc(sym)) ?? (sym === "BTC" || sym === "ETH" ? await coingeckoHistory(sym) : null);
        return [sym, h] as const;
      }),
    ),
  ]);

  if (!tickers) {
    if (prev.length) return prev;
    throw new Error("crypto feeds unavailable (Kraken + CoinGecko)");
  }

  return symbols.map((symbol) => {
    const old = prevMap.get(symbol);
    const histTuple = histories.find((h) => h[0] === symbol)?.[1];
    let history = histTuple && histTuple.length ? [...histTuple] : [...(old?.history ?? [])];
    const price = tickers[symbol] ?? old?.price ?? history.at(-1) ?? 0;
    if (price > 0 && history.at(-1) !== price) history.push(price);
    history = history.slice(-MAX_HISTORY);
    const tape = history;
    return { symbol, price, history, tape };
  });
}

export function applyReplayStep(books: CryptoBook[], index: number): CryptoBook[] {
  return books.map((b) => {
    const tape = b.tape?.length ? b.tape : b.history;
    if (tape.length < 8) return { ...b, tape };
    const i = Math.min(Math.max(index, 0), tape.length - 1);
    const visible = tape.slice(0, i + 1);
    return {
      ...b,
      tape,
      price: tape[i],
      history: visible.length >= 5 ? visible : tape,
    };
  });
}

export function tapeSentiment(book: CryptoBook | undefined): { green: number; total: number; netPct: number } {
  if (!book || book.history.length < 6) return { green: 0, total: 0, netPct: 0 };
  const slice = book.history.slice(-13);
  let green = 0;
  for (let i = 1; i < slice.length; i++) if (slice[i] >= slice[i - 1]) green++;
  const first = slice[0];
  const last = slice[slice.length - 1];
  const netPct = first ? ((last - first) / first) * 100 : 0;
  return { green, total: slice.length - 1, netPct };
}
