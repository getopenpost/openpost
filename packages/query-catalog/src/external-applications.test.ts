import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  externalAuthorizationRequestQueryOptions,
  externalInstallationsQueryOptions,
  type ExternalApplicationQueryAPI,
} from "./external-applications";

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("external application queries", () => {
  it("deduplicates concurrent installation reads", async () => {
    const listInstallations = vi.fn(async () => []);
    const options = externalInstallationsQueryOptions({ listInstallations });
    const client = queryClient();

    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);

    expect(listInstallations).toHaveBeenCalledTimes(1);
  });

  it("normalizes and partitions authorization requests", async () => {
    const getAuthorizationRequest = vi.fn(async () => ({
      application: {
        allowed_scopes: "workspace:read",
        client_id: "client-1",
        client_type: "public",
        created_at: "2026-09-04T00:00:00Z",
        id: "application-1",
        name: "Workflow app",
      },
    }));
    const api: Pick<ExternalApplicationQueryAPI, "getAuthorizationRequest"> = {
      getAuthorizationRequest,
    };
    const first = externalAuthorizationRequestQueryOptions(
      api,
      " client-1 ",
      " https://client.example/callback ",
    );
    const second = externalAuthorizationRequestQueryOptions(
      api,
      "client-1",
      "https://other.example/callback",
    );

    expect(first.queryKey).not.toEqual(second.queryKey);
    await queryClient().fetchQuery(first);
    expect(getAuthorizationRequest).toHaveBeenCalledWith(
      "client-1",
      "https://client.example/callback",
      expect.any(AbortSignal),
    );
  });
});
