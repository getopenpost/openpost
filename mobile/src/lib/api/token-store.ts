import { identityStore } from "../identity-store";

export const getToken = identityStore.getToken;
export const getTokenMutationRevision = identityStore.getTokenMutationRevision;
export const getPendingTokenMutationCount = identityStore.getPendingTokenMutationCount;
export const subscribeToken = identityStore.subscribeToken;
export const loadToken = identityStore.loadToken;
export const commitTokenIfCurrent = identityStore.commitTokenIfCurrent;

export const getWorkspaceId = identityStore.getWorkspaceId;
export const getWorkspaceMutationRevision = identityStore.getWorkspaceMutationRevision;
export const getPendingWorkspaceMutationCount = identityStore.getPendingWorkspaceMutationCount;
export const subscribeWorkspaceId = identityStore.subscribeWorkspaceId;
export const loadWorkspaceId = identityStore.loadWorkspaceId;
export const commitWorkspaceIdIfCurrent = identityStore.commitWorkspaceIdIfCurrent;
