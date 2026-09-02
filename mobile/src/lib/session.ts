import {
  appBootstrapQueryOptions,
  confirmedBootstrapWorkspaceId,
  seedAppBootstrap,
  type AppBootstrap,
} from "@openpost/query-catalog";
import type { QueryClient } from "@tanstack/react-query";

import type { ApiRequestIdentity } from "./api/client";
import type { ServerConfig } from "./server";

export type SessionState = {
  serverReady: boolean;
  signedIn: boolean;
  workspaceId: string | null;
};

export type SessionLoaders = {
  loadServer: () => Promise<unknown>;
  loadToken: () => Promise<unknown>;
  loadWorkspaceId: () => Promise<unknown>;
  getServer: () => unknown;
  getToken: () => string | null;
  getWorkspaceId: () => string | null;
};

export type SessionSynchronizer = {
  queryClient: QueryClient;
  getServer: () => ServerConfig | null;
  getToken: () => string | null;
  getWorkspaceId: () => string | null;
  captureIdentity: () => ApiRequestIdentity;
  identityIsCurrent: (identity: ApiRequestIdentity) => boolean;
  commitWorkspaceId: (workspaceId: string | null, identity: ApiRequestIdentity) => Promise<boolean>;
  clearToken: (identity: ApiRequestIdentity) => Promise<boolean>;
  readAppBootstrap: (
    serverBaseUrl: string,
    preferredWorkspaceId: string | null,
    signal: AbortSignal,
  ) => Promise<AppBootstrap>;
};

export async function loadSessionState(loaders: SessionLoaders): Promise<SessionState> {
  await Promise.all([loaders.loadServer(), loaders.loadToken(), loaders.loadWorkspaceId()]);
  return currentSessionState(loaders);
}

export async function synchronizeSession(
  synchronizer: SessionSynchronizer,
  signal: AbortSignal,
): Promise<SessionState> {
  const server = synchronizer.getServer();
  const token = synchronizer.getToken();
  if (!server || !token) return currentSessionState(synchronizer);
  const identity = synchronizer.captureIdentity();
  if (identity.serverBaseUrl !== server.baseUrl || identity.token !== token) throw sessionChanged();

  const preferredWorkspaceId = synchronizer.getWorkspaceId();
  const options = appBootstrapQueryOptions(
    {
      getAppBootstrap: (_preferredWorkspaceId, requestSignal) =>
        synchronizer.readAppBootstrap(server.baseUrl, _preferredWorkspaceId, requestSignal),
    },
    preferredWorkspaceId,
  );
  const cancel = () => {
    void synchronizer.queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
  };
  signal.addEventListener("abort", cancel, { once: true });

  try {
    const bootstrap = await synchronizer.queryClient.fetchQuery(options);
    signal.throwIfAborted();
    if (!synchronizer.identityIsCurrent(identity)) throw sessionChanged();

    if (!bootstrap.authenticated) {
      const cleared = await synchronizer.clearToken(identity);
      if (!cleared) throw sessionChanged();
      return currentSessionState(synchronizer);
    }

    const selectedWorkspaceId = confirmedBootstrapWorkspaceId(bootstrap);
    const workspaceCommitted = await synchronizer.commitWorkspaceId(selectedWorkspaceId, identity);
    if (!workspaceCommitted) {
      throw sessionChanged();
    }

    signal.throwIfAborted();
    const committedIdentity = synchronizer.captureIdentity();
    if (
      committedIdentity.serverBaseUrl !== identity.serverBaseUrl ||
      committedIdentity.serverMutationRevision !== identity.serverMutationRevision ||
      committedIdentity.token !== identity.token ||
      committedIdentity.tokenMutationRevision !== identity.tokenMutationRevision ||
      committedIdentity.workspaceId !== selectedWorkspaceId ||
      !synchronizer.identityIsCurrent(committedIdentity)
    ) {
      throw sessionChanged();
    }
    seedAppBootstrap(synchronizer.queryClient, bootstrap);
    return currentSessionState(synchronizer);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function sessionChanged(): DOMException {
  return new DOMException("The signed-in session changed", "AbortError");
}

function currentSessionState(loaders: {
  getServer: () => unknown;
  getToken: () => string | null;
  getWorkspaceId: () => string | null;
}): SessionState {
  const serverReady = Boolean(loaders.getServer());
  const signedIn = Boolean(serverReady && loaders.getToken());
  return {
    serverReady,
    signedIn,
    workspaceId: signedIn ? loaders.getWorkspaceId() : null,
  };
}
