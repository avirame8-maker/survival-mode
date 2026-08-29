"use client";

import type { ClientState } from "@/lib/engine/types";
import { pct, usd, usdDelta } from "@/lib/format";

export default function Metrics({ state }: { state: ClientState }) {
  const pnlCls = state.totalPnl > 0 ? "green" : state.totalPnl < 0 ? "red" : "";
  const subFilled = Math.min(1, state.subscriptionPaid / state.subscriptionMonthly);
  const due =
    state.status === "DEAD"
      ? "cancelled"
      : state.subscriptionPaid >= state.subscriptionMonthly - 0.01
        ? "paid"
        : "due";
  return (
    <section className="metrics">
      <div className="card balance">
        <div className="k">CURRENT BALANCE</div>
        <div className="v">{usd(state.equity)}</div>
        <div className="s">initial: {usd(state.initialCapital)}</div>
      </div>
      <div className="card">
        <div className="k">TOTAL P&L</div>
        <div className={`v ${pnlCls}`}>{usdDelta(state.totalPnl)}</div>
        <div className={`s ${pnlCls}`}>{pct(state.totalPnlPct, 1)}</div>
      </div>
      <div className="card">
        <div className="k">SUBSCRIPTION</div>
        <div className="v">{usd(state.subscriptionPaid)}</div>
        <div className="s">
          {usd(state.subscriptionMonthly, 0)}/mo · {due}
        </div>
        <div className="meter">
          <span style={{ width: `${subFilled * 100}%` }} />
        </div>
      </div>
      <div className="card">
        <div className="k">WIN RATE</div>
        <div className="v">
          {state.wins + state.losses === 0 ? "—" : `${state.winRate.toFixed(1)}%`}
        </div>
        <div className="s">
          {state.wins}W / {state.losses}L
        </div>
      </div>
    </section>
  );
}
