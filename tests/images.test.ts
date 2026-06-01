import { describe, it, expect, vi } from "vitest";
import { listImages } from "../src/images.js";
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

function mockClient(overrides: Partial<Client> = {}): Client {
  return {
    baseUrl: "http://localhost:18080",
    authHeader: vi.fn().mockReturnValue("Bearer test"),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    wsUrl: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

const rawImage = {
  id: "img_abc",
  name: "node:20-bookworm",
  url: "registry.example.com/node:20-bookworm",
  sha256: "abc123",
  os: "linux",
  arch: "amd64",
  source: "builtin",
  is_default: true,
  description: "Node.js 20 on Debian Bookworm",
  created_at: 1716000000,
};

describe("listImages", () => {
  it("GET /v1/images 返回 ImageInfo 数组", async () => {
    const getFn = vi.fn().mockResolvedValue(
      makeResponse({ images: [rawImage] }),
    );
    const client = mockClient({ get: getFn });
    const images = await listImages({ client });
    expect(getFn).toHaveBeenCalledWith("/v1/images");
    expect(images).toHaveLength(1);
  });

  it("正确映射 snake_case 字段到 camelCase", async () => {
    const getFn = vi.fn().mockResolvedValue(
      makeResponse({ images: [rawImage] }),
    );
    const client = mockClient({ get: getFn });
    const [img] = await listImages({ client });
    expect(img!.id).toBe("img_abc");
    expect(img!.name).toBe("node:20-bookworm");
    expect(img!.isDefault).toBe(true);
    expect(img!.source).toBe("builtin");
    expect(img!.createdAt).toBeInstanceOf(Date);
    expect(img!.createdAt.getFullYear()).toBe(2024);
  });

  it("空列表时返回空数组", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue(makeResponse({ images: [] })),
    });
    const images = await listImages({ client });
    expect(images).toHaveLength(0);
  });

  it("description 缺省时返回空字符串", async () => {
    const noDesc = { ...rawImage, description: undefined };
    const client = mockClient({
      get: vi.fn().mockResolvedValue(makeResponse({ images: [noDesc] })),
    });
    const [img] = await listImages({ client });
    expect(img!.description).toBe("");
  });
});
