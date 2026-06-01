import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../src/sandbox.js";
import { setDefaultClient, resetDefaultClient } from "../src/config.js";
import type { Client } from "../src/client.js";

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

const rawSandbox = {
  id: "sb_abc",
  state: "running",
  image_id: "node:20-bookworm",
  created_at: 1716000000,
  labels: {},
  network_policy: "restricted-egress",
};

const rawAgentRunResponse = {
  run_id: "run_xyz",
  status: "completed",
  duration_ms: 12345,
  steps: [
    {
      step: 1,
      action: "Page.navigate",
      thought: "Navigate to target",
      details: { url: "https://example.com" },
    },
  ],
  result: "Found cats on the page",
  exit_code: 0,
  stderr: "",
};

function mockClient(overrides: Partial<Client> = {}): Client {
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue("Bearer test"),
    get: vi.fn(),
    post: vi.fn().mockResolvedValue(makeResponse(rawSandbox, 201)),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    wsUrl: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

beforeEach(() => {
  resetDefaultClient();
});

describe("Sandbox.agentRun", () => {
  it("POST /agent/run 并返回映射后的结果", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201)) // create
      .mockResolvedValueOnce(makeResponse(rawAgentRunResponse, 200)); // agent/run
    const client = mockClient({ post: postFn });
    setDefaultClient(client);

    const sb = await Sandbox.create({ wait: false });
    const result = await sb.agentRun("Search for cats");

    expect(postFn).toHaveBeenCalledWith(
      "/v1/sandboxes/sb_abc/agent/run",
      expect.objectContaining({ json: expect.objectContaining({ goal: "Search for cats" }) }),
    );
    expect(result.runId).toBe("run_xyz");
    expect(result.status).toBe("completed");
    expect(result.durationMs).toBe(12345);
    expect(result.exitCode).toBe(0);
    expect(result.result).toBe("Found cats on the page");
  });

  it("可选参数 maxSteps 和 llmModel 传入请求体", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse(rawAgentRunResponse, 200));
    const client = mockClient({ post: postFn });
    setDefaultClient(client);

    const sb = await Sandbox.create({ wait: false });
    await sb.agentRun("Do something", { maxSteps: 50, llmModel: "anthropic:claude-sonnet-4-6" });

    const [, callOpts] = postFn.mock.calls[1] as [string, { json: Record<string, unknown> }];
    expect(callOpts.json["max_steps"]).toBe(50);
    expect(callOpts.json["llm_model"]).toBe("anthropic:claude-sonnet-4-6");
  });

  it("steps 正确映射", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse(rawAgentRunResponse, 200));
    const client = mockClient({ post: postFn });
    setDefaultClient(client);

    const sb = await Sandbox.create({ wait: false });
    const result = await sb.agentRun("Do something");

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.step).toBe(1);
    expect(result.steps[0]!.action).toBe("Page.navigate");
    expect(result.steps[0]!.thought).toBe("Navigate to target");
  });

  it("不传 maxSteps 时请求体不包含 max_steps 字段", async () => {
    const postFn = vi.fn()
      .mockResolvedValueOnce(makeResponse(rawSandbox, 201))
      .mockResolvedValueOnce(makeResponse(rawAgentRunResponse, 200));
    const client = mockClient({ post: postFn });
    setDefaultClient(client);

    const sb = await Sandbox.create({ wait: false });
    await sb.agentRun("Do something");

    const [, callOpts] = postFn.mock.calls[1] as [string, { json: Record<string, unknown> }];
    expect(callOpts.json["max_steps"]).toBeUndefined();
    expect(callOpts.json["llm_model"]).toBeUndefined();
  });
});
