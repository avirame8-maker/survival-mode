"use client";

import type { ClientState } from "@/lib/engine/types";
import { useEffect, useState } from "react";
import Header from "./Header";
import Metrics from "./Metrics";
import BalanceChart from "./BalanceChart";
import ActivityLog from "./ActivityLog";
import ModuleGrid from "./ModuleGrid";
import Footer from "./Footer";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ClientState;
}

export default function Dashboard() {
  const [state, setState] = useState<ClientState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let alive = true;

    const apply = (s: ClientState) => {
      if (alive) setState(s);
    };

    void fetch("/api/state")
      .then((r) => r.json())
      .then(apply)
      .catch((e: Error) => setErr(e.message));

    try {
      es = new EventSource("/api/stream");
      es.onmessage = (ev) => {
        try {
          apply(JSON.parse(ev.data) as ClientState);
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* polling fallback */
    }

    const poll = setInterval(() => {
      void fetch("/api/state")
        .then((r) => r.json())
        .then(apply)
        .catch(() => undefined);
    }, 2500);

    const tick = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      alive = false;
      es?.close();
      if (poll) clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const act = async (action: string) => {
    const next = await post("/api/control", { action });
    setState(next);
  };

  const toggleMod = async (id: string, paused: boolean) => {
    const next = await post("/api/modules", { id, paused });
    setState(next);
  };

  if (!state || (state.booting && state.cycle === 0)) {
    return (
      <div className="shell">
        <div className="boot">
          <div className="t">GROK BOT / SURVIVAL MODE</div>
          {(state?.bootLines ?? ["> connecting public feeds…", "> arming survival law…"]).map(
            (l, i) => (
              <div className="l" key={`${l}-${i}`}>
                {l.replace(/^> /, "")}
              </div>
            ),
          )}
          {err ? <div className="l">{err}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`shell ${state.status === "DEAD" ? "dead" : ""}`}>
      <Header state={state} now={now} />
      {state.status === "DEAD" ? (
        <div className="killbar">
          subscription cancelled · balance $0.00 · agent dead
        </div>
      ) : null}
      <Metrics state={state} />
      <div className="main">
        <section className="panel">
          <div className="panel-h">
            <span>{"// BALANCE HISTORY"}</span>
            <b>
              {hoursLabel(state, now)} / 48H
            </b>
          </div>
          <div className="chart-wrap">
            <BalanceChart points={state.equityCurve} equity={state.equity} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-h">
            <span>{"// ACTIVITY LOG"}</span>
            <b>{state.resolvedCount} RESOLVED</b>
          </div>
          <ActivityLog entries={state.log} />
        </section>
      </div>
      <ModuleGrid modules={state.modules} onToggle={toggleMod} dead={state.status === "DEAD"} />
      <Footer
        demo={state.demo}
        cycleMs={state.cycleMs}
        status={state.status}
        onPause={() => act(state.status === "PAUSED" ? "resume" : "pause")}
        onLiquidate={() => act("liquidate")}
        onRespawn={() => act("respawn")}
      />
    </div>
  );
}

function hoursLabel(state: ClientState, now: number): string {
  const end = state.status === "DEAD" ? (state.diedAt ?? now) : now;
  const h = Math.max(0, (end - state.startedAt) / 3600000);
  return `${h < 1 ? h.toFixed(2) : h.toFixed(1)}H`;
}
