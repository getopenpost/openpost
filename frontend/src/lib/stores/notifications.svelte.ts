import {
	isNotificationInboxQueryKey,
	notificationInboxQueryOptions,
	notificationQueryKeys,
	type NotificationPage,
	type NotificationQueryAPI
} from '@openpost/query-catalog';
import { InfiniteQueryObserver, type InfiniteData, type QueryClient } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { notificationQueryAPI } from '$lib/query/notifications';

export type Notification = components['schemas']['UserNotification'];

export interface NotificationInboxSnapshot {
	items: Notification[];
	unreadCount: number;
	nextCursor: string;
	initialized: boolean;
	loading: boolean;
	loadingMore: boolean;
	error: string;
	loadMoreError: string;
	loadedPages: number;
}

export interface NotificationMutationResult {
	ok: boolean;
	detail?: string;
}

type NotificationInboxData = InfiniteData<NotificationPage, string>;
type NotificationInboxKey = ReturnType<typeof notificationQueryKeys.inbox>;
type NotificationObserver = InfiniteQueryObserver<
	NotificationPage,
	Error,
	NotificationInboxData,
	NotificationInboxKey,
	string
>;

interface NotificationObserverEntry {
	observer: NotificationObserver;
	unsubscribe: () => void;
}

const PAGE_SIZE = 30;
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;

const EMPTY_INBOX: NotificationInboxSnapshot = Object.freeze({
	items: [],
	unreadCount: 0,
	nextCursor: '',
	initialized: false,
	loading: false,
	loadingMore: false,
	error: '',
	loadMoreError: '',
	loadedPages: 0
});

function deduplicate(items: Notification[]): Notification[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

export class NotificationInboxStore {
	private entries = $state.raw<Record<string, NotificationInboxSnapshot>>({});
	private observers = new Map<string, NotificationObserverEntry>();
	private accountEpoch = 0;
	private workspaceEpochs = new Map<string, number>();

	constructor(
		private cache: QueryClient = queryClient,
		private api: NotificationQueryAPI = notificationQueryAPI
	) {}

	snapshot(workspaceID: string): NotificationInboxSnapshot {
		return this.entries[workspaceID] ?? EMPTY_INBOX;
	}

	clear(workspaceID?: string) {
		if (workspaceID) {
			this.workspaceEpochs.set(workspaceID, this.workspaceEpoch(workspaceID) + 1);
			this.destroyObserver(workspaceID);
			this.cache.removeQueries({
				queryKey: notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
				exact: true
			});
			const { [workspaceID]: _removed, ...remaining } = this.entries;
			this.entries = remaining;
			return;
		}

		this.accountEpoch++;
		for (const cachedWorkspaceID of this.observers.keys()) {
			this.destroyObserver(cachedWorkspaceID);
		}
		this.cache.removeQueries({ predicate: (query) => isNotificationInboxQueryKey(query.queryKey) });
		this.entries = {};
		this.workspaceEpochs.clear();
	}

	async ensureLoaded(workspaceID: string): Promise<NotificationMutationResult> {
		if (!workspaceID) return { ok: false };
		const observer = this.observerFor(workspaceID);
		if (this.snapshot(workspaceID).initialized) return { ok: true };
		const result = observer.getCurrentResult();
		if (result.isError) return { ok: false, detail: errorMessage(result.error) };
		return this.settleQuery(observer.refetch());
	}

	async refresh(
		workspaceID: string,
		_options: { background?: boolean } = {}
	): Promise<NotificationMutationResult> {
		if (!workspaceID) return { ok: false };
		return this.settleQuery(this.observerFor(workspaceID).refetch());
	}

	async loadMore(workspaceID: string): Promise<NotificationMutationResult> {
		if (!workspaceID || !this.snapshot(workspaceID).nextCursor) return { ok: true };
		return this.settleQuery(this.observerFor(workspaceID).fetchNextPage());
	}

	async markRead(
		workspaceID: string,
		input: { ids?: string[]; all?: boolean }
	): Promise<NotificationMutationResult> {
		if (!workspaceID) return { ok: false };
		const accountEpoch = this.accountEpoch;
		const workspaceEpoch = this.workspaceEpoch(workspaceID);
		try {
			const { error } = await client.POST('/notifications/read', {
				body: { workspace_id: workspaceID, ids: input.ids, all: input.all }
			});
			if (error) throw new Error(error.detail ?? '');
			if (!this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)) {
				return { ok: false };
			}

			await this.cache.cancelQueries({
				queryKey: notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
				exact: true
			});
			const selected = new Set(input.ids ?? []);
			const currentItems = this.snapshot(workspaceID).items;
			if (input.all || currentItems.some((item) => !item.workspace_id && selected.has(item.id))) {
				this.invalidateOtherWorkspaceInboxes(workspaceID);
			}
			const now = new Date().toISOString();
			this.updateInbox(workspaceID, (data) => {
				let newlyRead = 0;
				const changedIDs = new Set<string>();
				const pages = data.pages.map((page) => ({
					...page,
					items: (page.items ?? []).map((item) => {
						if (item.read_at || (!input.all && !selected.has(item.id))) return item;
						if (!changedIDs.has(item.id)) newlyRead++;
						changedIDs.add(item.id);
						return { ...item, read_at: now };
					})
				}));
				const unreadCount = input.all ? 0 : Math.max(0, (pages[0]?.unread_count ?? 0) - newlyRead);
				return {
					...data,
					pages: pages.map((page) => ({ ...page, unread_count: unreadCount }))
				};
			});
			void this.cache.invalidateQueries({
				queryKey: notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
				exact: true,
				refetchType: 'none'
			});
			return { ok: true };
		} catch (cause) {
			return { ok: false, detail: errorMessage(cause) };
		}
	}

	async deleteNotifications(
		workspaceID: string,
		input: { ids?: string[]; all?: boolean }
	): Promise<NotificationMutationResult> {
		if (!workspaceID) return { ok: false };
		const accountEpoch = this.accountEpoch;
		const workspaceEpoch = this.workspaceEpoch(workspaceID);
		try {
			const { error } = await client.POST('/notifications/delete', {
				body: { workspace_id: workspaceID, ids: input.ids, all: input.all }
			});
			if (error) throw new Error(error.detail ?? '');
			if (!this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)) {
				return { ok: false };
			}

			await this.cache.cancelQueries({
				queryKey: notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
				exact: true
			});
			const selected = new Set(input.ids ?? []);
			const currentItems = this.snapshot(workspaceID).items;
			if (input.all || currentItems.some((item) => !item.workspace_id && selected.has(item.id))) {
				this.invalidateOtherWorkspaceInboxes(workspaceID);
			}
			this.updateInbox(workspaceID, (data) => {
				const removedUnreadIDs = new Set<string>();
				for (const page of data.pages) {
					for (const item of page.items ?? []) {
						if (selected.has(item.id) && !item.read_at) removedUnreadIDs.add(item.id);
					}
				}
				const unreadCount = input.all
					? 0
					: Math.max(0, (data.pages[0]?.unread_count ?? 0) - removedUnreadIDs.size);
				return {
					...data,
					pages: data.pages.map((page) => ({
						...page,
						items: input.all ? [] : (page.items ?? []).filter((item) => !selected.has(item.id)),
						unread_count: unreadCount,
						next_cursor: input.all ? '' : page.next_cursor
					}))
				};
			});
			void this.cache.invalidateQueries({
				queryKey: notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
				exact: true,
				refetchType: 'none'
			});
			return { ok: true };
		} catch (cause) {
			return { ok: false, detail: errorMessage(cause) };
		}
	}

	startAutoRefresh(
		workspaceID: string,
		intervalMilliseconds = NOTIFICATION_POLL_INTERVAL_MS
	): () => void {
		if (typeof window === 'undefined' || !workspaceID) return () => undefined;
		const refreshWhenVisible = () => {
			if (typeof document === 'undefined' || document.visibilityState === 'visible') {
				void this.refresh(workspaceID, { background: true });
			}
		};
		const interval = window.setInterval(refreshWhenVisible, intervalMilliseconds);
		return () => {
			window.clearInterval(interval);
		};
	}

	private observerFor(workspaceID: string): NotificationObserver {
		for (const cachedWorkspaceID of this.observers.keys()) {
			if (cachedWorkspaceID !== workspaceID) this.destroyObserver(cachedWorkspaceID);
		}
		const existing = this.observers.get(workspaceID);
		if (existing) return existing.observer;

		const observer = new InfiniteQueryObserver<
			NotificationPage,
			Error,
			NotificationInboxData,
			NotificationInboxKey,
			string
		>(this.cache, notificationInboxQueryOptions(this.api, workspaceID, PAGE_SIZE));
		const updateSnapshot = (result: ReturnType<NotificationObserver['getCurrentResult']>) => {
			const pages = result.data?.pages ?? [];
			const hasData = pages.length > 0;
			const lastPage = pages.at(-1);
			this.setSnapshot(workspaceID, {
				items: deduplicate(pages.flatMap((page) => page.items ?? [])),
				unreadCount: pages[0]?.unread_count ?? 0,
				nextCursor: lastPage?.next_cursor ?? '',
				initialized: hasData,
				loading: result.isFetching && !result.isFetchingNextPage,
				loadingMore: result.isFetchingNextPage,
				error: result.isError && !result.isFetchNextPageError ? errorMessage(result.error) : '',
				loadMoreError: result.isFetchNextPageError ? errorMessage(result.error) : '',
				loadedPages: pages.length
			});
		};
		const unsubscribe = observer.subscribe(updateSnapshot);
		updateSnapshot(observer.getCurrentResult());
		this.observers.set(workspaceID, { observer, unsubscribe });
		return observer;
	}

	private destroyObserver(workspaceID: string) {
		const entry = this.observers.get(workspaceID);
		if (!entry) return;
		entry.unsubscribe();
		entry.observer.destroy();
		this.observers.delete(workspaceID);
	}

	private async settleQuery(
		request: Promise<{ isError: boolean; error: Error | null }>
	): Promise<NotificationMutationResult> {
		try {
			const result = await request;
			return result.isError ? { ok: false, detail: errorMessage(result.error) } : { ok: true };
		} catch (cause) {
			return { ok: false, detail: errorMessage(cause) };
		}
	}

	private updateInbox(
		workspaceID: string,
		updater: (data: NotificationInboxData) => NotificationInboxData
	) {
		const data = this.cache.setQueryData<NotificationInboxData>(
			notificationQueryKeys.inbox(workspaceID, PAGE_SIZE),
			(data) => (data ? updater(data) : data)
		);
		if (!data || this.observers.has(workspaceID)) return;
		const pages = data.pages;
		this.setSnapshot(workspaceID, {
			items: deduplicate(pages.flatMap((page) => page.items ?? [])),
			unreadCount: pages[0]?.unread_count ?? 0,
			nextCursor: pages.at(-1)?.next_cursor ?? '',
			initialized: pages.length > 0,
			loading: false,
			loadingMore: false,
			error: '',
			loadMoreError: '',
			loadedPages: pages.length
		});
	}

	private invalidateOtherWorkspaceInboxes(workspaceID: string) {
		for (const query of this.cache.getQueryCache().getAll()) {
			if (!isNotificationInboxQueryKey(query.queryKey) || query.queryKey[3] === workspaceID) {
				continue;
			}
			const siblingWorkspaceID = query.queryKey[3];
			this.destroyObserver(siblingWorkspaceID);
			this.cache.removeQueries({ queryKey: query.queryKey, exact: true });
			const { [siblingWorkspaceID]: _removed, ...remaining } = this.entries;
			this.entries = remaining;
		}
	}

	private workspaceEpoch(workspaceID: string): number {
		return this.workspaceEpochs.get(workspaceID) ?? 0;
	}

	private isScopeCurrent(
		workspaceID: string,
		accountEpoch: number,
		workspaceEpoch: number
	): boolean {
		return (
			this.accountEpoch === accountEpoch && this.workspaceEpoch(workspaceID) === workspaceEpoch
		);
	}

	private setSnapshot(workspaceID: string, snapshot: NotificationInboxSnapshot) {
		this.entries = { ...this.entries, [workspaceID]: snapshot };
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : '';
}

export const notificationInbox = new NotificationInboxStore();
