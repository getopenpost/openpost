import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type ExternalApplication = components["schemas"]["ExternalApplicationResponse"];
export type ExternalInstallation = components["schemas"]["ExternalInstallationResponse"];
export type ExternalAuthorizationRequest =
  components["schemas"]["ExternalAuthorizationRequestOutputBody"];

export interface ExternalApplicationQueryAPI {
  listInstallations(signal: AbortSignal): Promise<ExternalInstallation[]>;
  listAdminApplications(signal: AbortSignal): Promise<ExternalApplication[]>;
  getAuthorizationRequest(
    clientId: string,
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<ExternalAuthorizationRequest>;
}

const externalApplicationRoot = ["openpost", "v1", "external-applications"] as const;

export const externalApplicationQueryKeys = {
  all: externalApplicationRoot,
  installations: () => [...externalApplicationRoot, "installations"] as const,
  adminApplications: () => [...externalApplicationRoot, "admin"] as const,
  authorizationRequest: (clientId: string, redirectUri: string) =>
    [
      ...externalApplicationRoot,
      "oauth-request",
      { clientId: clientId.trim(), redirectUri: redirectUri.trim() },
    ] as const,
};

export function externalInstallationsQueryOptions(
  api: Pick<ExternalApplicationQueryAPI, "listInstallations">,
) {
  const queryKey = externalApplicationQueryKeys.installations();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listInstallations(signal),
  };
}

export function externalAdminApplicationsQueryOptions(
  api: Pick<ExternalApplicationQueryAPI, "listAdminApplications">,
) {
  const queryKey = externalApplicationQueryKeys.adminApplications();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listAdminApplications(signal),
  };
}

export function externalAuthorizationRequestQueryOptions(
  api: Pick<ExternalApplicationQueryAPI, "getAuthorizationRequest">,
  clientId: string,
  redirectUri: string,
) {
  const normalizedClientId = clientId.trim();
  const normalizedRedirectUri = redirectUri.trim();
  const queryKey = externalApplicationQueryKeys.authorizationRequest(
    normalizedClientId,
    normalizedRedirectUri,
  );
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(normalizedClientId && normalizedRedirectUri),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getAuthorizationRequest(normalizedClientId, normalizedRedirectUri, signal),
  };
}
