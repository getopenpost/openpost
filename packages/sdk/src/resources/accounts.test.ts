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

  it("encodes account-scoped mention lookup and preserves permission failures", async () => {
    let requested = "";
    const fetch = vi.fn(async (url: string | URL | Request) => {
      requested = String(url);
      return jsonResponse({ detail: "Mention search permission required" }, 403);
    });
    const client = new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch });
    await expect(client.accounts.lookupMentions("account/id", "A & B")).rejects.toMatchObject({
      status: 403,
    });
    const url = new URL(requested);
    expect(url.pathname).toBe("/api/v1/accounts/account%2Fid/mentions");
    expect(url.searchParams.get("query")).toBe("A & B");
  });
});
