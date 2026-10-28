import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom installs its own Uint8Array/ArrayBuffer, but Buffer and TextEncoder
// still create Node ones, so stellar-sdk's `instanceof Uint8Array` checks
// fail. Use Node's typed arrays everywhere (browsers have only one realm).
const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as typeof Uint8Array;
globalThis.Uint8Array = NodeUint8Array;
globalThis.ArrayBuffer = new NodeUint8Array(0).buffer.constructor as typeof ArrayBuffer;

afterEach(() => {
  cleanup();
  localStorage.clear();
});
