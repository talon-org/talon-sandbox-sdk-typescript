import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../src/sandbox.js";
import { setDefaultClient, resetDefaultClient } from "../src/config.js";
import { NotFoundError, NotImplementedError } from "../src/errors.js";
import type { Client } from "../src/client.js";

const rawSandbox = {
  id: "sb_abc",
  state: "running",
  created_at: 1716000000,
};

function makeResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    status,
    body: new TextEncoder().encode(text).buffer as ArrayBuffer,
    text: () => text,
    json: <T>() => body as T,
    headers: new Headers(),
  };
}

function sandboxClient(extraMethods: Partial<Client> = {}): Client {
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue(undefined),
    wsUrl: vi.fn().mockReturnValue("ws://localhost:18080/v1/sandboxes/sb_abc/pty"),
    post: vi.fn().mockResolvedValue(makeResponse(rawSandbox, 201)),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn().mockResolvedValue(makeResponse(null, 204)),
    request: vi.fn(),
    ...extraMethods,
  } as unknown as Client;
}

beforeEach(() => resetDefaultClient());

describe("sb.expose", () => {
  it("POSTs to /expose and returns url", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse({
        port: 5173,
        url: "https://sb-abc-5173.preview.example.com",
        signed: false,
      }));
    const client = sandboxClient({ post: postFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    const url = await sb.expose(5173);
    expect(url).toBe("https://sb-abc-5173.preview.example.com");
    expect(postFn).toHaveBeenNthCalledWith(
      2,
      "/v1/sandboxes/sb_abc/expose",
      expect.objectContaining({ json: expect.objectContaining({ port: 5173 }) }),
    );
  });

  it("throws NotImplementedError when server returns 404", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockRejectedValue(new NotFoundError("not found", { statusCode: 404 }));
    const client = sandboxClient({ post: postFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    const err = await sb.expose(5173).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as Error).message).toContain("upgrade server to v1.1+");
  });

  it("passes sign=true to request body", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse({
        port: 5173,
        url: "https://signed.example.com",
        signed: true,
      }));
    const client = sandboxClient({ post: postFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.expose(5173, { sign: true, ttl: "1h", subdomain: "my-app" });
    const body = (postFn.mock.calls[1] as [string, { json: Record<string, unknown> }])[1].json;
    expect(body["sign"]).toBe(true);
    expect(body["subdomain"]).toBe("my-app");
    expect(body["ttl"]).toBe("1h");
  });

  it("converts numeric ttl to seconds string", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse({ port: 5173, url: "http://x.y", signed: false }));
    const client = sandboxClient({ post: postFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.expose(5173, { ttl: 3600 });
    const body = (postFn.mock.calls[1] as [string, { json: Record<string, unknown> }])[1].json;
    expect(body["ttl"]).toBe("3600s");
  });
});

describe("sb.unexpose", () => {
  it("calls DELETE /expose/{port}", async () => {
    const deleteFn = vi.fn().mockResolvedValue(makeResponse(null, 204));
    const client = sandboxClient({ delete: deleteFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.unexpose(5173);
    expect(deleteFn).toHaveBeenCalledWith("/v1/sandboxes/sb_abc/expose/5173");
  });

  it("throws NotImplementedError on 404", async () => {
    const deleteFn = vi.fn().mockRejectedValue(
      new NotFoundError("not found", { statusCode: 404 }),
    );
    const client = sandboxClient({ delete: deleteFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await expect(sb.unexpose(5173)).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("sb.exposed", () => {
  it("returns ExposedPort list", async () => {
    const getFn = vi.fn().mockResolvedValue(
      makeResponse({
        ports: [
          { port: 5173, url: "https://example.com", signed: false, expires_at: null },
          { port: 3000, url: "https://example2.com", signed: true, expires_at: "2026-06-01T00:00:00Z" },
        ],
      }),
    );
    const client = sandboxClient({ get: getFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    const ports = await sb.exposed();
    expect(ports).toHaveLength(2);
    expect(ports[0]!.port).toBe(5173);
    expect(ports[0]!.signed).toBe(false);
    expect(ports[0]!.expiresAt).toBeNull();
    expect(ports[1]!.port).toBe(3000);
    expect(ports[1]!.signed).toBe(true);
    expect(ports[1]!.expiresAt).toBeInstanceOf(Date);
  });

  it("throws NotImplementedError on 404", async () => {
    const getFn = vi.fn().mockRejectedValue(
      new NotFoundError("not found", { statusCode: 404 }),
    );
    const client = sandboxClient({ get: getFn });
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await expect(sb.exposed()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
