"use client";

import type { ClientState } from "@/lib/engine/types";
import { uptimeLabel } from "@/lib/engine/math";

export default function Header({ state, now }: { state: ClientState; now: number }) {
  const end = state.status === "DEAD" ? (state.diedAt ?? now) : now;
  const life =
    state.status === "DEAD" ? "dead" : state.status === "PAUSED" ? "paused" : "alive";
  return (
    <header className="hdr">
      <h1>GROK BOT / SURVIVAL MODE</h1>
      <div className={`life ${life}`}>
        <span className="dot" />
        {state.status === "DEAD" ? "DEAD" : state.status === "PAUSED" ? "PAUSED" : "ALIVE"}
      </div>
      <div className="meta">
        <span>
          UPTIME<b>{uptimeLabel(state.startedAt, end)}</b>
        </span>
        <span>
          CYCLE<b>#{state.cycle}</b>
        </span>
        <span>
          PID<b>{state.pid}</b>
        </span>
      </div>
    </header>
  );
}
