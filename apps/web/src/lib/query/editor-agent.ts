import {
	editorAssistantStatusQueryOptions,
	editorPreferencesQueryOptions
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from './client';
import { queryGET } from './transport';

export function queryEditorPreferences(
	workspaceId: string,
	projectId: string,
	kind: 'video' | 'image',
	context = ''
) {
	return queryClient.query(
		editorPreferencesQueryOptions(
			{
				getPreferences: async (signal) => {
					const { data } = await queryGET({
						signal,
						fallback: 'Could not load editor preferences',
						request: (requestSignal) =>
							client.GET('/editor-agent/preferences', {
								params: {
									query: {
										workspace_id: workspaceId,
										project_id: projectId,
										editor_kind: kind,
										context
									}
								},
								signal: requestSignal
							})
					});
					return data;
				}
			},
			workspaceId,
			projectId,
			kind,
			context
		)
	);
}

export function editorAssistantStatusOptions(workspaceId: string, fallback: string) {
	return editorAssistantStatusQueryOptions(
		{
			getStatus: async (querySignal) => {
				const { data } = await queryGET({
					signal: querySignal,
					fallback,
					request: (requestSignal) =>
						client.GET('/editor-agent/assistant/status', {
							params: { query: { workspace_id: workspaceId } },
							signal: requestSignal
						})
				});
				return data;
			}
		},
		workspaceId
	);
}
