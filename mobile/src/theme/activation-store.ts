import type { NativeResolvedThemeContract, NativeStagedThemeResources } from "./contract";
import { nativeThemeResourcesReady } from "./runtime";

export interface NativeThemeActivationState {
  readonly contract: NativeResolvedThemeContract | null;
  readonly resources: NativeStagedThemeResources | null;
  readonly pendingWorkspaceId: string | null;
  readonly sessionScope: number;
}

export interface NativeThemeActivationStore {
  get(): NativeThemeActivationState;
  subscribe(listener: () => void): () => void;
  bindSession(sessionIdentity: string): number;
  isCurrentSession(sessionIdentity: string): boolean;
  beginWorkspaceTransition(workspaceId: string): void;
  cancelWorkspaceTransition(workspaceId: string): void;
  stage(
    contract: NativeResolvedThemeContract,
    resources: NativeStagedThemeResources | null,
    sessionScope: number,
  ): boolean;
  clear(): void;
}

function emptyState(sessionScope: number): NativeThemeActivationState {
  return Object.freeze({
    contract: null,
    resources: null,
    pendingWorkspaceId: null,
    sessionScope,
  });
}

export function createNativeThemeActivationStore(): NativeThemeActivationStore {
  let state = emptyState(0);
  let sessionIdentity: string | null = null;
  let stateBeforeTransition: NativeThemeActivationState | null = null;
  const listeners = new Set<() => void>();

  function publish(next: NativeThemeActivationState) {
    if (state === next) return;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bindSession(nextIdentity) {
      if (sessionIdentity === nextIdentity) return state.sessionScope;
      sessionIdentity = nextIdentity;
      stateBeforeTransition = null;
      const nextScope = state.sessionScope + 1;
      publish(emptyState(nextScope));
      return nextScope;
    },
    isCurrentSession(candidate) {
      return sessionIdentity === candidate;
    },
    beginWorkspaceTransition(workspaceId) {
      if (!workspaceId) return;
      if (!state.pendingWorkspaceId) stateBeforeTransition = state;
      publish({
        contract: null,
        resources: null,
        pendingWorkspaceId: workspaceId,
        sessionScope: state.sessionScope,
      });
    },
    cancelWorkspaceTransition(workspaceId) {
      if (state.pendingWorkspaceId !== workspaceId) return;
      const previous = stateBeforeTransition ?? emptyState(state.sessionScope);
      stateBeforeTransition = null;
      publish(previous);
    },
    stage(contract, resources, sessionScope) {
      if (sessionScope !== state.sessionScope) return false;
      if (state.pendingWorkspaceId && state.pendingWorkspaceId !== contract.workspaceId) {
        return false;
      }
      if (!nativeThemeResourcesReady(contract, resources)) return false;
      stateBeforeTransition = null;
      publish({
        contract,
        resources,
        pendingWorkspaceId: null,
        sessionScope: state.sessionScope,
      });
      return true;
    },
    clear() {
      stateBeforeTransition = null;
      publish(emptyState(state.sessionScope));
    },
  };
}

const activationStore = createNativeThemeActivationStore();

export function getNativeThemeActivation(): NativeThemeActivationState {
  return activationStore.get();
}

export function subscribeNativeThemeActivation(listener: () => void): () => void {
  return activationStore.subscribe(listener);
}

export function bindNativeThemeSession(sessionIdentity: string): number {
  return activationStore.bindSession(sessionIdentity);
}

export function isNativeThemeSessionCurrent(sessionIdentity: string): boolean {
  return activationStore.isCurrentSession(sessionIdentity);
}

export function getNativeThemeSessionScope(): number {
  return activationStore.get().sessionScope;
}

export function beginNativeThemeWorkspaceTransition(workspaceId: string): void {
  activationStore.beginWorkspaceTransition(workspaceId);
}

export function cancelNativeThemeWorkspaceTransition(workspaceId: string): void {
  activationStore.cancelWorkspaceTransition(workspaceId);
}

export function stageNativeThemeActivation(
  contract: NativeResolvedThemeContract,
  resources: NativeStagedThemeResources | null,
  sessionScope: number,
): boolean {
  return activationStore.stage(contract, resources, sessionScope);
}

export function clearNativeThemeActivation(): void {
  activationStore.clear();
}
