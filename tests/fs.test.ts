import { describe, it, expect, vi } from "vitest";
import { Fs } from "../src/fs.js";
import type { Client } from "../src/client.js";

function makeResponse(body: unknown, status = 200) {
  const isBuffer = body instanceof ArrayBuffer || body instanceof Uint8Array;
  const buf = isBuffer
    ? (body instanceof Uint8Array ? body.buffer : body)
    : new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)).buffer;
  const text = isBuffer
    ? new TextDecoder().decode(buf as ArrayBuffer)
    : (typeof body === "string" ? body : JSON.stringify(body));
  return {
    status,
    body: buf as ArrayBuffer,
    text: () => text,
    json: <T>() => (typeof body === "string" ? body : body) as T,
    headers: new Headers(),
  };
}

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

describe("Fs.read", () => {
  it("returns Uint8Array from response body", async () => {
    const data = new Uint8Array([104, 101, 108, 108, 111]);
    const client = mockClient({
      get: vi.fn().mockResolvedValue({
        status: 200,
        body: data.buffer,
        text: () => "hello",
        json: () => null,
        headers: new Headers(),
      }),
    });
    const fs = new Fs("sb_1", client);
    const result = await fs.read("/workspace/main.py");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(data);
  });

  it("calls GET with correct path", async () => {
    const getFn = vi.fn().mockResolvedValue({
      status: 200,
      body: new ArrayBuffer(0),
      text: () => "",
      json: () => null,
      headers: new Headers(),
    });
    const client = mockClient({ get: getFn });
    const fs = new Fs("sb_1", client);
    await fs.read("/workspace/main.py");
    expect(getFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/fs/workspace/main.py");
  });
});

describe("Fs.readText", () => {
  it("decodes UTF-8", async () => {
    const encoded = new TextEncoder().encode("hello world");
    const client = mockClient({
      get: vi.fn().mockResolvedValue({
        status: 200,
        body: encoded.buffer,
        text: () => "hello world",
        json: () => null,
        headers: new Headers(),
      }),
    });
    const fs = new Fs("sb_1", client);
    const result = await fs.readText("/workspace/main.py");
    expect(result).toBe("hello world");
  });
});

describe("Fs.write", () => {
  it("calls PUT with octet-stream header", async () => {
    const putFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ put: putFn });
    const fs = new Fs("sb_1", client);
    const data = new Uint8Array([1, 2, 3]);
    await fs.write("/workspace/x.bin", data);
    expect(putFn).toHaveBeenCalledWith(
      "/v1/sandboxes/sb_1/fs/workspace/x.bin",
      expect.objectContaining({
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  });
});

describe("Fs.writeText", () => {
  it("calls PUT with encoded string", async () => {
    const putFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ put: putFn });
    const fs = new Fs("sb_1", client);
    await fs.writeText("/workspace/x.txt", "hello");
    expect(putFn).toHaveBeenCalledWith(
      "/v1/sandboxes/sb_1/fs/workspace/x.txt",
      expect.objectContaining({ headers: { "Content-Type": "application/octet-stream" } }),
    );
  });
});

describe("Fs.list", () => {
  it("returns FsEntry array with correct types", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({
        status: 200,
        body: new ArrayBuffer(0),
        text: () => "",
        json: () => ({
          entries: [
            { name: "main.py", size: 100, mod_time: 1000, is_dir: false },
            { name: "src", size: 0, mod_time: 2000, is_dir: true },
          ],
          total: 2,
        }),
        headers: new Headers(),
      }),
    });
    const fs = new Fs("sb_1", client);
    const entries = await fs.list("/workspace");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe("main.py");
    expect(entries[0]!.type).toBe("file");
    expect(entries[0]!.size).toBe(100);
    expect(entries[1]!.name).toBe("src");
    expect(entries[1]!.type).toBe("directory");
  });

  it("calls correct list path", async () => {
    const getFn = vi.fn().mockResolvedValue({
      status: 200,
      body: new ArrayBuffer(0),
      text: () => "",
      json: () => ({ entries: [], total: 0 }),
      headers: new Headers(),
    });
    const client = mockClient({ get: getFn });
    const fs = new Fs("sb_1", client);
    await fs.list("/workspace");
    expect(getFn).toHaveBeenCalledWith(
      "/v1/sandboxes/sb_1/fs-list/workspace",
      expect.anything(),
    );
  });
});

describe("Fs.remove", () => {
  it("calls DELETE with correct path", async () => {
    const deleteFn = vi.fn().mockResolvedValue({ status: 204 });
    const client = mockClient({ delete: deleteFn });
    const fs = new Fs("sb_1", client);
    await fs.remove("/workspace/old");
    expect(deleteFn).toHaveBeenCalledWith("/v1/sandboxes/sb_1/fs/workspace/old");
  });
});
