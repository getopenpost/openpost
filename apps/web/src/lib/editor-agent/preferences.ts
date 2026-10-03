import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { editorPreferencesQueryOptions, editorPreferencesQueryKeys } from '@openpost/query-catalog';

export type EditorPreferences = components['schemas']['Context'];
export type EditorPreference = components['schemas']['Preference'];
export type EditorStyle = components['schemas']['Style'];
export type EditorStyleDefinition = components['schemas']['StyleDefinition'];

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
					const { data, error } = await client.GET('/editor-agent/preferences', {
						params: {
							query: {
								workspace_id: workspaceId,
								project_id: projectId,
								editor_kind: kind,
								context
							}
						},
						signal
					});
					if (error || !data) throw new Error(error?.detail || 'Could not load editor preferences');
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
export async function saveEditorPreference(
	workspaceId: string,
	preference: EditorPreference,
	expectedRevision = 0
) {
	const { data, error } = await client.POST('/editor-agent/preferences', {
		body: { workspace_id: workspaceId, preference, expected_revision: expectedRevision }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not save preference');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
	return data;
}
export async function removeEditorPreference(workspaceId: string, preference: EditorPreference) {
	const { error } = await client.DELETE('/editor-agent/preferences/{id}', {
		params: {
			path: { id: preference.id! },
			query: {
				workspace_id: workspaceId,
				project_id: preference.project_id,
				expected_revision: preference.revision!
			}
		}
	});
	if (error) throw new Error(error.detail || 'Could not forget preference');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
}
export async function setEditorLearning(
	workspaceId: string,
	change: { enabled: boolean; reset?: boolean; projectId?: string }
) {
	const { error } = await client.POST('/editor-agent/learning', {
		body: {
			workspace_id: workspaceId,
			enabled: change.enabled,
			reset: change.reset ?? false,
			project_id: change.projectId
		}
	});
	if (error) throw new Error(error.detail || 'Could not change learning');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
}
export async function recordEditorChoice(
	workspaceId: string,
	projectId: string,
	entryId: string,
	entryName: string,
	kind: 'video' | 'image',
	context = ''
) {
	const { error } = await client.POST('/editor-agent/choices', {
		body: {
			workspace_id: workspaceId,
			project_id: projectId,
			entry_id: entryId,
			entry_name: entryName,
			editor_kind: kind,
			context
		}
	});
	if (error) throw new Error(error.detail || 'Could not record library choice');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
}
export async function syncEditorFavorite(
	workspaceId: string,
	entryId: string,
	entryName: string,
	kind: 'video' | 'image',
	options: { favorite: boolean; deviceLocal: boolean }
) {
	const { error } = await client.POST('/editor-agent/favorites', {
		body: {
			workspace_id: workspaceId,
			favorite: {
				entry_id: entryId,
				entry_name: entryName,
				editor_kind: kind,
				favorite: options.favorite,
				device_local: options.deviceLocal
			}
		}
	});
	if (error) throw new Error(error.detail || 'Could not sync favorite');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
}

export async function archiveEditorStyle(workspaceId: string, style: EditorStyle, archived = true) {
	const { error } = await client.POST('/editor-agent/styles/{id}/archive', {
		params: { path: { id: style.id! } },
		body: { workspace_id: workspaceId, expected_version: style.version!, archived }
	});
	if (error) throw new Error(error.detail || 'Could not change saved style');
	await queryClient.invalidateQueries({
		queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
	});
}
