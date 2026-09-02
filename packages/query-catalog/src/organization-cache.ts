import { authQueryKeys } from "./auth";
import { isBillingStatusQueryKey } from "./billing";
import type { QueryCachePlan } from "./cache-plan";
import { developerQueryKeys } from "./developer";
import { organizationQueryKeys } from "./organizations";

export function organizationIdentityMutationCachePlan(organizationId: string): QueryCachePlan {
  return {
    invalidate: [
      { queryKey: organizationQueryKeys.detailRoot(organizationId) },
      { queryKey: organizationQueryKeys.instanceAuditRoot() },
      { queryKey: authQueryKeys.linkableOIDCProviders(), exact: true },
      { queryKey: authQueryKeys.oidcIdentities(), exact: true },
      { queryKey: authQueryKeys.sessions(), exact: true },
      { queryKey: developerQueryKeys.mcpActivityRoot() },
      { predicate: (query) => isBillingStatusQueryKey(query.queryKey) },
    ],
  };
}
