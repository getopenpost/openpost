import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PLATFORM_CHAR_LIMIT,
	accountHasXPremiumLongPosts,
	accountCharacterLimit,
	minimumAccountCharacterLimit,
	uniquePlatformLimits
} from './platform-limits';

describe('platform-limits', () => {
	it('uses canonical limits for known platforms', () => {
		expect(accountCharacterLimit({ platform: 'x' })).toBe(280);
		expect(accountCharacterLimit({ platform: 'mastodon:https://masto.pt' })).toBe(500);
		expect(accountCharacterLimit({ platform: 'linkedin' })).toBe(3000);
	});

	it('keeps X conservative when the account API has no verified premium entitlement', () => {
		expect(accountCharacterLimit({ platform: 'x', limit_profile: 'x-premium' })).toBe(280);
		expect(
			accountCharacterLimit({
				platform: 'x',
				capabilities: ['long_posts']
			})
		).toBe(280);
		expect(
			accountCharacterLimit({
				platform: 'x',
				metadata: { x_premium: true }
			})
		).toBe(280);
	});

	it('does not infer X Premium from fields absent from the account API contract', () => {
		expect(accountHasXPremiumLongPosts({ platform: 'x', capabilities: ['long_posts'] })).toBe(
			false
		);
		expect(accountHasXPremiumLongPosts({ platform: 'x', account_username: 'premium' })).toBe(false);
		expect(accountHasXPremiumLongPosts({ platform: 'mastodon', limit_profile: 'x-premium' })).toBe(
			false
		);
	});

	it('falls back to the default limit for unknown providers', () => {
		expect(accountCharacterLimit({ platform: 'unknown' })).toBe(DEFAULT_PLATFORM_CHAR_LIMIT);
	});

	it('returns the tightest selected account limit', () => {
		expect(
			minimumAccountCharacterLimit([
				{ platform: 'linkedin' },
				{ platform: 'bluesky' },
				{ platform: 'threads' }
			])
		).toBe(300);
	});

	it('deduplicates displayed platform limits by canonical platform', () => {
		expect(
			uniquePlatformLimits([
				{ platform: 'x' },
				{ platform: 'twitter' },
				{ platform: 'x', limit_profile: 'x-premium' },
				{ platform: 'mastodon:https://masto.pt' }
			])
		).toEqual([
			expect.objectContaining({ platform: 'X', key: 'x', limit: 280 }),
			expect.objectContaining({ platform: 'Mastodon', key: 'mastodon', limit: 500 })
		]);
	});
});
