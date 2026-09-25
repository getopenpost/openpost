import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import ComposerDestinationTabs from './composer-destination-tabs.svelte';

function socialAccount(id: string, platform: string, account_username: string): SocialAccount {
	return {
		id,
		slug: id,
		platform,
		account_id: id,
		account_username,
		account_avatar_url: '',
		instance_url: '',
		is_active: true,
		thread_replies_supported: true,
		messaging_supported: false,
		messages_enabled: false,
		grant_destination_count: 1,
		shared_grant: false
	};
}

describe('Composer destination tabs', () => {
	it('marks tabs with custom content and leaves shared tabs unmarked', async () => {
		const onActivate = vi.fn();
		const screen = await render(ComposerDestinationTabs, {
			accounts: [socialAccount('acc-1', 'x', 'one'), socialAccount('acc-2', 'threads', 'two')],
			activeAccountId: null,
			onActivate,
			accountLabel: (account: SocialAccount) => `@${account.account_username}`,
			issueCountFor: () => 0,
			isCustomFor: (account: SocialAccount) => account.id === 'acc-1'
		});

		const customTab = screen.getByTestId('composer-destination-custom');
		expect(customTab).toBeDefined();
		expect(
			screen.container.querySelectorAll('[data-testid="composer-destination-custom"]')
		).toHaveLength(1);

		const customButton = screen.getByRole('tab', { name: '@one, custom' });
		expect(customButton.element().getAttribute('aria-selected')).toBe('false');
		expect(screen.getByRole('tab', { name: '@two' })).toBeDefined();

		await customButton.click();
		expect(onActivate).toHaveBeenCalledWith('acc-1');
	});

	it('keeps the custom marker next to the issue count', async () => {
		const screen = await render(ComposerDestinationTabs, {
			accounts: [socialAccount('acc-1', 'x', 'one')],
			activeAccountId: 'acc-1',
			onActivate: () => {},
			accountLabel: (account: SocialAccount) => `@${account.account_username}`,
			issueCountFor: () => 2,
			isCustomFor: () => true
		});

		expect(
			screen.container.querySelectorAll('[data-testid="composer-destination-custom"]')
		).toHaveLength(1);
		expect(screen.getByText('2')).toBeDefined();
	});
});
