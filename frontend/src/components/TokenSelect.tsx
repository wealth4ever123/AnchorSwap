"use client";

import { TOKENS, type Token } from "@/lib/tokens";

export default function TokenSelect({
  value,
  onChange,
  label,
  exclude,
}: {
  value: Token;
  onChange: (t: Token) => void;
  label: string;
  exclude?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value.symbol}
      onChange={(e) => {
        const t = TOKENS.find((x) => x.symbol === e.target.value);
        if (t) onChange(t);
      }}
      className="cursor-pointer rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-base font-semibold text-white focus:outline-none focus:ring-2 focus:ring-anchor-400"
    >
      {TOKENS.filter((t) => t.symbol !== exclude || t.symbol === value.symbol).map((t) => (
        <option key={t.symbol} value={t.symbol} className="bg-anchor-900">
          {t.symbol}
        </option>
      ))}
    </select>
  );
}
