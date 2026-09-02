import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  apiTokensQueryOptions,
  developerQueryKeys,
  mcpActivityQueryOptions,
  type APIToken,
  type MCPActivity,
} from "./index";

describe("developer queries", () => {
  it("loads API tokens with cancellation", async () => {
    const tokens = [{ id: "token-1" }] as APIToken[];
    const listAPITokens = vi.fn(async () => tokens);
    const client = new QueryClient();

    await expect(client.fetchQuery(apiTokensQueryOptions({ listAPITokens }))).resolves.toBe(tokens);

    expect(developerQueryKeys.apiTokens()).toEqual(["openpost", "v1", "developer", "api-tokens"]);
    expect(listAPITokens).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("normalizes the MCP activity limit in both key and request", async () => {
    const activity = [{ id: "activity-1" }] as MCPActivity[];
    const listMCPActivity = vi.fn(async () => activity);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(mcpActivityQueryOptions({ listMCPActivity }, 3.8)),
    ).resolves.toBe(activity);

    expect(developerQueryKeys.mcpActivity(3)).toEqual([
      "openpost",
      "v1",
      "developer",
      "mcp-activity",
      { limit: 3 },
    ]);
    expect(developerQueryKeys.mcpActivity(3)).toEqual([
      ...developerQueryKeys.mcpActivityRoot(),
      { limit: 3 },
    ]);
    expect(listMCPActivity).toHaveBeenCalledWith(3, expect.any(AbortSignal));
  });

  it("groups every developer query under one invalidation root", () => {
    expect(developerQueryKeys.apiTokens()).toEqual([...developerQueryKeys.all, "api-tokens"]);
    expect(developerQueryKeys.mcpActivityRoot()).toEqual([
      ...developerQueryKeys.all,
      "mcp-activity",
    ]);
  });
});
