"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletButton from "./WalletButton";
import { NETWORK } from "@/lib/config";

const LINKS = [
  { href: "/swap", label: "Swap" },
  { href: "/pool", label: "Pool" },
  { href: "/history", label: "History" },
];

export default function Navbar() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-anchor-900/70 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold">
          <span aria-hidden>⚓</span> AnchorSwap
        </Link>
        <div className="order-3 flex w-full justify-center gap-1 sm:order-none sm:w-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                path?.startsWith(l.href) ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
            {NETWORK.name}
          </span>
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
