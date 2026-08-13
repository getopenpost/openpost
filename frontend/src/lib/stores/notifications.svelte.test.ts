import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from './notifications.svelte';
import { NotificationInboxStore } from './notifications.svelte';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		POST: mocks.post
	}
}));

function notification(index: number, workspaceID = 'workspace-a'): Notification {
	return {
		id: `notification-${index.toString().padStart(3, '0')}`,
		user_id: 'user-1',
		workspace_id: workspaceID,
		type: index % 2 === 0 ? 'post_published' : 'publish_failed',
		title: `Notification ${index}`,
		body: `Body ${index}`,
		href: '/activity',
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
		mocks.get.mockReset();
		mocks.post.mockReset();
	});

	it('keeps one reactive cache per workspace for the bell and feed to share', async () => {
		mocks.get.mockImplementation(async (_path, request) => {
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
		const store = new NotificationInboxStore();

		await Promise.all([store.ensureLoaded('workspace-a'), store.ensureLoaded('workspace-a')]);
		await store.ensureLoaded('workspace-b');

		expect(mocks.get).toHaveBeenCalledTimes(2);
		expect(store.snapshot('workspace-a').unreadCount).toBe(1);
		expect(store.snapshot('workspace-a').items[0]?.workspace_id).toBe('workspace-a');
		expect(store.snapshot('workspace-b').unreadCount).toBe(7);
		expect(store.snapshot('workspace-b').items[0]?.workspace_id).toBe('workspace-b');
	});

	it('keeps unread truth on a failed open and decrements only once after retry', async () => {
		mocks.get.mockResolvedValue({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		mocks.post
			.mockResolvedValueOnce({ error: { detail: 'Forced failure' } })
			.mockResolvedValueOnce({ error: null })
			.mockResolvedValueOnce({ error: null });
		const store = new NotificationInboxStore();
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
		mocks.get.mockImplementation(async (_path, request) => {
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
		const store = new NotificationInboxStore();
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
		expect(mocks.get).toHaveBeenCalledTimes(3);
	});

	it('retries the same failed cursor and reaches more than one hundred items without duplicates', async () => {
		const items = Array.from({ length: 125 }, (_, index) => notification(index));
		let cursorFailure = true;
		mocks.get.mockImplementation(async (_path, request) => {
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
		const store = new NotificationInboxStore();
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
			mocks.get.mock.calls.filter(([, request]) => request.params.query.cursor === '30')
		).toHaveLength(2);
	});

	it('merges server arrivals into the shared cache during a background refresh', async () => {
		const first = notification(1);
		const arrival = notification(0);
		mocks.get
			.mockResolvedValueOnce({
				data: { items: [first], unread_count: 1, next_cursor: '' },
				error: null
			})
			.mockResolvedValueOnce({
				data: { items: [arrival, first], unread_count: 2, next_cursor: '' },
				error: null
			});
		const store = new NotificationInboxStore();
		await store.ensureLoaded('workspace-a');
		await store.refresh('workspace-a', { background: true });

		expect(store.snapshot('workspace-a').items.map((item) => item.id)).toEqual([
			arrival.id,
			first.id
		]);
		expect(store.snapshot('workspace-a').unreadCount).toBe(2);
	});

	it('settles a refresh discarded after a concurrent mutation without restoring stale unread state', async () => {
		const item = notification(1);
		const staleRefresh = deferred<{
			data: { items: Notification[]; unread_count: number; next_cursor: string };
			error: null;
		}>();
		mocks.get
			.mockResolvedValueOnce({
				data: { items: [item], unread_count: 1, next_cursor: '' },
				error: null
			})
			.mockReturnValueOnce(staleRefresh.promise);
		mocks.post.mockResolvedValue({ error: null });
		const store = new NotificationInboxStore();
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
		mocks.get
			.mockResolvedValueOnce({
				data: { items: [first], unread_count: 1, next_cursor: 'next' },
				error: null
			})
			.mockReturnValueOnce(staleNextPage.promise);
		mocks.post.mockResolvedValue({ error: null });
		const store = new NotificationInboxStore();
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
		mocks.get.mockReturnValueOnce(oldAccount.promise).mockReturnValueOnce(newAccount.promise);
		const store = new NotificationInboxStore();

		const oldLoad = store.ensureLoaded('workspace-a');
		store.clear();
		const newLoad = store.ensureLoaded('workspace-a');
		expect(mocks.get).toHaveBeenCalledTimes(2);

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
		mocks.get.mockResolvedValue({
			data: { items: [notification(1)], unread_count: 1, next_cursor: '' },
			error: null
		});
		const mutation = deferred<{ error: null }>();
		mocks.post.mockReturnValueOnce(mutation.promise);
		const store = new NotificationInboxStore();
		await store.ensureLoaded('workspace-a');

		const markingRead = store.markRead('workspace-a', { ids: [notification(1).id] });
		store.clear();
		mutation.resolve({ error: null });
		expect(await markingRead).toEqual({ ok: false });

		expect(store.snapshot('workspace-a').initialized).toBe(false);
		expect(store.snapshot('workspace-a').items).toEqual([]);
	});
});
