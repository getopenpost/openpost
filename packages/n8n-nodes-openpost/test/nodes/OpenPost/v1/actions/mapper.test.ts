import { describe, expect, test } from "bun:test";

import {
  buildOpenPostRequest,
  shouldRetryOpenPost,
} from "../../../../../nodes/OpenPost/v1/actions/mapper";
import { findGeneratedAction } from "../../../../../nodes/OpenPost/v1/actions/generated/requestMappers";

describe("OpenPost request mapper", () => {
  test("maps native create publication fields and default idempotency keys", () => {
    const mapper = findGeneratedAction("publication", "create");
    if (!mapper) throw new Error("missing mapper");

    const request = buildOpenPostRequest({
      baseUrl: "https://example.com",
      mapper,
      itemIndex: 2,
      executionId: "exec-1",
      parameters: {
        get(name, fallback) {
          return (
            (
              {
                workspaceId: "ws-1",
                title: "Launch",
                sourceText: "Ship it",
                contentProfile: "default",
                creationPreset: "post",
                accountIds: "acct-1, acct-2",
                mediaIds: "media-1",
                advancedJson: '{"goal":"announce"}',
              } as Record<string, unknown>
            )[name] ?? fallback
          );
        },
      },
    });

    expect(request.options.url).toBe("https://example.com/api/v1/publications");
    expect(request.options.headers?.["Idempotency-Key"]).toBe("n8n:exec-1:publication.create:2");
    expect(request.options.body).toMatchObject({
      workspace_id: "ws-1",
      title: "Launch",
      source_text: "Ship it",
      content_profile: "default",
      creation_preset: "post",
      social_account_ids: ["acct-1", "acct-2"],
      media: [{ id: "media-1" }],
      goal: "announce",
    });
  });

  test("maps offset pagination without exposing an internal offset field", () => {
    const mapper = findGeneratedAction("media", "getMany");
    if (!mapper) throw new Error("missing mapper");
    const request = buildOpenPostRequest({
      baseUrl: "https://example.com",
      mapper,
      itemIndex: 0,
      executionId: "exec-1",
      offset: 50,
      parameters: {
        get(name, fallback) {
          return ({ workspaceId: "ws-1", limit: 50 } as Record<string, unknown>)[name] ?? fallback;
        },
      },
    });
    expect(request.options.qs).toMatchObject({ workspace_id: "ws-1", limit: 50, offset: 50 });
  });

  test("retries naturally idempotent completion requests only for transient failures", () => {
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 503, idempotency: "natural" })).toBe(
      true,
    );
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 409, idempotency: "natural" })).toBe(
      false,
    );
  });
});
