# talon-sandbox

TypeScript SDK v2 for [Talon Sandbox Platform](https://talon-sandbox.dev).

## Install

```bash
npm install talon-sandbox
```

Requires Node.js 20+ (uses built-in `fetch` and `globalThis`).

## Quick start

```typescript
import { Sandbox } from "talon-sandbox";

// Configure via env vars: TALON_SANDBOX_SERVER + TALON_SANDBOX_API_KEY
// Or explicitly:
// import { configure } from "talon-sandbox";
// configure({ server: "https://api.example.com", apiKey: "ask_..." });

const sb = await Sandbox.create({
  image: "node:20-bookworm",
  resources: { cpu: 2, memory: "4GiB", disk: "10GiB" },
  network: "allowlist",
  env: { NODE_ENV: "development" },
  timeout: "30m",
  ttl: "6h",
  labels: { project: "my-agent" },
});

// Run a command (wait for exit)
const result = await sb.run("npm install");
console.log(result.stdout);
assert(result.exitCode === 0);

// Spawn a long-running process
const proc = await sb.spawn("npm run dev");
proc.on("stdout", (line) => console.log(line));
proc.on("exit", (code) => console.log("exited:", code));
await proc.wait();

// Interactive terminal (PTY)
const pty = await sb.terminal.open({ rows: 24, cols: 80 });
pty.on("data", (chunk) => process.stdout.write(chunk));
pty.on("exit", (code) => console.log("pty closed:", code));
await pty.write("ls -la\n");
await pty.resize({ rows: 40, cols: 120 });
await pty.close();

// Filesystem
const bytes: Uint8Array = await sb.fs.read("/workspace/main.py");
const text: string = await sb.fs.readText("/workspace/main.py");
await sb.fs.write("/workspace/out.bin", new Uint8Array([1, 2, 3]));
await sb.fs.writeText("/workspace/out.txt", "hello");
const entries = await sb.fs.list("/workspace");
await sb.fs.remove("/workspace/old");

// Environment variables
const val = await sb.env.get("NODE_ENV");
await sb.env.set("API_KEY", "sk-...");
const all = await sb.env.all();

// Expose a port (requires server v1.1+)
const url = await sb.expose(5173);
const signed = await sb.expose(5173, { sign: true, ttl: "1h", subdomain: "my-app" });
await sb.unexpose(5173);
const ports = await sb.exposed();

// Headless browser (CDP)
const browser = await sb.browser.start();
console.log(browser.cdpUrl); // use with playwright / puppeteer
await sb.browser.stop();

// Reattach to existing sandbox
const sb2 = await Sandbox.get("sb_abc123");

// List sandboxes (label filter is client-side)
const all2 = await Sandbox.list({ labels: { project: "my-agent" } });

// Auto-cleanup with `await using` (TypeScript 5.2+)
await using sb3 = await Sandbox.create({ image: "alpine:latest" });
// sb3.kill() is called automatically on block exit

// Lifecycle
await sb.pause();
await sb.resume();
await sb.kill();
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `TALON_SANDBOX_SERVER` | API server base URL | `https://api.sandbox.talon.net.cn` |
| `TALON_SANDBOX_API_KEY` | API key (`ask_…` prefix) | — |

## Explicit configuration

```typescript
import { configure, Client, Sandbox } from "talon-sandbox";

// Global (affects all Sandbox calls)
configure({ server: "https://api.example.com", apiKey: "ask_..." });

// Per-sandbox (overrides global)
const client = new Client({ server: "https://api.example.com", apiKey: "ask_..." });
const sb = await Sandbox.create({ image: "alpine:latest", client });
```

## Error handling

```typescript
import {
  SandboxError,
  AuthError,
  NotFoundError,
  QuotaError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  NotImplementedError,
} from "talon-sandbox";

try {
  const sb = await Sandbox.create({ image: "node:20-bookworm" });
} catch (err) {
  if (err instanceof QuotaError) {
    console.log("quota exceeded");
  } else if (err instanceof AuthError) {
    console.log("authentication failed");
  } else if (err instanceof NotImplementedError) {
    console.log("upgrade server version:", err.message);
  }
}
```

## parseSize / parseDuration utilities

```typescript
import { parseSize, parseDuration } from "talon-sandbox";

parseSize("4GiB")   // 4294967296
parseSize("512MiB") // 536870912
parseSize("1GB")    // 1000000000

parseDuration("30m") // 1800
parseDuration("6h")  // 21600
parseDuration("1d")  // 86400
```

## License

UNLICENSED — Proprietary. All rights reserved.
