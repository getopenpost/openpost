import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  accountCatalogQueryKeys,
  accountProvidersQueryOptions,
  isAccountProvidersQueryKey,
  type AccountProvider,
} from "./index";

describe("account catalogue queries", () => {
  it("recognizes every Workspace provider catalogue key", () => {
    expect(
      isAccountProvidersQueryKey([
        "openpost",
        "v1",
        "workspace",
        "workspace-1",
        "account-providers",
      ]),
    ).toBe(true);
    expect(
      isAccountProvidersQueryKey(["openpost", "v1", "workspace", "workspace-1", "accounts"]),
    ).toBe(false);
  });

  it("partitions providers by Workspace and forwards cancellation", async () => {
    const providers: AccountProvider[] = [];
    const listAccountProviders = vi.fn(async () => providers);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(accountProvidersQueryOptions({ listAccountProviders }, "workspace-1")),
    ).resolves.toBe(providers);

    expect(accountCatalogQueryKeys.providers("workspace-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "account-providers",
    ]);
    expect(listAccountProviders).toHaveBeenCalledWith("workspace-1", expect.any(AbortSignal));
  });
});
