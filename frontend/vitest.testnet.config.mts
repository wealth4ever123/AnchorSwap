import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Real Stellar Testnet. Slow, needs network access; run with `npm run test:testnet`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["test/testnet/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
