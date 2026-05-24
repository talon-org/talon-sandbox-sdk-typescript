/**
 * Error hierarchy for talon-sandbox SDK.
 *
 * HTTP mapping:
 *   401/403  → AuthError
 *   404      → NotFoundError
 *   422      → QuotaError
 *   429      → RateLimitError
 *   5xx      → ServerError
 *   network  → NetworkError
 */

export interface SandboxErrorOpts {
  statusCode?: number;
  requestId?: string;
}

/** Base class for all talon-sandbox SDK errors. */
export class SandboxError extends Error {
  /** HTTP status code if the error originated from an HTTP response. */
  readonly statusCode: number | undefined;
  /** Server-side request ID for audit log correlation. */
  readonly requestId: string | undefined;

  constructor(message: string, opts?: SandboxErrorOpts) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = opts?.statusCode;
    this.requestId = opts?.requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 / 403 — authentication or authorization failure. */
export class AuthError extends SandboxError {}

/** 404 — sandbox, process, or file not found. */
export class NotFoundError extends SandboxError {}

/** 422 — tenant sandbox quota exceeded. */
export class QuotaError extends SandboxError {}

export interface RateLimitErrorOpts {
  retryAfter?: number;
  requestId?: string;
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends SandboxError {
  readonly retryAfter: number | undefined;

  constructor(message: string, opts?: RateLimitErrorOpts) {
    super(message, { statusCode: 429 });
    if (opts?.requestId !== undefined) {
      (this as { requestId: string | undefined }).requestId = opts.requestId;
    }
    this.retryAfter = opts?.retryAfter;
  }
}

export interface TimeoutErrorOpts {
  state?: string;
  elapsed?: number;
  requestId?: string;
}

/** Sandbox stuck in unexpected state past a wait deadline. */
export class TimeoutError extends SandboxError {
  readonly state: string | undefined;
  readonly elapsed: number | undefined;

  constructor(message: string, opts?: TimeoutErrorOpts) {
    super(message);
    if (opts?.requestId !== undefined) {
      (this as { requestId: string | undefined }).requestId = opts.requestId;
    }
    this.state = opts?.state;
    this.elapsed = opts?.elapsed;
  }
}

/** Network / connection error (no HTTP response received). */
export class NetworkError extends SandboxError {
  readonly underlyingCause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.underlyingCause = cause;
  }
}

/** 5xx — server-side error. */
export class ServerError extends SandboxError {}

/** Generic 4xx client error. */
export class ClientError extends SandboxError {}

/**
 * Feature requires a newer server version.
 * Thrown when a v1.1+ endpoint returns 404.
 */
export class NotImplementedError extends SandboxError {}

/** Map HTTP status + body to the appropriate SandboxError subclass. */
export function mapHttpError(
  status: number,
  body: string,
  opts?: { retryAfter?: number; requestId?: string },
): SandboxError {
  const message = extractMessage(body);
  const errOpts: SandboxErrorOpts = { statusCode: status };
  if (opts?.requestId !== undefined) errOpts.requestId = opts.requestId;

  if (status === 401 || status === 403) return new AuthError(message, errOpts);
  if (status === 404) return new NotFoundError(message, { statusCode: 404, ...errOpts });
  if (status === 422) return new QuotaError(message, { statusCode: 422, ...errOpts });
  if (status === 429) {
    const rlOpts: RateLimitErrorOpts = {};
    if (opts?.retryAfter !== undefined) rlOpts.retryAfter = opts.retryAfter;
    if (opts?.requestId !== undefined) rlOpts.requestId = opts.requestId;
    return new RateLimitError(message, rlOpts);
  }
  if (status >= 500) return new ServerError(message, errOpts);
  return new ClientError(message, errOpts);
}

function extractMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as Record<string, unknown>)["error"] === "string"
    ) {
      return (parsed as Record<string, string>)["error"]!;
    }
  } catch {
    // fall through
  }
  return body || "Unknown error";
}
