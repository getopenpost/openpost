import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  accountFeaturesQueryOptions,
  featureQueryKeys,
  isAccountFeaturesQueryKey,
  type AccountFeatureState,
} from "./index";

describe("account feature queries", () => {
  it("recognizes every Workspace account-feature key", () => {
    expect(
      isAccountFeaturesQueryKey(featureQueryKeys.accountStates("workspace-1", ["account-1"])),
    ).toBe(true);
    expect(
      isAccountFeaturesQueryKey(["openpost", "v1", "workspace", "workspace-1", "accounts"]),
    ).toBe(false);
  });

  it("normalizes account IDs and forwards cancellation", async () => {
    const features: AccountFeatureState[] = [];
    const listAccountFeatures = vi.fn(async () => features);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(
        accountFeaturesQueryOptions({ listAccountFeatures }, "workspace-1", [
          " account-2 ",
          "",
          "account-1",
          "account-2",
        ]),
      ),
    ).resolves.toBe(features);

    expect(featureQueryKeys.accountStates("workspace-1", [" account-2 ", "", "account-1"])).toEqual(
      [
        "openpost",
        "v1",
        "workspace",
        "workspace-1",
        "account-features",
        ["account-1", "account-2"],
      ],
    );
    expect(listAccountFeatures).toHaveBeenCalledWith(
      "workspace-1",
      ["account-1", "account-2"],
      expect.any(AbortSignal),
    );
  });
});
