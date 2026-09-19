import { describe, expect, it, vi } from "vitest";
import { OpenPost } from "../index";
import { OpenPostError } from "../errors";
import type { Publication } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function publication(status: string, revision = 3): Publication {
  return {
    id: "pub_1",
    workspace_id: "ws_1",
    created_by: "u_1",
    creation_source: "sdk",
    title: "Hello",
    intent: "post",
    content_profile: "short_text",
    source_text: "Hello",
    status: status as Publication["status"],
    revision,
    created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-09-18T00:00:00Z",
    renditions: [],
  };
}

function clientWith(responses: Response[]): { client: OpenPost; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  return { client: new OpenPost({ baseUrl: "https://example.test", token: "tok", fetch }), fetch };
}

describe("Publications", () => {
  it("creates a publication with the workspace body", async () => {
    const { client, fetch } = clientWith([jsonResponse(publication("draft"))]);
    const result = await client.publications.create({
      workspace_id: "ws_1",
      title: "Hello",
      content_profile: "short_text",
      source_text: "Hello",
      social_account_ids: ["acc_1"],
    });
    expect(result.id).toBe("pub_1");
    expect(result.creation_source).toBe("sdk");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ workspace_id: "ws_1", title: "Hello" });
  });

  it("sends expected_revision on schedule and publish actions", async () => {
    const { client, fetch } = clientWith([
      jsonResponse({ message: "scheduled", revision: 4 }),
      jsonResponse({ message: "published", revision: 5 }),
    ]);
    await client.publications.schedule("pub_1", 3);
    await client.publications.publishNow("pub_1", 4);

    const [, scheduleInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const [publishUrl, publishInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(scheduleInit.body))).toEqual({ expected_revision: 3 });
    expect(publishUrl).toContain("/api/v1/publications/pub_1/publish-now");
    expect(JSON.parse(String(publishInit.body))).toEqual({ expected_revision: 4 });
  });

  it("throws a validation error when throwOnInvalid is set", async () => {
    const { client } = clientWith([
      jsonResponse({
        valid: false,
        issues: [{ severity: "error", code: "too_long", message: "Too long" }],
      }),
    ]);
    const error = await client.publications
      .validate("pub_1", { throwOnInvalid: true })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OpenPostError);
    expect((error as OpenPostError).code).toBe("validation");
  });

  it("waits until the publication reaches a terminal status", async () => {
    const { client } = clientWith([
      jsonResponse(publication("publishing", 4)),
      jsonResponse(publication("published", 4)),
    ]);
    const result = await client.publications.wait("pub_1", { intervalMs: 1, timeoutMs: 5_000 });
    expect(result.status).toBe("published");
  });

  it("times out while the publication stays transitional", async () => {
    const { client } = clientWith([jsonResponse(publication("publishing", 4))]);
    const error = await client.publications
      .wait("pub_1", { intervalMs: 1, timeoutMs: 0 })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OpenPostError);
    expect((error as OpenPostError).code).toBe("timeout");
  });
});
