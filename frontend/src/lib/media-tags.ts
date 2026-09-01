import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { mediaQueryKeys, mediaTagsQueryOptions, type MediaTagList } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { mediaQueryAPI } from '$lib/query/media';

export type MediaTag = components['schemas']['MediaTagResponse'];

export interface MediaTagState {
	tags: MediaTag[];
	canEdit: boolean;
}

export async function listMediaTags(workspaceId: string): Promise<MediaTagState> {
	const data = await queryClient.query(mediaTagsQueryOptions(mediaQueryAPI, workspaceId));
	return {
		tags: data.tags ?? [],
		canEdit: Boolean(data.can_edit)
	};
}

export async function createMediaTag(workspaceId: string, name: string): Promise<MediaTag> {
	const { data, error } = await client.POST('/media/tags', {
		body: { workspace_id: workspaceId, name }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not create the tag.');
	queryClient.setQueryData<MediaTagList>(mediaQueryKeys.tags(workspaceId), (current) => {
		if (!current) return current;
		return { ...current, tags: [...(current.tags ?? []), data] };
	});
	await invalidateMediaTags(workspaceId);
	return data;
}

export async function updateMediaTag(
	workspaceId: string,
	id: string,
	name: string
): Promise<MediaTag> {
	const { data, error } = await client.PATCH('/media/tags/{id}', {
		params: { path: { id } },
		body: { name }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not update the tag.');
	queryClient.setQueryData<MediaTagList>(mediaQueryKeys.tags(workspaceId), (current) => {
		if (!current) return current;
		return {
			...current,
			tags: (current.tags ?? []).map((tag) => (tag.id === data.id ? data : tag))
		};
	});
	await invalidateMediaTags(workspaceId);
	return data;
}

export async function deleteMediaTag(workspaceId: string, id: string): Promise<void> {
	const { error } = await client.DELETE('/media/tags/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(error.detail || 'Could not delete the tag.');
	queryClient.setQueryData<MediaTagList>(mediaQueryKeys.tags(workspaceId), (current) => {
		if (!current) return current;
		return { ...current, tags: (current.tags ?? []).filter((tag) => tag.id !== id) };
	});
	await queryClient.invalidateQueries({
		queryKey: mediaQueryKeys.lists(workspaceId),
		refetchType: 'none'
	});
}

export async function updateMediaTagItems(
	workspaceId: string,
	tagId: string,
	mediaIds: string[],
	mode: 'add' | 'remove' | 'replace' = 'add'
): Promise<number> {
	const { data, error } = await client.PUT('/media/tags/{id}/items', {
		params: { path: { id: tagId } },
		body: { media_ids: mediaIds, mode }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not update media tags.');
	await queryClient.invalidateQueries({
		queryKey: mediaQueryKeys.tags(workspaceId),
		exact: true,
		refetchType: 'active'
	});
	await queryClient.invalidateQueries({
		queryKey: mediaQueryKeys.lists(workspaceId),
		refetchType: 'none'
	});
	return data.count;
}

export function toggleMediaTagSelection(selectedIds: string[], tagId: string): string[] {
	return selectedIds.includes(tagId)
		? selectedIds.filter((id) => id !== tagId)
		: [...selectedIds, tagId];
}

function invalidateMediaTags(workspaceId: string) {
	return queryClient.invalidateQueries({
		queryKey: mediaQueryKeys.tags(workspaceId),
		exact: true,
		refetchType: 'none'
	});
}
