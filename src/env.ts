/**
 * Environment variable management for a sandbox.
 *
 * GET    /v1/sandboxes/{id}/env       — list all → { env: {...} }
 * GET    /v1/sandboxes/{id}/env/{key} — get one  → { value }
 * PUT    /v1/sandboxes/{id}/env/{key} — set one  (body { value }) → { env }
 * DELETE /v1/sandboxes/{id}/env/{key} — unset one → { env }
 *
 * 热更新语义:改 env 只更新持久化值,不重启已运行进程;
 * 下次 Start/spawn 的进程才读到新值。
 */

import type { Client } from "./client.js";
import { NotFoundError } from "./errors.js";

export class Env {
  constructor(
    private readonly sandboxId: string,
    private readonly client: Client,
  ) {}

  /**
   * Get the value of an environment variable.
   * Returns undefined if not set.
   */
  async get(key: string): Promise<string | undefined> {
    try {
      const res = await this.client.get(
        `/v1/sandboxes/${this.sandboxId}/env/${encodeURIComponent(key)}`,
      );
      const data = res.json<{ value: string }>();
      return data.value;
    } catch (err: unknown) {
      if (err instanceof NotFoundError) return undefined;
      throw err;
    }
  }

  /**
   * Set an environment variable. key 在 path,body 只含 value。
   * 仅影响后续启动的进程,不影响已运行的进程。
   */
  async set(key: string, value: string): Promise<void> {
    await this.client.put(
      `/v1/sandboxes/${this.sandboxId}/env/${encodeURIComponent(key)}`,
      { json: { value } },
    );
  }

  /**
   * Get all environment variables as a record.
   */
  async all(): Promise<Record<string, string>> {
    const res = await this.client.get(`/v1/sandboxes/${this.sandboxId}/env`);
    const data = res.json<{ env: Record<string, string> }>();
    return data.env ?? {};
  }

  /**
   * 删除一个环境变量(DELETE .../env/{key})。
   */
  async unset(key: string): Promise<void> {
    await this.client.delete(
      `/v1/sandboxes/${this.sandboxId}/env/${encodeURIComponent(key)}`,
    );
  }
}
