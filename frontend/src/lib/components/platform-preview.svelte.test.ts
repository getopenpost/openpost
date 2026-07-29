import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { SocialPreviewPage, createPreviewModel } from '@openpost/social-preview';
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
		await expect.element(screen.getByText('Comment', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Share', { exact: true })).toBeVisible();
	});

	it('renders a YouTube-specific video preview', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'youtube',
			...previewProps
		});

		await expect.element(screen.getByTestId('youtube-preview')).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Launch update' })).toBeVisible();
		await expect.element(screen.getByText('Scheduled video')).toBeVisible();
		await expect.element(screen.getByText('Subscribe')).toBeVisible();
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

	it('renders Instagram Stories in a vertical player instead of the feed shell', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'instagram',
			format: 'story',
			...previewProps
		});

		await expect.element(screen.getByLabelText('Instagram story player')).toBeVisible();
	});

	it('renders YouTube Shorts in a vertical player instead of the watch-page shell', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'youtube',
			format: 'short',
			...previewProps
		});

		await expect.element(screen.getByLabelText('YouTube short player')).toBeVisible();
	});

	it.each([
		['x', 'Views'],
		['bluesky', 'Repost'],
		['threads', 'Share']
	])('renders the native controls for %s', async (platform, expectedText) => {
		const screen = await render(PlatformPreview, {
			platform,
			...previewProps
		});
		await expect.element(screen.getByTestId(`${platform}-preview`)).toBeVisible();
		await expect.element(screen.getByText(expectedText, { exact: true })).toBeVisible();
	});

	it('renders Mastodon content warnings', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'mastodon',
			contentWarning: 'Product details',
			...previewProps
		});
		await expect.element(screen.getByText('Content warning')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Show more' })).toBeVisible();
	});

	it('renders LinkedIn documents', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'linkedin',
			format: 'document',
			title: 'Launch brief',
			...previewProps
		});
		await expect.element(screen.getByText('Launch brief')).toBeVisible();
		await expect.element(screen.getByText('PDF')).toBeVisible();
	});

	it('renders Discord video messages', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'discord',
			format: 'video',
			...previewProps
		});
		await expect.element(screen.getByText('APP')).toBeVisible();
		await expect.element(screen.getByText('Video preview', { exact: true })).toBeVisible();
	});

	it('renders a complete destination page without OpenPost application chrome', async () => {
		const screen = await render(SocialPreviewPage, {
			model: createPreviewModel({
				platform: 'x',
				format: 'thread',
				identity: { displayName: 'OpenPost', handle: 'openpost' },
				segments: [
					{ id: 'one', text: 'First destination post.' },
					{ id: 'two', text: 'Second destination post.' }
				]
			})
		});

		await expect.element(screen.getByLabelText('X page preview')).toBeVisible();
		await expect.element(screen.getByText('First destination post.')).toBeVisible();
		await expect.element(screen.getByText('Second destination post.')).toBeVisible();
	});

	it('shows an unsupported state instead of falling back to another network', async () => {
		const screen = await render(PlatformPreview, {
			platform: 'future-network',
			...previewProps
		});

		await expect.element(screen.getByRole('status')).toHaveTextContent('Preview unavailable');
		await expect.element(screen.getByText('Discord post preview')).not.toBeInTheDocument();
	});
});
