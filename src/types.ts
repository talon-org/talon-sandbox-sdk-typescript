/**
 * Public types and raw DTO interfaces for talon-sandbox SDK.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type SandboxState =
  | "created"
  | "running"
  | "paused"
  | "stopped"
  | "destroyed"
  | "killed"
  | "lost";

export type NetworkAlias = "allowlist" | "open" | "sealed" | "deny";
export type NetworkPolicy = "offline" | "restricted-egress" | "full-egress";
export type NetworkInput = NetworkAlias | NetworkPolicy;

export interface SandboxInfo {
  id: string;
  state: SandboxState;
  image: string;
  createdAt: Date;
  labels: Record<string, string>;
  network: string;
  cpuMillis: number;
  memoryBytes: number;
  idleTimeoutSeconds: number;
  ttlSeconds: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface FsEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
}

export interface ExposedPort {
  port: number;
  url: string;
  signed: boolean;
  expiresAt: Date | null;
  source?: "explicit" | "dynamic";
}

export interface BrowserSession {
  cdpUrl: string;
  profileDir?: string;
}

// ── Images ────────────────────────────────────────────────────────────────────

/** 单个 base image 的信息（GET /v1/images 响应中的元素）。 */
export interface ImageInfo {
  id: string;
  name: string;
  url: string;
  sha256: string;
  os: string;
  arch: string;
  /** "builtin" | "admin" */
  source: string;
  isDefault: boolean;
  description: string;
  createdAt: Date;
}

// ── Agent Run ─────────────────────────────────────────────────────────────────

/** agentRun 的单步记录（对应后端 AgentRunStep）。 */
export interface AgentRunStep {
  step: number;
  action: string;
  thought?: string;
  details?: Record<string, unknown>;
}

/** agentRun 的选项（POST /v1/sandboxes/{id}/agent/run 请求体）。 */
export interface AgentRunOptions {
  /** 最大步骤数（默认 20，后端硬上限 100）。 */
  maxSteps?: number;
  /** LLM 模型 hint，例如 "anthropic:claude-sonnet-4-6"。 */
  llmModel?: string;
}

/** agentRun 的响应（对应后端 AgentRunResponse）。 */
export interface AgentRunResult {
  runId: string;
  /** "completed" | "failed" | "timeout" */
  status: string;
  durationMs: number;
  steps: AgentRunStep[];
  result?: string;
  exitCode: number;
  stderr?: string;
}

// ── Raw DTO shapes (snake_case from server) ──────────────────────────────────

export interface RawSandbox {
  id: string;
  state: string;
  profile?: string;
  image_id?: string;
  cpu_millis?: number;
  memory_bytes?: number;
  idle_timeout_seconds?: number;
  ttl_seconds?: number;
  created_at?: number;
  network_policy?: string;
  labels?: Record<string, string>;
}

export interface RawProcess {
  id: string;
  sandbox_id?: string;
  command?: string[];
  pid?: number;
  state?: string;
  exit_code?: number;
  started_at?: number;
  exited_at?: number;
}

export interface RawFSEntry {
  name: string;
  size?: number;
  mod_time?: number;
  is_dir?: boolean;
}

export interface RawBrowser {
  sandbox_id: string;
  cdp_ws_url: string;
  cdp_path?: string;
}

export interface RawExposedPort {
  port: number;
  url: string;
  signed: boolean;
  expires_at?: string | null;
  source?: string;
}

/** 后端 ImageDTO（snake_case）。 */
export interface RawImage {
  id: string;
  name: string;
  url: string;
  sha256: string;
  os: string;
  arch: string;
  source: string;
  is_default: boolean;
  description?: string;
  created_at: number;
}

/** 后端 AgentRunStep（snake_case）。 */
export interface RawAgentRunStep {
  step: number;
  action: string;
  thought?: string;
  details?: Record<string, unknown>;
}

/** 后端 AgentRunResponse（snake_case）。 */
export interface RawAgentRunResponse {
  run_id: string;
  status: string;
  duration_ms: number;
  steps: RawAgentRunStep[];
  result?: string;
  exit_code: number;
  stderr?: string;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

export function sandboxInfoFromRaw(r: RawSandbox): SandboxInfo {
  return {
    id: r.id,
    state: r.state as SandboxState,
    image: r.image_id ?? "",
    createdAt: r.created_at ? new Date(r.created_at * 1000) : new Date(0),
    labels: r.labels ?? {},
    network: r.network_policy ?? "",
    cpuMillis: r.cpu_millis ?? 0,
    memoryBytes: r.memory_bytes ?? 0,
    idleTimeoutSeconds: r.idle_timeout_seconds ?? 0,
    ttlSeconds: r.ttl_seconds ?? 0,
  };
}

export function fsEntryFromRaw(r: RawFSEntry): FsEntry {
  return {
    name: r.name,
    type: r.is_dir ? "directory" : "file",
    size: r.size ?? 0,
    modified: r.mod_time ? new Date(r.mod_time * 1000) : new Date(0),
  };
}

export function imageInfoFromRaw(r: RawImage): ImageInfo {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    sha256: r.sha256,
    os: r.os,
    arch: r.arch,
    source: r.source,
    isDefault: r.is_default,
    description: r.description ?? "",
    createdAt: r.created_at ? new Date(r.created_at * 1000) : new Date(0),
  };
}

export function agentRunResultFromRaw(r: RawAgentRunResponse): AgentRunResult {
  const steps: AgentRunStep[] = (r.steps ?? []).map((s) => {
    const step: AgentRunStep = { step: s.step, action: s.action };
    if (s.thought !== undefined) step.thought = s.thought;
    if (s.details !== undefined) step.details = s.details;
    return step;
  });
  const res: AgentRunResult = {
    runId: r.run_id,
    status: r.status,
    durationMs: r.duration_ms,
    steps,
    exitCode: r.exit_code,
  };
  if (r.result !== undefined) res.result = r.result;
  if (r.stderr !== undefined) res.stderr = r.stderr;
  return res;
}

export function exposedPortFromRaw(r: RawExposedPort): ExposedPort {
  const entry: ExposedPort = {
    port: r.port,
    url: r.url,
    signed: r.signed,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  };
  if (r.source !== undefined) {
    entry.source = r.source as "explicit" | "dynamic";
  }
  return entry;
}
