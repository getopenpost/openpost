import { api, type Api } from "./api/client";
import {
  createAppBootstrapReader,
  type AppBootstrapCapabilityMemory,
  type AppBootstrapTransport,
} from "./app-bootstrap-reader";

const processCapabilities: AppBootstrapCapabilityMemory = new Map();

export const readAppBootstrap = createAppBootstrapReader(
  () => createOpenApiBootstrapTransport(api()),
  processCapabilities,
);

function createOpenApiBootstrapTransport(requestApi: Api): AppBootstrapTransport {
  return {
    getBootstrap: (preferredWorkspaceId, signal) =>
      requestApi.GET("/app/bootstrap", {
        signal,
        params: {
          query: preferredWorkspaceId ? { preferred_workspace_id: preferredWorkspaceId } : {},
        },
      }),
    getCurrentUser: (signal) => requestApi.GET("/auth/me", { signal }),
    listWorkspaces: (signal) => requestApi.GET("/workspaces", { signal }),
    getWorkspaceSettings: (workspaceId, signal) =>
      requestApi.GET("/workspaces/{id}/settings", {
        signal,
        params: { path: { id: workspaceId } },
      }),
  };
}
