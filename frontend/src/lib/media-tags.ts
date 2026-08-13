import { client } from '$lib/api/client';

export interface MediaTag {
	id: string;
	workspace_id: string;
	name: string;
	item_count: number;
	created_at?: string;
}

export interface MediaTagState {
	tags: MediaTag[];
	canEdit: boolean;
}

export async function listMediaTags(workspaceId: string): Promise<MediaTagState> {
	const { data, error } = await client.GET('/media/tags', {
		params: { query: { workspace_id: workspaceId } }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not load media tags.');
	return {
		tags: (data.tags ?? []) as MediaTag[],
		canEdit: Boolean(data.can_edit)
	};
}

export async function createMediaTag(workspaceId: string, name: string): Promise<MediaTag> {
	const { data, error } = await client.POST('/media/tags', {
		body: { workspace_id: workspaceId, name }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not create the tag.');
	return data as MediaTag;
}

export async function updateMediaTag(id: string, name: string): Promise<MediaTag> {
	const { data, error } = await client.PATCH('/media/tags/{id}', {
		params: { path: { id } },
		body: { name }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not update the tag.');
	return data as MediaTag;
}

export async function deleteMediaTag(id: string): Promise<void> {
	const { error } = await client.DELETE('/media/tags/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(error.detail || 'Could not delete the tag.');
}

export async function updateMediaTagItems(
	tagId: string,
	mediaIds: string[],
	mode: 'add' | 'remove' | 'replace' = 'add'
): Promise<number> {
	const { data, error } = await client.PUT('/media/tags/{id}/items', {
		params: { path: { id: tagId } },
		body: { media_ids: mediaIds, mode }
	});
	if (error || !data) throw new Error(error?.detail || 'Could not update media tags.');
	return data.count;
}

export function toggleMediaTagSelection(selectedIds: string[], tagId: string): string[] {
	return selectedIds.includes(tagId)
		? selectedIds.filter((id) => id !== tagId)
		: [...selectedIds, tagId];
}
