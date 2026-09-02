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
let persistenceTail = Promise.resolve();
let mutationRevision = 0;
let pendingServerMutationCount = 0;

export function subscribeServer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServer(): ServerConfig | null {
  return current;
}

export function getServerMutationRevision(): number {
  return mutationRevision;
}

export function getPendingServerMutationCount(): number {
  return pendingServerMutationCount;
}

function notify() {
  for (const listener of listeners) listener();
}

function runPersistenceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceTail.then(operation, operation);
  persistenceTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function runServerMutation<T>(operation: () => Promise<T>): Promise<T> {
  pendingServerMutationCount += 1;
  return runPersistenceOperation(operation).finally(() => {
    pendingServerMutationCount -= 1;
  });
}

export function loadServer(): Promise<ServerConfig | null> {
  const expectedMutationRevision = mutationRevision;
  return runPersistenceOperation(async () => {
    const stored = await SecureStore.getItemAsync(KEY);
    if (mutationRevision !== expectedMutationRevision) return current;

    const baseUrl = stored ? normalizeServerUrl(stored) : null;
    current = baseUrl ? { baseUrl, isHosted: baseUrl === HOSTED_URL } : null;
    notify();
    return current;
  });
}

export function setServer(rawUrl: string): Promise<ServerConfig> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized) {
    return Promise.reject(new Error("Enter a valid server address, e.g. openpost.example.com"));
  }
  const next = { baseUrl: normalized, isHosted: normalized === HOSTED_URL };
  const operationRevision = ++mutationRevision;
  return runServerMutation(async () => {
    requireCurrentServerOperation(operationRevision);
    const previousStored = await SecureStore.getItemAsync(KEY);
    requireCurrentServerOperation(operationRevision);
    try {
      await SecureStore.setItemAsync(KEY, normalized);
    } catch (cause) {
      await writeStoredServer(previousStored);
      throw cause;
    }
    if (mutationRevision !== operationRevision) {
      await writeStoredServer(previousStored);
      throw sessionChanged();
    }
    current = next;
    notify();
    return next;
  });
}

export function clearServer(): Promise<void> {
  const operationRevision = ++mutationRevision;
  return runServerMutation(async () => {
    requireCurrentServerOperation(operationRevision);
    const previousStored = await SecureStore.getItemAsync(KEY);
    requireCurrentServerOperation(operationRevision);
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch (cause) {
      await writeStoredServer(previousStored);
      throw cause;
    }
    if (mutationRevision !== operationRevision) {
      await writeStoredServer(previousStored);
      throw sessionChanged();
    }
    current = null;
    notify();
  });
}

function requireCurrentServerOperation(expectedRevision: number): void {
  if (mutationRevision !== expectedRevision) throw sessionChanged();
}

function writeStoredServer(value: string | null): Promise<void> {
  return value ? SecureStore.setItemAsync(KEY, value) : SecureStore.deleteItemAsync(KEY);
}

function sessionChanged(): DOMException {
  return new DOMException("The selected server changed", "AbortError");
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
