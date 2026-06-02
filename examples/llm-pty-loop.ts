/**
 * llm-pty-loop.ts — stream PTY output and feed to an LLM.
 *
 * Shows how to open a terminal session and stream data chunks.
 * Replace `llm.feed(chunk)` with your actual LLM integration.
 *
 * Run（托管端点，配 API key 即可）:
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/llm-pty-loop.ts
 *
 * 自部署覆盖 server:
 *   TALON_SANDBOX_SERVER=http://localhost:18080 \
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/llm-pty-loop.ts
 */
import { Sandbox } from "../src/index.js";

// Use `await using` for auto-cleanup on block exit (TS 5.2+)
await using sb = await Sandbox.create({
  image: "talon-alpine",
  resources: { memory: "1GiB" },
  ttl: "10m",
});

console.log("sandbox:", sb.id);

const pty = await sb.terminal.open({ rows: 24, cols: 80 });

// Stream PTY output
pty.on("data", (chunk) => {
  // In a real LLM loop: llm.feed(chunk)
  process.stdout.write(chunk);
});

pty.on("exit", (code) => {
  console.log("\nPTY exited with code:", code);
});

// Send commands
await pty.write("echo 'LLM PTY loop demo'\n");
await pty.write("ls /\n");
await pty.write("node --version\n");
await pty.write("exit\n");

// Wait for PTY to close
await new Promise<void>((resolve) => pty.on("exit", () => resolve()));

// sb.kill() called automatically by `await using`
