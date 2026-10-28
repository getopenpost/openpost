import { describe, expect, test } from "bun:test";

import {
  buildOpenPostRequest,
  findRequestMapper,
  shouldRetryOpenPost,
} from "../../../../../nodes/OpenPost/v1/actions/mapper";

describe("OpenPost request mapper", () => {
  test("maps native create publication fields and default idempotency keys", () => {
    const mapper = findRequestMapper("publication", "create");

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
    const mapper = findRequestMapper("media", "getMany");
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
    // Safety branch first: a mutation without an idempotency guarantee must not replay.
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 503, idempotency: "none" })).toBe(
      false,
    );
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 503, idempotency: "required" })).toBe(
      true,
    );
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 503, idempotency: "natural" })).toBe(
      true,
    );
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 409, idempotency: "natural" })).toBe(
      false,
    );
    expect(shouldRetryOpenPost({ method: "POST", statusCode: 500, idempotency: "required" })).toBe(
      false,
    );
    expect(shouldRetryOpenPost({ method: "GET", statusCode: 429, idempotency: "none" })).toBe(true);
  });
});

test("mention lookup sends the search in the GET query", () => {
  const mapper = findRequestMapper("account", "lookupMentions");
  const request = buildOpenPostRequest({
    baseUrl: "https://example.com",
    mapper,
    itemIndex: 0,
    executionId: "exec",
    parameters: {
      get(name, fallback) {
        return name === "accountId" ? "account-1" : name === "query" ? "A & B" : fallback;
      },
    },
  });
  expect(request.options.url).toBe("https://example.com/api/v1/accounts/account-1/mentions");
  expect(request.options.qs).toEqual({ query: "A & B" });
  expect(request.options.body).toBeUndefined();
});
