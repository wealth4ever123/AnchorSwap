import Link from "next/link";
import { AMM_CONTRACT, explorerContract } from "@/lib/config";

const FEATURES = [
  {
    title: "Best of two venues",
    desc: "Every quote compares the AnchorSwap pool with the Stellar DEX and picks the better price.",
  },
  {
    title: "Real quotes",
    desc: "Prices come from the contract itself and from Horizon's path finder, never from local estimates.",
  },
  {
    title: "Protected trades",
    desc: "Minimum-output and deadline checks are enforced on-chain. Slippage is capped at 5%.",
  },
  {
    title: "Verifiable",
    desc: "Success is only shown after the ledger confirms it, with a link to check it yourself.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col items-center">
      <section className="mx-auto max-w-3xl pb-14 pt-12 text-center">
        <div className="mb-5 text-6xl" aria-hidden>
          ⚓
        </div>
        <h1 className="mb-5 text-4xl font-extrabold leading-tight md:text-5xl">
          Swap Stellar assets <span className="gradient-text">at the best available price</span>
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-white/60">
          AnchorSwap is a constant-product AMM on Soroban with Stellar DEX routing. Connect Freighter or another
          Stellar wallet and trade on Testnet.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/swap" className="btn-primary px-8 py-3 text-base">
            Launch app
          </Link>
          <a
            href={explorerContract(AMM_CONTRACT)}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card glass-card-hover rounded-xl px-8 py-3 text-base font-semibold"
          >
            View contract ↗
          </a>
        </div>
      </section>
      <section className="mb-16 grid w-full max-w-4xl gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="glass-card p-6">
            <h2 className="mb-2 font-bold">{f.title}</h2>
            <p className="text-sm leading-relaxed text-white/55">{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
