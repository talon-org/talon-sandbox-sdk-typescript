/**
 * talon-sandbox — TypeScript SDK v2 for Talon Sandbox Platform.
 *
 * @example
 * import { Sandbox } from "talon-sandbox";
 *
 * const sb = await Sandbox.create({
 *   image: "node:20-bookworm",
 *   resources: { cpu: 2, memory: "4GiB", disk: "10GiB" },
 *   network: "allowlist",
 *   env: { NODE_ENV: "development" },
 *   timeout: "30m",
 *   ttl: "6h",
 *   labels: { project: "agent-x" },
 * });
 *
 * const result = await sb.run("npm install");
 * console.log(result.stdout);
 *
 * const proc = await sb.spawn("npm run dev");
 * proc.on("stdout", (line) => console.log(line));
 *
 * const url = await sb.expose(5173);
 * const pty = await sb.terminal.open();
 *
 * await sb.kill();
 *
 * // Auto-cleanup:
 * await using sb2 = await Sandbox.create({ image: "node:20-bookworm" });
 */

// ── Main class ────────────────────────────────────────────────────────────────
export { Sandbox } from "./sandbox.js";
export type {
  SandboxInfo,
  SandboxCreateOptions,
  ResourceOptions,
  ExposeOptions,
  ExposedPort,
  ListOptions,
  RunOptions,
  SpawnOptions,
  AgentRunOptions,
  AgentRunResult,
} from "./sandbox.js";
export { SpawnedProcess } from "./sandbox.js";

// ── Sub-classes (re-exported for instanceof checks / type annotations) ─────────
export { Fs } from "./fs.js";
export type { FsEntry } from "./fs.js";

export { Env } from "./env.js";

// ── Images ────────────────────────────────────────────────────────────────────
export { listImages } from "./images.js";
export type { ImageInfo } from "./images.js";

export { Terminal, PtySession } from "./terminal.js";
export type { TerminalOpenOptions, PtyResizeOptions } from "./terminal.js";

export { Browser } from "./browser.js";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  ProcessResult,
  BrowserSession,
  FsEntry as FsEntryType,
  SandboxState,
  NetworkInput,
  NetworkPolicy,
  NetworkAlias,
  AgentRunStep,
} from "./types.js";

// ── Client / Config ───────────────────────────────────────────────────────────
export { Client } from "./client.js";
export type { ClientOptions } from "./client.js";
export { configure, getDefaultClient } from "./config.js";

// ── Errors ────────────────────────────────────────────────────────────────────
export {
  SandboxError,
  AuthError,
  NotFoundError,
  QuotaError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  ServerError,
  ClientError,
  NotImplementedError,
  mapHttpError,
} from "./errors.js";

// ── Utilities ─────────────────────────────────────────────────────────────────
export { parseSize, parseDuration } from "./parse.js";

export const VERSION = "0.1.0";
