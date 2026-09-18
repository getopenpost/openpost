import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "./client";
import { OpenPostError } from "./errors";
import { SDK_VERSION } from "./version";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("HttpClient", () => {
  it("sends the bearer token, workspace-agnostic paths, and SDK user agent", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const http = new HttpClient({ baseUrl: "https://example.test/", token: "tok", fetch });
    await http.get("/api/v1/workspaces");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/api/v1/workspaces");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    expect(headers["User-Agent"]).toBe(`openpost-sdk/${SDK_VERSION}`);
  });

  it("throws missing_config without a token", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const http = new HttpClient({ baseUrl: "https://example.test", fetch });
    const error = await http.get("/api/v1/workspaces").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OpenPostError);
    expect((error as OpenPostError).code).toBe("missing_config");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps HTTP statuses to typed error codes", async () => {
    const fetch = vi.fn(async () => jsonResponse({ title: "Nope", detail: "Gone" }, 404));
    const http = new HttpClient({ baseUrl: "https://example.test", token: "tok", fetch });
    const error = await http.get("/api/v1/workspaces").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OpenPostError);
    expect((error as OpenPostError).code).toBe("not_found");
    expect((error as OpenPostError).status).toBe(404);
    expect((error as OpenPostError).message).toBe("Gone");
  });

  it("retries once on a 500 and then returns the recovery", async () => {
    const fetch = vi
      .fn(async () => jsonResponse({ title: "boom" }, 500))
      .mockImplementationOnce(async () => jsonResponse({ title: "boom" }, 500))
      .mockImplementationOnce(async () => jsonResponse([{ id: "w1" }]));
    const http = new HttpClient({ baseUrl: "https://example.test", token: "tok", fetch });
    const result = await http.get("/api/v1/workspaces");
    expect(result).toEqual([{ id: "w1" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a 404", async () => {
    const fetch = vi.fn(async () => jsonResponse({ detail: "missing" }, 404));
    const http = new HttpClient({ baseUrl: "https://example.test", token: "tok", fetch });
    await expect(http.get("/api/v1/workspaces")).rejects.toBeInstanceOf(OpenPostError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("skips empty query values when building URLs", () => {
    const http = new HttpClient({ baseUrl: "https://example.test", token: "tok" });
    expect(
      http.buildUrl("/api/v1/publications", {
        workspace_id: "w1",
        status: "",
        limit: 10,
        offset: undefined,
      }),
    ).toBe("https://example.test/api/v1/publications?workspace_id=w1&limit=10");
  });
});
