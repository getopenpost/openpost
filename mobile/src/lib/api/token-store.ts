import * as SecureStore from "expo-secure-store";

const KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";

let token: string | null = null;
let workspaceId: string | null = null;
const tokenListeners = new Set<() => void>();
const workspaceListeners = new Set<() => void>();
let persistenceMutationTail = Promise.resolve();
let tokenMutationRevision = 0;
let workspaceMutationRevision = 0;

export function getToken(): string | null {
  return token;
}

export function getTokenMutationRevision(): number {
  return tokenMutationRevision;
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

export function getWorkspaceMutationRevision(): number {
  return workspaceMutationRevision;
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
  const expectedMutationRevision = tokenMutationRevision;
  return runPersistenceMutation(async () => {
    const stored = await SecureStore.getItemAsync(KEY);
    if (tokenMutationRevision !== expectedMutationRevision) return token;
    token = stored;
    notifyToken();
    return token;
  });
}

export function commitTokenIfCurrent(
  value: string | null,
  expectedToken: string | null,
  expectedTokenMutationRevision: number,
  identityIsCurrent: () => boolean,
): Promise<boolean> {
  if (
    token !== expectedToken ||
    tokenMutationRevision !== expectedTokenMutationRevision ||
    !identityIsCurrent()
  ) {
    return Promise.resolve(false);
  }
  const operationTokenRevision = ++tokenMutationRevision;
  workspaceMutationRevision += 1;
  return runPersistenceMutation(async () => {
    if (
      !conditionalTokenOperationIsCurrent(expectedToken, operationTokenRevision, identityIsCurrent)
    ) {
      return false;
    }
    const committed = await writeTokenStateIfCurrent(value, () =>
      conditionalTokenOperationIsCurrent(expectedToken, operationTokenRevision, identityIsCurrent),
    );
    if (!committed) return false;
    publishTokenState(value, null);
    return true;
  });
}

export function loadWorkspaceId(): Promise<string | null> {
  const expectedTokenMutationRevision = tokenMutationRevision;
  const expectedWorkspaceMutationRevision = workspaceMutationRevision;
  return runPersistenceMutation(async () => {
    const stored = await SecureStore.getItemAsync(WORKSPACE_KEY);
    if (
      tokenMutationRevision !== expectedTokenMutationRevision ||
      workspaceMutationRevision !== expectedWorkspaceMutationRevision
    ) {
      return workspaceId;
    }
    workspaceId = stored;
    notifyWorkspaceId();
    return workspaceId;
  });
}

export function commitWorkspaceIdIfCurrent(
  value: string | null,
  expectedToken: string,
  expectedTokenMutationRevision: number,
  expectedWorkspaceMutationRevision: number,
  identityIsCurrent: () => boolean,
): Promise<boolean> {
  if (
    token !== expectedToken ||
    tokenMutationRevision !== expectedTokenMutationRevision ||
    workspaceMutationRevision !== expectedWorkspaceMutationRevision ||
    !identityIsCurrent()
  ) {
    return Promise.resolve(false);
  }
  const operationWorkspaceMutationRevision = ++workspaceMutationRevision;
  return runPersistenceMutation(async () => {
    if (
      !workspaceCommitIsCurrent(
        expectedToken,
        expectedTokenMutationRevision,
        operationWorkspaceMutationRevision,
        identityIsCurrent,
      )
    ) {
      return false;
    }

    const committed = await writeWorkspaceIdIfCurrent(value, () =>
      workspaceCommitIsCurrent(
        expectedToken,
        expectedTokenMutationRevision,
        operationWorkspaceMutationRevision,
        identityIsCurrent,
      ),
    );
    if (!committed) return false;

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
  expectedWorkspaceMutationRevision: number,
  identityIsCurrent: () => boolean,
): boolean {
  return (
    token === expectedToken &&
    tokenMutationRevision === expectedTokenMutationRevision &&
    workspaceMutationRevision === expectedWorkspaceMutationRevision &&
    identityIsCurrent()
  );
}

function conditionalTokenOperationIsCurrent(
  expectedToken: string | null,
  expectedTokenMutationRevision: number,
  identityIsCurrent: () => boolean,
): boolean {
  return (
    token === expectedToken &&
    tokenMutationRevision === expectedTokenMutationRevision &&
    identityIsCurrent()
  );
}

async function writeTokenStateIfCurrent(
  nextToken: string | null,
  operationIsCurrent: () => boolean,
): Promise<boolean> {
  const previous = await readStoredTokenState();
  if (!operationIsCurrent()) return false;
  try {
    await writeToken(nextToken);
    await writeWorkspaceId(null);
  } catch (cause) {
    await restoreStoredTokenState(previous);
    throw cause;
  }
  if (operationIsCurrent()) return true;
  await restoreStoredTokenState(previous);
  return false;
}

async function writeWorkspaceIdIfCurrent(
  value: string | null,
  operationIsCurrent: () => boolean,
): Promise<boolean> {
  const previous = await SecureStore.getItemAsync(WORKSPACE_KEY);
  if (!operationIsCurrent()) return false;
  try {
    await writeWorkspaceId(value);
  } catch (cause) {
    await writeWorkspaceId(previous);
    throw cause;
  }
  if (operationIsCurrent()) return true;
  await writeWorkspaceId(previous);
  return false;
}

type StoredTokenState = {
  token: string | null;
  workspaceId: string | null;
};

async function readStoredTokenState(): Promise<StoredTokenState> {
  const [storedToken, storedWorkspaceId] = await Promise.all([
    SecureStore.getItemAsync(KEY),
    SecureStore.getItemAsync(WORKSPACE_KEY),
  ]);
  return { token: storedToken, workspaceId: storedWorkspaceId };
}

async function restoreStoredTokenState(previous: StoredTokenState): Promise<void> {
  await writeToken(previous.token);
  await writeWorkspaceId(previous.workspaceId);
}

function writeToken(value: string | null): Promise<void> {
  return value ? SecureStore.setItemAsync(KEY, value) : SecureStore.deleteItemAsync(KEY);
}

function publishTokenState(nextToken: string | null, nextWorkspaceId: string | null): void {
  token = nextToken;
  workspaceId = nextWorkspaceId;
  notifyToken();
  notifyWorkspaceId();
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
