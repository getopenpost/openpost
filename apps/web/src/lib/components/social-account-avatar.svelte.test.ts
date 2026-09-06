import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SocialAccountAvatar from './social-account-avatar.svelte';

const browserImage = window.Image;

class RejectingPreloader {
	onerror: ((event: Event) => void) | null = null;

	set src(_value: string) {
		queueMicrotask(() => this.onerror?.(new Event('error')));
	}
}

afterEach(() => {
	Object.defineProperty(window, 'Image', {
		configurable: true,
		writable: true,
		value: browserImage
	});
});

describe('social account avatar', () => {
	it('shows an image that loads in the page when the avatar preloader rejects it', async () => {
		Object.defineProperty(window, 'Image', {
			configurable: true,
			writable: true,
			value: RejectingPreloader
		});

		const screen = await render(SocialAccountAvatar, {
			name: 'Rodrigo',
			platform: 'linkedin',
			avatarUrl:
				'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"%3E%3Crect width="10" height="10" fill="red"/%3E%3C/svg%3E'
		});
		const image = screen.container.querySelector('img');
		if (!image) throw new Error('Expected a provider avatar image.');

		await vi.waitFor(() => expect(getComputedStyle(image).opacity).toBe('1'));
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-slot="avatar-fallback"]')).toHaveClass(
				'invisible'
			)
		);
	});
});
