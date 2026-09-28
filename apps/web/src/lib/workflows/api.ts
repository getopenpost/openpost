import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import {
	captureQueryMutationSession,
	settleQueryMutationSession
} from '$lib/query/authorization-boundary';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { workflowQueryKeys } from '@openpost/query-catalog';
import { m } from '$lib/paraglide/messages';
export type Workflow = components['schemas']['Workflow'];
export type Definition = components['schemas']['WorkflowDefinition'];
export type Step = components['schemas']['WorkflowStep'];
export type Value = components['schemas']['WorkflowValue'];
export type Run = components['schemas']['WorkflowRun'];
export type Source = components['schemas']['WorkflowSource'];
export type Connection = components['schemas']['WorkflowConnection'];
export type WorkflowData = components['schemas']['WorkflowNodeTestRequest']['data'];
export type Save = components['schemas']['WorkflowSaveRequest'];

async function mutation<T>(
	ws: string,
	request: () => Promise<{ data?: T; error?: { detail?: string }; response: Response }>
): Promise<T> {
	const session = captureQueryMutationSession();
	const result = await request();
	if (
		!settleQueryMutationSession(session, result.response) ||
		workspaceCtx.currentWorkspace?.id !== ws
	)
		throw new DOMException('Workspace changed', 'AbortError');
	if (result.error || !result.data)
		throw new Error(result.error?.detail || m.workflows_operation_failed());
	void queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all(ws) });
	return result.data;
}
export function saveWorkflow(ws: string, id: string, body: Save) {
	return mutation(ws, () =>
		id
			? client.PUT('/workflows/{id}', {
					params: { query: { workspace_id: ws }, path: { id } },
					body
				})
			: client.POST('/workflows', { params: { query: { workspace_id: ws } }, body })
	);
}
export function publishWorkflow(ws: string, id: string, revision: number) {
	return mutation(ws, () =>
		client.POST('/workflows/{id}/publish', {
			params: { query: { workspace_id: ws }, path: { id } },
			body: { expected_revision: revision }
		})
	);
}
export function pauseWorkflow(ws: string, id: string, revision: number) {
	return mutation(ws, () =>
		client.POST('/workflows/{id}/pause', {
			params: { query: { workspace_id: ws }, path: { id } },
			body: { expected_revision: revision }
		})
	);
}
export function startRun(
	ws: string,
	id: string,
	revision: number,
	mode: 'preview' | 'live',
	source: components['schemas']['WorkflowStartInputBody']['source']
) {
	return mutation(ws, () =>
		client.POST('/workflows/{id}/runs', {
			params: { query: { workspace_id: ws }, path: { id } },
			body: { expected_revision: revision, mode, source }
		})
	);
}
export function cancelRun(ws: string, run: Run) {
	return mutation(ws, () =>
		client.POST('/workflow-runs/{id}/cancel', {
			params: { query: { workspace_id: ws }, path: { id: run.id } },
			body: { expected_revision: run.revision }
		})
	);
}
export function approveRun(ws: string, run: Run, revision: number) {
	return mutation(ws, () =>
		client.POST('/workflow-runs/{id}/approve', {
			params: { query: { workspace_id: ws }, path: { id: run.id } },
			body: { expected_revision: run.revision, publication_revision: revision }
		})
	);
}
export function sampleSource(ws: string, source: Source) {
	return mutation(ws, () =>
		client.POST('/workflow-sources/sample', {
			params: { query: { workspace_id: ws } },
			body: source
		})
	);
}
export function createConnection(
	ws: string,
	name: string,
	token: string,
	options: Omit<components['schemas']['WorkflowCredentialRequest'], 'name' | 'token'> = {}
) {
	return mutation(ws, () =>
		client.POST('/workflow-connections', {
			params: { query: { workspace_id: ws } },
			body: { name, token, ...options }
		})
	);
}
export function deleteWorkflow(ws: string, id: string) {
	return mutation(ws, () =>
		client.DELETE('/workflows/{id}', { params: { query: { workspace_id: ws }, path: { id } } })
	);
}

export function deleteConnection(ws: string, id: string) {
	return mutation(ws, () =>
		client.DELETE('/workflow-connections/{id}', {
			params: { query: { workspace_id: ws }, path: { id } }
		})
	);
}

export function rotateConnection(ws: string, id: string, token: string) {
	return mutation(ws, () =>
		client.PUT('/workflow-connections/{id}', {
			params: { query: { workspace_id: ws }, path: { id } },
			body: { token }
		})
	);
}

export function testNode(
	ws: string,
	id: string,
	revision: number,
	stepID: string,
	data: WorkflowData
) {
	return mutation(ws, () =>
		client.POST('/workflows/{id}/test-node', {
			params: { query: { workspace_id: ws }, path: { id } },
			body: { expected_revision: revision, step_id: stepID, data }
		})
	);
}
