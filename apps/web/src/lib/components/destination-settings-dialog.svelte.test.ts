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
	it('authors explicit disclosure answers and can restore the channel default', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [
					setting('self_declared_made_for_kids', 'Made for kids', {
						control: 'optional_boolean',
						type: 'boolean'
					})
				],
				values: {},
				onChange
			}
		});
		const choice = screen.getByRole('button', {
			name: 'Made for kids',
			exact: true
		});
		await expect.element(choice).toHaveTextContent('Not specified');
		await choice.click();
		await screen.getByRole('option', { name: 'No', exact: true }).click();
		expect(onChange).toHaveBeenLastCalledWith('self_declared_made_for_kids', false);
		await choice.click();
		await screen.getByRole('option', { name: 'Yes', exact: true }).click();
		expect(onChange).toHaveBeenLastCalledWith('self_declared_made_for_kids', true);
		await choice.click();
		await screen.getByRole('option', { name: 'Not specified', exact: true }).click();
		expect(onChange).toHaveBeenLastCalledWith('self_declared_made_for_kids', null);
	});

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
				optionGroups: {
					discord_channels: [{ value: 'channel-1', label: 'Launches' }]
				},
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

	it.each([
		['invalid field collection', '{"fields":123}'],
		['missing nested text', '{"footer":{}}'],
		['unknown nested fields', '{"footer":{"text":"Thanks","extra":"preserve"}}']
	])('keeps an embed with %s editable as raw JSON', async (_case, embed) => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: discordAccount,
				settings: [
					setting('embed', 'Embed', {
						control: 'structured_editor',
						type: 'json'
					})
				],
				values: { embed },
				onChange
			}
		});

		const rawEditor = screen.getByRole('textbox', { name: 'Embed JSON' });
		await expect.element(rawEditor).toHaveValue(embed);
		await expect.element(screen.getByRole('alert')).toBeVisible();
		expect(screen.getByRole('textbox', { name: 'Title' }).query()).toBeNull();
		await rawEditor.fill(`${embed} `);
		expect(onChange).toHaveBeenCalledWith('embed', `${embed} `);
	});

	it('chooses a TikTok photo cover from attached media rather than an arbitrary index', async () => {
		const onChange = vi.fn();
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: { ...xAccount, platform: 'tiktok' },
				settings: [
					setting('cover_index', 'Cover image', {
						control: 'cover_index',
						type: 'number'
					})
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

	it('keeps unavailable X capabilities out of the main settings while retaining their reasons', async () => {
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
		await expect.element(screen.getByText('Unavailable (3)')).toBeVisible();
		await expect.element(screen.getByText(quoteReason)).not.toBeVisible();
		await screen.getByText('Unavailable (3)').click();
		await expect.element(screen.getByText(quoteReason)).toBeVisible();
		await expect.element(screen.getByText(communityReason)).toBeVisible();
		await expect.element(screen.getByText(locationReason)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Done' })).toBeVisible();

		expect(document.querySelector('input#destination-setting-quote_url')).toBeNull();
		expect(document.getElementById('destination-setting-community_id')).toBeNull();
		expect(document.getElementById('destination-setting-location_id')).toBeNull();
		expect(document.querySelectorAll('input[placeholder="Search options"]')).toHaveLength(0);
	});

	it('keeps an authored unsupported value and its reason inspectable', async () => {
		const quoteReason = 'Quote publishing requires X Enterprise API access.';
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
						control: 'remote_picker',
						type: 'select',
						options_source: 'x_communities',
						unavailable_reason: 'Community publishing is unavailable.'
					})
				],
				values: { quote_url: 'https://x.com/example/status/1' },
				onChange: vi.fn()
			}
		});

		await expect.element(screen.getByText(quoteReason)).toBeVisible();
		await expect.element(screen.getByText('https://x.com/example/status/1')).toBeVisible();
		await expect.element(screen.getByText('Unavailable (1)')).toBeVisible();
		expect(document.getElementById('destination-setting-quote_url')?.textContent).toBe(
			'Quote post'
		);
	});
});

it.each([
	{ text: '😀'.repeat(1250), bytes: 5000, invalid: false },
	{ text: '😀'.repeat(1251), bytes: 5004, invalid: true },
	{ text: 'Launch <now>', bytes: 12, invalid: true }
])(
	'shows YouTube description byte usage and validity ($bytes bytes)',
	async ({ text, bytes, invalid }) => {
		const screen = await render(DestinationSettingsDialog, {
			props: {
				open: true,
				account: youtubeAccount,
				settings: [setting('description', 'Description', { type: 'textarea' })],
				values: { description: text },
				onChange: vi.fn()
			}
		});
		await expect.element(screen.getByText(`${bytes} / 5000 bytes`, { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('textbox', { name: 'Description', exact: true }))
			.toHaveAttribute('aria-invalid', String(invalid));
		await screen.getByRole('button', { name: 'Done', exact: true }).click();
	}
);
