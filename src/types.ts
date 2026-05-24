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
