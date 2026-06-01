import { describe, it, expect, vi } from "vitest";
import { Env } from "../src/env.js";
import { NotFoundError } from "../src/errors.js";
import type { Client } from "../src/client.js";

function mockClient(overrides: Partial<Client> = {}): Client {
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue(undefined),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
    wsUrl: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

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

describe("Env.get", () => {
  it("returns value for existing key", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue(makeResponse({ key: "NODE_ENV", value: "development" })),
    });
    const env = new Env("sb_1", client);
    expect(await env.get("NODE_ENV")).toBe("development");
  });

  it("returns undefined on 404", async () => {
    const client = mockClient({
      get: vi.fn().mockRejectedValue(new NotFoundError("not found", { statusCode: 404 })),
    });
    const env = new Env("sb_1", client);
    expect(await env.get("MISSING")).toBeUndefined();
  });

  it("URL-encodes key with special chars", async () => {
    const getFn = vi.fn().mockResolvedValue(makeResponse({ key: "MY_VAR", value: "x" }));
    const client = mockClient({ get: getFn });
    const env = new Env("sb_1", client);
    await env.get("MY VAR");
    expect(getFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/env/MY%20VAR");
  });
});

describe("Env.set", () => {
  it("calls PUT with key+value body", async () => {
    const putFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ put: putFn });
    const env = new Env("sb_1", client);
    await env.set("API_KEY", "sk-abc");
    expect(putFn).toHaveBeenCalledWith(
      "/v1/sandboxes/sb_1/env/API_KEY",
      { json: { key: "API_KEY", value: "sk-abc" } },
    );
  });
});

describe("Env.all", () => {
  it("returns full env record", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue(
        makeResponse({ env: { NODE_ENV: "development", PORT: "3000" } }),
      ),
    });
    const env = new Env("sb_1", client);
    const all = await env.all();
    expect(all["NODE_ENV"]).toBe("development");
    expect(all["PORT"]).toBe("3000");
  });
});

describe("Env.unset", () => {
  it("DELETE /env/{key} 调用正确路径", async () => {
    const deleteFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ delete: deleteFn });
    const env = new Env("sb_1", client);
    await env.unset("MY_VAR");
    expect(deleteFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/env/MY_VAR");
  });

  it("URL-encodes key with special chars", async () => {
    const deleteFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ delete: deleteFn });
    const env = new Env("sb_1", client);
    await env.unset("MY VAR");
    expect(deleteFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/env/MY%20VAR");
  });
});
