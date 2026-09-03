import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  billingCheckoutConfigQueryOptions,
  billingQueryKeys,
  billingStatusQueryOptions,
  isBillingStatusQueryKey,
  type BillingCheckoutConfig,
  type BillingStatus,
} from "./index";

describe("billing query catalogue", () => {
  it("partitions status by Workspace and keeps checkout configuration global", async () => {
    const status = { workspace_id: "workspace-1" } as BillingStatus;
    const checkoutConfig = { client_token: "token" } as BillingCheckoutConfig;
    const getBillingStatus = vi.fn(async () => status);
    const getCheckoutConfig = vi.fn(async () => checkoutConfig);
    const client = new QueryClient();

    await expect(
      client.fetchQuery(billingStatusQueryOptions({ getBillingStatus }, "workspace-1")),
    ).resolves.toBe(status);
    await expect(
      client.fetchQuery(billingCheckoutConfigQueryOptions({ getCheckoutConfig })),
    ).resolves.toBe(checkoutConfig);

    expect(billingQueryKeys.status("workspace-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "billing",
      "status",
    ]);
    expect(getBillingStatus).toHaveBeenCalledWith("workspace-1", expect.any(AbortSignal));
    expect(getCheckoutConfig).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(isBillingStatusQueryKey(billingQueryKeys.status("workspace-1"))).toBe(true);
    expect(isBillingStatusQueryKey(billingQueryKeys.checkoutConfig())).toBe(false);
  });
});
