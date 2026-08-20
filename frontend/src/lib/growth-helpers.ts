/* eslint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */
import type { components } from '$lib/api/types';
import { getPlatformKey } from '$lib/utils';

export type RecommendationView = components['schemas']['RecommendationView'];
export type SyncStateView = components['schemas']['SyncStateView'];
export type SocialAccount = components['schemas']['AccountResponse'];

export function isCompatibleAccount(account: SocialAccount): boolean {
	if (!account.is_active) return false;
	const key = getPlatformKey(account.platform);
	return key === 'bluesky' || key === 'mastodon';
}

export function compatibleAccounts(accounts: SocialAccount[]): SocialAccount[] {
	return accounts.filter(isCompatibleAccount);
}

export function selectInitialAccount(
	accounts: SocialAccount[],
	currentID?: string | null
): string | null {
	const compatible = compatibleAccounts(accounts);
	if (compatible.length === 0) return null;
	if (currentID) {
		const stillValid = compatible.find((a) => a.id === currentID);
		if (stillValid) return stillValid.id;
	}
	return compatible[0].id;
}

export function getAccountByID(accounts: SocialAccount[], id: string): SocialAccount | undefined {
	return accounts.find((a) => a.id === id);
}

export function formatCount(value: number, locale = 'en-US'): string {
	return new Intl.NumberFormat(locale).format(value);
}

export function formatLastUpdated(dateStr: string | null | undefined, locale = 'en-US'): string {
	if (!dateStr) return '';
	try {
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return '';
		return new Intl.DateTimeFormat(locale, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(d);
	} catch {
		return '';
	}
}

export function shouldPollSync(
	syncState: SyncStateView | null | undefined,
	hasPendingFollow: boolean
): boolean {
	if (hasPendingFollow) return true;
	if (!syncState) return false;
	const s = syncState.status;
	return s === 'queued' || s === 'refreshing';
}

export function isSyncBusy(syncState: SyncStateView | null | undefined): boolean {
	if (!syncState) return false;
	return syncState.status === 'queued' || syncState.status === 'refreshing';
}

export function isSyncOk(syncState: SyncStateView | null | undefined): boolean {
	return syncState?.status === 'ok';
}

export const canonicalSyncStatuses = [
	'idle',
	'queued',
	'refreshing',
	'ok',
	'permission_required',
	'rate_limited',
	'temporarily_unavailable',
	'failed'
] as const;

export type CanonicalSyncStatus = (typeof canonicalSyncStatuses)[number];

export function isCanonicalSyncStatus(status: string): status is CanonicalSyncStatus {
	return (canonicalSyncStatuses as readonly string[]).includes(status);
}

export function syncErrorKind(
	syncState: SyncStateView | null | undefined
): 'rate_limited' | 'auth' | 'failed' | null {
	if (!syncState) return null;
	const code = (syncState.error_code ?? '').toLowerCase();
	const status = syncState.status;
	if (code.includes('rate') || status === 'rate_limited' || code.includes('429'))
		return 'rate_limited';
	if (
		code.includes('auth') ||
		status === 'permission_required' ||
		code.includes('permission') ||
		code.includes('unauthorized') ||
		code.includes('forbidden')
	)
		return 'auth';
	if (status === 'failed' || status === 'temporarily_unavailable' || code) return 'failed';
	return null;
}

export function growthRankBucket(position: number): string {
	if (position <= 3) return '1-3';
	if (position <= 6) return '4-6';
	if (position <= 10) return '7-10';
	return '11+';
}

export function growthMutualBucket(count: number): string {
	if (count === 0) return '0';
	if (count === 1) return '1';
	if (count <= 3) return '2-3';
	if (count <= 6) return '4-6';
	return '7+';
}

export interface ReasonChip {
	key: string;
	label: string;
}

export function mapReasonChips(
	rec: RecommendationView,
	translate: (key: string, params?: Record<string, unknown>) => string
): ReasonChip[] {
	const chips: ReasonChip[] = [];
	const platformKey = getPlatformKey(rec.platform);
	const signals = rec.signals ?? [];

	if (rec.follows_viewer) {
		chips.push({ key: 'follows_you', label: translate('grow_reason_follows_you') });
	}
	if (rec.mutual_count > 0) {
		chips.push({
			key: 'mutuals',
			label: translate('grow_reason_mutuals', { count: rec.mutual_count })
		});
	}

	const hasSuggestion = signals.includes('suggestion');
	const hasFriends = signals.includes('friends_of_friends');
	const hasSimilar = signals.includes('similar_to_recently_followed');
	const hasPopular = signals.includes('most_followed');

	if (hasSuggestion && platformKey === 'bluesky') {
		chips.push({ key: 'suggested_bluesky', label: translate('grow_reason_suggested_bluesky') });
	} else if (hasSuggestion && platformKey === 'mastodon') {
		chips.push({ key: 'suggested_mastodon', label: translate('grow_reason_suggested_mastodon') });
	}

	if (hasSimilar) {
		chips.push({ key: 'similar', label: translate('grow_reason_similar') });
	}
	if (hasFriends) {
		chips.push({ key: 'friends', label: translate('grow_reason_friends') });
	}
	if (hasPopular && platformKey === 'mastodon') {
		chips.push({ key: 'popular', label: translate('grow_reason_popular') });
	}

	return chips;
}

export function formatMutualCopy(
	rec: RecommendationView,
	translate: (key: string, params?: Record<string, unknown>) => string,
	locale = 'en-US'
): string | null {
	const mutuals = rec.mutuals ?? [];
	if (mutuals.length === 0 || rec.mutual_count === 0) return null;

	const names = mutuals
		.slice(0, 3)
		.map((m) => m.DisplayName || m.Handle || m.RemoteID)
		.filter(Boolean);
	if (names.length === 0) return null;

	const formatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
	const namesJoined = formatter.format(names);

	if (rec.mutual_exact) {
		if (rec.mutual_count > names.length) {
			const remaining = rec.mutual_count - names.length;
			return translate('grow_followed_by_with_others', { names: namesJoined, count: remaining });
		}
		return translate('grow_followed_by', { names: namesJoined });
	} else {
		return translate('grow_also_followed_by', { names: namesJoined });
	}
}

export function followButtonState(followState: string): {
	labelKey: string;
	disabled: boolean;
	variant: 'default' | 'secondary' | 'outline';
} {
	switch (followState) {
		case 'pending':
			return { labelKey: 'grow_following_progress', disabled: true, variant: 'secondary' };
		case 'requested':
			return { labelKey: 'grow_requested', disabled: true, variant: 'secondary' };
		case 'following':
			return { labelKey: 'grow_following', disabled: true, variant: 'secondary' };
		case 'failed':
			return { labelKey: 'grow_follow', disabled: false, variant: 'default' };
		default:
			return { labelKey: 'grow_follow', disabled: false, variant: 'default' };
	}
}

export const growthGridClasses = 'grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

export class StaleGuard {
	private seq = 0;
	next(): number {
		this.seq += 1;
		return this.seq;
	}
	isStale(seq: number): boolean {
		return seq !== this.seq;
	}
	current(): number {
		return this.seq;
	}
}

export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function terminalRemovalDelay(): number {
	return prefersReducedMotion() ? 0 : 1200;
}
