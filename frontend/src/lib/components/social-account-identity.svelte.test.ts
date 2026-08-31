import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SocialAccountIdentity from './social-account-identity.svelte';

describe('social account identity', () => {
	it('shows the account name, profile photo, and platform together', async () => {
		const screen = await render(SocialAccountIdentity, {
			name: '@openpost',
			platform: 'linkedin',
			avatarUrl: 'https://cdn.example.com/openpost.png'
		});

		await expect.element(screen.getByText('@openpost')).toBeVisible();
		expect(
			screen.container.querySelector('[data-slot="social-account-platform"]')?.textContent
		).toContain('LinkedIn');
		const image = screen.container.querySelector<HTMLImageElement>('[data-slot="avatar-image"]');
		expect(image?.src).toBe('https://cdn.example.com/openpost.png');
	});

	it('keeps the account identifiable when no profile photo is available', async () => {
		const screen = await render(SocialAccountIdentity, {
			name: 'Rodrigo Gomes',
			platform: 'bluesky'
		});

		await expect.element(screen.getByText('Rodrigo Gomes')).toBeVisible();
		const avatar = screen.container.querySelector('[data-slot="avatar"]');
		expect(avatar?.tagName).toBe('SPAN');
		expect(avatar?.getAttribute('aria-hidden')).toBe('true');
		expect(avatar?.textContent).toContain('RG');
		expect(
			screen.container.querySelector('[data-slot="social-account-platform"]')?.textContent
		).toContain('Bluesky');
	});
});
