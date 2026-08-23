import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { VoiceProfile, VoiceProfilesClient } from '$lib/voice-profiles';
import VoiceProfilesSettings from './voice-profiles-settings.svelte';

function profile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
	return {
		id: 'voice-founder',
		workspaceId: 'workspace-1',
		name: 'Founder',
		isDefault: true,
		revision: 1,
		schemaVersion: 1,
		definition: {
			identitySummary: 'A technical founder who writes from first-hand experience.',
			preferredLanguage: 'English (Portugal)',
			traits: ['Direct', 'Technical'],
			vocabulary: [],
			recurringExpressions: [],
			expertise: ['Product engineering'],
			opinions: [],
			humor: '',
			formality: '',
			boundaries: [],
			forbiddenPhrases: [],
			dislikedPatterns: [],
			examples: [],
			corrections: [],
			interviewAnswers: []
		},
		assignedAccountIds: [],
		...overrides
	};
}

function voiceClient(created = profile()): VoiceProfilesClient {
	return {
		list: vi.fn(async () => []),
		create: vi.fn(async () => created),
		update: vi.fn(async () => created),
		setDefault: vi.fn(async () => created),
		delete: vi.fn(async () => undefined),
		assignAccount: vi.fn(async () => undefined)
	};
}

describe('VoiceProfilesSettings', () => {
	it('keeps evidence fields progressive while exposing profile actions', async () => {
		const secondary = profile({
			id: 'voice-company',
			name: 'OpenPost',
			isDefault: false
		});
		const screen = await render(VoiceProfilesSettings, {
			props: {
				workspaceId: 'workspace-1',
				client: voiceClient(),
				initialProfiles: [profile(), secondary],
				selectedProfileId: secondary.id,
				autoLoad: false
			}
		});

		await expect.element(screen.getByLabelText('Who is speaking?')).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Make workspace default' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Delete voice' })).toBeVisible();
		await expect.element(screen.getByText('Representative examples')).not.toBeVisible();

		await screen.getByRole('button', { name: /Advanced voice details/ }).click();

		await expect
			.element(screen.getByLabelText('Preferred language'))
			.toHaveValue('English (Portugal)');
		await expect.element(screen.getByText('Representative examples')).toBeVisible();
		await expect.element(screen.getByText('Accepted corrections')).toBeVisible();
		await expect.element(screen.getByText('Interview answers')).toBeVisible();
	});

	it('creates a normalized profile through the injected client', async () => {
		const saved = profile({ id: 'voice-openpost', name: 'OpenPost', isDefault: false });
		const client = voiceClient(saved);
		const screen = await render(VoiceProfilesSettings, {
			props: {
				workspaceId: 'workspace-1',
				client,
				initialProfiles: [profile()],
				autoLoad: false
			}
		});

		await screen.getByRole('button', { name: 'New voice' }).first().click();
		await screen.getByLabelText('Profile name').fill('  OpenPost  ');
		await screen
			.getByLabelText('Who is speaking?')
			.fill('  A product company that writes clearly.  ');
		await screen.getByRole('button', { name: 'Create voice' }).click();

		expect(client.create).toHaveBeenCalledWith(
			{
				workspaceId: 'workspace-1',
				name: 'OpenPost',
				isDefault: false,
				definition: expect.objectContaining({
					identitySummary: 'A product company that writes clearly.'
				})
			},
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		await expect.element(screen.getByRole('heading', { name: 'OpenPost' })).toBeVisible();
	});
});
