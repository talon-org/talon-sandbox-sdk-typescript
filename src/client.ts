/**
 * Internal HTTP client for talon-sandbox SDK.
 *
 * Auth precedence:
 *   1. apiKey option → Authorization: Bearer <key>
 *   2. TALON_SANDBOX_API_KEY env var → Bearer
 *   3. Cookie auth (sandbox_auth + sandbox_csrf CSRF)
 */

import { mapHttpError, NetworkError } from "./errors.js";

const DEFAULT_BASE_URL = "http://localhost:18080";

export interface ClientOptions {
  /** Server base URL. Default: TALON_SANDBOX_SERVER env var or http://localhost:18080 */
  server?: string;
  /** API key (ask_… prefix). Default: TALON_SANDBOX_API_KEY env var. */
  apiKey?: string;
  /** Request timeout in ms. Default: 30000. */
  timeout?: number;
}

export class Client {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeout: number;
  private readonly cookieJar: Map<string, string> = new Map();
  private csrfToken: string | undefined;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (
      opts.server ??
      (typeof process !== "undefined"
        ? process.env["TALON_SANDBOX_SERVER"]
        : undefined) ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");

    this.apiKey =
      opts.apiKey ??
      (typeof process !== "undefined"
        ? process.env["TALON_SANDBOX_API_KEY"]
        : undefined);

    this.timeout = opts.timeout ?? 30_000;
  }

  authHeader(): string | undefined {
    if (this.apiKey) return `Bearer ${this.apiKey}`;
    return undefined;
  }

  private parseCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const part = header.split(";")[0] ?? "";
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      this.cookieJar.set(name, value);
      if (name === "sandbox_csrf") this.csrfToken = value;
    }
  }

  private cookieHeader(): string {
    if (this.apiKey) return "";
    return [...this.cookieJar.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async request(
    method: string,
    path: string,
    opts: {
      json?: unknown;
      body?: BodyInit;
      headers?: Record<string, string>;
      params?: Record<string, string | number | boolean>;
    } = {},
  ): Promise<{
    status: number;
    body: ArrayBuffer;
    text: () => string;
    json: <T>() => T;
    headers: Headers;
  }> {
    const url = new URL(this.baseUrl + path);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url.searchParams.set(k, String(v));
      }
    }

    const isMutating = ["POST", "PUT", "DELETE", "PATCH"].includes(
      method.toUpperCase(),
    );

    const headers: Record<string, string> = {
      Accept: "application/json, application/octet-stream, text/plain",
      ...opts.headers,
    };

    const authHdr = this.authHeader();
    if (authHdr) {
      headers["Authorization"] = authHdr;
    } else {
      const cookieStr = this.cookieHeader();
      if (cookieStr) headers["Cookie"] = cookieStr;
      if (isMutating && this.csrfToken) {
        headers["X-CSRF-Token"] = this.csrfToken;
      }
    }

    let fetchBody: BodyInit | null = null;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(opts.json);
    } else if (opts.body !== undefined) {
      fetchBody = opts.body;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let resp: Response;
    try {
      resp = await globalThis.fetch(url.toString(), {
        method: method.toUpperCase(),
        headers,
        body: fetchBody,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg =
        err instanceof Error ? err.message : "Network request failed";
      throw new NetworkError(msg, err);
    } finally {
      clearTimeout(timer);
    }

    const setCookies = resp.headers.getSetCookie?.() ?? [];
    if (setCookies.length) this.parseCookies(setCookies);

    const rawBody = await resp.arrayBuffer();
    const textBody = new TextDecoder().decode(rawBody);

    if (resp.status >= 400) {
      const retryAfterHdr = resp.headers.get("Retry-After");
      const retryAfter =
        retryAfterHdr !== null ? parseInt(retryAfterHdr, 10) : undefined;
      const requestId = resp.headers.get("X-Request-Id") ?? undefined;
      throw mapHttpError(resp.status, textBody, { retryAfter, requestId });
    }

    return {
      status: resp.status,
      body: rawBody,
      text: () => textBody,
      json: <T>() => JSON.parse(textBody) as T,
      headers: resp.headers,
    };
  }

  get(path: string, opts?: Parameters<Client["request"]>[2]) {
    return this.request("GET", path, opts);
  }
  post(path: string, opts?: Parameters<Client["request"]>[2]) {
    return this.request("POST", path, opts);
  }
  put(path: string, opts?: Parameters<Client["request"]>[2]) {
    return this.request("PUT", path, opts);
  }
  delete(path: string, opts?: Parameters<Client["request"]>[2]) {
    return this.request("DELETE", path, opts);
  }

  /** Build wss:// WebSocket URL for a sandbox PTY endpoint. */
  wsUrl(sandboxId: string): string {
    return (
      this.baseUrl
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://")
        .replace(/\/+$/, "") + `/v1/sandboxes/${sandboxId}/pty`
    );
  }
}
