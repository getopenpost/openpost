import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PlatformPreview from './platform-preview.svelte';

const previewProps = {
	content: 'Launch update\nShip notes for every social channel.',
	mediaIds: [],
	username: 'openpost',
	displayName: 'OpenPost'
};

describe('PlatformPreview platform views', () => {
	it('renders an Instagram-specific post preview', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'instagram',
			...previewProps
		});

		await expect.element(screen.getByTestId('instagram-preview')).toBeVisible();
		await expect.element(screen.getByText('Instagram post preview')).toBeVisible();
		await expect.element(screen.getByText('Launch update')).toBeVisible();
	});

	it('renders a Facebook-specific feed preview', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'facebook',
			...previewProps
		});

		await expect.element(screen.getByTestId('facebook-preview')).toBeVisible();
		await expect.element(screen.getByText('Like')).toBeVisible();
		await expect.element(screen.getByText('Comment')).toBeVisible();
		await expect.element(screen.getByText('Share')).toBeVisible();
	});

	it('renders a YouTube-specific video preview', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'youtube',
			...previewProps
		});

		await expect.element(screen.getByTestId('youtube-preview')).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Launch update' })).toBeVisible();
		await expect.element(screen.getByText('OpenPost · Scheduled video')).toBeVisible();
	});

	it('renders a TikTok-specific vertical video preview', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'tiktok',
			...previewProps
		});

		await expect.element(screen.getByTestId('tiktok-preview')).toBeVisible();
		await expect.element(screen.getByText('@openpost')).toBeVisible();
		await expect.element(screen.getByText('Launch update')).toBeVisible();
	});
});
