/**
 * vibe-coding.ts — spawn a dev server, expose port, stream logs.
 *
 * Demonstrates: spawn(), expose(), on("stdout"), await using.
 *
 * Run（托管端点，配 API key 即可）:
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/vibe-coding.ts
 *
 * 自部署覆盖 server:
 *   TALON_SANDBOX_SERVER=http://localhost:18080 \
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/vibe-coding.ts
 */
import { Sandbox } from "../src/index.js";
import { NotImplementedError } from "../src/index.js";

await using sb = await Sandbox.create({
  image: "talon-alpine",
  resources: { cpu: 2, memory: "2GiB" },
  network: "open",
  ttl: "2h",
  labels: { role: "vibe-coder" },
});

console.log("sandbox:", sb.id);

// Write a minimal express server
await sb.fs.writeText(
  "/workspace/server.js",
  `
const http = require('http');
const server = http.createServer((req, res) => {
  res.end('Hello from sandbox!\\n');
});
server.listen(3000, () => console.log('listening on port 3000'));
`,
);

// Spawn the server
const proc = await sb.spawn("node /workspace/server.js");
proc.on("stdout", (line) => console.log("[server]", line));
proc.on("exit", (code) => console.log("[server] exited with", code));

// Give it a moment to start
await new Promise<void>((r) => setTimeout(r, 1000));

// Expose port (requires server v1.1+)
try {
  const url = await sb.expose(3000, {
    sign: false,
    subdomain: "demo-app",
  });
  console.log("preview URL:", url);

  const signed = await sb.expose(3000, { sign: true, ttl: "1h" });
  console.log("signed URL:", signed);

  const ports = await sb.exposed();
  console.log("exposed ports:", ports.map((p) => `${p.port} → ${p.url}`));

  await sb.unexpose(3000);
  console.log("port unexposed");
} catch (err) {
  if (err instanceof NotImplementedError) {
    console.log("expose() not available yet:", err.message);
  } else {
    throw err;
  }
}

await proc.kill();
console.log("done — sb.kill() will be called by `await using`");
