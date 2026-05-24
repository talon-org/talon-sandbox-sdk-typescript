import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../src/sandbox.js";
import { setDefaultClient, resetDefaultClient } from "../src/config.js";
import type { Client } from "../src/client.js";

const rawSandbox = {
  id: "sb_abc",
  state: "running",
  image_id: "node:20-bookworm",
  created_at: 1716000000,
  labels: { project: "test" },
  network_policy: "restricted-egress",
  cpu_millis: 2000,
  memory_bytes: 4294967296,
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

function mockClient(overrides: Partial<Client> = {}): Client {
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue("Bearer test"),
    wsUrl: vi.fn().mockReturnValue("ws://localhost:18080/v1/sandboxes/sb_abc/pty"),
    get: vi.fn().mockResolvedValue(makeResponse({ sandboxes: [rawSandbox] })),
    post: vi.fn().mockResolvedValue(makeResponse(rawSandbox, 201)),
    put: vi.fn().mockResolvedValue(makeResponse(null, 204)),
    delete: vi.fn().mockResolvedValue(makeResponse(null, 204)),
    request: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

beforeEach(() => {
  resetDefaultClient();
});

describe("Sandbox.create", () => {
  it("posts to /v1/sandboxes and returns Sandbox instance", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ image: "node:20-bookworm", wait: false });
    expect(client.post).toHaveBeenCalledWith(
      "/v1/sandboxes",
      expect.objectContaining({
        json: expect.objectContaining({ image_id: "node:20-bookworm" }),
      }),
    );
    expect(sb.id).toBe("sb_abc");
    expect(sb.state).toBe("running");
    expect(sb.image).toBe("node:20-bookworm");
  });

  it("converts resources.memory string to memory_bytes", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ resources: { memory: "4GiB" }, wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["memory_bytes"]).toBe(4 * 1024 * 1024 * 1024);
  });

  it("converts resources.cpu to cpu_millis (integer)", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ resources: { cpu: 2 }, wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["cpu_millis"]).toBe(2000);
  });

  it("converts resources.cpu fractional (0.5 → 500 millis)", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ resources: { cpu: 0.5 }, wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["cpu_millis"]).toBe(500);
  });

  it("converts timeout string to idle_timeout_seconds", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ timeout: "30m", wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["idle_timeout_seconds"]).toBe(1800);
  });

  it("converts ttl string to ttl_seconds", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ ttl: "6h", wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["ttl_seconds"]).toBe(21600);
  });

  it("passes labels and env", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({
      labels: { project: "agent-x" },
      env: { NODE_ENV: "development" },
      wait: false,
    });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["labels"]).toEqual({ project: "agent-x" });
    expect(call[1].json["env"]).toEqual({ NODE_ENV: "development" });
  });

  it("converts disk size string to disk_bytes", async () => {
    const client = mockClient();
    setDefaultClient(client);
    await Sandbox.create({ resources: { disk: "10GiB" }, wait: false });
    const call = (client.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { json: Record<string, unknown> },
    ];
    expect(call[1].json["disk_bytes"]).toBe(10 * 1024 * 1024 * 1024);
  });

  it("attaches fs, env, terminal, browser sub-objects", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    expect(sb.fs).toBeDefined();
    expect(sb.env).toBeDefined();
    expect(sb.terminal).toBeDefined();
    expect(sb.browser).toBeDefined();
  });
});

describe("Sandbox.get", () => {
  it("fetches sandbox by id", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue(makeResponse(rawSandbox)),
    });
    setDefaultClient(client);
    const sb = await Sandbox.get("sb_abc");
    expect(sb.id).toBe("sb_abc");
    expect(client.get).toHaveBeenCalledWith("/v1/sandboxes/sb_abc");
  });
});

describe("Sandbox.list", () => {
  it("returns list of Sandbox instances", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sbs = await Sandbox.list();
    expect(sbs).toHaveLength(1);
    expect(sbs[0]!.id).toBe("sb_abc");
  });

  it("filters by labels client-side", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue(
        makeResponse({
          sandboxes: [
            { ...rawSandbox, id: "sb_1", labels: { project: "agent-x" } },
            { ...rawSandbox, id: "sb_2", labels: { project: "other" } },
          ],
        }),
      ),
    });
    setDefaultClient(client);
    const sbs = await Sandbox.list({ labels: { project: "agent-x" } });
    expect(sbs).toHaveLength(1);
    expect(sbs[0]!.id).toBe("sb_1");
  });
});

describe("Sandbox lifecycle", () => {
  it("pause posts to /pause and updates state", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.pause();
    expect(client.post).toHaveBeenCalledWith("/v1/sandboxes/sb_abc/pause");
    expect(sb.state).toBe("paused");
  });

  it("resume posts to /resume and updates state", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.pause();
    await sb.resume();
    expect(client.post).toHaveBeenCalledWith("/v1/sandboxes/sb_abc/resume");
    expect(sb.state).toBe("running");
  });

  it("kill calls DELETE and updates state", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb.kill();
    expect(client.delete).toHaveBeenCalledWith("/v1/sandboxes/sb_abc");
    expect(sb.state).toBe("killed");
  });
});

describe("Sandbox asyncDispose", () => {
  it("calls kill (DELETE) on dispose", async () => {
    const client = mockClient();
    setDefaultClient(client);
    const sb = await Sandbox.create({ wait: false });
    await sb[Symbol.asyncDispose]();
    expect(client.delete).toHaveBeenCalledWith("/v1/sandboxes/sb_abc");
  });
});
