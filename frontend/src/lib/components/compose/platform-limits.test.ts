import { describe, expect, it } from 'vitest';
import {
	X_PREMIUM_CHAR_LIMIT,
	accountHasXPremiumLongPosts,
	accountCharacterLimit,
	mostConstrainedCharacterUsage,
	minimumAccountCharacterLimit,
	platformTextLength
} from './platform-limits';

describe('platform-limits', () => {
	it('uses X weighted text counting', () => {
		expect(platformTextLength('x', 'Hello, world! 👋')).toBe(16);
		expect(platformTextLength('x', '👨‍👩‍👧‍👦')).toBe(2);
		expect(platformTextLength('x', '日本語')).toBe(6);
		expect(platformTextLength('x', 'See https://example.com/this/is/a/long/path')).toBe(27);
		expect(platformTextLength('x', 'cafe\u0301')).toBe(4);
		expect(platformTextLength('mastodon', '日本語')).toBe(3);
	});

	it('does not invent a limit when no destination uses the shared text', () => {
		expect(mostConstrainedCharacterUsage('A'.repeat(302), [])).toEqual({
			count: 302,
			limit: null
		});
	});

	it('uses the verified X account limit profile', () => {
		expect(accountCharacterLimit({ platform: 'x', limit_profile: 'x-premium' })).toBe(
			X_PREMIUM_CHAR_LIMIT
		);
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

	it('does not infer X Premium from unrelated account fields', () => {
		expect(accountHasXPremiumLongPosts({ platform: 'x', capabilities: ['long_posts'] })).toBe(
			false
		);
		expect(accountHasXPremiumLongPosts({ platform: 'x', account_username: 'premium' })).toBe(false);
		expect(accountHasXPremiumLongPosts({ platform: 'x', limit_profile: 'x-premium' })).toBe(true);
		expect(accountHasXPremiumLongPosts({ platform: 'mastodon', limit_profile: 'x-premium' })).toBe(
			false
		);
	});

	it('returns the tightest selected account limit', () => {
		expect(
			minimumAccountCharacterLimit([
				{ platform: 'linkedin' },
				{ platform: 'bluesky' },
				{ platform: 'threads' }
			])
		).toBe(300);
		expect(
			minimumAccountCharacterLimit(
				[
					{ id: 'free', platform: 'x' },
					{ id: 'premium', platform: 'x', limit_profile: 'x-premium' }
				],
				{
					free: { text_limit: 280 },
					premium: { text_limit: X_PREMIUM_CHAR_LIMIT }
				}
			)
		).toBe(280);
	});
});
