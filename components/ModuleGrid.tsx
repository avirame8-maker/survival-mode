"use client";

import type { ClientState } from "@/lib/engine/types";

type Mod = ClientState["modules"][number];

export default function ModuleGrid({
  modules,
  onToggle,
  dead,
}: {
  modules: Mod[];
  onToggle: (id: string, paused: boolean) => void;
  dead: boolean;
}) {
  return (
    <section className="modules">
      {modules.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`mod ${m.paused ? "paused" : ""}`}
          style={{ ["--mod" as string]: m.color }}
          onClick={() => !dead && onToggle(m.id, !m.paused)}
          aria-pressed={m.paused}
          title={`${m.name} ${m.paused ? "paused" : "active"} — ${m.strategy}`}
          disabled={dead}
        >
          <span className="idx">{m.idx}</span>
          {m.paused ? (
            <span className="mute" aria-hidden>
              <MuteIcon />
            </span>
          ) : null}
          <span className="icon">
            {m.id === "rigo" ? <HazardPause paused={m.paused} /> : <PausePlay paused={m.paused} />}
          </span>
          <span className="name">{m.name}</span>
          <span className="strat">{m.paused ? "PAUSED" : m.strategy}</span>
        </button>
      ))}
    </section>
  );
}

function PausePlay({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 34 34" width="34" height="34" fill="currentColor">
      <path d="M12 8v18l16-9-16-9z" />
    </svg>
  ) : (
    <svg viewBox="0 0 34 34" width="34" height="34" fill="currentColor">
      <rect x="10" y="8" width="5" height="18" />
      <rect x="19" y="8" width="5" height="18" />
    </svg>
  );
}

function HazardPause({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 34 34" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M17 4 L32 30 H2 Z" />
      {paused ? (
        <path d="M14 14 l8 5 -8 5 z" fill="currentColor" stroke="none" />
      ) : (
        <>
          <rect x="13" y="14" width="2.6" height="9" fill="currentColor" stroke="none" />
          <rect x="18.4" y="14" width="2.6" height="9" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </svg>
  );
}
