import { QueryClient } from "@tanstack/query-core";
import { expect, it, vi } from "vitest";
import {
  workflowRunQueryOptions,
  workflowRunsQueryOptions,
  workflowQueryKeys,
  type WorkflowQueryAPI,
  type WorkflowRun,
} from "./workflows";

function run(revision: number, state: string): WorkflowRun {
  return {
    id: "run",
    workspace_id: "workspace-a",
    workflow_id: "workflow",
    workflow_name: "Audit",
    workflow_revision: 1,
    revision,
    mode: "live",
    state,
    definition: { schema: 1, source: { kind: "manual" }, steps: [] },
    source: {},
    steps: [],
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:01:00Z",
  };
}
function api(initial: WorkflowRun): WorkflowQueryAPI {
  return {
    list: vi.fn(),
    get: vi.fn(),
    connections: vi.fn(),
    runs: vi.fn(async () => [initial]),
    run: vi.fn(async () => initial),
  };
}
it("reconciles selected run revisions into both owning lists without changing another Workspace", async () => {
  const client = new QueryClient();
  const queued = run(1, "queued");
  const transport = api(queued);
  const workflowList = workflowQueryKeys.runs("workspace-a", "workflow");
  const allList = workflowQueryKeys.runs("workspace-a");
  const otherList = workflowQueryKeys.runs("workspace-b", "workflow");
  await client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a", "workflow"));
  await client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a"));
  client.setQueryData(otherList, [queued]);
  const waiting = run(2, "waiting");
  vi.mocked(transport.run).mockResolvedValue(waiting);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([waiting]);
  expect(client.getQueryData(allList)).toEqual([waiting]);
  expect(client.getQueryData(otherList)).toEqual([queued]);
  const approved = run(3, "queued");
  vi.mocked(transport.run).mockResolvedValue(approved);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([approved]);
  expect(client.getQueryData(allList)).toEqual([approved]);
  const running = run(3, "running");
  vi.mocked(transport.run).mockResolvedValue(running);
  await client.fetchQuery({
    ...workflowRunQueryOptions(transport, "workspace-a", "run"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowList)).toEqual([running]);
  client.clear();
});
it("does not regress newer detail from a late list but accepts a newer authoritative list", async () => {
  const client = new QueryClient();
  const transport = api(run(1, "queued"));
  let resolveList: (runs: WorkflowRun[]) => void = () => {
    throw new Error("List has not started");
  };
  vi.mocked(transport.runs).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveList = resolve;
      }),
  );
  const pending = client.fetchQuery(workflowRunsQueryOptions(transport, "workspace-a", "workflow"));
  await vi.waitFor(() => expect(transport.runs).toHaveBeenCalledOnce());
  const waiting = run(3, "waiting");
  vi.mocked(transport.run).mockResolvedValue(waiting);
  await client.fetchQuery(workflowRunQueryOptions(transport, "workspace-a", "run"));
  resolveList([run(1, "queued")]);
  expect(await pending).toEqual([waiting]);
  const newer = run(4, "succeeded");
  vi.mocked(transport.runs).mockResolvedValue([newer]);
  await client.fetchQuery({
    ...workflowRunsQueryOptions(transport, "workspace-a", "workflow"),
    staleTime: 0,
  });
  expect(client.getQueryData(workflowQueryKeys.run("workspace-a", "run"))).toEqual(newer);
  vi.mocked(transport.run).mockResolvedValue(run(2, "waiting"));
  expect(
    await client.fetchQuery({
      ...workflowRunQueryOptions(transport, "workspace-a", "run"),
      staleTime: 0,
    }),
  ).toEqual(newer);
  client.clear();
});
