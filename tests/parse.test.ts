import { describe, it, expect } from "vitest";
import { parseSize, parseDuration } from "../src/parse.js";

describe("parseSize", () => {
  it("bare integer treated as bytes", () => expect(parseSize("1024")).toBe(1024));
  it("bare float treated as bytes truncated", () => expect(parseSize("1.9")).toBe(1));
  it("KiB", () => expect(parseSize("1KiB")).toBe(1024));
  it("MiB", () => expect(parseSize("4MiB")).toBe(4 * 1024 * 1024));
  it("GiB", () => expect(parseSize("4GiB")).toBe(4 * 1024 * 1024 * 1024));
  it("TiB", () => expect(parseSize("1TiB")).toBe(1024 * 1024 * 1024 * 1024));
  it("KB (SI)", () => expect(parseSize("1KB")).toBe(1000));
  it("MB (SI)", () => expect(parseSize("1MB")).toBe(1_000_000));
  it("GB (SI)", () => expect(parseSize("1GB")).toBe(1_000_000_000));
  it("TB (SI)", () => expect(parseSize("1TB")).toBe(1_000_000_000_000));
  it("case insensitive — gib", () => expect(parseSize("4gib")).toBe(4 * 1024 * 1024 * 1024));
  it("case insensitive — GIB", () => expect(parseSize("4GIB")).toBe(4 * 1024 * 1024 * 1024));
  it("fractional — 1.5GiB", () =>
    expect(parseSize("1.5GiB")).toBe(Math.floor(1.5 * 1024 * 1024 * 1024)));
  it("spaces around value", () => expect(parseSize("  512 MiB  ")).toBe(512 * 1024 * 1024));
  it("numeric 0", () => expect(parseSize("0")).toBe(0));
  it("throws on invalid unit", () => expect(() => parseSize("4XiB")).toThrow());
  it("throws on empty string", () => expect(() => parseSize("")).toThrow());
  it("throws on negative", () => expect(() => parseSize("-1GiB")).toThrow());
  it("B unit", () => expect(parseSize("512B")).toBe(512));
  it("number input", () => expect(parseSize(4096)).toBe(4096));
});

describe("parseDuration", () => {
  it("bare number treated as seconds", () => expect(parseDuration("30")).toBe(30));
  it("seconds suffix", () => expect(parseDuration("30s")).toBe(30));
  it("minutes", () => expect(parseDuration("5m")).toBe(300));
  it("hours", () => expect(parseDuration("2h")).toBe(7200));
  it("days", () => expect(parseDuration("1d")).toBe(86400));
  it("weeks", () => expect(parseDuration("1w")).toBe(604800));
  it("milliseconds", () => expect(parseDuration("500ms")).toBe(0.5));
  it("fractional hours — 1.5h", () => expect(parseDuration("1.5h")).toBe(5400));
  it("case insensitive M minutes", () => expect(parseDuration("5M")).toBe(300));
  it("throws on invalid", () => expect(() => parseDuration("abc")).toThrow());
  it("throws on empty", () => expect(() => parseDuration("")).toThrow());
  it("number input (seconds)", () => expect(parseDuration(60)).toBe(60));
  it("6h", () => expect(parseDuration("6h")).toBe(21600));
  it("30m", () => expect(parseDuration("30m")).toBe(1800));
});
