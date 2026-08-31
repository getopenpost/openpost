import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';
import {
	registerLocalImageEditorMedia,
	releaseLocalImageEditorMedia
} from '$lib/image-editor/local-media-url';
import DestinationSettingsDialog from './destination-settings-dialog.svelte';

type SettingDefinition = components['schemas']['SettingDefinition'];
const QA_VIDEO_ID = 'local_media_destination-video';

const xAccount: SocialAccount = {
	id: 'x-main',
	slug: 'x-main',
	platform: 'x',
	account_id: '123',
	account_username: 'rodrgds',
	account_avatar_url: '',
	instance_url: '',
	is_active: true,
	grant_destination_count: 1,
	shared_grant: false,
	messaging_supported: true,
	messages_enabled: false,
	thread_replies_supported: true
};

const youtubeAccount: SocialAccount = {
	...xAccount,
	id: 'youtube-main',
	slug: 'youtube-main',
	platform: 'youtube',
	account_id: 'channel-1',
	account_username: 'OpenPost channel'
};

function setting(
	key: string,
	label: string,
	overrides: Partial<SettingDefinition> = {}
): SettingDefinition {
	return {
		key,
		message_key: `publishing.setting.${key.replaceAll('_', '.')}`,
		label,
		group: 'content',
		control: 'text',
		type: 'text',
		scope: 'destination',
		intents: ['post'],
		output_profiles: ['x.post'],
		media_shapes: ['text'],
		required: false,
		required_policy: 'never',
		constraints: {},
		...overrides
	};
}

describe('DestinationSettingsDialog', () => {
	afterEach(async () => {
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
		const doneButton = Array.from(dialog?.querySelectorAll('button') ?? []).find(
			(button) => button.textContent?.trim() === 'Done'
		);
		doneButton?.click();
		await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
		releaseLocalImageEditorMedia(QA_VIDEO_ID);
	});

	it('shows unavailable X capabilities without fake editable controls', async () => {
		await page.viewport(390, 844);
		const quoteReason = 'Quote publishing requires X Enterprise API access.';
		const communityReason =
			'X has not granted this account access to Community publishing options.';
		const locationReason = 'X has not granted this account access to location publishing options.';
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: xAccount,
				settings: [
					setting('quote_url', 'Quote post', {
						control: 'quote_url',
						unavailable_reason: quoteReason
					}),
					setting('community_id', 'Community', {
						group: 'distribution',
						control: 'remote_picker',
						type: 'select',
						options_source: 'x_communities',
						unavailable_reason: communityReason
					}),
					setting('location_id', 'Location', {
						group: 'media_accessibility',
						control: 'remote_picker',
						type: 'select',
						options_source: 'x_locations',
						unavailable_reason: locationReason
					})
				],
				values: {},
				onChange: vi.fn()
			}
		});

		await expect.element(screen.getByRole('heading', { name: 'X settings' })).toBeVisible();
		await expect.element(screen.getByText(quoteReason)).toBeVisible();
		await expect.element(screen.getByText(communityReason)).toBeVisible();
		await expect.element(screen.getByText(locationReason)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Done' })).toBeVisible();

		expect(document.getElementById('destination-setting-quote_url')).toBeNull();
		expect(document.getElementById('destination-setting-community_id')).toBeNull();
		expect(document.getElementById('destination-setting-location_id')).toBeNull();
		expect(document.querySelectorAll('input[placeholder="Search options"]')).toHaveLength(0);
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(390);
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	});

	it('searches YouTube categories and playlists inside their comboboxes', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [
					setting('category_id', 'Category', {
						group: 'distribution',
						control: 'remote_picker',
						type: 'select',
						options_source: 'youtube_categories',
						required: true
					}),
					setting('playlist_id', 'Playlist', {
						group: 'distribution',
						control: 'remote_picker',
						type: 'select',
						options_source: 'youtube_playlists'
					})
				],
				values: {},
				optionGroups: {
					youtube_categories: [
						{ value: '1', label: 'Film & Animation' },
						{ value: '10', label: 'Music' }
					],
					youtube_playlists: [
						{ value: 'uploads', label: 'Uploads' },
						{ value: 'launches', label: 'Launches' }
					]
				},
				onChange
			}
		});

		expect(document.querySelectorAll('input[placeholder="Search options"]')).toHaveLength(0);
		await screen.getByRole('combobox', { name: 'Category' }).click();
		await screen.getByPlaceholder('Search options').fill('Music');
		await screen.getByText('Music', { exact: true }).click();

		expect(onChange).toHaveBeenCalledWith('category_id', '10');

		await screen.getByRole('combobox', { name: 'Playlist' }).click();
		await screen.getByPlaceholder('Search options').fill('Launch');
		await screen.getByText('Launches', { exact: true }).click();

		expect(onChange).toHaveBeenCalledWith('playlist_id', 'launches');
	});

	it('continues paged remote options without overflow', async () => {
		await page.viewport(320, 720);
		const onOptionLoadMore = vi.fn();
		const playlist = setting('playlist_id', 'Playlist', {
			group: 'distribution',
			control: 'remote_picker',
			type: 'select',
			options_source: 'youtube_playlists'
		});
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [playlist],
				values: {},
				optionGroups: { youtube_playlists: [{ value: 'uploads', label: 'Uploads' }] },
				optionNextCursors: { youtube_playlists: 'page-2' },
				onChange: vi.fn(),
				onOptionLoadMore
			}
		});

		const continuation = screen.getByRole('button', { name: 'Load more options' });
		await continuation.click();
		expect(onOptionLoadMore).toHaveBeenCalledWith(playlist);
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	});

	it('uploads destination files through the composer callback', async () => {
		const onFileChange = vi.fn().mockResolvedValue(undefined);
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [
					setting('thumbnail_media_id', 'Thumbnail', {
						control: 'media_picker',
						type: 'media',
						media_shapes: ['video']
					})
				],
				values: {},
				onChange: vi.fn(),
				onFileChange
			}
		});

		const input = screen.getByLabelText('Thumbnail').element();
		if (!(input instanceof HTMLInputElement)) throw new Error('Expected a thumbnail file input.');
		const file = new File(['thumbnail'], 'thumbnail.jpg', { type: 'image/jpeg' });
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await vi.waitFor(() => expect(onFileChange).toHaveBeenCalledWith(expect.anything(), file));
	});

	it('shows a video frame picker for destination cover timestamps', async () => {
		await page.viewport(390, 844);
		registerLocalImageEditorMedia(QA_VIDEO_ID, new Blob([], { type: 'video/mp4' }));
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [
					setting('cover_timestamp_ms', 'Cover frame', {
						control: 'cover_frame',
						type: 'number',
						media_shapes: ['video']
					})
				],
				values: {},
				mediaItems: [{ id: QA_VIDEO_ID, label: 'Video 1', mimeType: 'video/mp4' }],
				onChange: vi.fn()
			}
		});

		await expect.element(screen.getByLabelText('Video preview for Cover frame')).toBeVisible();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	});
});
