import { describe, it, expect, vi } from "vitest";
import { runCommand, spawnProcess, SpawnedProcess } from "../src/process.js";
import type { Client } from "../src/client.js";

function makeResponse(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    body: new TextEncoder().encode(text).buffer as ArrayBuffer,
    text: () => text,
    json: <T>() => body as T,
    headers: new Headers(),
  };
}

function mockClient(responses: ReturnType<typeof makeResponse>[]): Client {
  let call = 0;
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue(undefined),
    post: vi.fn(async () => responses[call++]!),
    get: vi.fn(async () => responses[call++]!),
    put: vi.fn(async () => makeResponse(null, 204)),
    delete: vi.fn(async () => makeResponse(null, 204)),
    request: vi.fn(),
    wsUrl: vi.fn(),
  } as unknown as Client;
}

describe("runCommand", () => {
  it("starts process, polls until exited, returns result", async () => {
    const client = mockClient([
      // POST /processes → process created with state=exited
      makeResponse({ id: "proc_1", state: "exited", exit_code: 0, started_at: 1000, exited_at: 1002 }, 201),
      // GET /processes/proc_1/logs
      makeResponse("hello\n"),
    ]);
    const result = await runCommand(client, "sb_1", "echo hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("polls while state=running then gets exit", async () => {
    const client = mockClient([
      // POST /processes → running
      makeResponse({ id: "proc_2", state: "running", exit_code: -1 }, 201),
      // GET poll → exited
      makeResponse({ id: "proc_2", state: "exited", exit_code: 1 }),
      // GET logs
      makeResponse("error output\n"),
    ]);
    const result = await runCommand(client, "sb_1", "false", { pollInterval: 1 });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("error output\n");
  });

  it("parses quoted command args", async () => {
    const postFn = vi.fn().mockResolvedValue(
      makeResponse({ id: "p", state: "exited", exit_code: 0 }, 201),
    );
    const getFn = vi.fn().mockResolvedValue(makeResponse(""));
    const client = {
      baseUrl: "http://localhost:18080",
      authHeader: vi.fn(),
      post: postFn,
      get: getFn,
      put: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      wsUrl: vi.fn(),
    } as unknown as Client;
    await runCommand(client, "sb_1", 'echo "hello world"');
    const body = (postFn.mock.calls[0] as [string, { json: { command: string[] } }])[1].json;
    expect(body.command).toEqual(["echo", "hello world"]);
  });
});

describe("spawnProcess", () => {
  it("returns SpawnedProcess with correct id", async () => {
    const client = mockClient([
      makeResponse({ id: "proc_3", state: "running", exit_code: -1 }, 201),
    ]);
    const proc = await spawnProcess(client, "sb_1", "npm run dev");
    expect(proc).toBeInstanceOf(SpawnedProcess);
    expect(proc.id).toBe("proc_3");
    expect(proc.command).toBe("npm run dev");
    expect(proc.exitCode).toBeUndefined();
  });

  it("kill calls DELETE on process", async () => {
    const deleteFn = vi.fn().mockResolvedValue(makeResponse(null, 204));
    const client = {
      baseUrl: "http://localhost:18080",
      authHeader: vi.fn(),
      post: vi.fn().mockResolvedValue(makeResponse({ id: "proc_4", state: "running" }, 201)),
      get: vi.fn(),
      put: vi.fn(),
      delete: deleteFn,
      request: vi.fn(),
      wsUrl: vi.fn(),
    } as unknown as Client;
    const proc = await spawnProcess(client, "sb_1", "sleep 100");
    await proc.kill();
    expect(deleteFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/processes/proc_4");
  });

  it("on() registers stdout listener", async () => {
    const client = mockClient([
      makeResponse({ id: "proc_5", state: "running" }, 201),
    ]);
    const proc = await spawnProcess(client, "sb_1", "tail -f /dev/null");
    const lines: string[] = [];
    proc.on("stdout", (l) => lines.push(l));
    proc.emit("stdout", "test line");
    expect(lines).toEqual(["test line"]);
  });
});
