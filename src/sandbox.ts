/**
 * Sandbox — main entry point for talon-sandbox SDK.
 *
 * @example
 * import { Sandbox } from "talon-sandbox";
 *
 * const sb = await Sandbox.create({
 *   image: "talon-alpine",
 *   resources: { cpu: 2, memory: "4GiB" },
 *   network: "allowlist",
 *   timeout: "30m",
 *   ttl: "6h",
 * });
 * const result = await sb.run("npm install");
 * await sb.kill();
 *
 * // Auto-cleanup:
 * await using sb2 = await Sandbox.create({ image: "talon-alpine" });
 */

import { Client, type ClientOptions } from "./client.js";
import { getDefaultClient } from "./config.js";
import { parseSize, parseDuration } from "./parse.js";
import { NotImplementedError, TimeoutError } from "./errors.js";
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
  agentRunResultFromRaw,
  type SandboxInfo,
  type RawSandbox,
  type RawExposedPort,
  type ExposedPort,
  type ProcessResult,
  type AgentRunOptions,
  type AgentRunResult,
  type RawAgentRunResponse,
} from "./types.js";

export type { SandboxInfo, ExposedPort, ProcessResult, AgentRunOptions, AgentRunResult };
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
  /** Base image reference, e.g. "talon-alpine". */
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
   *   image: "talon-alpine",
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
      const start = Date.now();
      const deadline = start + timeoutMs;

      while (info.state !== "running" && Date.now() < deadline) {
        // Terminal states never recover to running — bail out early.
        if (
          info.state === "stopped" ||
          info.state === "killed" ||
          info.state === "destroyed" ||
          info.state === "lost"
        ) {
          throw new TimeoutError(
            `Sandbox ${info.id} entered terminal state '${info.state}' while waiting for running`,
            { state: info.state, elapsed: Date.now() - start },
          );
        }
        await new Promise<void>((r) => setTimeout(r, intervalMs));
        const pollRes = await client.get(`/v1/sandboxes/${info.id}`);
        info = sandboxInfoFromRaw(pollRes.json<RawSandbox>());
      }

      if (info.state !== "running") {
        throw new TimeoutError(
          `Sandbox ${info.id} did not reach 'running' within ${timeoutMs}ms (last state: '${info.state}')`,
          { state: info.state, elapsed: Date.now() - start },
        );
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
   * 列出沙箱，支持服务端 label 过滤（同时保留客户端兜底过滤）。
   *
   * 当 opts.labels 非空时，将每个 (key, value) 拼成 `label=key:value`
   * query 参数发给后端（AND 语义，重复 key）。后端不支持时客户端过滤兜底。
   *
   * @example
   * const sbs = await Sandbox.list({ labels: { project: "agent-x" } });
   */
  static async list(opts: ListOptions = {}): Promise<Sandbox[]> {
    const client = opts.client ?? getDefaultClient();

    // 构建请求路径：labels 非空时把每对 key:value 作为重复 label 参数追加到 URL。
    // 使用 URLSearchParams.append 保证同名 key 被重复序列化（而非覆盖）。
    let path = "/v1/sandboxes";
    if (opts.labels && Object.keys(opts.labels).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.labels)) {
        // 用冒号分隔 key 与 value（后端约定，value 可能含等号）。
        qs.append("label", `${k}:${v}`);
      }
      path = `${path}?${qs.toString()}`;
    }

    const res = await client.get(path);
    const data = res.json<{ sandboxes: RawSandbox[] }>();
    const all = (data.sandboxes ?? []).map(
      (r) => new Sandbox(sandboxInfoFromRaw(r), client),
    );

    // 客户端过滤保留：老版本服务端不支持 label 参数时作为双保险。
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

  /**
   * 从 stopped 状态重新拉起 sandbox（POST .../start，返回 204）。
   * 与 resume 不同：start 针对 stopped sandbox，resume 针对 paused sandbox。
   */
  async start(): Promise<void> {
    await this._client.post(`/v1/sandboxes/${this.id}/start`);
    this._info = { ...this._info, state: "running" };
  }

  /**
   * 停止 running sandbox（POST .../stop，返回 204）。
   * 与 pause 不同：stop 是完全停止（进程退出），pause 是冻结（SIGSTOP）。
   */
  async stop(): Promise<void> {
    await this._client.post(`/v1/sandboxes/${this.id}/stop`);
    this._info = { ...this._info, state: "stopped" };
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

  // ── Agent Run ─────────────────────────────────────────────────────────────

  /**
   * 在 sandbox 内运行高层 agent（POST .../agent/run，同步阻塞，最长 5 分钟）。
   * agent 会控制 sandbox 内的 browser-harness 完成 goal，返回步骤日志与结果。
   *
   * @example
   * const result = await sb.agentRun("Search for cats and return page title");
   * console.log(result.status, result.result);
   */
  async agentRun(goal: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    const body: Record<string, unknown> = { goal };
    if (opts.maxSteps !== undefined) body["max_steps"] = opts.maxSteps;
    if (opts.llmModel !== undefined) body["llm_model"] = opts.llmModel;

    const res = await this._client.post(
      `/v1/sandboxes/${this.id}/agent/run`,
      { json: body },
    );
    return agentRunResultFromRaw(res.json<RawAgentRunResponse>());
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
