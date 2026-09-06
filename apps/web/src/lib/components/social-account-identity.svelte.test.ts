import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SocialAccountIdentity from './social-account-identity.svelte';

it('can show an account without repeating its platform name', async () => {
	const screen = await render(SocialAccountIdentity, {
		name: '@rodrgds',
		platform: 'threads',
		size: 'sm',
		showPlatform: false
	});

	await expect.element(screen.getByText('@rodrgds')).toBeVisible();
	await expect.element(screen.getByText('· Threads')).not.toBeInTheDocument();
});
