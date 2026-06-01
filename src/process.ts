/**
 * Process execution for talon-sandbox SDK.
 *
 * run()   → runCommand()   — POST /processes, poll until exit, return ProcessResult
 * spawn() → spawnProcess() — POST /processes, return SpawnedProcess handle immediately
 *
 * Both use POST /v1/sandboxes/{id}/processes (the existing async-spawn endpoint).
 * run() polls until exited, then fetches logs. spawn() returns immediately.
 */

import { EventEmitter } from "./event-emitter.js";
import type { Client } from "./client.js";
import type { ProcessResult } from "./types.js";

export type { ProcessResult };

interface RawProc {
  id: string;
  state?: string;
  exit_code?: number;
  started_at?: number;
  exited_at?: number;
}

/** Parse a shell command string into argv. Honours double-quoted strings. */
function parseCommand(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

export interface RunOptions {
  /** Working directory inside sandbox. */
  cwd?: string;
  /** Extra env vars as { KEY: "value" } */
  env?: Record<string, string>;
  /** Poll interval ms while waiting for exit. Default 300. */
  pollInterval?: number;
  /** Max wait ms. Default 300000 (5 min). */
  timeout?: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  /**
   * 进程声明对外暴露的容器端口,如 [5173]。
   * 预览反代准入及 runc DNAT 路由依赖此字段;不填则无法被预览反代访问。
   */
  exposePorts?: number[];
}

/**
 * Execute a command synchronously (wait for exit, return result).
 * Maps to `sb.run("cmd")`.
 */
export async function runCommand(
  client: Client,
  sandboxId: string,
  command: string,
  opts: RunOptions = {},
): Promise<ProcessResult> {
  const startMs = Date.now();
  const argv = parseCommand(command);
  const envArr = opts.env
    ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
    : undefined;

  const body: Record<string, unknown> = { command: argv };
  if (envArr?.length) body["env"] = envArr;
  if (opts.cwd) body["cwd"] = opts.cwd;

  const res = await client.post(`/v1/sandboxes/${sandboxId}/processes`, {
    json: body,
  });
  let proc = res.json<RawProc>();

  const pollInterval = opts.pollInterval ?? 300;
  const deadline = Date.now() + (opts.timeout ?? 300_000);

  // Poll until exited/killed/failed
  while (proc.state === "running" && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollInterval));
    const pollRes = await client.get(
      `/v1/sandboxes/${sandboxId}/processes/${proc.id}`,
    );
    proc = pollRes.json<RawProc>();
  }

  // Fetch logs
  const logsRes = await client.get(
    `/v1/sandboxes/${sandboxId}/processes/${proc.id}/logs`,
  );
  const logText = logsRes.text();

  return {
    stdout: logText,
    stderr: "",
    exitCode: proc.exit_code ?? -1,
    duration: (Date.now() - startMs) / 1000,
  };
}

type SpawnEventMap = {
  stdout: (line: string) => void;
  exit: (code: number) => void;
  error: (err: Error) => void;
};

/**
 * A handle to a spawned long-running process.
 * Maps to `sb.spawn("cmd")`.
 */
export class SpawnedProcess extends EventEmitter<SpawnEventMap> {
  readonly id: string;
  readonly command: string;
  private readonly sandboxId: string;
  private readonly client: Client;
  private _exitCode: number | undefined;

  constructor(
    id: string,
    command: string,
    sandboxId: string,
    client: Client,
  ) {
    super();
    this.id = id;
    this.command = command;
    this.sandboxId = sandboxId;
    this.client = client;
  }

  /** Resolved exit code, or undefined if still running. */
  get exitCode(): number | undefined {
    return this._exitCode;
  }

  /**
   * Wait until the process exits by polling GET /processes/{id}.
   */
  async wait(timeoutMs = 300_000): Promise<number> {
    if (this._exitCode !== undefined) return this._exitCode;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 500));
      try {
        const res = await this.client.get(
          `/v1/sandboxes/${this.sandboxId}/processes/${this.id}`,
        );
        const proc = res.json<RawProc>();
        if (proc.state !== "running") {
          this._exitCode = proc.exit_code ?? -1;
          this.emit("exit", this._exitCode);
          return this._exitCode;
        }
      } catch (err) {
        this.emit(
          "error",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
    throw new Error(`spawn wait() timed out after ${timeoutMs}ms`);
  }

  /** Kill this process. */
  async kill(): Promise<void> {
    await this.client.delete(
      `/v1/sandboxes/${this.sandboxId}/processes/${this.id}`,
    );
  }

  /** Fetch combined stdout+stderr log tail as string. */
  async logs(tail?: number): Promise<string> {
    const reqOpts: { params?: Record<string, number> } = {};
    if (tail !== undefined) reqOpts.params = { tail };
    const res = await this.client.get(
      `/v1/sandboxes/${this.sandboxId}/processes/${this.id}/logs`,
      reqOpts,
    );
    return res.text();
  }
}

/**
 * Start a process and return a SpawnedProcess handle.
 * Maps to `sb.spawn("cmd")`.
 */
export async function spawnProcess(
  client: Client,
  sandboxId: string,
  command: string,
  opts: SpawnOptions = {},
): Promise<SpawnedProcess> {
  const argv = parseCommand(command);
  const envArr = opts.env
    ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
    : undefined;

  const body: Record<string, unknown> = { command: argv };
  if (envArr?.length) body["env"] = envArr;
  if (opts.cwd) body["cwd"] = opts.cwd;
  if (opts.exposePorts?.length) body["expose_ports"] = opts.exposePorts;

  const res = await client.post(`/v1/sandboxes/${sandboxId}/processes`, {
    json: body,
  });
  const proc = res.json<RawProc>();

  return new SpawnedProcess(proc.id, command, sandboxId, client);
}
