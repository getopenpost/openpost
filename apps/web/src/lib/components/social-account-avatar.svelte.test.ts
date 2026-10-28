import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SocialAccountAvatar from './social-account-avatar.svelte';

describe('social account avatar', () => {
	it('loads the provider photo lazily without sending a referrer', async () => {
		const screen = await render(SocialAccountAvatar, {
			name: 'Rodrigo',
			platform: 'linkedin',
			avatarUrl:
				'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"%3E%3Crect width="10" height="10" fill="red"/%3E%3C/svg%3E'
		});
		const image = screen.container.querySelector('img');
		if (!image) throw new Error('Expected a provider avatar image.');
		expect(image.getAttribute('loading')).toBe('lazy');
		expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
	});
});
