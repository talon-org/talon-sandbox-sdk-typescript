/**
 * Environment variable management for a sandbox.
 *
 * GET  /v1/sandboxes/{id}/env       — list all
 * GET  /v1/sandboxes/{id}/env/{key} — get one
 * PUT  /v1/sandboxes/{id}/env/{key} — set one
 *
 * Note: these endpoints are planned (Spec 50) but not yet in the current
 * OpenAPI. They will 404 until the server implements them.
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
      const data = res.json<{ key: string; value: string }>();
      return data.value;
    } catch (err: unknown) {
      if (err instanceof NotFoundError) return undefined;
      throw err;
    }
  }

  /**
   * Set an environment variable (affects future processes, not running ones).
   */
  async set(key: string, value: string): Promise<void> {
    await this.client.put(
      `/v1/sandboxes/${this.sandboxId}/env/${encodeURIComponent(key)}`,
      { json: { key, value } },
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
}
