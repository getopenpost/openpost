import createClient from "openapi-fetch";
import { proxyFetch } from "../proxy-fetch";
import { serverHeadersForUrl } from "../server-headers";
import { nativeTelemetry } from "../telemetry";
import type { paths } from "@openpost/api-contract";

import {
  getPendingServerMutationCount,
  getServer,
  getServerMutationRevision,
  subscribeServer,
} from "../server";
import {
  commitTokenIfCurrent,
  commitWorkspaceIdIfCurrent,
  getPendingTokenMutationCount,
  getPendingWorkspaceMutationCount,
  getToken,
  getTokenMutationRevision,
  getWorkspaceId,
  getWorkspaceMutationRevision,
  subscribeToken,
} from "./token-store";

export type Api = ReturnType<typeof createClient<paths>>;
export type ApiRequestIdentity = {
  serverBaseUrl: string;
  serverMutationRevision: number;
  serverMutationPendingAtCapture: boolean;
  token: string | null;
  tokenMutationRevision: number;
  tokenMutationPendingAtCapture: boolean;
  workspaceId: string | null;
  workspaceMutationRevision: number;
  workspaceMutationPendingAtCapture: boolean;
};

let client: Api | null = null;
let clientKey = "";
let purgeUnauthorizedDeviceData: () => Promise<void> = async () => undefined;

export function registerUnauthorizedDeviceDataPurge(purge: () => Promise<void>): void {
  purgeUnauthorizedDeviceData = purge;
}

function rebuild() {
  const server = getServer();
  const token = getToken();
  const key = `${server?.baseUrl ?? ""}|${getServerMutationRevision()}|${token ?? ""}`;
  if (client && key === clientKey) return client;
  clientKey = key;
  client = createClient<paths>({
    baseUrl: server ? `${server.baseUrl}/api/v1` : "",
    fetch: (request) =>
      server &&
      Object.keys(serverHeadersForUrl(request.url, server.baseUrl, server.headers ?? [])).length
        ? proxyFetch(request)
        : globalThis.fetch(request),
  });
  client.use({
    onRequest({ request }) {
      if (
        server &&
        getServer() === server &&
        getToken() === token &&
        new URL(request.url).origin === new URL(server.baseUrl).origin
      ) {
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        const headers = serverHeadersForUrl(request.url, server.baseUrl, server.headers ?? []);
        for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
        request.headers.set("X-OpenPost-Client", "native");
        for (const [name, value] of Object.entries(nativeTelemetry.headers(server.baseUrl)))
          request.headers.set(name, value);
      }
      return request;
    },
    onError({ error, schemaPath }) {
      if (
        getServer()?.baseUrl === server?.baseUrl &&
        getToken() === token &&
        !(error instanceof Error && error.name === "AbortError")
      )
        nativeTelemetry.exception(error, schemaPath);
    },
  });
  return client;
}

subscribeServer(rebuild);
subscribeToken(rebuild);

/** Typed API client bound to the current server + bearer token. */
export function api(): Api {
  return rebuild();
}

export function captureApiRequestIdentity(): ApiRequestIdentity {
  return {
    serverBaseUrl: getServer()?.baseUrl ?? "",
    serverMutationRevision: getServerMutationRevision(),
    serverMutationPendingAtCapture: getPendingServerMutationCount() > 0,
    token: getToken(),
    tokenMutationRevision: getTokenMutationRevision(),
    tokenMutationPendingAtCapture: getPendingTokenMutationCount() > 0,
    workspaceId: getWorkspaceId(),
    workspaceMutationRevision: getWorkspaceMutationRevision(),
    workspaceMutationPendingAtCapture: getPendingWorkspaceMutationCount() > 0,
  };
}

export function apiRequestIdentityIsCurrent(identity: ApiRequestIdentity): boolean {
  return (
    apiActorIdentityIsCurrent(identity) &&
    !identity.workspaceMutationPendingAtCapture &&
    getPendingWorkspaceMutationCount() === 0 &&
    getWorkspaceId() === identity.workspaceId &&
    getWorkspaceMutationRevision() === identity.workspaceMutationRevision
  );
}

export function apiActorIdentityIsCurrent(identity: ApiRequestIdentity): boolean {
  return (
    apiServerIdentityIsCurrent(identity) &&
    !identity.tokenMutationPendingAtCapture &&
    getPendingTokenMutationCount() === 0 &&
    getToken() === identity.token &&
    getTokenMutationRevision() === identity.tokenMutationRevision
  );
}

function apiServerIdentityIsCurrent(identity: ApiRequestIdentity): boolean {
  return (
    !identity.serverMutationPendingAtCapture &&
    getPendingServerMutationCount() === 0 &&
    getServer()?.baseUrl === identity.serverBaseUrl &&
    getServerMutationRevision() === identity.serverMutationRevision
  );
}

export function commitTokenForIdentity(
  token: string,
  identity: ApiRequestIdentity,
  stillActive: () => boolean = () => true,
): Promise<boolean> {
  if (!stillActive() || !apiServerIdentityIsCurrent(identity)) return Promise.resolve(false);
  return commitTokenIfCurrent(
    token,
    identity.token,
    identity.tokenMutationRevision,
    () => stillActive() && apiServerIdentityIsCurrent(identity),
  );
}

export function clearTokenForIdentity(identity: ApiRequestIdentity): Promise<boolean> {
  if (!apiServerIdentityIsCurrent(identity)) return Promise.resolve(false);
  return commitTokenIfCurrent(null, identity.token, identity.tokenMutationRevision, () =>
    apiServerIdentityIsCurrent(identity),
  );
}

export function commitWorkspaceIdForIdentity(
  workspaceId: string | null,
  identity: ApiRequestIdentity,
): Promise<boolean> {
  if (!identity.token || !apiActorIdentityIsCurrent(identity)) return Promise.resolve(false);
  return commitWorkspaceIdIfCurrent(
    workspaceId,
    identity.token,
    identity.tokenMutationRevision,
    identity.workspaceMutationRevision,
    () => apiActorIdentityIsCurrent(identity),
  );
}

export async function settleApiUnauthorized(
  identity: ApiRequestIdentity,
  response: Response | undefined,
): Promise<void> {
  if (response?.status !== 401 || !identity.token) return;
  const challenge = response.headers.get("WWW-Authenticate") ?? "";
  if (!/^Bearer\s+error="invalid_token"(?:\s*,|$)/i.test(challenge)) return;
  if (!apiActorIdentityIsCurrent(identity)) return;
  if (await clearTokenForIdentity(identity)) await purgeUnauthorizedDeviceData();
}

/** Extract a readable message from an openapi-fetch error response. */
export async function errorMessage(
  response: Response | undefined,
  fallback: string,
  problem?: unknown,
): Promise<string> {
  if (problem === undefined && response && !response.bodyUsed) {
    try {
      problem = await response.json();
    } catch {
      // Non-JSON responses still need a readable status fallback.
    }
  }
  if (problem && typeof problem === "object") {
    if ("errors" in problem && Array.isArray(problem.errors)) {
      const details = problem.errors.flatMap((error: unknown) => {
        if (!error || typeof error !== "object" || !("message" in error)) return [];
        if (typeof error.message !== "string" || !error.message.trim()) return [];
        const location =
          "location" in error && typeof error.location === "string" ? error.location : "";
        return [location ? `${location}: ${error.message}` : error.message];
      });
      if (details.length) return details.join("\n");
    }
    for (const field of ["message", "detail", "title"] as const) {
      if (field in problem) {
        const value: unknown = Reflect.get(problem, field);
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  return response ? `${fallback} (${response.status})` : fallback;
}
