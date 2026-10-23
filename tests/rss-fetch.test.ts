import { describe, it, expect } from "vitest";
import { isBlockedHost, assertSafeUrl } from "@/services/rss-fetch";

describe("rss-fetch SSRF", () => {
  it("bloqueia hosts internos", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("10.0.0.1")).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
  });

  it("assertSafeUrl rejeita protocolo e SSRF", () => {
    expect(() => assertSafeUrl("ftp://example.com")).toThrow();
    expect(() => assertSafeUrl("http://localhost/admin")).toThrow();
    expect(() => assertSafeUrl("https://example.com/rss")).not.toThrow();
  });
});
