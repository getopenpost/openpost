import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import {
	mediaQueryKeys,
	mediaTagsQueryOptions,
	type MediaListResult,
	type MediaTagList
} from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { mediaQueryAPI } from '$lib/query/media';
import {
	captureQueryMutationSession,
	settleQueryMutationSession,
	type QueryMutationSession
} from '$lib/query/authorization-boundary';
import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';

export type MediaTag = components['schemas']['MediaTagResponse'];

export interface MediaTagState {
	tags: MediaTag[];
	canEdit: boolean;
}

export class MediaTagWorkspaceMismatchError extends Error {
	constructor() {
		super('The media tag response is not in the selected workspace.');
		this.name = 'MediaTagWorkspaceMismatchError';
	}
}

function requireMediaTagWorkspace(tag: MediaTag, workspaceId: string): MediaTag {
	if (tag.workspace_id !== workspaceId) throw new MediaTagWorkspaceMismatchError();
	return tag;
}

function settleMediaTagMutation(
	session: QueryMutationSession,
	response: Pick<Response, 'status'>
): void {
	settleQueryMutationSession(session, response);
}

export async function listMediaTags(workspaceId: string): Promise<MediaTagState> {
	const data = await queryClient.query(mediaTagsQueryOptions(mediaQueryAPI, workspaceId));
	return {
		tags: data.tags ?? [],
		canEdit: Boolean(data.can_edit)
	};
}

export async function createMediaTag(workspaceId: string, name: string): Promise<MediaTag> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/media/tags', {
		body: { workspace_id: workspaceId, name }
	});
	settleMediaTagMutation(session, response);
	if (error || !data) throw new Error(error?.detail || 'Could not create the tag.');
	const tag = requireMediaTagWorkspace(data, workspaceId);
	const queryKey = mediaQueryKeys.tags(workspaceId);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey, exact: true }],
		reconcile: () => {
			queryClient.setQueryData<MediaTagList>(queryKey, (current) => {
				if (!current) return { tags: [tag], can_edit: true };
				const tags = current.tags ?? [];
				return {
					...current,
					tags: tags.some((candidate) => candidate.id === tag.id) ? tags : [...tags, tag]
				};
			});
		},
		invalidate: [{ queryKey, exact: true, refetchType: 'none' }]
	});
	return tag;
}

export async function updateMediaTag(
	workspaceId: string,
	id: string,
	name: string
): Promise<MediaTag> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.PATCH('/media/tags/{id}', {
		params: { path: { id } },
		body: { name }
	});
	settleMediaTagMutation(session, response);
	if (error || !data) throw new Error(error?.detail || 'Could not update the tag.');
	const tag = requireMediaTagWorkspace(data, workspaceId);
	if (tag.id !== id) throw new MediaTagWorkspaceMismatchError();
	const queryKey = mediaQueryKeys.tags(workspaceId);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey, exact: true }],
		reconcile: () => {
			queryClient.setQueryData<MediaTagList>(queryKey, (current) => {
				if (!current) return current;
				return {
					...current,
					tags: (current.tags ?? []).map((candidate) => (candidate.id === tag.id ? tag : candidate))
				};
			});
		},
		invalidate: [{ queryKey, exact: true, refetchType: 'none' }]
	});
	return tag;
}

export async function deleteMediaTag(workspaceId: string, id: string): Promise<void> {
	const session = captureQueryMutationSession();
	const { error, response } = await client.DELETE('/media/tags/{id}', {
		params: { path: { id } }
	});
	settleMediaTagMutation(session, response);
	if (error) throw new Error(error.detail || 'Could not delete the tag.');
	const tagKey = mediaQueryKeys.tags(workspaceId);
	const listKey = mediaQueryKeys.lists(workspaceId);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey: tagKey, exact: true }, { queryKey: listKey }],
		reconcile: () => {
			queryClient.setQueryData<MediaTagList>(tagKey, (current) => {
				if (!current) return current;
				return { ...current, tags: (current.tags ?? []).filter((tag) => tag.id !== id) };
			});
			queryClient.setQueriesData<MediaListResult>({ queryKey: listKey }, (current) => {
				if (!current) return current;
				return {
					...current,
					media: (current.media ?? []).map((item) => ({
						...item,
						tags: (item.tags ?? []).filter((tagID) => tagID !== id)
					}))
				};
			});
		},
		invalidate: [
			{ queryKey: tagKey, exact: true, refetchType: 'none' },
			{ queryKey: listKey, refetchType: 'none' }
		]
	});
}

export async function updateMediaTagItems(
	workspaceId: string,
	tagId: string,
	mediaIds: string[],
	mode: 'add' | 'remove' | 'replace' = 'add'
): Promise<number> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.PUT('/media/tags/{id}/items', {
		params: { path: { id: tagId } },
		body: { media_ids: mediaIds, mode }
	});
	settleMediaTagMutation(session, response);
	if (error || !data) throw new Error(error?.detail || 'Could not update media tags.');
	const tagKey = mediaQueryKeys.tags(workspaceId);
	const listKey = mediaQueryKeys.lists(workspaceId);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey: tagKey, exact: true }, { queryKey: listKey }],
		invalidate: [
			{ queryKey: tagKey, exact: true, refetchType: 'active' },
			{ queryKey: listKey, refetchType: 'none' }
		]
	});
	return data.count;
}

export function toggleMediaTagSelection(selectedIds: string[], tagId: string): string[] {
	return selectedIds.includes(tagId)
		? selectedIds.filter((id) => id !== tagId)
		: [...selectedIds, tagId];
}
