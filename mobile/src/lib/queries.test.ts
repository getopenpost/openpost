import { describe, expect, mock, test } from "bun:test";
import {
  activityPublicationsQueryOptions,
  liveQueryStaleTime,
  queryStaleTime,
  workspaceAccountsQueryOptions,
} from "@openpost/query-catalog";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const { accountsOptions, publicationActivityOptions } = await import("./queries");

describe("shared query definition parity", () => {
  test("uses the canonical keys and freshness for mobile publications and accounts", () => {
    const sharedScheduled = activityPublicationsQueryOptions(
      { listActivityPublications: async () => ({ items: [], total: 0, nextCursor: "" }) },
      "workspace-1",
      "scheduled",
      { limit: 100 },
    );
    const mobileScheduled = publicationActivityOptions("workspace-1", "scheduled");
    expect(mobileScheduled.queryKey as readonly unknown[]).toEqual(
      sharedScheduled.queryKey as readonly unknown[],
    );
    expect(mobileScheduled.staleTime).toBe(liveQueryStaleTime);
    expect(mobileScheduled.staleTime).toBe(sharedScheduled.staleTime);
    expect(mobileScheduled.retry).toBe(sharedScheduled.retry);

    const sharedAccounts = workspaceAccountsQueryOptions(
      { listAccounts: async () => [] },
      "workspace-1",
    );
    const mobileAccounts = accountsOptions("workspace-1");
    expect(mobileAccounts.queryKey as readonly unknown[]).toEqual(
      sharedAccounts.queryKey as readonly unknown[],
    );
    expect(mobileAccounts.staleTime).toBe(queryStaleTime);
    expect(mobileAccounts.staleTime).toBe(sharedAccounts.staleTime);
    expect(mobileAccounts.retry).toBe(sharedAccounts.retry);
  });
});
