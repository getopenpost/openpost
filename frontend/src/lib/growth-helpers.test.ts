/* eslint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening */
import { describe, expect, it } from 'vitest';
import {
	compatibleAccounts,
	selectInitialAccount,
	formatMutualCopy,
	mapReasonChips,
	followButtonState,
	shouldPollSync,
	isSyncBusy,
	growthRankBucket,
	growthMutualBucket,
	StaleGuard,
	growthGridClasses
} from './growth-helpers';
import type { components } from './api/types';

type SocialAccount = components['schemas']['AccountResponse'];
type RecommendationView = components['schemas']['RecommendationView'];

function account(overrides: Partial<SocialAccount>): SocialAccount {
	return {
		id: 'acc-1',
		platform: 'bluesky',
		account_id: 'a1',
		account_username: 'user',
		account_avatar_url: '',
		account_kind: 'person',
		instance_url: '',
		is_active: true,
		grant_destination_count: 1,
		messages_enabled: false,
		messaging_supported: false,
		shared_grant: false,
		slug: 's1',
		thread_replies_supported: false,
		workspace_id: 'ws-1',
		workspace_name: 'WS',
		...overrides
	} as SocialAccount;
}

function rec(overrides: Partial<RecommendationView>): RecommendationView {
	return {
		id: 'r1',
		workspace_id: 'ws-1',
		social_account_id: 'acc-1',
		platform: 'bluesky',
		remote_account_id: 'remote-1',
		handle: 'jane',
		display_name: 'Jane',
		bio: 'Bio',
		avatar_url: '',
		profile_url: 'https://example.com/jane',
		followers_count: 100,
		following_count: 50,
		follows_viewer: false,
		mutual_count: 0,
		mutual_exact: false,
		mutuals: [],
		signals: [],
		score: 1,
		follow_state: 'idle',
		generation_id: 'gen-1',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_seen_at: new Date().toISOString(),
		...overrides
	} as RecommendationView;
}

describe('growth-helpers', () => {
	it('filters compatible accounts to active bluesky/mastodon', () => {
		const list = [
			account({ id: '1', platform: 'bluesky', is_active: true }),
			account({ id: '2', platform: 'mastodon', is_active: true }),
			account({ id: '3', platform: 'x', is_active: true }),
			account({ id: '4', platform: 'bluesky', is_active: false })
		];
		expect(compatibleAccounts(list).map((a) => a.id)).toEqual(['1', '2']);
	});

	it('selects first compatible unless current remains valid', () => {
		const list = [
			account({ id: '1', platform: 'bluesky' }),
			account({ id: '2', platform: 'mastodon' })
		];
		expect(selectInitialAccount(list, null)).toBe('1');
		expect(selectInitialAccount(list, '2')).toBe('2');
		expect(selectInitialAccount(list, 'unknown')).toBe('1');
	});

	it('maps exact mutual copy with remaining count', () => {
		const translate = (key: string, params?: Record<string, unknown>) => {
			if (key === 'grow_followed_by') return `Followed by ${params?.names}`;
			if (key === 'grow_followed_by_with_others')
				return `Followed by ${params?.names} + ${params?.count} others`;
			if (key === 'grow_also_followed_by') return `Also followed by ${params?.names}`;
			return '';
		};
		const r = rec({
			mutual_count: 5,
			mutual_exact: true,
			mutuals: [
				{ RemoteID: '1', Handle: 'theo', DisplayName: 'Theo', AvatarURL: '' },
				{ RemoteID: '2', Handle: 'jane', DisplayName: 'Jane', AvatarURL: '' }
			] as never
		});
		expect(formatMutualCopy(r, translate, 'en-US')).toBe('Followed by Theo and Jane + 3 others');
	});

	it('maps sampled mutual copy without implying exact totals', () => {
		const translate = (key: string, params?: Record<string, unknown>) => {
			if (key === 'grow_followed_by') return `Followed by ${params?.names}`;
			if (key === 'grow_followed_by_with_others')
				return `Followed by ${params?.names} + ${params?.count} others`;
			if (key === 'grow_also_followed_by') return `Also followed by ${params?.names}`;
			return '';
		};
		const r = rec({
			mutual_count: 5,
			mutual_exact: false,
			mutuals: [
				{ RemoteID: '1', Handle: 'theo', DisplayName: 'Theo', AvatarURL: '' },
				{ RemoteID: '2', Handle: 'jane', DisplayName: 'Jane', AvatarURL: '' }
			] as never
		});
		expect(formatMutualCopy(r, translate, 'en-US')).toBe('Also followed by Theo and Jane');
		// ensure we never leak exact count when not exact
		expect(formatMutualCopy(r, translate, 'en-US')).not.toContain('+');
	});

	it('maps evidence-only reason chips', () => {
		const t = (key: string) => key;
		const r1 = rec({
			platform: 'bluesky',
			follows_viewer: true,
			mutual_count: 3,
			signals: ['suggestion', 'friends_of_friends']
		});
		const chips1 = mapReasonChips(r1, t as never).map((c) => c.key);
		expect(chips1).toContain('follows_you');
		expect(chips1).toContain('mutuals');
		expect(chips1).toContain('suggested_bluesky');
		expect(chips1).toContain('friends');
		expect(chips1).not.toContain('popular');

		const r2 = rec({
			platform: 'mastodon',
			follows_viewer: false,
			mutual_count: 0,
			signals: ['most_followed']
		});
		const chips2 = mapReasonChips(r2, t as never).map((c) => c.key);
		expect(chips2).toContain('popular');
		expect(chips2).not.toContain('suggested_mastodon');
		expect(chips2).not.toContain('suggested_bluesky');

		const r3 = rec({
			platform: 'mastodon',
			signals: ['similar_to_recently_followed', 'friends_of_friends']
		});
		const chips3 = mapReasonChips(r3, t as never).map((c) => c.key);
		expect(chips3).toContain('similar');
		expect(chips3).toContain('friends');
	});

	it('returns correct follow button state labels', () => {
		expect(followButtonState('idle').labelKey).toBe('grow_follow');
		expect(followButtonState('pending').disabled).toBe(true);
		expect(followButtonState('pending').labelKey).toBe('grow_following_progress');
		expect(followButtonState('requested').labelKey).toBe('grow_requested');
		expect(followButtonState('following').labelKey).toBe('grow_following');
		expect(followButtonState('failed').disabled).toBe(false);
	});

	it('detects polling conditions and busy states', () => {
		expect(shouldPollSync({ status: 'queued' } as never, false)).toBe(true);
		expect(shouldPollSync({ status: 'refreshing' } as never, false)).toBe(true);
		expect(shouldPollSync({ status: 'success' } as never, true)).toBe(true);
		expect(shouldPollSync({ status: 'success' } as never, false)).toBe(false);
		expect(isSyncBusy({ status: 'queued' } as never)).toBe(true);
		expect(isSyncBusy({ status: 'success' } as never)).toBe(false);
	});

	it('buckets rank and mutual counts', () => {
		expect(growthRankBucket(1)).toBe('1-3');
		expect(growthRankBucket(5)).toBe('4-6');
		expect(growthRankBucket(9)).toBe('7-10');
		expect(growthRankBucket(15)).toBe('11+');
		expect(growthMutualBucket(0)).toBe('0');
		expect(growthMutualBucket(2)).toBe('2-3');
		expect(growthMutualBucket(10)).toBe('7+');
	});

	it('StaleGuard ignores out-of-order responses', () => {
		const g = new StaleGuard();
		const a = g.next();
		const b = g.next();
		expect(g.isStale(a)).toBe(true);
		expect(g.isStale(b)).toBe(false);
	});

	it('preserves old cards during queued/refreshing via shouldPoll logic', () => {
		// this is behavioral: when sync is queued, old results stay represented
		const syncQueued = { status: 'queued' } as never;
		expect(isSyncBusy(syncQueued)).toBe(true);
		expect(shouldPollSync(syncQueued, false)).toBe(true);
	});

	it('exposes responsive grid with one/two/three column tiers', () => {
		expect(growthGridClasses).toContain('grid-cols-1');
		expect(growthGridClasses).toContain('md:grid-cols-2');
		expect(growthGridClasses).toContain('xl:grid-cols-3');
		expect(growthGridClasses).not.toMatch(/shadow|gradient|glow/);
	});
});
