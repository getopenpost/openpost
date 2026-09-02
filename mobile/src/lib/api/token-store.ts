import * as SecureStore from "expo-secure-store";

const KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";

let token: string | null = null;
let workspaceId: string | null = null;
const tokenListeners = new Set<() => void>();
const workspaceListeners = new Set<() => void>();
let tokenMutationTail = Promise.resolve();

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

function runTokenMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = tokenMutationTail.then(operation, operation);
  tokenMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function loadToken(): Promise<string | null> {
  return runTokenMutation(async () => {
    token = await SecureStore.getItemAsync(KEY);
    notifyToken();
    return token;
  });
}

export function saveToken(value: string): Promise<void> {
  return runTokenMutation(async () => {
    await SecureStore.deleteItemAsync(WORKSPACE_KEY);
    await SecureStore.setItemAsync(KEY, value);
    token = value;
    workspaceId = null;
    notifyToken();
    notifyWorkspaceId();
  });
}

export function clearToken(): Promise<void> {
  return runTokenMutation(clearCurrentToken);
}

export function clearTokenIfCurrent(
  expectedToken: string,
  identityIsCurrent: () => boolean,
): Promise<boolean> {
  return runTokenMutation(async () => {
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

export async function loadWorkspaceId(): Promise<string | null> {
  workspaceId = await SecureStore.getItemAsync(WORKSPACE_KEY);
  notifyWorkspaceId();
  return workspaceId;
}

export async function saveWorkspaceId(value: string): Promise<void> {
  await SecureStore.setItemAsync(WORKSPACE_KEY, value);
  workspaceId = value;
  notifyWorkspaceId();
}

export async function clearWorkspaceId(): Promise<void> {
  await SecureStore.deleteItemAsync(WORKSPACE_KEY);
  workspaceId = null;
  notifyWorkspaceId();
}

export function getWorkspaceId(): string | null {
  return workspaceId;
}
