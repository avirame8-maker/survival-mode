"use client";

import { useState } from "react";
import type { AgentLife } from "@/lib/engine/types";

export default function Footer({
  demo,
  status,
  onPause,
  onLiquidate,
  onRespawn,
}: {
  demo: boolean;
  status: AgentLife;
  onPause: () => void;
  onLiquidate: () => void;
  onRespawn: () => void;
}) {
  const [armed, setArmed] = useState(false);

  const liquidate = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 6000);
      return;
    }
    setArmed(false);
    onLiquidate();
  };

  return (
    <footer className="foot">
      <div>
        <span className="badge">PAPER TRADING MODE</span>
        {demo ? <span className="badge demo">DEMO CYCLE</span> : null}
      </div>
      <div className="actions">
        {status === "DEAD" ? (
          <button className="btn green" type="button" onClick={onRespawn}>
            RESPAWN AGENT
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={onPause}>
              {status === "PAUSED" ? "RESUME AGENT" : "PAUSE AGENT"}
            </button>
            <button
              className={`btn red ${armed ? "armed" : ""}`}
              type="button"
              onClick={liquidate}
            >
              {armed ? "CONFIRM LIQUIDATE" : "EMERGENCY LIQUIDATE"}
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
