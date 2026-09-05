export type AgentLife = "ALIVE" | "PAUSED" | "DEAD";
export type Venue = "crypto" | "prediction";
export type CryptoSymbol = "BTC" | "ETH" | "SOL" | "DOGE";

export interface ModuleDef {
  id: string;
  idx: string;
  name: string;
  color: string;
  strategy: string;
  flavor:
    | "btc-breakout"
    | "prediction"
    | "eth-momentum"
    | "mean-reversion"
    | "macro"
    | "alts";
}

export interface ModuleRuntime {
  id: string;
  paused: boolean;
  autoPaused: boolean;
  realizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
  lastNote: string;
}

export interface Position {
  id: string;
  moduleId: string;
  venue: Venue;
  symbol: string;
  label: string;
  side: 1 | -1;
  qty: number;
  notional: number;
  entry: number;
  mark: number;
  openedCycle: number;
  openedAt: number;
  maxHold: number;
  stopPct: number;
  takePct: number;
  firstTargetPct?: number;
  partialTaken?: boolean;
  reason: string;
}

export interface LogEntry {
  id: string;
  ts: number;
  uptime: string;
  kind: "order" | "resolved" | "scan" | "system" | "control" | "death";
  moduleId?: string;
  text: string;
  amount?: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface CryptoBar {
  close: number;
  high: number;
  volume: number;
}

export interface CryptoBook {
  symbol: CryptoSymbol;
  price: number;
  history: number[];
  tape: number[];
  bars: CryptoBar[];
}

export interface PredictionBook {
  id: string;
  question: string;
  yes: number;
  volume: number;
  category: "weather" | "macro" | "other";
  history: number[];
}

export interface AgentState {
  version: 4;
  paperWeek: number;
  status: AgentLife;
  demo: boolean;
  cycleMs: number;
  startedAt: number;
  diedAt: number | null;
  lastCycleAt: number;
  pid: number;
  cycle: number;
  cash: number;
  initialCapital: number;
  subscriptionMonthly: number;
  subscriptionPaid: number;
  wins: number;
  losses: number;
  resolvedCount: number;
  modules: ModuleRuntime[];
  positions: Position[];
  log: LogEntry[];
  equityCurve: EquityPoint[];
  crypto: CryptoBook[];
  predictions: PredictionBook[];
  ready: boolean;
  booting: boolean;
  bootLines: string[];
  lastFeedAt: number;
  feedError: string | null;
  replayIndex: number;
}

export interface ClientState {
  status: AgentLife;
  demo: boolean;
  cycleMs: number;
  paperWeek: number;
  startedAt: number;
  diedAt: number | null;
  pid: number;
  cycle: number;
  cash: number;
  equity: number;
  initialCapital: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  subscriptionMonthly: number;
  subscriptionPaid: number;
  wins: number;
  losses: number;
  winRate: number;
  resolvedCount: number;
  modules: Array<
    ModuleDef &
      ModuleRuntime & {
        open: boolean;
      }
  >;
  positions: Position[];
  log: LogEntry[];
  equityCurve: EquityPoint[];
  ready: boolean;
  booting: boolean;
  bootLines: string[];
  feedError: string | null;
  lastFeedAt: number;
  lastCycleAt: number;
  deployed: number;
}

export interface Signal {
  moduleId: string;
  venue: Venue;
  symbol: string;
  label: string;
  side: 1 | -1;
  notional: number;
  entry: number;
  maxHold: number;
  stopPct: number;
  takePct: number;
  firstTargetPct?: number;
  reason: string;
}
