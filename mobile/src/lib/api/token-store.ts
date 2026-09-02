import * as SecureStore from "expo-secure-store";

const KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const TRANSACTION_KEY = "openpost.identity.pending";
const SESSION_TRANSACTION = "session";
const WORKSPACE_TRANSACTION = "workspace";

type PersistenceTransaction = typeof SESSION_TRANSACTION | typeof WORKSPACE_TRANSACTION;

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
    const interruptedTransaction = await recoverInterruptedTransactionAtQueueEntry();
    if (interruptedTransaction === SESSION_TRANSACTION) return token;

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
    const interruptedTransaction = await recoverInterruptedTransactionAtQueueEntry();
    if (interruptedTransaction) return workspaceId;

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
  if (await recoverInterruptedTransactionAtQueueEntry()) return false;
  const previous = await readStoredTokenState();
  if (!operationIsCurrent()) return false;
  await SecureStore.setItemAsync(TRANSACTION_KEY, SESSION_TRANSACTION);
  if (!operationIsCurrent()) {
    await restoreStoredTokenState(previous);
    return false;
  }
  try {
    await writeWorkspaceId(null);
    await writeToken(nextToken);
  } catch (cause) {
    await restoreStoredTokenState(previous);
    throw cause;
  }
  if (!operationIsCurrent()) {
    await restoreStoredTokenState(previous);
    return false;
  }
  try {
    await SecureStore.deleteItemAsync(TRANSACTION_KEY);
    return true;
  } catch (cause) {
    return failClosedStoredTokenState(cause);
  }
}

async function writeWorkspaceIdIfCurrent(
  value: string | null,
  operationIsCurrent: () => boolean,
): Promise<boolean> {
  if (await recoverInterruptedTransactionAtQueueEntry()) return false;
  const previous = await SecureStore.getItemAsync(WORKSPACE_KEY);
  if (!operationIsCurrent()) return false;
  await SecureStore.setItemAsync(TRANSACTION_KEY, WORKSPACE_TRANSACTION);
  if (!operationIsCurrent()) {
    await restoreWorkspaceIdOrClear(previous);
    return false;
  }
  try {
    await writeWorkspaceId(value);
  } catch (cause) {
    await restoreWorkspaceIdOrClear(previous);
    throw cause;
  }
  if (!operationIsCurrent()) {
    await restoreWorkspaceIdOrClear(previous);
    return false;
  }
  try {
    await SecureStore.deleteItemAsync(TRANSACTION_KEY);
    return true;
  } catch (cause) {
    return failClosedStoredWorkspaceId(cause);
  }
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
  try {
    await writeToken(previous.token);
    await writeWorkspaceId(previous.workspaceId);
    await SecureStore.deleteItemAsync(TRANSACTION_KEY);
  } catch (cause) {
    await failClosedStoredTokenState(cause);
  }
}

async function restoreWorkspaceIdOrClear(previous: string | null): Promise<void> {
  try {
    await writeWorkspaceId(previous);
    await SecureStore.deleteItemAsync(TRANSACTION_KEY);
  } catch (cause) {
    await failClosedStoredWorkspaceId(cause);
  }
}

async function failClosedStoredTokenState(cause: unknown): Promise<never> {
  const cleanupFailures: unknown[] = [];
  await captureCleanupFailure(
    () => SecureStore.setItemAsync(TRANSACTION_KEY, SESSION_TRANSACTION),
    cleanupFailures,
  );
  const workspaceCleared = await captureCleanupFailure(
    () => SecureStore.deleteItemAsync(WORKSPACE_KEY),
    cleanupFailures,
  );
  const tokenCleared = await captureCleanupFailure(
    () => SecureStore.deleteItemAsync(KEY),
    cleanupFailures,
  );
  if (workspaceCleared && tokenCleared) {
    await captureCleanupFailure(
      () => SecureStore.deleteItemAsync(TRANSACTION_KEY),
      cleanupFailures,
    );
  }
  publishTokenState(null, null);
  throwCleanupFailure("Could not restore or clear the stored session", cause, cleanupFailures);
}

async function failClosedStoredWorkspaceId(cause: unknown): Promise<never> {
  const cleanupFailures: unknown[] = [];
  await captureCleanupFailure(
    () => SecureStore.setItemAsync(TRANSACTION_KEY, WORKSPACE_TRANSACTION),
    cleanupFailures,
  );
  const workspaceCleared = await captureCleanupFailure(
    () => SecureStore.deleteItemAsync(WORKSPACE_KEY),
    cleanupFailures,
  );
  if (workspaceCleared) {
    await captureCleanupFailure(
      () => SecureStore.deleteItemAsync(TRANSACTION_KEY),
      cleanupFailures,
    );
  }
  publishWorkspaceId(null);
  throwCleanupFailure("Could not restore or clear the stored Workspace", cause, cleanupFailures);
}

async function captureCleanupFailure(
  operation: () => Promise<void>,
  failures: unknown[],
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (cause) {
    failures.push(cause);
    return false;
  }
}

function throwCleanupFailure(message: string, cause: unknown, cleanupFailures: unknown[]): never {
  if (cleanupFailures.length > 0) throw new AggregateError([cause, ...cleanupFailures], message);
  throw cause;
}

async function readInterruptedTransaction(): Promise<PersistenceTransaction | null> {
  const stored = await SecureStore.getItemAsync(TRANSACTION_KEY);
  if (!stored) return null;
  return stored === WORKSPACE_TRANSACTION ? WORKSPACE_TRANSACTION : SESSION_TRANSACTION;
}

async function recoverInterruptedTransactionAtQueueEntry(): Promise<PersistenceTransaction | null> {
  const transaction = await readInterruptedTransaction();
  if (!transaction) return null;
  if (transaction === SESSION_TRANSACTION) {
    tokenMutationRevision += 1;
    workspaceMutationRevision += 1;
    publishTokenState(null, null);
  } else {
    workspaceMutationRevision += 1;
    publishWorkspaceId(null);
  }
  await recoverInterruptedTransaction(transaction);
  return transaction;
}

async function recoverInterruptedTransaction(transaction: PersistenceTransaction): Promise<void> {
  const workspaceCleared = await ignoreCleanupFailure(() =>
    SecureStore.deleteItemAsync(WORKSPACE_KEY),
  );
  const tokenCleared =
    transaction === SESSION_TRANSACTION
      ? await ignoreCleanupFailure(() => SecureStore.deleteItemAsync(KEY))
      : true;
  if (workspaceCleared && tokenCleared) {
    await ignoreCleanupFailure(() => SecureStore.deleteItemAsync(TRANSACTION_KEY));
  }
}

async function ignoreCleanupFailure(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
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
