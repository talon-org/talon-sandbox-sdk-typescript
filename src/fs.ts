/**
 * Filesystem operations for talon-sandbox SDK.
 *
 * GET    /v1/sandboxes/{id}/fs/{path}       — read
 * PUT    /v1/sandboxes/{id}/fs/{path}       — write
 * DELETE /v1/sandboxes/{id}/fs/{path}       — remove
 * GET    /v1/sandboxes/{id}/fs-list/{path}  — list
 */

import type { Client } from "./client.js";
import { fsEntryFromRaw, type FsEntry, type RawFSEntry } from "./types.js";

export type { FsEntry };

export class Fs {
  constructor(
    private readonly sandboxId: string,
    private readonly client: Client,
  ) {}

  private fsPath(path: string): string {
    return `/v1/sandboxes/${this.sandboxId}/fs/${path.replace(/^\/+/, "")}`;
  }

  private fsListPath(path: string): string {
    const p = path.replace(/^\/+/, "").replace(/\/+$/, "");
    return p
      ? `/v1/sandboxes/${this.sandboxId}/fs-list/${p}`
      : `/v1/sandboxes/${this.sandboxId}/fs-list`;
  }

  /**
   * Read a file. Returns raw bytes.
   */
  async read(path: string): Promise<Uint8Array> {
    const res = await this.client.get(this.fsPath(path));
    return new Uint8Array(res.body);
  }

  /**
   * Read a file as UTF-8 text.
   */
  async readText(path: string, encoding = "utf-8"): Promise<string> {
    const bytes = await this.read(path);
    return new TextDecoder(encoding).decode(bytes);
  }

  /**
   * Write bytes to a file. Parent directories are created automatically.
   */
  async write(path: string, content: Uint8Array): Promise<void> {
    // Take the exact view, not the entire backing ArrayBuffer. `content`
    // may be a slice (e.g. Buffer.subarray() in Node) — `content.buffer`
    // would include bytes outside the view and we'd upload garbage.
    //
    // We slice into a fresh ArrayBuffer to satisfy DOM's BodyInit type
    // (which doesn't include Uint8Array in lib.dom) while keeping the
    // correct bytes.
    const exact = (content.buffer as ArrayBuffer).slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    );
    await this.client.put(this.fsPath(path), {
      body: exact,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  /**
   * Write a string (UTF-8) to a file.
   */
  async writeText(path: string, content: string): Promise<void> {
    await this.write(path, new TextEncoder().encode(content));
  }

  /**
   * List a directory.
   */
  async list(
    path = "/",
    opts: { offset?: number; limit?: number } = {},
  ): Promise<FsEntry[]> {
    const params: Record<string, number> = {};
    if (opts.offset !== undefined) params["offset"] = opts.offset;
    if (opts.limit !== undefined) params["limit"] = opts.limit;

    const hasParams = Object.keys(params).length > 0;
    const res = await this.client.get(
      this.fsListPath(path),
      hasParams ? { params } : undefined,
    );
    const data = res.json<{ entries: RawFSEntry[]; total: number }>();
    return (data.entries ?? []).map(fsEntryFromRaw);
  }

  /**
   * Remove a file or directory.
   */
  async remove(path: string): Promise<void> {
    await this.client.delete(this.fsPath(path));
  }
}
