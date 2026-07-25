import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
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
	thread_replies_supported: true
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
});
