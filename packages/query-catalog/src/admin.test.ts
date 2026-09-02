import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  adminQueryKeys,
  instanceUsersQueryOptions,
  normalizeInstanceUsersFilters,
  type InstanceUserPage,
} from "./index";

describe("admin query catalogue", () => {
  it("normalizes every user-list request dimension and forwards cancellation", async () => {
    const page = {
      page: 1,
      per_page: 25,
      total: 0,
      total_pages: 0,
      users: [],
    } as InstanceUserPage;
    const listInstanceUsers = vi.fn(async () => page);
    const filters = {
      page: 0,
      perPage: 25,
      search: "  founder  ",
      sort: "created_at",
      direction: "desc" as const,
    };
    const normalized = normalizeInstanceUsersFilters(filters);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(instanceUsersQueryOptions({ listInstanceUsers }, filters)),
    ).resolves.toBe(page);

    expect(normalized).toEqual({
      page: 1,
      perPage: 25,
      search: "founder",
      sort: "created_at",
      direction: "desc",
    });
    expect(adminQueryKeys.users(filters)).toEqual(["openpost", "v1", "admin", "users", normalized]);
    expect(listInstanceUsers).toHaveBeenCalledWith(normalized, expect.any(AbortSignal));
  });
});
