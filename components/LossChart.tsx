"use client";

import { useMemo } from "react";

interface Point { step: number; loss: number }

export function LossChart({ history, height = 230 }: { history: Point[]; height?: number }) {
  const data = useMemo(() => {
    if (history.length < 2) return null;
    const maxPoints = 500;
    const step = Math.max(1, Math.ceil(history.length / maxPoints));
    const sampled = history.filter((_, i) => i % step === 0 || i === history.length - 1);
    const xs = sampled.map((p) => p.step);
    const ys = sampled.map((p) => p.loss);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    if (maxY - minY < 1e-6) { minY -= 0.01; maxY += 0.01; }
    const padY = (maxY - minY) * 0.12;
    minY -= padY; maxY += padY;
    const W = 800, H = height, L = 54, R = 16, T = 16, B = 28;
    const px = (x: number) => L + ((x - minX) / Math.max(1, maxX - minX)) * (W - L - R);
    const py = (y: number) => T + (1 - (y - minY) / (maxY - minY)) * (H - T - B);
    const line = sampled.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.step).toFixed(2)},${py(p.loss).toFixed(2)}`).join(" ");
    const area = `${line} L${px(maxX).toFixed(2)},${(H - B).toFixed(2)} L${px(minX).toFixed(2)},${(H - B).toFixed(2)} Z`;
    const ticks = Array.from({ length: 4 }, (_, i) => minY + (maxY - minY) * i / 3);
    return { W, H, L, R, T, B, line, area, ticks, py, px, minX, maxX, minY, maxY };
  }, [history, height]);

  if (!data) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded border border-dashed hairline text-xs text-[var(--muted)]">
        Loss graph will appear after at least two training steps.
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${data.W} ${data.H}`} className="h-auto w-full" preserveAspectRatio="none" role="img" aria-label="Training loss graph">
        <defs>
          <linearGradient id="lossFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {data.ticks.map((t, i) => (
          <g key={i}>
            <line x1={data.L} x2={data.W - data.R} y1={data.py(t)} y2={data.py(t)} stroke="#1f2a37" strokeWidth="1" />
            <text x={data.L - 8} y={data.py(t) + 3} textAnchor="end" fontSize="10" fill="#6b7a8d" fontFamily="monospace">{t.toFixed(3)}</text>
          </g>
        ))}
        <path d={data.area} fill="url(#lossFill)" />
        <path d={data.line} fill="none" stroke="#22d3ee" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <line x1={data.L} x2={data.W - data.R} y1={data.H - data.B} y2={data.H - data.B} stroke="#2b3849" />
        <text x={data.L} y={data.H - 8} fontSize="10" fill="#6b7a8d" fontFamily="monospace">step {data.minX}</text>
        <text x={data.W - data.R} y={data.H - 8} textAnchor="end" fontSize="10" fill="#6b7a8d" fontFamily="monospace">step {data.maxX}</text>
      </svg>
    </div>
  );
}

export function MiniLossChart({ history }: { history: Point[] }) {
  if (history.length < 2) return <div className="h-10 rounded border border-dashed hairline" />;
  const sample = history.slice(-100);
  const vals = sample.map((p) => p.loss);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = sample.map((p, i) => `${(i / (sample.length - 1)) * 100},${28 - ((p.loss - min) / range) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-10 w-full">
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
