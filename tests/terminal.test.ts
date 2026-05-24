import { describe, it, expect, vi } from "vitest";
import { PtySession } from "../src/terminal.js";
import { EventEmitter as NodeEE } from "events";

function makeFakeWs() {
  const ee = new NodeEE();
  const ws = Object.assign(ee, {
    send: vi.fn((data: Buffer, cb: (err?: Error) => void) => cb()),
    close: vi.fn(() => {
      ee.emit("close", 0);
    }),
    readyState: 1,
  });
  return ws;
}

describe("PtySession", () => {
  it("emits data when ws receives Buffer message", () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    const received: Uint8Array[] = [];
    session.on("data", (chunk) => received.push(chunk));

    ws.emit("message", Buffer.from("hello"));
    expect(received).toHaveLength(1);
    expect(new TextDecoder().decode(received[0]!)).toBe("hello");
  });

  it("emits data when ws receives ArrayBuffer message", () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    const received: Uint8Array[] = [];
    session.on("data", (chunk) => received.push(chunk));

    const ab = new TextEncoder().encode("world").buffer as ArrayBuffer;
    ws.emit("message", ab);
    expect(new TextDecoder().decode(received[0]!)).toBe("world");
  });

  it("write sends Buffer to ws.send", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    await session.write("ls\n");
    expect(ws.send).toHaveBeenCalledWith(Buffer.from("ls\n"), expect.any(Function));
  });

  it("write accepts Uint8Array", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    const data = new Uint8Array([0x03]); // Ctrl-C
    await session.write(data);
    expect(ws.send).toHaveBeenCalled();
  });

  it("resize sends JSON frame with type/cols/rows", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    await session.resize({ rows: 40, cols: 120 });
    const sent = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
    expect(JSON.parse(sent.toString())).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  it("close sets closed=true", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    await session.close();
    expect(session.closed).toBe(true);
  });

  it("write throws when closed", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    await session.close();
    await expect(session.write("x")).rejects.toThrow("closed");
  });

  it("emits exit with WS close code", () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    const codes: number[] = [];
    session.on("exit", (c) => codes.push(c));
    ws.emit("close", 1001);
    expect(codes).toEqual([1001]);
  });

  it("emits error on ws error event", () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    const errors: Error[] = [];
    session.on("error", (e) => errors.push(e));
    ws.emit("error", new Error("connection reset"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("connection reset");
  });

  it("close is idempotent", async () => {
    const ws = makeFakeWs();
    const session = new PtySession(ws as never);
    await session.close();
    await session.close(); // should not throw
    expect(session.closed).toBe(true);
  });
});
