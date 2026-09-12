import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';
import DestinationSettingsDialog from './destination-settings-dialog.svelte';

type SettingDefinition = components['schemas']['SettingDefinition'];

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

const discordAccount: SocialAccount = {
	...xAccount,
	id: 'discord-bot',
	slug: 'discord-bot',
	platform: 'discord_bot',
	account_id: 'guild-1',
	account_username: 'OpenPost bot'
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
		if (document.querySelector('[role="dialog"]')) {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		}
		await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
	});

	it('keeps a required Discord channel editable when Done is pressed without a selection', async () => {
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: discordAccount,
				settings: [
					setting('channel_id', 'Channel', {
						control: 'remote_picker',
						type: 'select',
						options_source: 'discord_channels',
						required: true
					})
				],
				values: {},
				optionGroups: { discord_channels: [{ value: 'channel-1', label: 'Launches' }] },
				onChange: vi.fn()
			}
		});

		await screen.getByRole('button', { name: 'Done' }).click();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByRole('alert')).toBeVisible();
		expect(screen.getByRole('alert').element().textContent).toContain('Channel');
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('combobox', { name: 'Channel' }).element()
			)
		);
	});

	it('offers typed Discord embed fields and preserves the typed JSON value', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: discordAccount,
				settings: [setting('embed', 'Embed', { control: 'structured_editor', type: 'json' })],
				values: { embed: '{"title":"Launch","description":"Details"}' },
				onChange
			}
		});

		await expect.element(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Launch');
		await screen.getByRole('textbox', { name: 'Title' }).fill('New launch');
		expect(JSON.parse(onChange.mock.lastCall?.[1])).toMatchObject({
			title: 'New launch',
			description: 'Details'
		});
		expect(document.getElementById('destination-setting-embed')?.tagName).not.toBe('TEXTAREA');
	});

	it('chooses a TikTok photo cover from attached media rather than an arbitrary index', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: { ...xAccount, platform: 'tiktok' },
				settings: [
					setting('cover_index', 'Cover image', { control: 'cover_index', type: 'number' })
				],
				values: {},
				mediaItems: [
					{ id: 'photo-1', label: 'First photo', mimeType: 'image/jpeg' },
					{ id: 'photo-2', label: 'Second photo', mimeType: 'image/jpeg' }
				],
				onChange
			}
		});

		await screen.getByLabelText('Cover image').click();
		await screen.getByRole('option', { name: 'Second photo' }).click();
		expect(onChange).toHaveBeenCalledWith('cover_index', 1);
		expect(
			document.querySelector('input[type="number"][id="destination-setting-cover_index"]')
		).toBeNull();
	});

	it('limits Bluesky content labels to the advertised choices', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: { ...xAccount, platform: 'bluesky' },
				settings: [
					setting('self_labels', 'Content labels', {
						control: 'chips',
						type: 'tags',
						options: ['porn', 'sexual', 'nudity', 'graphic-media']
					})
				],
				values: {},
				onChange
			}
		});

		await screen.getByRole('checkbox', { name: 'Nudity' }).click();
		expect(onChange).toHaveBeenCalledWith('self_labels', 'nudity');
		expect(document.getElementById('destination-setting-self_labels')).toBeNull();
	});

	it('labels static provider choices by their setting name', async () => {
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: discordAccount,
				settings: [
					setting('mention_policy', 'Mentions', {
						control: 'select',
						type: 'select',
						options: ['none', 'selected']
					})
				],
				values: { mention_policy: 'none' },
				onChange: vi.fn()
			}
		});

		await expect.element(screen.getByLabelText('Mentions')).toBeVisible();
	});

	it('adds more than one Discord role without replacing the prior mention', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: discordAccount,
				settings: [
					setting('mention_role_ids', 'Mention role', {
						control: 'remote_picker',
						type: 'select',
						options_source: 'discord_roles'
					})
				],
				values: { mention_role_ids: ['role-1'] },
				optionGroups: {
					discord_roles: [
						{ value: 'role-1', label: 'Founders' },
						{ value: 'role-2', label: 'Team' }
					]
				},
				onChange
			}
		});

		await expect.element(screen.getByRole('button', { name: 'Remove Founders' })).toBeVisible();
		await screen.getByRole('combobox', { name: 'Mention role' }).click();
		await screen.getByText('Team', { exact: true }).click();
		expect(onChange).toHaveBeenCalledWith('mention_role_ids', ['role-1', 'role-2']);
	});

	it('shows unavailable X capabilities without fake editable controls', async () => {
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

	it('continues paged remote options', async () => {
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
});
