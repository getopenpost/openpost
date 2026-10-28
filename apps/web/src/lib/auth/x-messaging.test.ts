import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	captureXMessagingCallback,
	takeXMessagingCallback,
	rememberXMessagingAuthorization,
	takeXMessagingAuthorization
} from './x-messaging';

describe('X messaging browser authorization', () => {
	beforeEach(() => {
		const stored = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
			removeItem: (key: string) => stored.delete(key)
		});
	});
	it('scrubs the callback URL before exposing the single-use code to completion', () => {
		const replaceState = vi.fn();
		vi.stubGlobal('location', {
			pathname: '/oauth/x-messaging',
			search: '?state=nonce&code=private-code&error_description=private-detail'
		});
		vi.stubGlobal('history', { state: { keep: true }, replaceState });
		captureXMessagingCallback();
		expect(replaceState).toHaveBeenCalledWith({ keep: true }, '', '/oauth/x-messaging');
		expect(takeXMessagingCallback()).toEqual({
			state: 'nonce',
			code: 'private-code',
			cancelled: false
		});
		expect(takeXMessagingCallback()).toBeUndefined();
	});
	it('rejects another actor and consumes their pending authorization', () => {
		rememberXMessagingAuthorization(
			'https://x.com/authorize?state=nonce',
			'actor-a',
			'workspace-a',
			'account-a'
		);
		expect(takeXMessagingAuthorization('nonce', 'actor-a')).toEqual({
			workspaceId: 'workspace-a',
			accountId: 'account-a'
		});
		rememberXMessagingAuthorization(
			'https://x.com/authorize?state=nonce',
			'actor-a',
			'workspace-a',
			'account-a'
		);
		expect(takeXMessagingAuthorization('nonce', 'actor-b')).toBeUndefined();
		expect(takeXMessagingAuthorization('nonce', 'actor-a')).toBeUndefined();
	});
	it('requires the same state and expires the browser binding after ten minutes', () => {
		rememberXMessagingAuthorization(
			'https://x.com/authorize?state=nonce',
			'actor-a',
			'workspace-a',
			'account-a'
		);
		expect(takeXMessagingAuthorization('nonce', 'actor-a')).toEqual({
			workspaceId: 'workspace-a',
			accountId: 'account-a'
		});
		rememberXMessagingAuthorization(
			'https://x.com/authorize?state=nonce',
			'actor-a',
			'workspace-a',
			'account-a'
		);
		expect(takeXMessagingAuthorization('other', 'actor-a')).toBeUndefined();
		rememberXMessagingAuthorization(
			'https://x.com/authorize?state=nonce',
			'actor-a',
			'workspace-a',
			'account-a'
		);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
		expect(takeXMessagingAuthorization('nonce', 'actor-a')).toBeUndefined();
		clock.mockRestore();
	});
});
