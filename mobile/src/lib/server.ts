import { identityStore } from "./identity-store";
import { normalizeServerUrl } from "./server-url";

export const HOSTED_URL = "https://app.openpo.st";

export type ServerConfig = {
  /** Origin of the OpenPost server, e.g. https://app.openpo.st */
  baseUrl: string;
  isHosted: boolean;
};

export const subscribeServer = identityStore.subscribeServer;
export const getServerMutationRevision = identityStore.getServerMutationRevision;
export const getPendingServerMutationCount = identityStore.getPendingServerMutationCount;

export function getServer(): ServerConfig | null {
  return serverConfig(identityStore.getServerBaseUrl());
}

export async function loadServer(): Promise<ServerConfig | null> {
  return serverConfig(await identityStore.loadServerBaseUrl());
}

export async function setServer(rawUrl: string): Promise<ServerConfig> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    throw new Error("Enter a valid server address, e.g. openpost.example.com");
  }
  await identityStore.commitServerBaseUrl(normalized);
  return { baseUrl: normalized, isHosted: normalized === HOSTED_URL };
}

export function clearServer(): Promise<void> {
  return identityStore.commitServerBaseUrl(null);
}

function serverConfig(baseUrl: string | null): ServerConfig | null {
  const normalized = baseUrl ? normalizeServerUrl(baseUrl) : null;
  return normalized ? { baseUrl: normalized, isHosted: normalized === HOSTED_URL } : null;
}

/** Validate an instance before committing to it. */
export async function probeServer(
  rawUrl: string,
): Promise<{ ok: true; baseUrl: string } | { ok: false; error: string }> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    return {
      ok: false,
      error: "Enter a valid server address, e.g. openpost.example.com",
    };
  }
  try {
    const response = await fetch(`${normalized}/api/v1/ready`);
    if (!response.ok) return { ok: false, error: `Server responded with ${response.status}` };
    const body = (await response.json()) as { status?: string };
    if (body.status !== "ready") return { ok: false, error: "Server is not ready yet" };
    return { ok: true, baseUrl: normalized };
  } catch {
    return { ok: false, error: "Could not reach that server" };
  }
}
