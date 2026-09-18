import { describe, expect, it, vi } from "vitest";
import { OpenPost } from "../index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Accounts", () => {
  it("unwraps the provider readiness envelope", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ providers: [{ platform: "x", status: "ready" }] }),
    );
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    expect(await client.accounts.readiness("ws_1")).toEqual([{ platform: "x", status: "ready" }]);
  });

  it("unwraps the destination options envelope", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ options: { general: [{ key: "a", label: "A" }] } }),
    );
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    expect(await client.accounts.destinationOptions("acc_1")).toEqual({
      general: [{ key: "a", label: "A" }],
    });
  });

  it("sends target_key when a rendition needs a subdestination", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: "retried" }));
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    await client.publications.retryRendition("pub_1", "acc_1", "profile_main");
    const [url] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("target_key=profile_main");
  });
});
