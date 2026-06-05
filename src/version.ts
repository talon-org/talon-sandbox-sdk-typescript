/**
 * SDK 版本与规范 User-Agent 构造。
 *
 * 版本号来源:构建时由 tsup 的 `define` 把 package.json 的 version 注入到
 * 全局编译期常量 `__SDK_VERSION__`(见 tsup.config.ts)。这样发版只需改
 * package.json,产物里的版本号会自动跟随,无需手改字符串。
 *
 * 非打包场景(如 vitest 直接跑 src/、或被其它工具以源码形式消费):
 * `__SDK_VERSION__` 未被替换,会是未定义的标识符,因此用 typeof 守卫兜底,
 * 回退到一个占位版本,避免抛 ReferenceError。
 */

// 由 tsup define 在构建时替换为字符串字面量;源码态下不存在该全局。
declare const __SDK_VERSION__: string | undefined;

/** 当前 SDK 版本号(构建时注入,源码/测试态回退占位)。 */
export const VERSION: string =
  typeof __SDK_VERSION__ === "string" && __SDK_VERSION__ ? __SDK_VERSION__ : "0.0.0-dev";

/**
 * 规范 User-Agent。格式 `talon-sandbox-typescript/<version>`,后端据此把
 * createSandbox 的来源归类成 `sdk-typescript`(UA 前缀 `talon-sandbox-<lang>/`)。
 * 切勿改前缀格式,否则后端来源归因会退化成 `api`。
 */
export const USER_AGENT = `talon-sandbox-typescript/${VERSION}`;

/** 浏览器兜底头的值:浏览器 fetch 不允许设 User-Agent,改用自定义头透传客户端标识。 */
export const CLIENT_HEADER_VALUE = "sdk-typescript";

/**
 * 判断当前是否浏览器环境。
 * 浏览器里 fetch 会忽略/拒绝 User-Agent 这类「forbidden header」,
 * 因此浏览器走 X-Talon-Client 兜底头;Node 正常设 User-Agent。
 */
function isBrowser(): boolean {
  // 有 window/document 视为浏览器;Node(含 Node 22+ 原生 fetch)没有 window。
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { window?: unknown }).window !== "undefined" &&
    typeof (globalThis as { document?: unknown }).document !== "undefined"
  );
}

/**
 * 返回应附加到出站 HTTP 请求上的客户端标识头。
 * - Node:`User-Agent: talon-sandbox-typescript/<version>`
 * - 浏览器:`X-Talon-Client: sdk-typescript`(User-Agent 设了也会被浏览器丢弃)
 */
export function clientIdentityHeaders(): Record<string, string> {
  if (isBrowser()) {
    return { "X-Talon-Client": CLIENT_HEADER_VALUE };
  }
  return { "User-Agent": USER_AGENT };
}
