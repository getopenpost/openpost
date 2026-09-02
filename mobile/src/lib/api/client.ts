import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

import { getServer, getServerMutationRevision, subscribeServer } from "../server";
import {
  commitTokenIfCurrent,
  commitWorkspaceIdIfCurrent,
  getToken,
  getTokenMutationRevision,
  getWorkspaceMutationRevision,
  subscribeToken,
} from "./token-store";

export type Api = ReturnType<typeof createClient<paths>>;
export type ApiRequestIdentity = {
  serverBaseUrl: string;
  serverMutationRevision: number;
  token: string | null;
  tokenMutationRevision: number;
  workspaceMutationRevision: number;
};

let client: Api | null = null;
let clientKey = "";

function rebuild() {
  const server = getServer();
  const token = getToken();
  const key = `${server?.baseUrl ?? ""}|${token ?? ""}`;
  if (client && key === clientKey) return client;
  clientKey = key;
  client = createClient<paths>({
    baseUrl: server ? `${server.baseUrl}/api/v1` : "",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return client;
}

subscribeServer(rebuild);
subscribeToken(rebuild);

/** Typed API client bound to the current server + bearer token. */
export function api(): Api {
  return rebuild();
}

export function apiUrl(path: string): string {
  const server = getServer();
  if (!server) throw new Error("No server configured");
  return `${server.baseUrl}${path}`;
}

export function captureApiRequestIdentity(): ApiRequestIdentity {
  return {
    serverBaseUrl: getServer()?.baseUrl ?? "",
    serverMutationRevision: getServerMutationRevision(),
    token: getToken(),
    tokenMutationRevision: getTokenMutationRevision(),
    workspaceMutationRevision: getWorkspaceMutationRevision(),
  };
}

export function apiRequestIdentityIsCurrent(identity: ApiRequestIdentity): boolean {
  return (
    getServer()?.baseUrl === identity.serverBaseUrl &&
    getServerMutationRevision() === identity.serverMutationRevision &&
    getToken() === identity.token &&
    getTokenMutationRevision() === identity.tokenMutationRevision
  );
}

function apiServerIdentityIsCurrent(identity: ApiRequestIdentity): boolean {
  return (
    getServer()?.baseUrl === identity.serverBaseUrl &&
    getServerMutationRevision() === identity.serverMutationRevision
  );
}

export function commitTokenForIdentity(
  token: string,
  identity: ApiRequestIdentity,
): Promise<boolean> {
  return commitTokenIfCurrent(token, identity.token, identity.tokenMutationRevision, () =>
    apiServerIdentityIsCurrent(identity),
  );
}

export function clearTokenForIdentity(identity: ApiRequestIdentity): Promise<boolean> {
  return commitTokenIfCurrent(null, identity.token, identity.tokenMutationRevision, () =>
    apiServerIdentityIsCurrent(identity),
  );
}

export function commitWorkspaceIdForIdentity(
  workspaceId: string | null,
  identity: ApiRequestIdentity,
): Promise<boolean> {
  if (!identity.token) return Promise.resolve(false);
  return commitWorkspaceIdIfCurrent(
    workspaceId,
    identity.token,
    identity.tokenMutationRevision,
    identity.workspaceMutationRevision,
    () => apiServerIdentityIsCurrent(identity),
  );
}

export async function settleApiUnauthorized(
  identity: ApiRequestIdentity,
  response: Response | undefined,
): Promise<void> {
  if (response?.status !== 401 || !identity.token) return;
  await clearTokenForIdentity(identity);
}

/** Extract a readable message from an openapi-fetch error response. */
export async function errorMessage(
  response: Response | undefined,
  fallback: string,
): Promise<string> {
  if (!response) return fallback;
  try {
    const body = (await response.json()) as { message?: string; title?: string };
    return body.message ?? body.title ?? fallback;
  } catch {
    return `${fallback} (${response.status})`;
  }
}
