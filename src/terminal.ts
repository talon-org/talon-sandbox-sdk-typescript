/**
 * PTY terminal over WebSocket for talon-sandbox SDK.
 *
 * WS endpoint: GET /v1/sandboxes/{id}/pty
 *
 * Protocol (binary frames):
 *   Client → Server: raw bytes to PTY stdin
 *   Server → Client: raw bytes from PTY stdout/stderr
 *
 * Resize is sent as JSON text frame: {"type":"resize","cols":80,"rows":24}
 *
 * Works in:
 * - Browsers (native WebSocket)
 * - Node 22+ (native WebSocket, but no header injection — token via query)
 * - Node 18-21 with `ws` package installed (peer dependency, optional)
 */

import { EventEmitter } from "./event-emitter.js";
import { NetworkError, SandboxError } from "./errors.js";
import { USER_AGENT } from "./version.js";
import type { Client } from "./client.js";

type PtyEventMap = {
  data: (chunk: Uint8Array) => void;
  exit: (code: number) => void;
  error: (err: Error) => void;
};

export interface PtyResizeOptions {
  rows: number;
  cols: number;
}

export interface TerminalOpenOptions {
  rows?: number;
  cols?: number;
  env?: Record<string, string>;
}

/**
 * Common interface bridging native browser WebSocket and Node's `ws` package.
 * Both APIs are similar but differ in (a) constructor (Node `ws` takes opts
 * with `headers`, browser doesn't), (b) send callback (Node has it, browser
 * doesn't), and (c) event registration (`on` vs `addEventListener`).
 */
interface WsLike {
  readonly readyState: number;
  send(data: ArrayBufferLike | ArrayBufferView | string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: string, listener: (ev: unknown) => void) => void;
  on?: (type: string, listener: (...args: unknown[]) => void) => void;
}

/** An active PTY WebSocket session. */
export class PtySession extends EventEmitter<PtyEventMap> {
  private readonly ws: WsLike;
  private _closed = false;

  constructor(ws: WsLike) {
    super();
    this.ws = ws;

    const onMessage = async (data: unknown): Promise<void> => {
      const chunk = await toUint8Array(data);
      this.emit("data", chunk);
    };

    const onClose = (codeOrEvent: unknown): void => {
      this._closed = true;
      const code =
        typeof codeOrEvent === "number"
          ? codeOrEvent
          : typeof codeOrEvent === "object" &&
              codeOrEvent !== null &&
              "code" in codeOrEvent
            ? Number((codeOrEvent as { code: unknown }).code)
            : 0;
      this.emit("exit", code || 0);
    };

    const onError = (errOrEvent: unknown): void => {
      const err =
        errOrEvent instanceof Error
          ? errOrEvent
          : new Error(
              typeof errOrEvent === "object" && errOrEvent
                ? String(
                    (errOrEvent as { message?: unknown }).message ?? errOrEvent,
                  )
                : String(errOrEvent ?? "WebSocket error"),
            );
      this.emit("error", err);
    };

    if (typeof ws.on === "function") {
      // Node `ws`: payload comes through as Buffer / ArrayBuffer / Buffer[].
      ws.on("message", (data: unknown) => {
        void onMessage(data);
      });
      ws.on("close", (code: unknown) => onClose(code));
      ws.on("error", (err: unknown) => onError(err));
    } else if (typeof ws.addEventListener === "function") {
      // Browser / Node 22+ native: payload is in event.data.
      ws.addEventListener("message", (ev: unknown) => {
        const data = (ev as { data: unknown }).data;
        void onMessage(data);
      });
      ws.addEventListener("close", (ev: unknown) => {
        const code = (ev as { code?: number }).code;
        onClose(code ?? 0);
      });
      ws.addEventListener("error", (ev: unknown) => onError(ev));
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  /**
   * Write data to PTY stdin.
   * Accepts string (UTF-8) or binary Uint8Array.
   */
  async write(data: string | Uint8Array): Promise<void> {
    if (this._closed) throw new SandboxError("PTY session is closed");
    const payload =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    // Native WebSocket.send is fire-and-forget; Node `ws` accepts an optional
    // callback. We standardise on no-callback so this method works on both.
    this.ws.send(payload);
  }

  /**
   * Resize the terminal window.
   */
  async resize(opts: PtyResizeOptions): Promise<void> {
    if (this._closed) return;
    const msg = JSON.stringify({
      type: "resize",
      cols: opts.cols,
      rows: opts.rows,
    });
    this.ws.send(msg);
  }

  /** Close the PTY WebSocket. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this.ws.close();
  }

  /** `await using pty = await sb.terminal.open()` */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

async function toUint8Array(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  // Browser Blob (some platforms wrap binary frames as Blob).
  if (
    typeof Blob !== "undefined" &&
    data instanceof (Blob as unknown as new () => unknown)
  ) {
    const buf = await (data as Blob).arrayBuffer();
    return new Uint8Array(buf);
  }
  // Node `ws` may deliver Buffer[] for fragmented messages.
  if (Array.isArray(data)) {
    let total = 0;
    const arrs: Uint8Array[] = [];
    for (const part of data) {
      const u = await toUint8Array(part);
      arrs.push(u);
      total += u.byteLength;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) {
      out.set(a, off);
      off += a.byteLength;
    }
    return out;
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  throw new Error(`Unsupported PTY message type: ${typeof data}`);
}

/**
 * Resolve a WebSocket constructor + connection options for the current runtime.
 *
 * Browser / Node 22+: native `WebSocket`. Cannot inject custom headers, so we
 *   pass auth via `?token=...` query param.
 * Node 18-21: dynamic `import("ws")`. Supports header injection — pass auth
 *   in `Authorization` header.
 *
 * The split is necessary because the platform's WS endpoint accepts either
 * scheme, and headers are the more secure default when available.
 */
async function openWebSocket(
  url: string,
  authHeader: string | undefined,
): Promise<WsLike> {
  const nativeWS: typeof globalThis extends { WebSocket: infer W } ? W : never =
    (globalThis as { WebSocket?: unknown }).WebSocket as never;

  if (nativeWS) {
    // Native WebSocket: append token to URL, no header support.
    const u = new URL(url);
    if (authHeader && !u.searchParams.has("authorization")) {
      // Strip the "Bearer " prefix server-side typically accepts.
      u.searchParams.set("authorization", authHeader);
    }
    return await new Promise<WsLike>((resolve, reject) => {
      const ws = new (nativeWS as new (u: string) => WsLike)(u.toString());
      const open = (): void => resolve(ws);
      const fail = (ev: unknown): void => {
        const msg =
          ev instanceof Error
            ? ev.message
            : (ev as { message?: string })?.message ?? "WebSocket open failed";
        reject(new NetworkError(`PTY WebSocket connection failed: ${msg}`, ev));
      };
      if (typeof (ws as WsLike).addEventListener === "function") {
        (ws as WsLike).addEventListener!("open", () => open());
        (ws as WsLike).addEventListener!("error", (ev) => fail(ev));
      } else if (typeof (ws as WsLike).on === "function") {
        (ws as WsLike).on!("open", () => open());
        (ws as WsLike).on!("error", (err) => fail(err));
      } else {
        reject(new NetworkError("WebSocket implementation has no event API"));
      }
    });
  }

  // Fall back to Node `ws` package (optional dep).
  let wsModule: { default: unknown } | { WebSocket: unknown };
  try {
    wsModule = (await import("ws")) as
      | { default: unknown }
      | { WebSocket: unknown };
  } catch (err) {
    throw new NetworkError(
      "No WebSocket implementation available. " +
        "In Node <22, install `ws` (`npm i ws`); in browsers/Node 22+ this should not happen.",
      err,
    );
  }
  const NodeWS = (
    "default" in wsModule ? wsModule.default : wsModule.WebSocket
  ) as new (
    u: string,
    opts?: { headers?: Record<string, string> },
  ) => WsLike;
  const headers: Record<string, string> = {
    // Node `ws` 支持注入握手头:带上规范 User-Agent,与 HTTP 出口口径一致。
    // (浏览器/Node 22+ 原生 WebSocket 不支持设头,且浏览器禁设 User-Agent,故仅此分支处理。)
    "User-Agent": USER_AGENT,
  };
  if (authHeader) headers["Authorization"] = authHeader;
  return await new Promise<WsLike>((resolve, reject) => {
    const ws = new NodeWS(url, { headers });
    if (typeof ws.on === "function") {
      ws.on("open", () => resolve(ws));
      ws.on("error", (err) =>
        reject(
          new NetworkError(
            `PTY WebSocket connection failed: ${
              (err as { message?: string })?.message ?? String(err)
            }`,
            err,
          ),
        ),
      );
    }
  });
}

export class Terminal {
  private readonly sandboxId: string;
  private readonly client: Client;

  constructor(sandboxId: string, client: Client) {
    this.sandboxId = sandboxId;
    this.client = client;
  }

  /** @internal — overridable in tests */
  _wsUrl(): string {
    return this.client.wsUrl(this.sandboxId);
  }

  /**
   * Open a new PTY session.
   */
  async open(_opts: TerminalOpenOptions = {}): Promise<PtySession> {
    const url = this._wsUrl();
    const authHdr = this.client.authHeader();
    const ws = await openWebSocket(url, authHdr ?? undefined);
    return new PtySession(ws);
  }
}
