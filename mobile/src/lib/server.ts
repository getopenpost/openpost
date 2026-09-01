import * as SecureStore from "expo-secure-store";

import { normalizeServerUrl } from "./server-url";

export const HOSTED_URL = "https://app.openpo.st";

export type ServerConfig = {
  /** Origin of the OpenPost server, e.g. https://app.openpo.st */
  baseUrl: string;
  isHosted: boolean;
};

const KEY = "openpost.server.baseUrl";
let current: ServerConfig | null = null;
const listeners = new Set<() => void>();

export function subscribeServer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServer(): ServerConfig | null {
  return current;
}

async function notify() {
  for (const listener of listeners) listener();
}

export async function loadServer(): Promise<ServerConfig | null> {
  const stored = await SecureStore.getItemAsync(KEY);
  const baseUrl = stored ? normalizeServerUrl(stored) : null;
  current = baseUrl ? { baseUrl, isHosted: baseUrl === HOSTED_URL } : null;
  await notify();
  return current;
}

export async function setServer(rawUrl: string): Promise<ServerConfig> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    throw new Error("Enter a valid server address, e.g. openpost.example.com");
  }
  await SecureStore.setItemAsync(KEY, normalized);
  current = { baseUrl: normalized, isHosted: normalized === HOSTED_URL };
  await notify();
  return current;
}

export async function clearServer(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  current = null;
  await notify();
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
