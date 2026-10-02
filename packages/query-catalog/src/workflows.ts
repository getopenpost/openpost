import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";
import { throwIfAborted } from "./caller-abort";
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
  const queryKey = workflowQueryKeys.runs(ws, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(ws),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const runs = await api.runs(ws, id, signal);
      throwIfAborted(signal);
      return runs.map((run) => reconcileWorkflowRun(client, ws, run));
    },
    refetchInterval: 15000,
  };
}
export function workflowRunQueryOptions(api: WorkflowQueryAPI, ws: string, id: string) {
  const queryKey = workflowQueryKeys.run(ws, id);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(ws && id),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const run = await api.run(ws, id, signal);
      throwIfAborted(signal);
      return reconcileWorkflowRun(client, ws, run);
    },
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

function reconcileWorkflowRun(client: QueryClient, workspaceID: string, incoming: WorkflowRun) {
  if (incoming.workspace_id !== workspaceID) return incoming;
  const detailKey = workflowQueryKeys.run(workspaceID, incoming.id);
  const current = client.getQueryData<WorkflowRun>(detailKey);
  // Durable state/step writes increment revision. Equal-revision reads remain authoritative, including lease acquisition changing queued to running.
  const run =
    current?.workspace_id === workspaceID &&
    current.workflow_id === incoming.workflow_id &&
    current.revision > incoming.revision
      ? current
      : incoming;
  client.setQueryData(detailKey, run);
  for (const key of [
    workflowQueryKeys.runs(workspaceID),
    workflowQueryKeys.runs(workspaceID, run.workflow_id),
  ]) {
    client.setQueryData<WorkflowRun[]>(key, (runs) =>
      runs?.map((listed) =>
        listed.id === run.id &&
        listed.workspace_id === workspaceID &&
        listed.workflow_id === run.workflow_id &&
        listed.revision <= run.revision
          ? run
          : listed,
      ),
    );
  }
  return run;
}
