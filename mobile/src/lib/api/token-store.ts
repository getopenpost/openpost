import * as SecureStore from "expo-secure-store";

const KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";

let token: string | null = null;
let workspaceId: string | null = null;
const tokenListeners = new Set<() => void>();
const workspaceListeners = new Set<() => void>();
let persistenceMutationTail = Promise.resolve();
// Invalidate an in-flight workspace commit as soon as an actor change is queued.
let tokenMutationRevision = 0;

export function getToken(): string | null {
  return token;
}

export function subscribeToken(listener: () => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

function notifyToken() {
  for (const listener of tokenListeners) listener();
}

export function subscribeWorkspaceId(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => workspaceListeners.delete(listener);
}

function notifyWorkspaceId() {
  for (const listener of workspaceListeners) listener();
}

function runPersistenceMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceMutationTail.then(operation, operation);
  persistenceMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function loadToken(): Promise<string | null> {
  tokenMutationRevision += 1;
  return runPersistenceMutation(async () => {
    token = await SecureStore.getItemAsync(KEY);
    notifyToken();
    return token;
  });
}

export function saveToken(value: string): Promise<void> {
  tokenMutationRevision += 1;
  return runPersistenceMutation(async () => {
    await SecureStore.deleteItemAsync(WORKSPACE_KEY);
    await SecureStore.setItemAsync(KEY, value);
    token = value;
    workspaceId = null;
    notifyToken();
    notifyWorkspaceId();
  });
}

export function clearToken(): Promise<void> {
  tokenMutationRevision += 1;
  return runPersistenceMutation(clearCurrentToken);
}

export function clearTokenIfCurrent(
  expectedToken: string,
  identityIsCurrent: () => boolean,
): Promise<boolean> {
  if (token !== expectedToken || !identityIsCurrent()) return Promise.resolve(false);
  tokenMutationRevision += 1;
  return runPersistenceMutation(async () => {
    if (token !== expectedToken || !identityIsCurrent()) return false;
    await clearCurrentToken();
    return true;
  });
}

async function clearCurrentToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  token = null;
  workspaceId = null;
  notifyToken();
  notifyWorkspaceId();
  await SecureStore.deleteItemAsync(WORKSPACE_KEY);
}

export function loadWorkspaceId(): Promise<string | null> {
  return runPersistenceMutation(async () => {
    workspaceId = await SecureStore.getItemAsync(WORKSPACE_KEY);
    notifyWorkspaceId();
    return workspaceId;
  });
}

export function saveWorkspaceId(value: string): Promise<void> {
  return runPersistenceMutation(async () => {
    await writeWorkspaceId(value);
    publishWorkspaceId(value);
  });
}

export function clearWorkspaceId(): Promise<void> {
  return runPersistenceMutation(async () => {
    await writeWorkspaceId(null);
    publishWorkspaceId(null);
  });
}

export function commitWorkspaceIdIfCurrent(
  value: string | null,
  expectedToken: string,
  identityIsCurrent: () => boolean,
): Promise<boolean> {
  const expectedTokenMutationRevision = tokenMutationRevision;
  return runPersistenceMutation(async () => {
    if (
      !workspaceCommitIsCurrent(expectedToken, expectedTokenMutationRevision, identityIsCurrent)
    ) {
      return false;
    }

    const previousWorkspaceId = workspaceId;
    await writeWorkspaceId(value);
    if (
      !workspaceCommitIsCurrent(expectedToken, expectedTokenMutationRevision, identityIsCurrent)
    ) {
      // SecureStore has no compare-and-set, so repair the write before later mutations run.
      await writeWorkspaceId(previousWorkspaceId);
      return false;
    }

    publishWorkspaceId(value);
    return true;
  });
}

export function getWorkspaceId(): string | null {
  return workspaceId;
}

function workspaceCommitIsCurrent(
  expectedToken: string,
  expectedTokenMutationRevision: number,
  identityIsCurrent: () => boolean,
): boolean {
  return (
    token === expectedToken &&
    tokenMutationRevision === expectedTokenMutationRevision &&
    identityIsCurrent()
  );
}

function writeWorkspaceId(value: string | null): Promise<void> {
  return value
    ? SecureStore.setItemAsync(WORKSPACE_KEY, value)
    : SecureStore.deleteItemAsync(WORKSPACE_KEY);
}

function publishWorkspaceId(value: string | null): void {
  workspaceId = value;
  notifyWorkspaceId();
}
