"use client";

import type { LogEntry } from "@/lib/engine/types";
import { usdDelta } from "@/lib/format";

export default function ActivityLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="log">
      {entries.length === 0 ? (
        <div className="log-row">
          <span className="ts">[--:--:--]</span>
          <span className="scan">waiting for first cycle…</span>
        </div>
      ) : (
        entries.map((e) => {
          const cls =
            e.kind === "resolved"
              ? `resolved ${(e.amount ?? 0) >= 0 ? "pos" : "neg"}`
              : e.kind;
          const amount =
            e.kind === "resolved" && typeof e.amount === "number"
              ? ` ${usdDelta(e.amount)}`
              : "";
          return (
            <div className="log-row" key={e.id}>
              <span className="ts">[{e.uptime}]</span>
              <span className={cls}>
                {e.kind === "resolved" && !e.text.startsWith("RESOLVED")
                  ? `RESOLVED${amount}  ${e.text}`
                  : e.text}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
