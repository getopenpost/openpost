import { api, type Api } from "./api/client";
import {
  createAppBootstrapReader,
  type AppBootstrapCapabilityMemory,
  type AppBootstrapTransport,
} from "./app-bootstrap-reader";
import { mobileQueryTransportRequest } from "./query-api";

const processCapabilities: AppBootstrapCapabilityMemory = new Map();

export const readAppBootstrap = createAppBootstrapReader(
  () => createOpenApiBootstrapTransport(api()),
  processCapabilities,
);

function createOpenApiBootstrapTransport(requestApi: Api): AppBootstrapTransport {
  return {
    getBootstrap: (preferredWorkspaceId, signal) =>
      mobileQueryTransportRequest(signal, (requestSignal) =>
        requestApi.GET("/app/bootstrap", {
          signal: requestSignal,
          params: {
            query: preferredWorkspaceId ? { preferred_workspace_id: preferredWorkspaceId } : {},
          },
        }),
      ),
    getCurrentUser: (signal) =>
      mobileQueryTransportRequest(signal, (requestSignal) =>
        requestApi.GET("/auth/me", { signal: requestSignal }),
      ),
    listWorkspaces: (signal) =>
      mobileQueryTransportRequest(signal, (requestSignal) =>
        requestApi.GET("/workspaces", { signal: requestSignal }),
      ),
    getWorkspaceSettings: (workspaceId, signal) =>
      mobileQueryTransportRequest(signal, (requestSignal) =>
        requestApi.GET("/workspaces/{id}/settings", {
          signal: requestSignal,
          params: { path: { id: workspaceId } },
        }),
      ),
  };
}
