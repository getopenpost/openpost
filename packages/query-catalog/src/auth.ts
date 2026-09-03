import type { components, paths } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime, stableQueryStaleTime } from "./policies";

export type AuthConfiguration = components["schemas"]["AuthConfigurationOutputBody"];
export type OIDCProvider = components["schemas"]["OIDCProviderSummary"];
export type SecurityStatus = components["schemas"]["SecurityStatusOutputBody"];
export type OIDCIdentity = components["schemas"]["OIDCIdentitySummary"];
export type EmailChangeStatus = components["schemas"]["EmailChangeStatusOutputBody"];
export type AuthSession = NonNullable<
  paths["/auth/sessions"]["get"]["responses"][200]["content"]["application/json"]
>[number];

export interface AuthQueryAPI {
  getAuthConfiguration(signal: AbortSignal): Promise<AuthConfiguration>;
  listOIDCProviders(signal: AbortSignal): Promise<OIDCProvider[]>;
  getSecurityStatus(signal: AbortSignal): Promise<SecurityStatus>;
  listOIDCIdentities(signal: AbortSignal): Promise<OIDCIdentity[]>;
  listLinkableOIDCProviders(signal: AbortSignal): Promise<OIDCProvider[]>;
  getEmailChangeStatus(signal: AbortSignal): Promise<EmailChangeStatus>;
  listAuthSessions(signal: AbortSignal): Promise<AuthSession[]>;
}

export const authQueryKeys = {
  configuration: () => ["openpost", "v1", "auth", "configuration"] as const,
  oidcProviders: () => ["openpost", "v1", "auth", "oidc-providers"] as const,
  security: () => ["openpost", "v1", "auth", "security"] as const,
  oidcIdentities: () => ["openpost", "v1", "auth", "oidc-identities"] as const,
  linkableOIDCProviders: () => ["openpost", "v1", "auth", "linkable-oidc-providers"] as const,
  emailChange: () => ["openpost", "v1", "auth", "email-change"] as const,
  sessions: () => ["openpost", "v1", "auth", "sessions"] as const,
};

export function authConfigurationQueryOptions(api: Pick<AuthQueryAPI, "getAuthConfiguration">) {
  const queryKey = authQueryKeys.configuration();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getAuthConfiguration(signal),
  };
}

export function oidcProvidersQueryOptions(api: Pick<AuthQueryAPI, "listOIDCProviders">) {
  const queryKey = authQueryKeys.oidcProviders();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listOIDCProviders(signal),
  };
}

export function securityStatusQueryOptions(api: Pick<AuthQueryAPI, "getSecurityStatus">) {
  const queryKey = authQueryKeys.security();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getSecurityStatus(signal),
  };
}

export function oidcIdentitiesQueryOptions(api: Pick<AuthQueryAPI, "listOIDCIdentities">) {
  const queryKey = authQueryKeys.oidcIdentities();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listOIDCIdentities(signal),
  };
}

export function linkableOIDCProvidersQueryOptions(
  api: Pick<AuthQueryAPI, "listLinkableOIDCProviders">,
) {
  const queryKey = authQueryKeys.linkableOIDCProviders();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listLinkableOIDCProviders(signal),
  };
}

export function emailChangeStatusQueryOptions(api: Pick<AuthQueryAPI, "getEmailChangeStatus">) {
  const queryKey = authQueryKeys.emailChange();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getEmailChangeStatus(signal),
  };
}

export function authSessionsQueryOptions(api: Pick<AuthQueryAPI, "listAuthSessions">) {
  const queryKey = authQueryKeys.sessions();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listAuthSessions(signal),
  };
}
