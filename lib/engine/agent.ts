import type { AgentState, ClientState, LogEntry, Position } from "./types";
import {
  INITIAL_CAPITAL,
  MAX_CURVE,
  MAX_LOG,
  MODULES,
  SUBSCRIPTION_MONTHLY,
  moduleDef,
} from "./modules";
import { round2, uid, uptimeLabel } from "./math";
import { loadState, saveState } from "./store";
import { applyReplayStep, fetchCrypto, fetchPredictions, tapeSentiment } from "./markets";
import { evaluateModule, markOf, scanNotes, unrealized } from "./strategies";

const g = globalThis as unknown as {
  __survivalTimer?: ReturnType<typeof setInterval>;
  __survivalStarted?: boolean;
};

function envDemo(): boolean {
  return process.env.DEMO === "1";
}

function envCycleMs(demo: boolean): number {
  const n = Number(process.env.CYCLE_MS);
  if (Number.isFinite(n) && n >= 1000) return n;
  return demo ? 6000 : 15 * 60 * 1000;
}

function freshState(demo: boolean, cycleMs: number): AgentState {
  return {
    version: 3,
    status: "ALIVE",
    demo,
    cycleMs,
    startedAt: Date.now(),
    diedAt: null,
    lastCycleAt: 0,
    pid: process.pid,
    cycle: 0,
    cash: INITIAL_CAPITAL,
    initialCapital: INITIAL_CAPITAL,
    subscriptionMonthly: SUBSCRIPTION_MONTHLY,
    subscriptionPaid: 0,
    wins: 0,
    losses: 0,
    resolvedCount: 0,
    modules: MODULES.map((m) => ({
      id: m.id,
      paused: false,
      autoPaused: false,
      realizedPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      lastNote: "",
    })),
    positions: [],
    log: [],
    equityCurve: [],
    crypto: [],
    predictions: [],
    ready: false,
    booting: true,
    bootLines: ["GROK BOT / SURVIVAL MODE", "booting paper broker…"],
    lastFeedAt: 0,
    feedError: null,
    replayIndex: 8,
  };
}

function pnlOf(p: Position, mark: number): number {
  return unrealized(p.entry, mark, p.qty, p.side);
}

export class Agent {
  state: AgentState;
  private ticking = false;
  private listeners = new Set<(s: ClientState) => void>();
  private persistQ: Promise<void> = Promise.resolve();
  private bootPromise: Promise<void> | null = null;
  private diskHydrated = false;

  constructor(state: AgentState) {
    this.state = state;
    this.state.pid = process.pid;
    this.state.demo = envDemo();
    this.state.cycleMs = envCycleMs(this.state.demo);
  }

  subscribe(fn: (s: ClientState) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): ClientState {
    const s = this.state;
    const uPnl = s.positions.reduce((acc, p) => acc + pnlOf(p, p.mark), 0);
    const deployed = s.positions.reduce((acc, p) => acc + p.notional, 0);
    const equity = round2(s.cash + deployed + uPnl);
    const totalPnl = round2(equity - s.initialCapital);
    const trades = s.wins + s.losses;
    return {
      status: s.status,
      demo: s.demo,
      cycleMs: s.cycleMs,
      startedAt: s.startedAt,
      diedAt: s.diedAt,
      pid: s.pid,
      cycle: s.cycle,
      cash: round2(s.cash),
      equity,
      initialCapital: s.initialCapital,
      realizedPnl: round2(equity - s.initialCapital - uPnl),
      unrealizedPnl: round2(uPnl),
      totalPnl,
      totalPnlPct: s.initialCapital ? (totalPnl / s.initialCapital) * 100 : 0,
      subscriptionMonthly: s.subscriptionMonthly,
      subscriptionPaid: round2(s.subscriptionPaid),
      wins: s.wins,
      losses: s.losses,
      winRate: trades ? (s.wins / trades) * 100 : 0,
      resolvedCount: s.resolvedCount,
      modules: MODULES.map((def) => {
        const rt = s.modules.find((m) => m.id === def.id)!;
        return {
          ...def,
          ...rt,
          open: s.positions.some((p) => p.moduleId === def.id),
        };
      }),
      positions: s.positions,
      log: s.log.slice(0, 80),
      equityCurve: s.equityCurve.slice(-240),
      ready: s.ready,
      booting: s.booting,
      bootLines: s.bootLines.slice(-8),
      feedError: s.feedError,
      lastFeedAt: s.lastFeedAt,
      lastCycleAt: s.lastCycleAt,
      deployed: round2(deployed),
    };
  }

  emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore */
      }
    }
  }

  private persist(): Promise<void> {
    const copy = this.state;
    this.persistQ = this.persistQ
      .then(() => saveState(copy))
      .catch((err) => {
        console.error("paper persist failed", err);
      });
    return this.persistQ;
  }

  private pushLog(
    kind: LogEntry["kind"],
    text: string,
    extra?: { amount?: number; moduleId?: string },
  ) {
    const now = Date.now();
    const entry: LogEntry = {
      id: uid(),
      ts: now,
      uptime: uptimeLabel(this.state.startedAt, this.state.diedAt ?? now),
      kind,
      text,
      amount: extra?.amount,
      moduleId: extra?.moduleId,
    };
    this.state.log.unshift(entry);
    if (this.state.log.length > MAX_LOG) this.state.log.length = MAX_LOG;
  }

  private bootLine(line: string) {
    this.state.bootLines.push(line);
    if (this.state.bootLines.length > 12) this.state.bootLines.shift();
    this.pushLog("system", line);
    this.emit();
  }

  private equity(): number {
    const uPnl = this.state.positions.reduce((acc, p) => acc + pnlOf(p, p.mark), 0);
    const deployed = this.state.positions.reduce((acc, p) => acc + p.notional, 0);
    return this.state.cash + deployed + uPnl;
  }

  private moduleRt(id: string) {
    return this.state.modules.find((m) => m.id === id)!;
  }

  async ensureRunning(): Promise<void> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    if (!g.__survivalTimer) {
      g.__survivalTimer = setInterval(() => {
        void this.maybeTick();
      }, 1000);
    }
    await this.bootPromise;
  }

  private async boot() {
    if (!this.diskHydrated) {
      const saved = await loadState();
      this.diskHydrated = true;
      if (saved && saved.demo === envDemo()) {
        saved.pid = process.pid;
        saved.demo = envDemo();
        saved.cycleMs = envCycleMs(saved.demo);
        saved.booting = true;
        saved.ready = false;
        saved.crypto = (saved.crypto ?? []).map((c) => ({
          ...c,
          tape: c.tape?.length ? c.tape : c.history ?? [],
          history: c.history ?? [],
        }));
        this.state = saved;
      }
    }
    this.state.booting = true;
    this.state.pid = process.pid;
    this.emit();
    try {
      this.bootLine("loading public price feeds…");
      const [crypto, predictions] = await Promise.all([
        fetchCrypto(this.state.crypto),
        fetchPredictions(this.state.predictions),
      ]);
      this.state.crypto = crypto;
      this.state.predictions = predictions;
      this.state.lastFeedAt = Date.now();
      this.state.feedError = null;
      this.bootLine(
        `FEED kraken/coingecko · BTC ${crypto.find((c) => c.symbol === "BTC")?.price.toFixed(0) ?? "—"}`,
      );
      this.bootLine(`FEED polymarket gamma · ${predictions.length} live books`);
      this.bootLine("FV windows seeded (SMA20 / EMA5)");
      this.bootLine(`paper broker ready · capital ${this.state.initialCapital.toFixed(2)} USD`);
      this.bootLine(
        this.state.demo
          ? "DEMO cadence · accelerated cycles"
          : "PAPER WEEK · $50 · 15m cadence · no live money",
      );
      this.bootLine("survival law armed · $200/mo from profits");

      if (this.state.demo && this.state.cycle === 0 && this.state.status === "ALIVE") {
        const depth = Math.min(
          12,
          Math.max(...this.state.crypto.map((c) => c.history.length), 12),
        );
        this.state.replayIndex = Math.max(16, depth - 14);
        for (let i = 0; i < 8; i++) {
          await this.runCycle(true);
        }
      } else if (!this.state.demo && this.state.lastCycleAt === 0) {
        // Paper week: wait a full 15m cadence before the first trade cycle.
        this.state.lastCycleAt = Date.now();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.feedError = msg;
      this.bootLine(`FEED ERROR ${msg}`);
    } finally {
      this.state.booting = false;
      this.state.ready = true;
      await this.persist();
      this.emit();
    }
  }

  async maybeTick(force = false) {
    if (this.ticking) return;
    if (!this.state.ready) return;
    if (this.state.status !== "ALIVE") return;
    const due = Date.now() - this.state.lastCycleAt >= this.state.cycleMs;
    if (!force && !due) return;
    await this.runCycle(false);
  }

  /** Cron / durable wake: boot feeds if needed, then run one paper cycle. */
  async tickNow() {
    await this.ensureRunning();
    await this.maybeTick(true);
    await this.persist();
    return this.snapshot();
  }

  private async refreshFeeds() {
    try {
      const [crypto, predictions] = await Promise.all([
        fetchCrypto(this.state.crypto),
        fetchPredictions(this.state.predictions),
      ]);
      this.state.crypto = crypto;
      this.state.predictions = predictions;
      this.state.lastFeedAt = Date.now();
      this.state.feedError = null;
    } catch (err) {
      this.state.feedError = err instanceof Error ? err.message : String(err);
      this.pushLog("system", `FEED TIMEOUT — using last mark (${this.state.feedError})`);
    }
  }

  private async runCycle(bootstrap: boolean) {
    this.ticking = true;
    try {
      if (this.state.status !== "ALIVE") return;

      const tapeLen = Math.max(
        0,
        ...this.state.crypto.map((c) => (c.tape?.length ? c.tape.length : c.history.length)),
      );
      const replaying = this.state.demo && tapeLen > 10 && this.state.replayIndex < tapeLen - 1;
      if (!bootstrap) {
        if (replaying) {
          try {
            this.state.predictions = await fetchPredictions(this.state.predictions);
            this.state.lastFeedAt = Date.now();
          } catch {
            /* keep last books */
          }
        } else {
          await this.refreshFeeds();
        }
      }

      if (replaying) {
        this.state.crypto = applyReplayStep(this.state.crypto, this.state.replayIndex);
        this.state.replayIndex += 1;
      }

      this.state.cycle += 1;
      this.state.lastCycleAt = Date.now();
      this.markPositions();

      const eq = this.equity();
      this.closeDuePositions(eq);
      this.maybePaySubscription(eq);
      this.maybePivot();
      this.openSignals();
      this.markPositions();

      const equity = round2(this.equity());
      this.state.equityCurve.push({ t: Date.now(), equity });
      if (this.state.equityCurve.length > MAX_CURVE) {
        this.state.equityCurve = this.state.equityCurve.slice(-MAX_CURVE);
      }

      if (this.state.cycle % 1 === 0) {
        const notes = scanNotes(this.state);
        const btc = this.state.crypto.find((c) => c.symbol === "BTC");
        const tape = tapeSentiment(btc);
        if (tape.total) {
          notes.push(
            `tape: BTC ${tape.green}/${tape.total} green prints, net ${tape.netPct >= 0 ? "+" : ""}${tape.netPct.toFixed(2)}%`,
          );
        }
        for (const n of notes.slice(0, 1)) this.pushLog("scan", n);
      }

      if (equity <= 0.004) {
        this.kill("BALANCE $0.00 — SUBSCRIPTION CANCELLED — AGENT DEAD");
      }

      this.persist();
      this.emit();
    } finally {
      this.ticking = false;
    }
  }

  private markPositions() {
    for (const p of this.state.positions) {
      p.mark = markOf(this.state, p);
    }
  }

  private closeDuePositions(equity: number) {
    const keep: Position[] = [];
    for (const p of this.state.positions) {
      const mark = p.mark;
      const pnl = pnlOf(p, mark);
      const ret = p.notional ? pnl / p.notional : 0;
      const held = this.state.cycle - p.openedCycle;
      let why = "";
      if (ret <= -p.stopPct) why = "STOP";
      else if (ret >= p.takePct) why = "TARGET";
      else if (held >= p.maxHold) why = "TIME";
      if (!why) {
        keep.push(p);
        continue;
      }
      this.settle(p, pnl, why);
    }
    this.state.positions = keep;
    void equity;
  }

  private settle(p: Position, pnl: number, why: string) {
    const realized = round2(pnl);
    this.state.cash = round2(this.state.cash + p.notional + realized);
    this.state.resolvedCount += 1;
    if (realized >= 0) this.state.wins += 1;
    else this.state.losses += 1;
    const rt = this.moduleRt(p.moduleId);
    rt.realizedPnl = round2(rt.realizedPnl + realized);
    rt.trades += 1;
    if (realized >= 0) rt.wins += 1;
    else rt.losses += 1;
    const def = moduleDef(p.moduleId);
    this.pushLog("resolved", `RESOLVED ${realized >= 0 ? "+" : "-"}$${Math.abs(realized).toFixed(2)}`, {
      amount: realized,
      moduleId: p.moduleId,
    });
    this.pushLog("scan", `${def.name} ${why} · ${p.label.slice(0, 48)}`, { moduleId: p.moduleId });
  }

  private maybePaySubscription(equity: number) {
    const profit = Math.max(0, equity - this.state.initialCapital);
    if (profit <= 0) return;
    const target = Math.min(this.state.subscriptionMonthly, profit * 0.2);
    const unpaid = round2(target - this.state.subscriptionPaid);
    if (unpaid < 0.05) return;
    const floor = 8;
    const payable = Math.min(unpaid, Math.max(0, this.state.cash - floor));
    if (payable < 0.05) return;
    this.state.cash = round2(this.state.cash - payable);
    this.state.subscriptionPaid = round2(this.state.subscriptionPaid + payable);
    this.pushLog(
      "system",
      `SUBSCRIPTION ${payable.toFixed(2)} → ${this.state.subscriptionPaid.toFixed(2)}/${this.state.subscriptionMonthly.toFixed(0)}`,
    );
  }

  private maybePivot() {
    const ilsa = this.moduleRt("ilsa");
    if (ilsa.paused || ilsa.autoPaused) return;
    if (ilsa.realizedPnl <= -4 || (ilsa.losses >= 3 && ilsa.realizedPnl < 0)) {
      ilsa.paused = true;
      ilsa.autoPaused = true;
      ilsa.lastNote = "ETH bleeding — withdrew";
      this.pushLog(
        "system",
        "ETH bleeding — ILSA withdrew, rotating capital into BTC DIP (BOLT)",
        { moduleId: "ilsa" },
      );
    }
  }

  private openSignals() {
    if (this.state.status !== "ALIVE") return;
    const equity = this.equity();
    if (equity < 6) return;
    const deployed = this.state.positions.reduce((a, p) => a + p.notional, 0);
    const boostBolt = this.moduleRt("ilsa").autoPaused ? 1.28 : 1;
    const room = equity * 0.46 - deployed;

    for (const mod of this.state.modules) {
      if (mod.paused) continue;
      if (room < 2.5) break;
      const signal = evaluateModule(mod.id, this.state, equity, boostBolt);
      if (!signal) continue;
      const notional = round2(Math.min(signal.notional, room, this.state.cash * 0.9, equity * 0.18));
      if (notional < 2.2 || this.state.cash < notional + 1.5) continue;
      const qty = signal.entry > 0 ? notional / signal.entry : 0;
      if (qty <= 0) continue;
      const pos: Position = {
        id: uid(),
        moduleId: signal.moduleId,
        venue: signal.venue,
        symbol: signal.symbol,
        label: signal.label,
        side: signal.side,
        qty,
        notional,
        entry: signal.entry,
        mark: signal.entry,
        openedCycle: this.state.cycle,
        openedAt: Date.now(),
        maxHold: signal.maxHold,
        stopPct: signal.stopPct,
        takePct: signal.takePct,
        reason: signal.reason,
      };
      this.state.positions.push(pos);
      this.state.cash = round2(this.state.cash - notional);
      const def = moduleDef(mod.id);
      const q =
        signal.venue === "prediction"
          ? `"${signal.label.slice(0, 48)}"`
          : signal.label;
      this.pushLog(
        "order",
        `ORDER $${notional.toFixed(2)} ${q}`,
        { amount: notional, moduleId: mod.id },
      );
      this.pushLog("scan", `${def.name} ${signal.side > 0 ? "LONG" : "SHORT"} · ${signal.reason}`, {
        moduleId: mod.id,
      });
      mod.lastNote = signal.reason;
    }
  }

  private kill(reason: string) {
    for (const p of [...this.state.positions]) {
      this.settle(p, pnlOf(p, p.mark), "DEATH");
    }
    this.state.positions = [];
    this.state.cash = 0;
    this.state.status = "DEAD";
    this.state.diedAt = Date.now();
    this.pushLog("death", reason);
    this.state.equityCurve.push({ t: Date.now(), equity: 0 });
  }

  async pauseAgent() {
    if (this.state.status === "DEAD") return this.snapshot();
    this.state.status = "PAUSED";
    this.pushLog("control", "AGENT PAUSED — cycles frozen, positions held");
    this.persist();
    this.emit();
    return this.snapshot();
  }

  async resumeAgent() {
    if (this.state.status === "DEAD") return this.snapshot();
    this.state.status = "ALIVE";
    this.pushLog("control", "AGENT RESUMED — survival clock running");
    this.persist();
    this.emit();
    return this.snapshot();
  }

  async liquidate() {
    if (this.state.status === "DEAD") return this.snapshot();
    this.markPositions();
    for (const p of [...this.state.positions]) {
      this.settle(p, pnlOf(p, p.mark), "LIQUIDATE");
    }
    this.state.positions = [];
    this.pushLog("control", "EMERGENCY LIQUIDATE — all paper positions flattened");
    const equity = round2(this.equity());
    this.state.equityCurve.push({ t: Date.now(), equity });
    if (equity <= 0.004) this.kill("BALANCE $0.00 AFTER LIQUIDATE — AGENT DEAD");
    this.persist();
    this.emit();
    return this.snapshot();
  }

  async setModulePaused(id: string, paused: boolean) {
    const rt = this.state.modules.find((m) => m.id === id);
    if (!rt) return this.snapshot();
    rt.paused = paused;
    if (!paused) rt.autoPaused = false;
    rt.lastNote = paused ? "manual pause" : "manual resume";
    const def = moduleDef(id);
    this.pushLog("control", `${def.name} ${paused ? "PAUSED" : "ACTIVE"}`, { moduleId: id });
    this.persist();
    this.emit();
    return this.snapshot();
  }

  async debugKill() {
    if (!this.state.demo) return this.snapshot();
    this.markPositions();
    this.kill("BALANCE $0.00 — SUBSCRIPTION CANCELLED — AGENT DEAD");
    this.persist();
    this.emit();
    return this.snapshot();
  }

  async respawn() {
    const demo = this.state.demo;
    const cycleMs = this.state.cycleMs;
    this.state = freshState(demo, cycleMs);
    this.diskHydrated = true;
    this.bootPromise = this.boot();
    this.persist();
    this.emit();
    await this.bootPromise;
    return this.snapshot();
  }
}

export function createInitialState(): AgentState {
  const demo = envDemo();
  return freshState(demo, envCycleMs(demo));
}

