import type { components, operations } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type Organization = components["schemas"]["OrganizationResponse"];
export type OrganizationTeam = components["schemas"]["OrganizationTeamOutputBody"];
export type PendingOwnershipTransfer = components["schemas"]["PendingOwnershipTransferResponse"];
export type OrganizationIdentityProvider = components["schemas"]["OIDCProviderAdminResponse"];
export type OrganizationSSOPolicy = components["schemas"]["Policy"];
export type OrganizationSSODomain = components["schemas"]["IdentityProviderDomain"];
export type OrganizationIdentityAuditEvent = components["schemas"]["IdentityAuditEvent"];
export type OrganizationAuditPage = components["schemas"]["OrganizationAuditPage"];
export type InstanceAuditPage = components["schemas"]["AuditPage"];
export type OrganizationAuditQuery = NonNullable<
  operations["list-organization-audit-events"]["parameters"]["query"]
>;
export type InstanceAuditQuery = NonNullable<
  operations["list-instance-audit-events"]["parameters"]["query"]
>;

export interface OrganizationQueryAPI {
  listOrganizations(signal: AbortSignal): Promise<Organization[]>;
  getOrganizationTeam(organizationId: string, signal: AbortSignal): Promise<OrganizationTeam>;
  getOwnershipTransfer(
    organizationId: string,
    signal: AbortSignal,
  ): Promise<PendingOwnershipTransfer>;
  listIdentityProviders(
    organizationId: string,
    signal: AbortSignal,
  ): Promise<OrganizationIdentityProvider[]>;
  getSSOPolicy(organizationId: string, signal: AbortSignal): Promise<OrganizationSSOPolicy>;
  listSSODomains(organizationId: string, signal: AbortSignal): Promise<OrganizationSSODomain[]>;
  listIdentityAuditEvents(
    organizationId: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<OrganizationIdentityAuditEvent[]>;
  listOrganizationAuditEvents(
    organizationId: string,
    query: OrganizationAuditQuery,
    signal: AbortSignal,
  ): Promise<OrganizationAuditPage>;
  listInstanceAuditEvents(
    query: InstanceAuditQuery,
    signal: AbortSignal,
  ): Promise<InstanceAuditPage>;
}

export const organizationQueryKeys = {
  all: () => ["openpost", "v1", "organizations"] as const,
  detailRoot: (organizationId: string) =>
    ["openpost", "v1", "organization", organizationId] as const,
  team: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "team"] as const,
  ownershipTransfer: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "ownership-transfer"] as const,
  identityProviders: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "identity-providers"] as const,
  ssoPolicy: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "sso-policy"] as const,
  ssoDomains: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "sso-domains"] as const,
  identityAudit: (organizationId: string, limit: number) =>
    [...organizationQueryKeys.detailRoot(organizationId), "identity-audit", { limit }] as const,
  auditRoot: (organizationId: string) =>
    [...organizationQueryKeys.detailRoot(organizationId), "audit"] as const,
  audit: (organizationId: string, query: OrganizationAuditQuery) =>
    [...organizationQueryKeys.auditRoot(organizationId), query] as const,
  instanceAuditRoot: () => ["openpost", "v1", "admin", "audit"] as const,
  instanceAudit: (query: InstanceAuditQuery) =>
    [...organizationQueryKeys.instanceAuditRoot(), query] as const,
};

export function isOrganizationAuditQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === "openpost" &&
    queryKey[1] === "v1" &&
    queryKey[2] === "organization" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "audit"
  );
}

export function isOrganizationDetailQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === "openpost" && queryKey[1] === "v1" && queryKey[2] === "organization";
}

export function organizationsQueryOptions(api: Pick<OrganizationQueryAPI, "listOrganizations">) {
  const queryKey = organizationQueryKeys.all();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listOrganizations(signal),
  };
}

export function organizationTeamQueryOptions(
  api: Pick<OrganizationQueryAPI, "getOrganizationTeam">,
  organizationId: string,
) {
  const queryKey = organizationQueryKeys.team(organizationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getOrganizationTeam(organizationId, signal),
  };
}

export function ownershipTransferQueryOptions(
  api: Pick<OrganizationQueryAPI, "getOwnershipTransfer">,
  organizationId: string,
) {
  const queryKey = organizationQueryKeys.ownershipTransfer(organizationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getOwnershipTransfer(organizationId, signal),
  };
}

export function organizationIdentityProvidersQueryOptions(
  api: Pick<OrganizationQueryAPI, "listIdentityProviders">,
  organizationId: string,
) {
  const queryKey = organizationQueryKeys.identityProviders(organizationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listIdentityProviders(organizationId, signal),
  };
}

export function organizationSSOPolicyQueryOptions(
  api: Pick<OrganizationQueryAPI, "getSSOPolicy">,
  organizationId: string,
) {
  const queryKey = organizationQueryKeys.ssoPolicy(organizationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getSSOPolicy(organizationId, signal),
  };
}

export function organizationSSODomainsQueryOptions(
  api: Pick<OrganizationQueryAPI, "listSSODomains">,
  organizationId: string,
) {
  const queryKey = organizationQueryKeys.ssoDomains(organizationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listSSODomains(organizationId, signal),
  };
}

export function organizationIdentityAuditQueryOptions(
  api: Pick<OrganizationQueryAPI, "listIdentityAuditEvents">,
  organizationId: string,
  limit: number,
) {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const queryKey = organizationQueryKeys.identityAudit(organizationId, normalizedLimit);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listIdentityAuditEvents(organizationId, normalizedLimit, signal),
  };
}

export function organizationAuditQueryOptions(
  api: Pick<OrganizationQueryAPI, "listOrganizationAuditEvents">,
  organizationId: string,
  query: OrganizationAuditQuery,
) {
  const queryKey = organizationQueryKeys.audit(organizationId, query);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listOrganizationAuditEvents(organizationId, query, signal),
  };
}

export function instanceAuditQueryOptions(
  api: Pick<OrganizationQueryAPI, "listInstanceAuditEvents">,
  query: InstanceAuditQuery,
) {
  const queryKey = organizationQueryKeys.instanceAudit(query);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listInstanceAuditEvents(query, signal),
  };
}
