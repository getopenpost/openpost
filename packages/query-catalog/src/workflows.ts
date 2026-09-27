import type { components } from "@openpost/api-contract";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type Workflow = components["schemas"]["Workflow"];
export type WorkflowRun = components["schemas"]["WorkflowRun"];
export type WorkflowConnection = components["schemas"]["WorkflowConnection"];
export interface WorkflowQueryAPI {
  list(workspaceID: string, signal: AbortSignal): Promise<Workflow[]>;
  get(workspaceID: string, id: string, signal: AbortSignal): Promise<Workflow>;
  runs(workspaceID: string, workflowID: string, signal: AbortSignal): Promise<WorkflowRun[]>;
  run(workspaceID: string, id: string, signal: AbortSignal): Promise<WorkflowRun>;
  connections(workspaceID: string, signal: AbortSignal): Promise<WorkflowConnection[]>;
}
export const workflowQueryKeys = {
  all: (ws: string) => openPostWorkspaceKey(ws, "workflows"),
  list: (ws: string) => openPostWorkspaceKey(ws, "workflows", "list"),
  detail: (ws: string, id: string) => openPostWorkspaceKey(ws, "workflows", "detail", id),
  runs: (ws: string, id = "") => openPostWorkspaceKey(ws, "workflows", "runs", id),
  run: (ws: string, id: string) => openPostWorkspaceKey(ws, "workflows", "run", id),
  connections: (ws: string) => openPostWorkspaceKey(ws, "workflows", "connections"),
};
export function workflowsQueryOptions(api: WorkflowQueryAPI, ws: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.list(ws),
    enabled: Boolean(ws),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.list(ws, signal),
  };
}
export function workflowQueryOptions(api: WorkflowQueryAPI, ws: string, id: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.detail(ws, id),
    enabled: Boolean(ws && id),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get(ws, id, signal),
  };
}
export function workflowRunsQueryOptions(api: WorkflowQueryAPI, ws: string, id = "") {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.runs(ws, id),
    enabled: Boolean(ws),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.runs(ws, id, signal),
    refetchInterval: 15000,
  };
}
export function workflowRunQueryOptions(api: WorkflowQueryAPI, ws: string, id: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.run(ws, id),
    enabled: Boolean(ws && id),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.run(ws, id, signal),
  };
}
export function workflowConnectionsQueryOptions(api: WorkflowQueryAPI, ws: string) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: workflowQueryKeys.connections(ws),
    enabled: Boolean(ws),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.connections(ws, signal),
  };
}
