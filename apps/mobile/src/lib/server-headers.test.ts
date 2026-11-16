import { describe, expect, test } from "bun:test";
import { serverHeadersForUrl, validateServerHeaders } from "./server-headers";

const headers = [{ name: "CF-Access-Client-Secret", value: "proxy-secret" }];

describe("custom proxy headers", () => {
  test("sends credentials only to the configured self-hosted origin", () => {
    expect(serverHeadersForUrl("/media/photo", "https://proxy.example.com", headers)).toEqual({
      "CF-Access-Client-Secret": "proxy-secret",
    });
    for (const target of [
      "https://external.example.com/media/photo",
      "http://proxy.example.com/media/photo",
      "https://proxy.example.com:444/media/photo",
      "//external.example.com/media/photo",
      "file:///photo",
      "data:image/png;base64,abcd",
    ])
      expect(serverHeadersForUrl(target, "https://proxy.example.com", headers)).toEqual({});
    expect(serverHeadersForUrl("/api/v1/ready", "https://app.openpo.st", headers)).toEqual({});
  });

  test("rejects reserved, duplicate, and malformed headers without exposing values", () => {
    for (const name of [
      "Authorization",
      "X-OpenPost-Client",
      "x-openpost-session",
      "Cookie",
      "Host",
      "Connection",
      "Content-Length",
      "invalid name",
      "",
    ]) {
      expect(() => validateServerHeaders([{ name, value: "secret" }])).toThrow();
    }
    expect(() =>
      validateServerHeaders([{ name: "X-Proxy", value: "secret\r\nAuthorization: secret" }]),
    ).toThrow("without line breaks");
    expect(() =>
      validateServerHeaders([
        { name: "X-Proxy", value: "one" },
        { name: "x-proxy", value: "two" },
      ]),
    ).toThrow("more than once");
    expect(validateServerHeaders([{ name: " X-Proxy ", value: " secret " }])).toEqual([
      { name: "X-Proxy", value: "secret" },
    ]);
  });
});
