import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime, stableQueryStaleTime } from "./policies";

export type BillingStatus = components["schemas"]["BillingStatusResponse"];
export type BillingCheckoutConfig = components["schemas"]["BillingCheckoutConfigResponse"];

export interface BillingQueryAPI {
  getBillingStatus(workspaceId: string, signal: AbortSignal): Promise<BillingStatus>;
  getCheckoutConfig(signal: AbortSignal): Promise<BillingCheckoutConfig>;
}

export const billingQueryKeys = {
  status: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "billing", "status"),
  checkoutConfig: () => ["openpost", "v1", "billing", "checkout-config"] as const,
};

export function isBillingStatusQueryKey(queryKey: readonly unknown[]) {
  return (
    queryKey.length === 6 &&
    queryKey[0] === "openpost" &&
    queryKey[1] === "v1" &&
    queryKey[2] === "workspace" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "billing" &&
    queryKey[5] === "status"
  );
}

export function billingStatusQueryOptions(
  api: Pick<BillingQueryAPI, "getBillingStatus">,
  workspaceId: string,
) {
  const queryKey = billingQueryKeys.status(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getBillingStatus(workspaceId, signal),
  };
}

export function billingCheckoutConfigQueryOptions(api: Pick<BillingQueryAPI, "getCheckoutConfig">) {
  const queryKey = billingQueryKeys.checkoutConfig();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getCheckoutConfig(signal),
  };
}
