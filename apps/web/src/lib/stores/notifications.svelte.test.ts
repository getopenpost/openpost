import {
	notificationQueryKeys,
	openPostQueryDefaults,
	type NotificationQueryAPI
} from '@openpost/query-catalog';
import { focusManager, QueryClient } from '@tanstack/svelte-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import type { Notification } from './notifications.svelte';
import { NotificationInboxStore } from './notifications.svelte';

const mocks = { list: vi.fn(), post: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

const queryAPI: NotificationQueryAPI = {
	async getQueueReminderSettings() {
		throw new Error('not used by notification inbox tests');
	},
	async listNotifications(workspaceID, limit, cursor, signal) {
		const result = await mocks.list('/notifications', {
			params: { query: { workspace_id: workspaceID, limit, cursor: cursor || undefined } },
			signal
		});
		if (result.error || !result.data) throw new Error(result.error?.detail ?? 'load failed');
		return result.data;
	},
	async getNotificationPreferences() {
		throw new Error('not used by notification inbox tests');
	}
};

function createStore() {
	return new NotificationInboxStore(
		new QueryClient({ defaultOptions: openPostQueryDefaults }),
		queryAPI
	);
}

function notification(index: number, workspaceID = 'workspace-a'): Notification {
	return {
		id: `notification-${index.toString().padStart(3, '0')}`,
		user_id: 'user-1',
		workspace_id: workspaceID,
		type: index % 2 === 0 ? 'post_published' : 'publish_failed',
		title: `Notification ${index}`,
		body: `Body ${index}`,
		href: '/publications',
		payload_json: '{}',
		read_at: '',
		created_at: new Date(Date.UTC(2026, 7, 9, 12, 0, 0) - index * 60_000).toISOString()
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('notification inbox store', () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.post.mockReset();
	});

	it('keeps one reactive cache per workspace for the bell and feed to share', async () => {
		mocks.list.mockImplementation(async (_path, request) => {
			const workspaceID = request.params.query.workspace_id;
			return {
				data: {
					items: [notification(workspaceID === 'workspace-a' ? 1 : 2, workspaceID)],
					unread_count: workspaceID === 'workspace-a' ? 1 : 7,
					next_cursor: ''
				},
				error: null
			};
		});
		const store = createStore();

		await Promise.all([store.ensureLoaded('workspace-a'), store.ensureLoaded('workspace-a')]);
		await store.ensureLoaded('workspace-b');
		await store.ensureLoaded('workspace-a');

		expect(mocks.list).toHaveBeenCalledTimes(2);
		expect(store.snapshot('workspace-a').unreadCount).toBe(1);
		expect(store.snapshot('workspace-a').items[0]?.workspace_id).toBe('workspace-a');
		expect(store.snapshot('workspace-b').unreadCount).toBe(7);
		expect(store.snapshot('workspace-b').items[0]?.workspace_id).toBe('workspace-b');
	});

	it('keeps unread truth on a failed open and decrements only once after retry', async () => {
		mocks.list.mockResolvedValue({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		mocks.post
			.mockResolvedValueOnce({ error: { detail: 'Forced failure' } })
			.mockResolvedValueOnce({ error: null })
			.mockResolvedValueOnce({ error: null });
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		const failed = await store.markRead('workspace-a', { ids: ['notification-001'] });
		expect(failed).toEqual({ ok: false, detail: 'Forced failure' });
		expect(store.snapshot('workspace-a').unreadCount).toBe(1);
		expect(store.snapshot('workspace-a').items[0]?.read_at).toBe('');

		expect(await store.markRead('workspace-a', { ids: ['notification-001'] })).toEqual({
			ok: true
		});
		expect(store.snapshot('workspace-a').unreadCount).toBe(0);
		expect(store.snapshot('workspace-a').items[0]?.read_at).not.toBe('');

		await store.markRead('workspace-a', { ids: ['notification-001'] });
		expect(store.snapshot('workspace-a').unreadCount).toBe(0);
	});

	it('invalidates sibling workspace caches after an account-wide bulk mutation', async () => {
		let accountWidePresent = true;
		mocks.list.mockImplementation(async (_path, request) => {
			const workspaceID = request.params.query.workspace_id;
			const items = [notification(workspaceID === 'workspace-a' ? 1 : 2, workspaceID)];
			if (accountWidePresent) items.push(notification(3, ''));
			return {
				data: { items, unread_count: items.length, next_cursor: '' },
				error: null
			};
		});
		mocks.post.mockImplementation(async () => {
			accountWidePresent = false;
			return { error: null };
		});
		const store = createStore();
		await store.ensureLoaded('workspace-a');
		await store.ensureLoaded('workspace-b');

		expect(store.snapshot('workspace-b').items).toHaveLength(2);
		expect(await store.deleteNotifications('workspace-a', { all: true })).toEqual({ ok: true });
		expect(store.snapshot('workspace-a').items).toEqual([]);
		expect(store.snapshot('workspace-b').initialized).toBe(false);

		await store.ensureLoaded('workspace-b');
		expect(store.snapshot('workspace-b').items.map((item) => item.workspace_id)).toEqual([
			'workspace-b'
		]);
		expect(mocks.list).toHaveBeenCalledTimes(3);
	});

	it('retries the same failed cursor and reaches more than one hundred items without duplicates', async () => {
		const items = Array.from({ length: 125 }, (_, index) => notification(index));
		let cursorFailure = true;
		mocks.list.mockImplementation(async (_path, request) => {
			const cursor = request.params.query.cursor ?? '0';
			if (cursor === '30' && cursorFailure) {
				cursorFailure = false;
				return { error: { detail: 'Cursor unavailable' } };
			}
			const offset = Number(cursor);
			const pageItems = items.slice(offset, offset + 30);
			const nextOffset = offset + pageItems.length;
			return {
				data: {
					items: pageItems,
					unread_count: items.length,
					next_cursor: nextOffset < items.length ? String(nextOffset) : ''
				},
				error: null
			};
		});
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		const failed = await store.loadMore('workspace-a');
		expect(failed).toEqual({ ok: false, detail: 'Cursor unavailable' });
		expect(store.snapshot('workspace-a').items).toHaveLength(30);
		expect(store.snapshot('workspace-a').nextCursor).toBe('30');

		while (store.snapshot('workspace-a').nextCursor) {
			expect((await store.loadMore('workspace-a')).ok).toBe(true);
		}
		const loaded = store.snapshot('workspace-a').items;
		expect(loaded).toHaveLength(125);
		expect(new Set(loaded.map((item) => item.id)).size).toBe(125);
		expect(
			mocks.list.mock.calls.filter(([, request]) => request.params.query.cursor === '30')
		).toHaveLength(2);
	});

	it('counts an unread notification once when it overlaps adjacent cursor pages', async () => {
		const overlapping = notification(1);
		const second = notification(2);
		mocks.list.mockImplementation(async (_path, request) =>
			request.params.query.cursor
				? {
						data: {
							items: [overlapping, second],
							unread_count: 2,
							next_cursor: ''
						},
						error: null
					}
				: {
						data: { items: [overlapping], unread_count: 2, next_cursor: 'next' },
						error: null
					}
		);
		mocks.post.mockResolvedValue({ error: null });
		const store = createStore();
		await store.ensureLoaded('workspace-a');
		await store.loadMore('workspace-a');

		expect(store.snapshot('workspace-a').items).toHaveLength(2);
		await store.markRead('workspace-a', { ids: [overlapping.id] });

		expect(store.snapshot('workspace-a').unreadCount).toBe(1);
		expect(
			store.snapshot('workspace-a').items.find((item) => item.id === overlapping.id)?.read_at
		).not.toBe('');
	});

	it('merges server arrivals into the shared cache during a background refresh', async () => {
		const first = notification(1);
		const arrival = notification(0);
		mocks.list
			.mockResolvedValueOnce({
				data: { items: [first], unread_count: 1, next_cursor: '' },
				error: null
			})
			.mockResolvedValueOnce({
				data: { items: [arrival, first], unread_count: 2, next_cursor: '' },
				error: null
			});
		const store = createStore();
		await store.ensureLoaded('workspace-a');
		await store.refresh('workspace-a', { background: true });

		expect(store.snapshot('workspace-a').items.map((item) => item.id)).toEqual([
			arrival.id,
			first.id
		]);
		expect(store.snapshot('workspace-a').unreadCount).toBe(2);
	});

	it('performs one refresh when a mounted query client regains focus', async () => {
		mocks.list.mockResolvedValue({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		const cache = new QueryClient({ defaultOptions: openPostQueryDefaults });
		const store = new NotificationInboxStore(cache, queryAPI);
		cache.mount();
		const stopPolling = store.startAutoRefresh('workspace-a', 60_000);

		try {
			await store.ensureLoaded('workspace-a');
			await cache.invalidateQueries({
				queryKey: notificationQueryKeys.inbox('workspace-a', 30),
				exact: true,
				refetchType: 'none'
			});

			focusManager.setFocused(false);
			focusManager.setFocused(true);
			await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
			window.dispatchEvent(new Event('focus'));
			await Promise.resolve();

			expect(mocks.list).toHaveBeenCalledTimes(2);
		} finally {
			stopPolling();
			store.clear();
			cache.unmount();
			focusManager.setFocused(undefined);
		}
	});

	it('keeps cached notifications visible through a background error and clears it on success', async () => {
		const item = notification(1);
		mocks.list
			.mockResolvedValueOnce({
				data: { items: [item], unread_count: 1, next_cursor: '' },
				error: null
			})
			.mockResolvedValueOnce({ error: { detail: 'Background refresh failed' } })
			.mockResolvedValueOnce({
				data: { items: [item], unread_count: 1, next_cursor: '' },
				error: null
			});
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		expect(await store.refresh('workspace-a', { background: true })).toEqual({
			ok: false,
			detail: 'Background refresh failed'
		});
		expect(store.snapshot('workspace-a')).toMatchObject({
			items: [item],
			initialized: true,
			error: 'Background refresh failed'
		});

		expect(await store.refresh('workspace-a', { background: true })).toEqual({ ok: true });
		expect(store.snapshot('workspace-a')).toMatchObject({ items: [item], error: '' });
	});

	it('keeps a terminal first-load error until an explicit refresh', async () => {
		mocks.list
			.mockResolvedValueOnce({ error: { detail: 'Initial load failed' } })
			.mockResolvedValueOnce({
				data: { items: [], unread_count: 0, next_cursor: '' },
				error: null
			});
		const store = createStore();

		expect(await store.ensureLoaded('workspace-a')).toEqual({
			ok: false,
			detail: 'Initial load failed'
		});
		expect(await store.ensureLoaded('workspace-a')).toEqual({
			ok: false,
			detail: 'Initial load failed'
		});
		expect(mocks.list).toHaveBeenCalledTimes(1);

		expect(await store.refresh('workspace-a')).toEqual({ ok: true });
		expect(mocks.list).toHaveBeenCalledTimes(2);
		expect(store.snapshot('workspace-a')).toMatchObject({ initialized: true, error: '' });
	});

	it('settles a refresh discarded after a concurrent mutation without restoring stale unread state', async () => {
		const item = notification(1);
		const staleRefresh = deferred<{
			data: { items: Notification[]; unread_count: number; next_cursor: string };
			error: null;
		}>();
		mocks.list
			.mockResolvedValueOnce({
				data: { items: [item], unread_count: 1, next_cursor: '' },
				error: null
			})
			.mockReturnValueOnce(staleRefresh.promise);
		mocks.post.mockResolvedValue({ error: null });
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		const refreshing = store.refresh('workspace-a');
		expect(store.snapshot('workspace-a').loading).toBe(true);
		await store.markRead('workspace-a', { ids: [item.id] });
		staleRefresh.resolve({
			data: { items: [item], unread_count: 1, next_cursor: '' },
			error: null
		});
		await refreshing;

		expect(store.snapshot('workspace-a').loading).toBe(false);
		expect(store.snapshot('workspace-a').unreadCount).toBe(0);
		expect(store.snapshot('workspace-a').items[0]?.read_at).not.toBe('');
	});

	it('settles load more after a concurrent mutation and leaves the cursor available to retry', async () => {
		const first = notification(1);
		const staleNextPage = deferred<{
			data: { items: Notification[]; unread_count: number; next_cursor: string };
			error: null;
		}>();
		mocks.list
			.mockResolvedValueOnce({
				data: { items: [first], unread_count: 1, next_cursor: 'next' },
				error: null
			})
			.mockReturnValueOnce(staleNextPage.promise);
		mocks.post.mockResolvedValue({ error: null });
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		const loadingMore = store.loadMore('workspace-a');
		expect(store.snapshot('workspace-a').loadingMore).toBe(true);
		await store.markRead('workspace-a', { ids: [first.id] });
		staleNextPage.resolve({
			data: { items: [notification(2)], unread_count: 1, next_cursor: '' },
			error: null
		});
		await loadingMore;

		expect(store.snapshot('workspace-a').loadingMore).toBe(false);
		expect(store.snapshot('workspace-a').nextCursor).toBe('next');
		expect(store.snapshot('workspace-a').items).toHaveLength(1);
		expect(store.snapshot('workspace-a').unreadCount).toBe(0);
		expect(store.snapshot('workspace-a').items[0]?.read_at).not.toBe('');
	});

	it('does not let an in-flight request repopulate a cache cleared for another account', async () => {
		const oldAccount = deferred<{
			data: { items: Notification[]; unread_count: number; next_cursor: string };
			error: null;
		}>();
		const newAccount = deferred<{
			data: { items: Notification[]; unread_count: number; next_cursor: string };
			error: null;
		}>();
		mocks.list.mockReturnValueOnce(oldAccount.promise).mockReturnValueOnce(newAccount.promise);
		const store = createStore();

		const oldLoad = store.ensureLoaded('workspace-a');
		store.clear();
		const newLoad = store.ensureLoaded('workspace-a');
		expect(mocks.list).toHaveBeenCalledTimes(2);

		newAccount.resolve({
			data: { items: [notification(2)], unread_count: 1, next_cursor: '' },
			error: null
		});
		await newLoad;
		oldAccount.resolve({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		await oldLoad;

		expect(store.snapshot('workspace-a').items.map((item) => item.id)).toEqual([
			notification(2).id
		]);
		expect(store.snapshot('workspace-a').loading).toBe(false);
	});

	it('ignores a mutation response that completes after the account cache is cleared', async () => {
		mocks.list.mockResolvedValue({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		const mutation = deferred<{ error: null }>();
		mocks.post.mockReturnValueOnce(mutation.promise);
		const store = createStore();
		await store.ensureLoaded('workspace-a');

		const markingRead = store.markRead('workspace-a', { ids: [notification(1).id] });
		store.clear();
		mutation.resolve({ error: null });
		expect(await markingRead).toEqual({ ok: false });

		expect(store.snapshot('workspace-a').initialized).toBe(false);
		expect(store.snapshot('workspace-a').items).toEqual([]);
	});
});
