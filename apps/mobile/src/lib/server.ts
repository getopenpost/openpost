import { proxyFetch } from "./proxy-fetch";
import { identityStore } from "./identity-store";
import { validateServerHeaders, serverHeadersForUrl, type ServerHeader } from "./server-headers";
import { normalizeServerUrl } from "./server-url";

export const HOSTED_URL = "https://app.openpo.st";

export type ServerConfig = {
  /** Origin of the OpenPost server, e.g. https://app.openpo.st */
  baseUrl: string;
  isHosted: boolean;
  headers: ServerHeader[];
};

export const subscribeServer = identityStore.subscribeServer;
export const getServerMutationRevision = identityStore.getServerMutationRevision;
export const getPendingServerMutationCount = identityStore.getPendingServerMutationCount;

let serverSnapshot: ServerConfig | null = null;
let snapshotBaseUrl: string | null = null;
let snapshotHeaders: ServerHeader[] | null = null;

export function getServer(): ServerConfig | null {
  const baseUrl = identityStore.getServerBaseUrl();
  // React's external-store hook requires the same snapshot while state is unchanged.
  const headers = identityStore.getServerHeaders();
  if (baseUrl !== snapshotBaseUrl || JSON.stringify(headers) !== JSON.stringify(snapshotHeaders)) {
    serverSnapshot = serverConfig(baseUrl);
    snapshotBaseUrl = baseUrl;
    snapshotHeaders = headers;
  }
  return serverSnapshot;
}

export async function loadServer(): Promise<ServerConfig | null> {
  return serverConfig(await identityStore.loadServerBaseUrl());
}

export async function setServer(
  rawUrl: string,
  headers: ServerHeader[] = [],
): Promise<ServerConfig> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    throw new Error("Enter a valid server address, e.g. openpost.example.com");
  }
  const validated = validateServerHeaders(headers);
  await identityStore.commitServerBaseUrl(normalized, normalized === HOSTED_URL ? [] : validated);
  return serverConfig(normalized)!;
}

export function updateServerHeaders(headers: ServerHeader[]): Promise<void> {
  const server = getServer();
  if (!server || server.isHosted)
    return Promise.reject(new Error("Choose a self-hosted server first."));
  return identityStore.commitServerHeaders(validateServerHeaders(headers));
}

export function clearServer(): Promise<void> {
  return identityStore.commitServerBaseUrl(null);
}

function serverConfig(baseUrl: string | null): ServerConfig | null {
  const normalized = baseUrl ? normalizeServerUrl(baseUrl) : null;
  return normalized
    ? {
        baseUrl: normalized,
        isHosted: normalized === HOSTED_URL,
        headers: normalized === HOSTED_URL ? [] : identityStore.getServerHeaders(),
      }
    : null;
}

/** Validate an instance before committing to it. */
export async function probeServer(
  rawUrl: string,
  headers: ServerHeader[] = [],
): Promise<{ ok: true; baseUrl: string } | { ok: false; error: string }> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    return {
      ok: false,
      error: "Enter a valid server address, e.g. openpost.example.com",
    };
  }
  try {
    const validated = validateServerHeaders(headers);
    const url = `${normalized}/api/v1/ready`;
    const requestHeaders = serverHeadersForUrl(url, normalized, validated);
    const response = Object.keys(requestHeaders).length
      ? await proxyFetch(url, { headers: requestHeaders })
      : await fetch(url);
    if (!response.ok) return { ok: false, error: `Server responded with ${response.status}` };
    const body = (await response.json()) as { status?: string };
    if (body.status !== "ready") return { ok: false, error: "Server is not ready yet" };
    return { ok: true, baseUrl: normalized };
  } catch {
    return { ok: false, error: "Could not reach that server" };
  }
}
