import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SocialAccount } from '$lib/api/client';
import type { VoiceProfile, VoiceProfilesClient } from '$lib/voice-profiles';
import VoiceProfilesSettingsTab from './voice-profiles-settings-tab.svelte';

function profile(): VoiceProfile {
	return {
		id: 'voice-1',
		workspaceId: 'workspace-1',
		name: 'Rodrigo',
		isDefault: true,
		revision: 1,
		schemaVersion: 1,
		assignedAccountIds: [],
		definition: {
			identitySummary: 'A technical founder.',
			preferredLanguage: 'English (Portugal)',
			traits: ['Direct'],
			vocabulary: [],
			recurringExpressions: [],
			expertise: [],
			opinions: [],
			humor: '',
			formality: '',
			boundaries: [],
			forbiddenPhrases: [],
			dislikedPatterns: [],
			examples: [],
			corrections: [],
			interviewAnswers: []
		}
	};
}

function profileClient(): VoiceProfilesClient {
	return {
		list: vi.fn(async () => [profile()]),
		create: vi.fn(async () => profile()),
		update: vi.fn(async () => profile()),
		setDefault: vi.fn(async () => profile()),
		delete: vi.fn(async () => undefined),
		assignAccount: vi.fn(async () => undefined)
	};
}

function account(): SocialAccount {
	return {
		id: 'account-1',
		account_id: 'provider-account-1',
		account_username: 'rodrigo',
		account_avatar_url: '',
		account_kind: 'person',
		grant_destination_count: 1,
		instance_url: '',
		is_active: true,
		messages_enabled: false,
		messaging_supported: false,
		platform: 'linkedin',
		shared_grant: false,
		slug: 'rodrigo',
		thread_replies_supported: false
	};
}

describe('VoiceProfilesSettingsTab', () => {
	it('loads current workspace accounts and keeps viewers read-only', async () => {
		const accountLoader = vi.fn(async () => [account()]);
		const screen = await render(VoiceProfilesSettingsTab, {
			props: {
				workspaceId: 'workspace-1',
				canEdit: false,
				profileClient: profileClient(),
				accountLoader
			}
		});

		await expect.element(screen.getByText(/workspace role cannot change them/i)).toBeVisible();
		await expect.element(screen.getByText('@rodrigo')).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Rodrigo' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'New voice' })).toBeDisabled();
		await expect.element(screen.getByLabelText('Voice for @rodrigo')).toBeDisabled();
		expect(accountLoader).toHaveBeenCalledWith('workspace-1');
	});

	it('keeps profile editing available when account loading fails and retries just that list', async () => {
		const accountLoader = vi
			.fn<() => Promise<SocialAccount[]>>()
			.mockRejectedValueOnce(new Error(''))
			.mockResolvedValueOnce([account()]);
		const screen = await render(VoiceProfilesSettingsTab, {
			props: {
				workspaceId: 'workspace-1',
				profileClient: profileClient(),
				accountLoader
			}
		});

		await expect
			.element(
				screen.getByText(
					'OpenPost could not load connected accounts. Voice profiles are still available.'
				)
			)
			.toBeVisible();
		await expect.element(screen.getByLabelText('Who is speaking?')).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Rodrigo' })).toBeVisible();

		await screen.getByRole('button', { name: 'Try again' }).click();

		await expect.element(screen.getByText('@rodrigo')).toBeVisible();
		expect(accountLoader).toHaveBeenCalledTimes(2);
	});
});
