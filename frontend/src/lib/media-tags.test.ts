import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaQueryKeys, type MediaTagList } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';
import {
	createMediaTag,
	MediaTagWorkspaceMismatchError,
	updateMediaTag,
	updateMediaTagItems,
	type MediaTag
} from './media-tags';

const mocks = { post: vi.fn(), patch: vi.fn(), put: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);
vi.spyOn(client, 'PATCH').mockImplementation(mocks.patch);
vi.spyOn(client, 'PUT').mockImplementation(mocks.put);

describe('media tag mutations', () => {
	beforeEach(() => {
		queryClient.clear();
		mocks.post.mockReset();
		mocks.patch.mockReset();
		mocks.put.mockReset();
	});

	afterEach(() => {
		registerQueryAuthorizationBoundary(undefined);
	});

	it('creates a tag through the API after cancelling a stale tag read', async () => {
		const queryKey = mediaQueryKeys.tags('workspace-1');
		let readSignal: AbortSignal | undefined;
		const staleRead = queryClient
			.fetchQuery({
				queryKey,
				queryFn: async ({ signal }) => {
					readSignal = signal;
					await new Promise<void>((resolve) => {
						signal.addEventListener('abort', () => resolve(), { once: true });
					});
					return tagList(tagFixture('tag-stale', 'Stale'));
				}
			})
			.catch(() => undefined);
		await vi.waitFor(() => expect(readSignal).toBeInstanceOf(AbortSignal));
		const created = tagFixture('tag-new', 'Launch');
		mocks.post.mockResolvedValue({
			data: created,
			response: new Response(null, { status: 201 })
		});

		await expect(createMediaTag('workspace-1', 'Launch')).resolves.toEqual(created);
		await staleRead;

		expect(mocks.post).toHaveBeenCalledWith('/media/tags', {
			body: { workspace_id: 'workspace-1', name: 'Launch' }
		});
		expect(readSignal?.aborted).toBe(true);
		expect(queryClient.getQueryData<MediaTagList>(queryKey)?.tags).toEqual([created]);
		expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
	});

	it('updates a tag and invalidates tag and media caches after item assignment', async () => {
		const tagKey = mediaQueryKeys.tags('workspace-1');
		const mediaKey = mediaQueryKeys.list('workspace-1', {});
		const original = tagFixture('tag-1', 'Before');
		const updated = tagFixture('tag-1', 'After');
		queryClient.setQueryData(tagKey, tagList(original));
		queryClient.setQueryData(mediaKey, { media: [], total: 0 });
		mocks.patch.mockResolvedValue({
			data: updated,
			response: new Response(null, { status: 200 })
		});
		mocks.put.mockResolvedValue({
			data: { count: 1 },
			response: new Response(null, { status: 200 })
		});

		await updateMediaTag('workspace-1', 'tag-1', 'After');
		await expect(updateMediaTagItems('workspace-1', 'tag-1', ['media-1'], 'replace')).resolves.toBe(
			1
		);

		expect(mocks.patch).toHaveBeenCalledWith('/media/tags/{id}', {
			params: { path: { id: 'tag-1' } },
			body: { name: 'After' }
		});
		expect(mocks.put).toHaveBeenCalledWith('/media/tags/{id}/items', {
			params: { path: { id: 'tag-1' } },
			body: { media_ids: ['media-1'], mode: 'replace' }
		});
		expect(queryClient.getQueryData<MediaTagList>(tagKey)?.tags).toEqual([updated]);
		expect(queryClient.getQueryState(tagKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(mediaKey)?.isInvalidated).toBe(true);
	});

	it('rejects a tag response from another Workspace without changing the cache', async () => {
		const queryKey = mediaQueryKeys.tags('workspace-1');
		const original = tagFixture('tag-1', 'Before');
		queryClient.setQueryData(queryKey, tagList(original));
		mocks.post.mockResolvedValue({
			data: { ...tagFixture('tag-2', 'Wrong'), workspace_id: 'workspace-2' },
			response: new Response(null, { status: 201 })
		});

		await expect(createMediaTag('workspace-1', 'Wrong')).rejects.toBeInstanceOf(
			MediaTagWorkspaceMismatchError
		);
		expect(queryClient.getQueryData<MediaTagList>(queryKey)?.tags).toEqual([original]);
	});
});

function tagFixture(id: string, name: string): MediaTag {
	return {
		id,
		workspace_id: 'workspace-1',
		name,
		item_count: 0,
		created_at: '2026-09-01T10:00:00Z'
	};
}

function tagList(...tags: MediaTag[]): MediaTagList {
	return { tags, can_edit: true };
}
