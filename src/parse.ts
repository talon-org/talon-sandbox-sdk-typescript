/**
 * Unit conversion helpers for talon-sandbox SDK.
 * All conversions are done client-side before sending to the API.
 */

const SIZE_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/;

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
  tib: 1_099_511_627_776,
};

/**
 * Parse a human-readable size string into bytes (number).
 *
 * Accepts: "4GiB", "512MiB", "1GB", "1024", 4096
 * Returns: bytes as number (truncated to integer)
 * Throws: on unrecognised format or negative value
 *
 * @example
 * parseSize("4GiB")  // 4294967296
 * parseSize(1024)    // 1024
 */
export function parseSize(value: string | number): number {
  if (typeof value === "number") return Math.floor(value);

  const m = SIZE_RE.exec(value);
  if (!m) throw new Error(`Cannot parse size: ${JSON.stringify(value)}`);

  const num = parseFloat(m[1]!);
  if (num < 0) throw new Error(`Size must be non-negative: ${JSON.stringify(value)}`);

  const unitRaw = (m[2] ?? "").toLowerCase();

  if (!unitRaw) return Math.floor(num);

  const multiplier = SIZE_UNITS[unitRaw];
  if (multiplier === undefined) {
    throw new Error(
      `Unknown size unit ${JSON.stringify(m[2])} in: ${JSON.stringify(value)}`,
    );
  }

  return Math.floor(num * multiplier);
}

const DURATION_RE = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?\s*$/i;

const DURATION_SECONDS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/**
 * Parse a human-readable duration string into seconds (number).
 *
 * Accepts: "30s", "5m", "2h", "1d", "1w", "500ms", "30" (bare = seconds), 60
 * Returns: seconds as number (may be fractional for ms)
 * Throws: on unrecognised format
 *
 * @example
 * parseDuration("30m")  // 1800
 * parseDuration("6h")   // 21600
 * parseDuration(60)     // 60
 */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") return value;

  const m = DURATION_RE.exec(value);
  if (!m) throw new Error(`Cannot parse duration: ${JSON.stringify(value)}`);

  const num = parseFloat(m[1]!);
  const unitRaw = (m[2] ?? "").toLowerCase();

  if (!unitRaw) return num; // bare number = seconds

  const multiplier = DURATION_SECONDS[unitRaw];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit ${JSON.stringify(m[2])}`);
  }

  return num * multiplier;
}
