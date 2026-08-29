"use client";

import type { EquityPoint } from "@/lib/engine/types";
import { usd } from "@/lib/format";
import { useEffect, useRef, useState } from "react";

export default function BalanceChart({
  points,
  equity,
}: {
  points: EquityPoint[];
  equity: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({
        w: Math.max(1, Math.floor(r.width)),
        h: Math.max(1, Math.floor(r.height)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = box.w;
  const h = box.h;
  const narrow = w > 0 && w < 520;
  const padL = narrow ? 42 : 56;
  const padR = narrow ? 22 : 72;
  const padT = narrow ? 22 : 16;
  const padB = 12;
  const innerW = Math.max(10, w - padL - padR);
  const innerH = Math.max(10, h - padT - padB);
  const vals = points.length ? points.map((p) => p.equity) : [equity];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.16;
  min -= pad;
  max += pad;
  const xs = points.map((_, i) => {
    const t = points.length === 1 ? 0 : i / (points.length - 1);
    return padL + t * innerW;
  });
  const ys = points.map((p) => padT + ((max - p.equity) / (max - min)) * innerH);
  const d = points.length
    ? points
        .map((_, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`)
        .join(" ")
    : "";
  const lastX = xs.at(-1) ?? padL;
  const lastY = ys.at(-1) ?? padT + innerH / 2;
  const ticks: number[] = [];
  for (let i = 0; i <= 4; i++) ticks.push(min + ((max - min) * i) / 4);
  const labelY = narrow ? Math.max(14, lastY - 12) : lastY + 4;
  const labelX = narrow ? Math.min(lastX, w - 8) : Math.min(lastX + 10, w - 8);

  return (
    <div ref={ref} className="chart-inner">
      {w > 8 && h > 8 ? (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          overflow="hidden"
          role="img"
          aria-label="Balance history"
        >
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00ff41" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#00ff41" stopOpacity="0" />
            </linearGradient>
            <clipPath id="eqClip">
              <rect x="0" y="0" width={w} height={h} />
            </clipPath>
          </defs>
          <g clipPath="url(#eqClip)">
          {ticks.map((v) => {
            const y = padT + ((max - v) / (max - min)) * innerH;
            return (
              <g key={v.toFixed(4)}>
                <line
                  x1={padL}
                  x2={w - padR}
                  y1={y}
                  y2={y}
                  stroke="#1a1a1a"
                  strokeWidth="1"
                />
                <text
                  x={6}
                  y={y + 4}
                  fill="#4a4a4a"
                  fontSize={narrow ? 9 : 11}
                  fontFamily="ui-monospace, monospace"
                >
                  {usd(v, Math.abs(max - min) < 8 ? 2 : 0)}
                </text>
              </g>
            );
          })}
          {points.length > 1 ? (
            <path
              d={`${d} L ${lastX} ${padT + innerH} L ${padL} ${padT + innerH} Z`}
              fill="url(#eqFill)"
            />
          ) : null}
          {d ? (
            <path d={d} fill="none" stroke="#f5f5f5" strokeWidth="1.7" />
          ) : null}
          <circle cx={lastX} cy={lastY} r="5" fill="#000" stroke="#00ff41" strokeWidth="1.8" />
          <text
            x={labelX}
            y={labelY}
            textAnchor={narrow ? "end" : "start"}
            fill="#00ff41"
            fontSize={narrow ? 11 : 12}
            fontFamily="ui-monospace, monospace"
          >
            {usd(equity)}
          </text>
          </g>
        </svg>
      ) : null}
    </div>
  );
}
