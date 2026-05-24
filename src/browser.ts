/**
 * Browser session management for talon-sandbox SDK.
 *
 * POST   /v1/sandboxes/{id}/browser  — start
 * GET    /v1/sandboxes/{id}/browser  — get current session
 * DELETE /v1/sandboxes/{id}/browser  — stop
 */

import type { Client } from "./client.js";
import type { BrowserSession, RawBrowser } from "./types.js";

export type { BrowserSession };

export class Browser {
  constructor(
    private readonly sandboxId: string,
    private readonly client: Client,
  ) {}

  /**
   * Start a headless Chromium browser inside the sandbox.
   * Returns a BrowserSession with the CDP WebSocket URL.
   */
  async start(): Promise<BrowserSession> {
    const res = await this.client.post(
      `/v1/sandboxes/${this.sandboxId}/browser`,
    );
    const raw = res.json<RawBrowser>();
    return { cdpUrl: raw.cdp_ws_url };
  }

  /**
   * Get the current browser session (if running).
   */
  async get(): Promise<BrowserSession> {
    const res = await this.client.get(
      `/v1/sandboxes/${this.sandboxId}/browser`,
    );
    const raw = res.json<RawBrowser>();
    return { cdpUrl: raw.cdp_ws_url };
  }

  /**
   * Stop the browser session.
   */
  async stop(): Promise<void> {
    await this.client.delete(`/v1/sandboxes/${this.sandboxId}/browser`);
  }
}
