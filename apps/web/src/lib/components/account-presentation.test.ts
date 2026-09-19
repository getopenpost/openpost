import { describe, expect, it } from 'vitest';
import type { SocialAccount } from '$lib/api/client';
import {
	accountContextLabel,
	accountDisplayName,
	accountKindLabel,
	accountPlatformName,
	accountServer,
	accountSlug,
	accountSoftwareName,
	isConnectorProvider,
	providerCanConnect,
	providerNeedsAdminSetup,
	providerTitle,
	readinessStateMessage,
	type ProviderEntry
} from './account-presentation';

const account: SocialAccount = {
	id: 'account-1',
	slug: 'x-founder',
	platform: 'x',
	account_id: 'provider-account-1',
	account_username: 'old-founder',
	account_avatar_url: '',
	instance_url: '',
	is_active: true,
	thread_replies_supported: true,
	messaging_supported: true,
	messages_enabled: false,
	grant_destination_count: 1,
	shared_grant: false
};

const facts = {
	approval: '',
	authorization: '',
	configuration: '',
	control: '',
	live_certification: '',
	local_test: '',
	policy: ''
};

function testProvider(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
	return {
		auth_mode: 'oauth',
		configured: true,
		display_name: '',
		platform: 'x',
		readiness: {
			advertisable: false,
			analytics_ready: false,
			connectable: true,
			discoverable: false,
			executable: false,
			facts,
			observable: false,
			publishable: false,
			state: 'healthy'
		},
		...overrides
	};
}

describe('account display names', () => {
	it('prefers the username, then instance host, then ids', () => {
		expect(accountDisplayName(account)).toBe('@old-founder');
		expect(accountDisplayName({ ...account, account_username: '' })).toBe('provider-account-1');
		expect(
			accountDisplayName({
				...account,
				account_username: '',
				account_id: '',
				platform: 'mastodon',
				instance_url: 'https://toot.example'
			})
		).toBe('toot.example');
	});

	it('reports fediverse software only when it differs from the platform', () => {
		expect(accountSoftwareName(account)).toBe('');
		expect(accountSoftwareName({ ...account, fediverse_software: 'x' })).toBe('');
		expect(accountSoftwareName({ ...account, fediverse_software: 'Mastodon' })).toBe('Mastodon');
	});

	it('resolves platform names through connector installations first', () => {
		const entries = [testProvider({ installation_id: 'inst-1', display_name: 'Custom' })];
		expect(accountPlatformName({ ...account, provider_installation_id: 'inst-1' }, entries)).toBe(
			'Custom'
		);
		expect(accountPlatformName(account, entries)).toBe('X');
		expect(accountContextLabel(account, entries)).toContain('@old-founder');
	});

	it('reads slug, server and kind fields', () => {
		expect(accountSlug(account)).toBe('x-founder');
		expect(accountSlug({ ...account, slug: '' })).toBe('old-founder');
		expect(accountServer(account)).toBe('');
		expect(
			accountServer({ ...account, platform: 'mastodon', instance_url: 'https://toot.example/' })
		).toBe('toot.example');
		expect(accountKindLabel(account)).toBe('');
		expect(accountKindLabel({ ...account, account_kind: 'bot_user' })).toBe('Bot user');
	});
});

describe('provider presentation', () => {
	it('detects connector providers and titles', () => {
		expect(isConnectorProvider(testProvider())).toBe(false);
		expect(
			isConnectorProvider(testProvider({ auth_mode: 'preconfigured', installation_id: 'inst-1' }))
		).toBe(true);
		expect(providerTitle(testProvider({ display_name: 'Custom' }))).toBe('Custom');
		expect(providerTitle(testProvider())).toBe('X');
	});

	it('gates connection on status and readiness', () => {
		expect(providerCanConnect(testProvider())).toBe(true);
		expect(providerCanConnect(testProvider({ status: 'planned' }))).toBe(false);
		expect(providerNeedsAdminSetup(testProvider({ status: 'planned' }))).toBe(true);
		expect(providerNeedsAdminSetup(testProvider())).toBe(false);
	});
});

describe('readinessStateMessage', () => {
	it('maps states to copy and blanks healthy', () => {
		expect(readinessStateMessage('healthy', 'X')).toBe('');
		expect(readinessStateMessage('unknown-state', 'X')).toBe('');
		expect(readinessStateMessage('unsupported', 'X')).toContain('X');
		expect(readinessStateMessage('disabled', 'X')).toContain('X');
	});
});
