import { createAbortError } from "@openpost/query-catalog";
import * as SecureStore from "expo-secure-store";

const SERVER_KEY = "openpost.server.baseUrl";
const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const TRANSACTION_KEY = "openpost.identity.pending";

const SERVER_TRANSACTION = "server";
const SESSION_TRANSACTION = "session";
const WORKSPACE_TRANSACTION = "workspace";

type IdentityTransaction =
  | typeof SERVER_TRANSACTION
  | typeof SESSION_TRANSACTION
  | typeof WORKSPACE_TRANSACTION;

type StoredIdentity = {
  serverBaseUrl: string | null;
  token: string | null;
  workspaceId: string | null;
};

type IdentityStorage = Pick<
  typeof SecureStore,
  "deleteItemAsync" | "getItemAsync" | "setItemAsync"
>;

class IdentityQuarantineError extends AggregateError {
  readonly transaction: IdentityTransaction;

  constructor(transaction: IdentityTransaction, causes: unknown[], message: string) {
    super(causes, message);
    this.name = "IdentityQuarantineError";
    this.transaction = transaction;
  }
}

export function createIdentityStore(storage: IdentityStorage) {
  let serverBaseUrl: string | null = null;
  let token: string | null = null;
  let workspaceId: string | null = null;
  let serverMutationRevision = 0;
  let tokenMutationRevision = 0;
  let workspaceMutationRevision = 0;
  let pendingServerMutationCount = 0;
  let pendingTokenMutationCount = 0;
  let pendingWorkspaceMutationCount = 0;
  let persistenceTail = Promise.resolve();

  const serverListeners = new Set<() => void>();
  const tokenListeners = new Set<() => void>();
  const workspaceListeners = new Set<() => void>();

  function runPersistenceOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = persistenceTail.then(operation, operation);
    persistenceTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function notify(listeners: Set<() => void>): void {
    for (const listener of listeners) listener();
  }

  function applyQuarantine(transaction: IdentityTransaction): void {
    if (transaction === SERVER_TRANSACTION) {
      serverBaseUrl = null;
      serverMutationRevision += 1;
      notify(serverListeners);
    }
    if (transaction !== WORKSPACE_TRANSACTION) {
      token = null;
      tokenMutationRevision += 1;
      notify(tokenListeners);
    }
    workspaceId = null;
    workspaceMutationRevision += 1;
    notify(workspaceListeners);
  }

  async function recoverInterruptedTransaction(): Promise<IdentityTransaction | null> {
    const stored = await storage.getItemAsync(TRANSACTION_KEY);
    if (!stored) return null;
    const transaction = parseTransaction(stored);
    const affectedKeys = keysForTransaction(transaction);
    const cleared = await Promise.all(
      affectedKeys.map((key) => ignoreFailure(() => storage.deleteItemAsync(key))),
    );
    if (cleared.every(Boolean)) {
      await ignoreFailure(() => storage.deleteItemAsync(TRANSACTION_KEY));
    }
    return transaction;
  }

  async function loadServerBaseUrl(): Promise<string | null> {
    const expectedRevision = serverMutationRevision;
    return runPersistenceOperation(async () => {
      const recovered = await recoverInterruptedTransaction();
      if (recovered) applyQuarantine(recovered);
      if (recovered === SERVER_TRANSACTION) return serverBaseUrl;

      const stored = await storage.getItemAsync(SERVER_KEY);
      if (serverMutationRevision !== expectedRevision) return serverBaseUrl;
      serverBaseUrl = stored;
      notify(serverListeners);
      return serverBaseUrl;
    });
  }

  async function loadToken(): Promise<string | null> {
    const expectedRevision = tokenMutationRevision;
    return runPersistenceOperation(async () => {
      const recovered = await recoverInterruptedTransaction();
      if (recovered) applyQuarantine(recovered);
      if (recovered === SERVER_TRANSACTION || recovered === SESSION_TRANSACTION) return token;

      const stored = await storage.getItemAsync(TOKEN_KEY);
      if (tokenMutationRevision !== expectedRevision) return token;
      token = stored;
      notify(tokenListeners);
      return token;
    });
  }

  async function loadWorkspaceId(): Promise<string | null> {
    const expectedTokenRevision = tokenMutationRevision;
    const expectedWorkspaceRevision = workspaceMutationRevision;
    return runPersistenceOperation(async () => {
      const recovered = await recoverInterruptedTransaction();
      if (recovered) {
        applyQuarantine(recovered);
        return workspaceId;
      }

      const stored = await storage.getItemAsync(WORKSPACE_KEY);
      if (
        tokenMutationRevision !== expectedTokenRevision ||
        workspaceMutationRevision !== expectedWorkspaceRevision
      ) {
        return workspaceId;
      }
      workspaceId = stored;
      notify(workspaceListeners);
      return workspaceId;
    });
  }

  function commitServerBaseUrl(value: string | null): Promise<void> {
    const operationRevision = ++serverMutationRevision;
    pendingServerMutationCount += 1;
    return runPersistenceOperation(async () => {
      let pendingFinished = false;
      let recovered: IdentityTransaction | null = null;
      const finishPending = () => {
        if (pendingFinished) return;
        pendingFinished = true;
        pendingServerMutationCount -= 1;
      };

      try {
        recovered = await recoverInterruptedTransaction();
        if (recovered) throw sessionChanged();
        const previous = await readStoredIdentity(storage);
        const committed = await commitStoredTransaction(
          storage,
          SERVER_TRANSACTION,
          previous,
          async () => {
            await writeValue(storage, SERVER_KEY, value);
            await writeValue(storage, WORKSPACE_KEY, null);
            await writeValue(storage, TOKEN_KEY, null);
          },
          () => serverMutationRevision === operationRevision,
        );
        if (!committed) throw sessionChanged();

        finishPending();
        serverBaseUrl = value;
        token = null;
        workspaceId = null;
        tokenMutationRevision += 1;
        workspaceMutationRevision += 1;
        notify(serverListeners);
        notify(tokenListeners);
        notify(workspaceListeners);
      } catch (cause) {
        finishPending();
        if (cause instanceof IdentityQuarantineError) applyQuarantine(cause.transaction);
        else if (recovered) applyQuarantine(recovered);
        throw cause;
      } finally {
        finishPending();
      }
    });
  }

  function commitTokenIfCurrent(
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
    pendingTokenMutationCount += 1;

    return runPersistenceOperation(async () => {
      let pendingFinished = false;
      const finishPending = () => {
        if (pendingFinished) return;
        pendingFinished = true;
        pendingTokenMutationCount -= 1;
      };
      const operationIsCurrent = () =>
        token === expectedToken &&
        tokenMutationRevision === operationTokenRevision &&
        identityIsCurrent();

      try {
        const recovered = await recoverInterruptedTransaction();
        if (recovered) {
          finishPending();
          applyQuarantine(recovered);
          return false;
        }
        const previous = await readStoredIdentity(storage);
        const committed = await commitStoredTransaction(
          storage,
          SESSION_TRANSACTION,
          previous,
          async () => {
            await writeValue(storage, WORKSPACE_KEY, null);
            await writeValue(storage, TOKEN_KEY, value);
          },
          operationIsCurrent,
        );
        finishPending();
        if (!committed) return false;

        token = value;
        workspaceId = null;
        notify(tokenListeners);
        notify(workspaceListeners);
        return true;
      } catch (cause) {
        finishPending();
        if (cause instanceof IdentityQuarantineError) applyQuarantine(cause.transaction);
        throw cause;
      } finally {
        finishPending();
      }
    });
  }

  function commitWorkspaceIdIfCurrent(
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
    const operationWorkspaceRevision = ++workspaceMutationRevision;
    pendingWorkspaceMutationCount += 1;

    return runPersistenceOperation(async () => {
      let pendingFinished = false;
      const finishPending = () => {
        if (pendingFinished) return;
        pendingFinished = true;
        pendingWorkspaceMutationCount -= 1;
      };
      const operationIsCurrent = () =>
        token === expectedToken &&
        tokenMutationRevision === expectedTokenMutationRevision &&
        workspaceMutationRevision === operationWorkspaceRevision &&
        identityIsCurrent();

      try {
        const recovered = await recoverInterruptedTransaction();
        if (recovered) {
          finishPending();
          applyQuarantine(recovered);
          return false;
        }
        const previous = await readStoredIdentity(storage);
        const committed = await commitStoredTransaction(
          storage,
          WORKSPACE_TRANSACTION,
          previous,
          () => writeValue(storage, WORKSPACE_KEY, value),
          operationIsCurrent,
        );
        finishPending();
        if (!committed) return false;

        workspaceId = value;
        notify(workspaceListeners);
        return true;
      } catch (cause) {
        finishPending();
        if (cause instanceof IdentityQuarantineError) applyQuarantine(cause.transaction);
        throw cause;
      } finally {
        finishPending();
      }
    });
  }

  return {
    commitServerBaseUrl,
    commitTokenIfCurrent,
    commitWorkspaceIdIfCurrent,
    getPendingServerMutationCount: () => pendingServerMutationCount,
    getPendingTokenMutationCount: () => pendingTokenMutationCount,
    getPendingWorkspaceMutationCount: () => pendingWorkspaceMutationCount,
    getServerBaseUrl: () => serverBaseUrl,
    getServerMutationRevision: () => serverMutationRevision,
    getToken: () => token,
    getTokenMutationRevision: () => tokenMutationRevision,
    getWorkspaceId: () => workspaceId,
    getWorkspaceMutationRevision: () => workspaceMutationRevision,
    loadServerBaseUrl,
    loadToken,
    loadWorkspaceId,
    subscribeServer: (listener: () => void) => subscribe(serverListeners, listener),
    subscribeToken: (listener: () => void) => subscribe(tokenListeners, listener),
    subscribeWorkspaceId: (listener: () => void) => subscribe(workspaceListeners, listener),
  };
}

export const identityStore = createIdentityStore(SecureStore);

async function commitStoredTransaction(
  storage: IdentityStorage,
  transaction: IdentityTransaction,
  previous: StoredIdentity,
  writeNext: () => Promise<void>,
  operationIsCurrent: () => boolean,
): Promise<boolean> {
  if (!operationIsCurrent()) return false;
  await storage.setItemAsync(TRANSACTION_KEY, transaction);
  if (!operationIsCurrent()) {
    await restoreStoredIdentity(storage, transaction, previous, sessionChanged());
    return false;
  }

  try {
    await writeNext();
  } catch (cause) {
    await restoreStoredIdentity(storage, transaction, previous, cause);
    throw cause;
  }
  if (!operationIsCurrent()) {
    await restoreStoredIdentity(storage, transaction, previous, sessionChanged());
    return false;
  }

  try {
    await storage.deleteItemAsync(TRANSACTION_KEY);
  } catch (cause) {
    await quarantineStoredIdentity(storage, transaction, cause);
  }
  if (!operationIsCurrent()) {
    await restoreStoredIdentity(storage, transaction, previous, sessionChanged());
    return false;
  }
  return true;
}

async function restoreStoredIdentity(
  storage: IdentityStorage,
  transaction: IdentityTransaction,
  previous: StoredIdentity,
  cause: unknown,
): Promise<void> {
  try {
    await storage.setItemAsync(TRANSACTION_KEY, transaction);
    for (const key of keysForTransaction(transaction)) {
      await writeValue(storage, key, valueForKey(previous, key));
    }
    await storage.deleteItemAsync(TRANSACTION_KEY);
  } catch (restoreCause) {
    await quarantineStoredIdentity(storage, transaction, cause, restoreCause);
  }
}

async function quarantineStoredIdentity(
  storage: IdentityStorage,
  transaction: IdentityTransaction,
  ...causes: unknown[]
): Promise<never> {
  const cleanupFailures: unknown[] = [];
  await captureFailure(() => storage.setItemAsync(TRANSACTION_KEY, transaction), cleanupFailures);
  const cleared = await Promise.all(
    keysForTransaction(transaction).map((key) =>
      captureFailure(() => storage.deleteItemAsync(key), cleanupFailures),
    ),
  );
  if (cleared.every(Boolean)) {
    await captureFailure(() => storage.deleteItemAsync(TRANSACTION_KEY), cleanupFailures);
  }
  const primaryCause = causes[0];
  const message =
    cleanupFailures.length === 0 && primaryCause instanceof Error
      ? primaryCause.message
      : quarantineMessage(transaction);
  throw new IdentityQuarantineError(transaction, [...causes, ...cleanupFailures], message);
}

async function readStoredIdentity(storage: IdentityStorage): Promise<StoredIdentity> {
  const [serverBaseUrl, token, workspaceId] = await Promise.all([
    storage.getItemAsync(SERVER_KEY),
    storage.getItemAsync(TOKEN_KEY),
    storage.getItemAsync(WORKSPACE_KEY),
  ]);
  return { serverBaseUrl, token, workspaceId };
}

function keysForTransaction(transaction: IdentityTransaction): string[] {
  if (transaction === SERVER_TRANSACTION) return [SERVER_KEY, TOKEN_KEY, WORKSPACE_KEY];
  if (transaction === SESSION_TRANSACTION) return [TOKEN_KEY, WORKSPACE_KEY];
  return [WORKSPACE_KEY];
}

function valueForKey(identity: StoredIdentity, key: string): string | null {
  if (key === SERVER_KEY) return identity.serverBaseUrl;
  if (key === TOKEN_KEY) return identity.token;
  return identity.workspaceId;
}

function parseTransaction(value: string): IdentityTransaction {
  if (value === SESSION_TRANSACTION || value === WORKSPACE_TRANSACTION) return value;
  return SERVER_TRANSACTION;
}

function quarantineMessage(transaction: IdentityTransaction): string {
  if (transaction === SERVER_TRANSACTION) {
    return "Could not restore or clear the stored server and session";
  }
  if (transaction === SESSION_TRANSACTION) return "Could not restore or clear the stored session";
  return "Could not restore or clear the stored Workspace";
}

function writeValue(storage: IdentityStorage, key: string, value: string | null): Promise<void> {
  return value ? storage.setItemAsync(key, value) : storage.deleteItemAsync(key);
}

async function captureFailure(
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

async function ignoreFailure(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}

function subscribe(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sessionChanged(): Error {
  return createAbortError("The selected identity changed");
}
