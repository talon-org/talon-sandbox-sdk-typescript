/**
 * hello.ts — basic talon-sandbox usage.
 *
 * Run（托管端点，配 API key 即可）:
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/hello.ts
 *
 * 自部署覆盖 server:
 *   TALON_SANDBOX_SERVER=http://localhost:18080 \
 *   TALON_SANDBOX_API_KEY=ask_... \
 *   npx tsx examples/hello.ts
 */
import { Sandbox } from "../src/index.js";

const sb = await Sandbox.create({
  image: "talon-alpine",
  resources: { cpu: 2, memory: "4GiB", disk: "10GiB" },
  network: "allowlist",
  env: { NODE_ENV: "development" },
  timeout: "30m",
  ttl: "6h",
  labels: { project: "agent-x" },
});

console.log("sandbox id:", sb.id);
console.log("state:", sb.state);

const result = await sb.run("echo hello from sandbox");
console.log("stdout:", result.stdout.trim());
console.log("exit code:", result.exitCode);

await sb.fs.writeText("/workspace/hello.txt", "hello world\n");
const text = await sb.fs.readText("/workspace/hello.txt");
console.log("file contents:", text.trim());

const entries = await sb.fs.list("/workspace");
console.log("files:", entries.map((e) => e.name));

await sb.kill();
console.log("sandbox killed");
