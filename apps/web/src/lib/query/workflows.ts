import type { WorkflowQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';
import { m } from '$lib/paraglide/messages';
export const workflowQueryAPI: WorkflowQueryAPI = {
	async list(ws, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/workflows', { params: { query: { workspace_id: ws } }, signal })
		});
		return data ?? [];
	},
	async get(ws, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/workflows/{id}', {
					params: { query: { workspace_id: ws }, path: { id } },
					signal
				})
		});
		return data;
	},
	async runs(ws, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/workflow-runs', {
					params: { query: { workspace_id: ws, workflow_id: id } },
					signal
				})
		});
		return data ?? [];
	},
	async run(ws, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/workflow-runs/{id}', {
					params: { query: { workspace_id: ws }, path: { id } },
					signal
				})
		});
		return data;
	},
	async connections(ws, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/workflow-connections', { params: { query: { workspace_id: ws } }, signal })
		});
		return data ?? [];
	}
};
