import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

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

interface PendingNotificationRequest {
	token: symbol;
	promise: Promise<NotificationMutationResult>;
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

function errorDetail(error: unknown): string {
	if (typeof error === 'object' && error && 'detail' in error && typeof error.detail === 'string') {
		return error.detail;
	}
	if (error instanceof Error) return error.message;
	return '';
}

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
	private requests = new Map<string, PendingNotificationRequest>();
	private loadMoreTokens = new Map<string, symbol>();
	private mutationVersions = new Map<string, number>();
	private workspaceEpochs = new Map<string, number>();
	private accountEpoch = 0;

	snapshot(workspaceID: string): NotificationInboxSnapshot {
		return this.entries[workspaceID] ?? EMPTY_INBOX;
	}

	clear(workspaceID?: string) {
		if (workspaceID) {
			this.workspaceEpochs.set(workspaceID, this.workspaceEpoch(workspaceID) + 1);
			const { [workspaceID]: _removed, ...remaining } = this.entries;
			this.entries = remaining;
			this.mutationVersions.delete(workspaceID);
			this.requests.delete(workspaceID);
			this.loadMoreTokens.delete(workspaceID);
			return;
		}
		this.accountEpoch++;
		this.entries = {};
		this.requests.clear();
		this.loadMoreTokens.clear();
		this.mutationVersions.clear();
		this.workspaceEpochs.clear();
	}

	async ensureLoaded(workspaceID: string): Promise<NotificationMutationResult> {
		const snapshot = this.snapshot(workspaceID);
		if (snapshot.initialized && !snapshot.error) return { ok: true };
		return this.refresh(workspaceID);
	}

	async refresh(
		workspaceID: string,
		options: { background?: boolean } = {}
	): Promise<NotificationMutationResult> {
		if (!workspaceID) return { ok: false };
		const activeRequest = this.requests.get(workspaceID);
		if (activeRequest) return activeRequest.promise;

		const token = Symbol(workspaceID);
		const request = this.loadFirstPage(
			workspaceID,
			options.background ?? false,
			token,
			this.accountEpoch,
			this.workspaceEpoch(workspaceID)
		).finally(() => {
			if (this.requests.get(workspaceID)?.token === token) this.requests.delete(workspaceID);
		});
		this.requests.set(workspaceID, { token, promise: request });
		return request;
	}

	private async loadFirstPage(
		workspaceID: string,
		background: boolean,
		token: symbol,
		accountEpoch: number,
		workspaceEpoch: number
	): Promise<NotificationMutationResult> {
		const previous = this.snapshot(workspaceID);
		const mutationVersion = this.mutationVersions.get(workspaceID) ?? 0;
		if (!background) {
			this.setSnapshot(workspaceID, { ...previous, loading: true, error: '' });
		}

		try {
			const { data, error } = await client.GET('/notifications', {
				params: { query: { workspace_id: workspaceID, limit: PAGE_SIZE } }
			});
			if (error) throw error;
			if (!this.isRequestCurrent(workspaceID, token, accountEpoch, workspaceEpoch)) {
				return { ok: true };
			}
			if ((this.mutationVersions.get(workspaceID) ?? 0) !== mutationVersion) {
				this.settleFirstPageLoading(workspaceID, token);
				return { ok: true };
			}

			const current = this.snapshot(workspaceID);
			const firstPage = data?.items ?? [];
			const items =
				current.loadedPages > 1
					? deduplicate([...firstPage, ...current.items])
					: deduplicate(firstPage);
			this.setSnapshot(workspaceID, {
				...current,
				items,
				unreadCount: data?.unread_count ?? 0,
				nextCursor: current.loadedPages > 1 ? current.nextCursor : (data?.next_cursor ?? ''),
				initialized: true,
				loading: false,
				error: '',
				loadMoreError: '',
				loadedPages: Math.max(1, current.loadedPages)
			});
			return { ok: true };
		} catch (error) {
			const detail = errorDetail(error);
			if (!this.isRequestCurrent(workspaceID, token, accountEpoch, workspaceEpoch)) {
				return { ok: false, detail };
			}
			const current = this.snapshot(workspaceID);
			if (!background || !current.initialized) {
				this.setSnapshot(workspaceID, { ...current, loading: false, error: detail });
			}
			return { ok: false, detail };
		}
	}

	async loadMore(workspaceID: string): Promise<NotificationMutationResult> {
		const previous = this.snapshot(workspaceID);
		if (!workspaceID || previous.loadingMore || !previous.nextCursor) return { ok: true };
		const cursor = previous.nextCursor;
		const mutationVersion = this.mutationVersions.get(workspaceID) ?? 0;
		const accountEpoch = this.accountEpoch;
		const workspaceEpoch = this.workspaceEpoch(workspaceID);
		const token = Symbol(workspaceID);
		this.loadMoreTokens.set(workspaceID, token);
		this.setSnapshot(workspaceID, { ...previous, loadingMore: true, loadMoreError: '' });

		try {
			const { data, error } = await client.GET('/notifications', {
				params: { query: { workspace_id: workspaceID, cursor, limit: PAGE_SIZE } }
			});
			if (error) throw error;
			if (!this.isLoadMoreCurrent(workspaceID, token, accountEpoch, workspaceEpoch)) {
				return { ok: true };
			}
			if ((this.mutationVersions.get(workspaceID) ?? 0) !== mutationVersion) {
				this.settleLoadMore(workspaceID, token);
				return { ok: true };
			}

			const current = this.snapshot(workspaceID);
			this.setSnapshot(workspaceID, {
				...current,
				items: deduplicate([...current.items, ...(data?.items ?? [])]),
				unreadCount: data?.unread_count ?? current.unreadCount,
				nextCursor: data?.next_cursor ?? '',
				loadingMore: false,
				loadMoreError: '',
				loadedPages: current.loadedPages + 1
			});
			return { ok: true };
		} catch (error) {
			const detail = errorDetail(error);
			if (!this.isLoadMoreCurrent(workspaceID, token, accountEpoch, workspaceEpoch)) {
				return { ok: false, detail };
			}
			const current = this.snapshot(workspaceID);
			this.setSnapshot(workspaceID, { ...current, loadingMore: false, loadMoreError: detail });
			return { ok: false, detail };
		} finally {
			if (this.loadMoreTokens.get(workspaceID) === token) {
				this.loadMoreTokens.delete(workspaceID);
			}
		}
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
			if (error) throw error;
			if (!this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)) {
				return { ok: false };
			}

			this.advanceMutationVersion(workspaceID);
			const current = this.snapshot(workspaceID);
			const selected = new Set(input.ids ?? []);
			if (input.all || current.items.some((item) => !item.workspace_id && selected.has(item.id))) {
				this.invalidateOtherWorkspaceSnapshots(workspaceID);
			}
			const now = new Date().toISOString();
			let newlyRead = 0;
			const items = current.items.map((item) => {
				if (item.read_at || (!input.all && !selected.has(item.id))) return item;
				newlyRead++;
				return { ...item, read_at: now };
			});
			this.setSnapshot(workspaceID, {
				...current,
				items,
				unreadCount: input.all ? 0 : Math.max(0, current.unreadCount - newlyRead)
			});
			return { ok: true };
		} catch (error) {
			return { ok: false, detail: errorDetail(error) };
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
			if (error) throw error;
			if (!this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)) {
				return { ok: false };
			}

			this.advanceMutationVersion(workspaceID);
			const current = this.snapshot(workspaceID);
			const selected = new Set(input.ids ?? []);
			if (input.all || current.items.some((item) => !item.workspace_id && selected.has(item.id))) {
				this.invalidateOtherWorkspaceSnapshots(workspaceID);
			}
			if (input.all) {
				this.setSnapshot(workspaceID, {
					...current,
					items: [],
					unreadCount: 0,
					nextCursor: '',
					loadMoreError: ''
				});
				return { ok: true };
			}

			const removedUnread = current.items.filter(
				(item) => selected.has(item.id) && !item.read_at
			).length;
			this.setSnapshot(workspaceID, {
				...current,
				items: current.items.filter((item) => !selected.has(item.id)),
				unreadCount: Math.max(0, current.unreadCount - removedUnread)
			});
			return { ok: true };
		} catch (error) {
			return { ok: false, detail: errorDetail(error) };
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
		window.addEventListener('focus', refreshWhenVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', refreshWhenVisible);
		};
	}

	private advanceMutationVersion(workspaceID: string) {
		this.mutationVersions.set(workspaceID, (this.mutationVersions.get(workspaceID) ?? 0) + 1);
	}

	private invalidateOtherWorkspaceSnapshots(workspaceID: string) {
		for (const cachedWorkspaceID of Object.keys(this.entries)) {
			if (cachedWorkspaceID !== workspaceID) this.clear(cachedWorkspaceID);
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

	private isRequestCurrent(
		workspaceID: string,
		token: symbol,
		accountEpoch: number,
		workspaceEpoch: number
	): boolean {
		return (
			this.requests.get(workspaceID)?.token === token &&
			this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)
		);
	}

	private isLoadMoreCurrent(
		workspaceID: string,
		token: symbol,
		accountEpoch: number,
		workspaceEpoch: number
	): boolean {
		return (
			this.loadMoreTokens.get(workspaceID) === token &&
			this.isScopeCurrent(workspaceID, accountEpoch, workspaceEpoch)
		);
	}

	private settleFirstPageLoading(workspaceID: string, token: symbol) {
		if (this.requests.get(workspaceID)?.token !== token || !this.entries[workspaceID]) return;
		const current = this.snapshot(workspaceID);
		this.setSnapshot(workspaceID, { ...current, loading: false });
	}

	private settleLoadMore(workspaceID: string, token: symbol) {
		if (this.loadMoreTokens.get(workspaceID) !== token || !this.entries[workspaceID]) return;
		const current = this.snapshot(workspaceID);
		this.setSnapshot(workspaceID, { ...current, loadingMore: false });
	}

	private setSnapshot(workspaceID: string, snapshot: NotificationInboxSnapshot) {
		this.entries = { ...this.entries, [workspaceID]: snapshot };
	}
}

export const notificationInbox = new NotificationInboxStore();
