"use client";

import { useState } from "react";
import { MAX_SLIPPAGE_BPS } from "@/lib/config";
import { formatBps } from "@/lib/amounts";

const PRESETS = [10, 50, 100];

/** Slippage tolerance picker, capped at MAX_SLIPPAGE_BPS (5 %). */
export default function SlippageSettings({ value, onChange }: { value: number; onChange: (bps: number) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  function applyCustom(v: string) {
    setCustom(v);
    if (v === "") return setError(null);
    const pct = Number(v);
    if (!/^\d*\.?\d{0,2}$/.test(v) || Number.isNaN(pct)) return setError("Enter a percentage like 0.75");
    const bps = Math.round(pct * 100);
    if (bps <= 0) return setError("Must be above 0%");
    if (bps > MAX_SLIPPAGE_BPS) return setError(`Maximum is ${formatBps(MAX_SLIPPAGE_BPS)}`);
    setError(null);
    onChange(bps);
  }

  return (
    <div className="relative">
      <button
        className="rounded-lg px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Slippage {formatBps(value)} ⚙
      </button>
      {open && (
        <div className="glass-card absolute right-0 z-20 mt-2 w-64 bg-anchor-900/95 p-3 text-sm">
          <div className="mb-2 text-white/60">Max price movement you accept</div>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setCustom("");
                  setError(null);
                  onChange(p);
                }}
                className={`flex-1 rounded-lg py-1.5 ${value === p && !custom ? "bg-anchor-500" : "bg-white/10"}`}
              >
                {formatBps(p)}
              </button>
            ))}
            <input
              aria-label="Custom slippage percent"
              placeholder="Custom"
              value={custom}
              onChange={(e) => applyCustom(e.target.value)}
              className="w-20 rounded-lg bg-white/10 px-2 text-right outline-none"
            />
          </div>
          {error && <div className="mt-2 text-red-300">{error}</div>}
        </div>
      )}
    </div>
  );
}
