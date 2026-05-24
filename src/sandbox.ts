/**
 * Sandbox — main entry point for talon-sandbox SDK.
 *
 * @example
 * import { Sandbox } from "talon-sandbox";
 *
 * const sb = await Sandbox.create({
 *   image: "node:20-bookworm",
 *   resources: { cpu: 2, memory: "4GiB" },
 *   network: "allowlist",
 *   timeout: "30m",
 *   ttl: "6h",
 * });
 * const result = await sb.run("npm install");
 * await sb.kill();
 *
 * // Auto-cleanup:
 * await using sb2 = await Sandbox.create({ image: "node:20-bookworm" });
 */

import { Client, type ClientOptions } from "./client.js";
import { getDefaultClient } from "./config.js";
import { parseSize, parseDuration } from "./parse.js";
import { NotImplementedError } from "./errors.js";
import { Fs } from "./fs.js";
import { Env } from "./env.js";
import { Terminal } from "./terminal.js";
import { Browser } from "./browser.js";
import {
  runCommand,
  spawnProcess,
  SpawnedProcess,
  type RunOptions,
  type SpawnOptions,
} from "./process.js";
import {
  sandboxInfoFromRaw,
  exposedPortFromRaw,
  type SandboxInfo,
  type RawSandbox,
  type RawExposedPort,
  type ExposedPort,
  type ProcessResult,
} from "./types.js";

export type { SandboxInfo, ExposedPort, ProcessResult };
export type { RunOptions, SpawnOptions };
export { SpawnedProcess };

export interface ResourceOptions {
  /** CPU cores (integer or float, e.g. 2 or 0.5). */
  cpu?: number;
  /** Memory as human string ("4GiB") or bytes number. */
  memory?: string | number;
  /** Disk as human string ("10GiB") or bytes number. */
  disk?: string | number;
}

export interface SandboxCreateOptions {
  /** Base image reference, e.g. "node:20-bookworm". */
  image?: string;
  /** Resource allocation. */
  resources?: ResourceOptions;
  /**
   * Network policy alias. Passed directly to server (Spec 45 handles aliases).
   * "allowlist" | "open" | "sealed" | "restricted-egress" | "full-egress" | "offline"
   */
  network?: string;
  /** Environment variables for the sandbox at boot time. */
  env?: Record<string, string>;
  /**
   * Idle timeout duration string, e.g. "30m".
   * Converted to seconds before sending.
   */
  timeout?: string | number;
  /**
   * Hard TTL duration string, e.g. "6h".
   * Converted to seconds before sending.
   */
  ttl?: string | number;
  /** Arbitrary label map. */
  labels?: Record<string, string>;
  /**
   * Wait for sandbox to reach "running" before returning.
   * Default: true.
   */
  wait?: boolean;
  /** Polling timeout ms when wait=true. Default 60000. */
  waitTimeoutMs?: number;
  /** Polling interval ms when wait=true. Default 500. */
  pollIntervalMs?: number;
  /** Explicit client (overrides global default). */
  client?: Client;
}

export interface ExposeOptions {
  /** Issue a signed preview URL token. */
  sign?: boolean;
  /** Token TTL (only used when sign=true), e.g. "1h". */
  ttl?: string | number;
  /** Custom subdomain prefix. */
  subdomain?: string;
}

export interface ListOptions {
  labels?: Record<string, string>;
  client?: Client;
}

function buildCreateBody(opts: SandboxCreateOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (opts.image) body["image_id"] = opts.image;
  if (opts.network) body["network_policy"] = opts.network;
  if (opts.labels && Object.keys(opts.labels).length) body["labels"] = opts.labels;

  if (opts.env && Object.keys(opts.env).length) {
    body["env"] = opts.env;
  }

  if (opts.timeout !== undefined) {
    body["idle_timeout_seconds"] = Math.floor(parseDuration(opts.timeout));
  }
  if (opts.ttl !== undefined) {
    body["ttl_seconds"] = Math.floor(parseDuration(opts.ttl));
  }

  if (opts.resources) {
    const r = opts.resources;
    if (r.cpu !== undefined) {
      // cpu=2 → cpu_millis=2000; cpu=0.5 → cpu_millis=500
      body["cpu_millis"] = Math.floor(r.cpu * 1000);
    }
    if (r.memory !== undefined) {
      body["memory_bytes"] = parseSize(r.memory);
    }
    if (r.disk !== undefined) {
      body["disk_bytes"] = parseSize(r.disk);
    }
  }

  return body;
}

function isNotFoundLike(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "statusCode" in err &&
    (err as { statusCode: unknown }).statusCode === 404
  );
}

export class Sandbox {
  private _info: SandboxInfo;
  private readonly _client: Client;

  /** Filesystem operations. */
  readonly fs: Fs;
  /** Environment variable operations. */
  readonly env: Env;
  /** Interactive PTY terminal. */
  readonly terminal: Terminal;
  /** Headless browser control. */
  readonly browser: Browser;

  constructor(info: SandboxInfo, client: Client) {
    this._info = info;
    this._client = client;
    this.fs = new Fs(info.id, client);
    this.env = new Env(info.id, client);
    this.terminal = new Terminal(info.id, client);
    this.browser = new Browser(info.id, client);
  }

  // ── Properties ────────────────────────────────────────────────────────────

  get id(): string {
    return this._info.id;
  }
  get state(): string {
    return this._info.state;
  }
  get image(): string {
    return this._info.image;
  }
  get createdAt(): Date {
    return this._info.createdAt;
  }
  get labels(): Record<string, string> {
    return this._info.labels;
  }
  get network(): string {
    return this._info.network;
  }

  // ── Factory methods ───────────────────────────────────────────────────────

  /**
   * Create a new sandbox.
   *
   * @example
   * const sb = await Sandbox.create({
   *   image: "node:20-bookworm",
   *   resources: { cpu: 2, memory: "4GiB", disk: "10GiB" },
   *   network: "allowlist",
   *   env: { NODE_ENV: "development" },
   *   timeout: "30m",
   *   ttl: "6h",
   *   labels: { project: "agent-x" },
   * });
   */
  static async create(opts: SandboxCreateOptions = {}): Promise<Sandbox> {
    const client = opts.client ?? getDefaultClient();
    const body = buildCreateBody(opts);

    const wait = opts.wait ?? true;
    const postOpts: {
      json: Record<string, unknown>;
      params?: Record<string, string>;
    } = { json: body };
    if (wait) postOpts.params = { wait: "running" };

    const res = await client.post("/v1/sandboxes", postOpts);
    let info = sandboxInfoFromRaw(res.json<RawSandbox>());

    // Client-side polling fallback if server doesn't support ?wait=running
    if (wait && info.state !== "running") {
      const timeoutMs = opts.waitTimeoutMs ?? 60_000;
      const intervalMs = opts.pollIntervalMs ?? 500;
      const deadline = Date.now() + timeoutMs;

      while (info.state !== "running" && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, intervalMs));
        const pollRes = await client.get(`/v1/sandboxes/${info.id}`);
        info = sandboxInfoFromRaw(pollRes.json<RawSandbox>());
      }
    }

    return new Sandbox(info, client);
  }

  /**
   * Reattach to an existing sandbox by ID.
   *
   * @example
   * const sb = await Sandbox.get("sb_abc123");
   */
  static async get(
    sandboxId: string,
    opts: { client?: Client } = {},
  ): Promise<Sandbox> {
    const client = opts.client ?? getDefaultClient();
    const res = await client.get(`/v1/sandboxes/${sandboxId}`);
    const info = sandboxInfoFromRaw(res.json<RawSandbox>());
    return new Sandbox(info, client);
  }

  /**
   * List sandboxes, optionally filtered by labels (client-side).
   *
   * @example
   * const sbs = await Sandbox.list({ labels: { project: "agent-x" } });
   */
  static async list(opts: ListOptions = {}): Promise<Sandbox[]> {
    const client = opts.client ?? getDefaultClient();
    const res = await client.get("/v1/sandboxes");
    const data = res.json<{ sandboxes: RawSandbox[] }>();
    const all = (data.sandboxes ?? []).map(
      (r) => new Sandbox(sandboxInfoFromRaw(r), client),
    );

    if (opts.labels && Object.keys(opts.labels).length > 0) {
      return all.filter((sb) => {
        for (const [k, v] of Object.entries(opts.labels!)) {
          if (sb.labels[k] !== v) return false;
        }
        return true;
      });
    }
    return all;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Freeze sandbox processes (SIGSTOP). */
  async pause(): Promise<void> {
    await this._client.post(`/v1/sandboxes/${this.id}/pause`);
    this._info = { ...this._info, state: "paused" };
  }

  /** Resume a paused sandbox. */
  async resume(): Promise<void> {
    await this._client.post(`/v1/sandboxes/${this.id}/resume`);
    this._info = { ...this._info, state: "running" };
  }

  /** Destroy the sandbox (irreversible). */
  async kill(): Promise<void> {
    await this._client.delete(`/v1/sandboxes/${this.id}`);
    this._info = { ...this._info, state: "killed" };
  }

  /** Refresh sandbox state from the server. */
  async refresh(): Promise<SandboxInfo> {
    const res = await this._client.get(`/v1/sandboxes/${this.id}`);
    this._info = sandboxInfoFromRaw(res.json<RawSandbox>());
    return this._info;
  }

  // ── Command execution ─────────────────────────────────────────────────────

  /**
   * Run a command synchronously. Waits for exit, returns result.
   *
   * @example
   * const result = await sb.run("npm install");
   * console.log(result.stdout);
   * assert(result.exitCode === 0);
   */
  async run(command: string, opts: RunOptions = {}): Promise<ProcessResult> {
    return runCommand(this._client, this.id, command, opts);
  }

  /**
   * Spawn a long-running process. Returns a handle immediately.
   *
   * @example
   * const proc = await sb.spawn("npm run dev");
   * proc.on("stdout", (line) => console.log(line));
   * await proc.wait();
   */
  async spawn(
    command: string,
    opts: SpawnOptions = {},
  ): Promise<SpawnedProcess> {
    return spawnProcess(this._client, this.id, command, opts);
  }

  // ── Port exposure ─────────────────────────────────────────────────────────

  /**
   * Expose a port and return its preview URL.
   * Requires server v1.1+ (Spec 50). Throws NotImplementedError on 404.
   *
   * @example
   * const url = await sb.expose(5173);
   * const signed = await sb.expose(5173, { sign: true, ttl: "1h", subdomain: "my-app" });
   */
  async expose(port: number, opts: ExposeOptions = {}): Promise<string> {
    const body: Record<string, unknown> = { port };
    if (opts.sign !== undefined) body["sign"] = opts.sign;
    if (opts.ttl !== undefined) {
      body["ttl"] =
        typeof opts.ttl === "string"
          ? opts.ttl
          : `${Math.floor(parseDuration(opts.ttl))}s`;
    }
    if (opts.subdomain) body["subdomain"] = opts.subdomain;

    try {
      const res = await this._client.post(
        `/v1/sandboxes/${this.id}/expose`,
        { json: body },
      );
      const data = res.json<{ port: number; url: string }>();
      return data.url;
    } catch (err: unknown) {
      if (isNotFoundLike(err)) {
        throw new NotImplementedError(
          "upgrade server to v1.1+ for sb.expose()",
        );
      }
      throw err;
    }
  }

  /**
   * Remove an explicit port exposure.
   */
  async unexpose(port: number): Promise<void> {
    try {
      await this._client.delete(`/v1/sandboxes/${this.id}/expose/${port}`);
    } catch (err: unknown) {
      if (isNotFoundLike(err)) {
        throw new NotImplementedError(
          "upgrade server to v1.1+ for sb.unexpose()",
        );
      }
      throw err;
    }
  }

  /**
   * List all exposed ports (explicit + dynamic).
   */
  async exposed(): Promise<ExposedPort[]> {
    try {
      const res = await this._client.get(`/v1/sandboxes/${this.id}/expose`);
      const data = res.json<{ ports: RawExposedPort[] }>();
      return (data.ports ?? []).map(exposedPortFromRaw);
    } catch (err: unknown) {
      if (isNotFoundLike(err)) {
        throw new NotImplementedError(
          "upgrade server to v1.1+ for sb.exposed()",
        );
      }
      throw err;
    }
  }

  // ── List processes ────────────────────────────────────────────────────────

  /** List all processes in this sandbox. */
  async processes(): Promise<
    Array<{ id: string; state: string; command: string[] }>
  > {
    const res = await this._client.get(
      `/v1/sandboxes/${this.id}/processes`,
    );
    const data = res.json<{
      processes: Array<{ id: string; state?: string; command?: string[] }>;
    }>();
    return (data.processes ?? []).map((p) => ({
      id: p.id,
      state: p.state ?? "unknown",
      command: p.command ?? [],
    }));
  }

  // ── Async dispose (TS 5.2+ `await using`) ─────────────────────────────────

  /**
   * Implements Symbol.asyncDispose for `await using sb = await Sandbox.create(...)`.
   * Automatically calls kill() when the block exits.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.kill();
  }
}
