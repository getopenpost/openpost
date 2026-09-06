import { describe, expect, test } from "bun:test";

import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  test("normalizes a bare host or HTTPS origin into a bare HTTPS origin", () => {
    expect(normalizeServerUrl("openpost.example.com")).toBe("https://openpost.example.com");
    expect(normalizeServerUrl("https://openpost.example.com:8443/")).toBe(
      "https://openpost.example.com:8443",
    );
  });

  test("rejects cleartext, non-origin, and device-local server URLs", () => {
    for (const candidate of [
      "http://openpost.example.com",
      "https://openpost.example.com/app",
      "https://user:pass@openpost.example.com",
      "https://openpost.example.com?next=/app",
      "https://openpost.example.com#app",
      "https://localhost",
      "https://127.0.0.1",
      "https://openpost.local",
    ]) {
      expect(normalizeServerUrl(candidate), candidate).toBeNull();
    }
  });
});
