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
 */

import WebSocket from "ws";
import { EventEmitter } from "./event-emitter.js";
import { NetworkError, SandboxError } from "./errors.js";
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

/** An active PTY WebSocket session. */
export class PtySession extends EventEmitter<PtyEventMap> {
  private readonly ws: WebSocket;
  private _closed = false;

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      let chunk: Uint8Array;
      if (Buffer.isBuffer(data)) {
        chunk = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else if (data instanceof ArrayBuffer) {
        chunk = new Uint8Array(data);
      } else {
        const buf = Buffer.concat(data as Buffer[]);
        chunk = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
      this.emit("data", chunk);
    });

    ws.on("close", (code) => {
      this._closed = true;
      this.emit("exit", code ?? 0);
    });

    ws.on("error", (err) => {
      this.emit("error", err);
    });
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
      typeof data === "string"
        ? Buffer.from(data, "utf-8")
        : Buffer.from(data);
    return new Promise<void>((resolve, reject) => {
      this.ws.send(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
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
    return new Promise<void>((resolve, reject) => {
      this.ws.send(Buffer.from(msg, "utf-8"), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Close the PTY WebSocket. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    return new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }

  /** `await using pty = await sb.terminal.open()` */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
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
    const wsHeaders: Record<string, string> = {};
    const authHdr = this.client.authHeader();
    if (authHdr) wsHeaders["Authorization"] = authHdr;

    return new Promise<PtySession>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: wsHeaders });

      ws.once("open", () => resolve(new PtySession(ws)));
      ws.once("error", (err) => {
        reject(
          new NetworkError(
            `PTY WebSocket connection failed: ${err.message}`,
            err,
          ),
        );
      });
    });
  }
}
