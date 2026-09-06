import type { VideoProjectQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createVideoProjectQueryAPI(transport: QueryTransport): VideoProjectQueryAPI {
	return {
		async listVideoProjects(workspaceId, includeTrash, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Cloud Video Projects',
				request: (requestSignal) =>
					transport.GET('/video-projects', {
						params: { query: { workspace_id: workspaceId, include_trash: includeTrash } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getVideoProject(workspaceId, projectId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Cloud Video Project',
				request: (requestSignal) =>
					transport.GET('/video-projects/{id}', {
						params: { path: { id: projectId }, query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listVideoProjectRevisions(workspaceId, projectId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Cloud Video Project history',
				request: (requestSignal) =>
					transport.GET('/video-projects/{id}/revisions', {
						params: { path: { id: projectId }, query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listVideoProjectConflicts(workspaceId, projectId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Cloud Video Project conflicts',
				request: (requestSignal) =>
					transport.GET('/video-projects/{id}/conflicts', {
						params: { path: { id: projectId }, query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listVideoProjectAssets(workspaceId, projectId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Cloud Video Project assets',
				request: (requestSignal) =>
					transport.GET('/video-projects/{id}/assets', {
						params: { path: { id: projectId }, query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const videoProjectQueryAPI = createVideoProjectQueryAPI(client);
