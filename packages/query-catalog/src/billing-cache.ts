import { adminQueryKeys } from "./admin";
import { isBillingStatusQueryKey } from "./billing";
import type { QueryCachePlan } from "./cache-plan";
import { isAccountFeaturesQueryKey } from "./features";
import { organizationQueryKeys } from "./organizations";
import { publicProfileQueryKeys } from "./public-profiles";
import { isWorkspaceSetupQueryKey } from "./workspace-settings";

export function billingMutationCachePlan(organizationId: string): QueryCachePlan {
  return {
    remove: [{ queryKey: publicProfileQueryKeys.all() }],
    invalidate: [
      { queryKey: adminQueryKeys.usersRoot() },
      { predicate: (query) => isAccountFeaturesQueryKey(query.queryKey) },
      { predicate: (query) => isBillingStatusQueryKey(query.queryKey) },
      { predicate: (query) => isWorkspaceSetupQueryKey(query.queryKey) },
      { queryKey: organizationQueryKeys.instanceAuditRoot() },
      ...(organizationId ? [{ queryKey: organizationQueryKeys.auditRoot(organizationId) }] : []),
    ],
  };
}
