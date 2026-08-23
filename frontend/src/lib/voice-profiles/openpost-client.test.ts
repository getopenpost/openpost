import { describe, expect, it, vi } from 'vitest';
import type { components } from '$lib/api/types';
import { emptyVoiceProfileDefinition } from './mapping';
import { createOpenPostVoiceProfilesClient } from './openpost-client';

type WireVoiceProfile = components['schemas']['VoiceProfile'];

function response(status = 200): Response {
	return new Response(null, { status });
}

function profile(overrides: Partial<WireVoiceProfile> = {}): WireVoiceProfile {
	return {
		id: 'voice-1',
		workspace_id: 'workspace-1',
		name: 'Rodrigo',
		is_default: true,
		revision: 3,
		schema_version: 1,
		assigned_account_ids: ['account-1'],
		created_at: '2026-08-23T10:00:00Z',
		updated_at: '2026-08-23T10:00:00Z',
		definition: {
			identity_summary: 'A technical founder.',
			traits: ['Direct'],
			recurring_expressions: ['The practical part is...'],
			forbidden_phrases: ['Game changer'],
			examples: [
				{ text: 'A real post.', platform: 'LinkedIn', why_it_fits: 'It starts with evidence.' }
			]
		},
		...overrides
	};
}

function typedClient(methods: Record<string, ReturnType<typeof vi.fn>>) {
	// SAFETY: Each test supplies the four HTTP methods with the response tuple shape used by openapi-fetch.
	return {
		GET: methods.GET ?? vi.fn(),
		POST: methods.POST ?? vi.fn(),
		PUT: methods.PUT ?? vi.fn(),
		DELETE: methods.DELETE ?? vi.fn()
	} as never;
}

describe('OpenPost Voice Profiles API client', () => {
	it('uses the generated list route and maps the stored definition', async () => {
		const GET = vi
			.fn()
			.mockResolvedValue({ data: [profile()], error: undefined, response: response() });
		const client = createOpenPostVoiceProfilesClient({ client: typedClient({ GET }) });
		const controller = new AbortController();

		await expect(client.list('workspace-1', { signal: controller.signal })).resolves.toEqual([
			expect.objectContaining({
				id: 'voice-1',
				workspaceId: 'workspace-1',
				isDefault: true,
				assignedAccountIds: ['account-1'],
				definition: expect.objectContaining({
					identitySummary: 'A technical founder.',
					recurringExpressions: ['The practical part is...'],
					forbiddenPhrases: ['Game changer'],
					examples: [
						{
							text: 'A real post.',
							platform: 'LinkedIn',
							whyItFits: 'It starts with evidence.'
						}
					]
				})
			})
		]);
		expect(GET).toHaveBeenCalledWith('/voice-profiles', {
			params: { query: { workspace_id: 'workspace-1' } },
			signal: controller.signal
		});
	});

	it('sends revision-safe mutations and restores account inheritance with an empty ID', async () => {
		const POST = vi
			.fn()
			.mockResolvedValueOnce({ data: profile(), error: undefined, response: response() })
			.mockResolvedValueOnce({
				data: profile({ id: 'voice-2', is_default: true, revision: 2 }),
				error: undefined,
				response: response()
			});
		const PUT = vi
			.fn()
			.mockResolvedValueOnce({
				data: profile({ revision: 4 }),
				error: undefined,
				response: response()
			})
			.mockResolvedValueOnce({ data: {}, error: undefined, response: response() });
		const DELETE = vi.fn().mockResolvedValue({
			data: { deleted: true },
			error: undefined,
			response: response()
		});
		const client = createOpenPostVoiceProfilesClient({
			client: typedClient({ POST, PUT, DELETE })
		});
		const definition = {
			...emptyVoiceProfileDefinition(),
			identitySummary: 'A technical founder.',
			traits: ['Direct']
		};

		await client.create({
			workspaceId: 'workspace-1',
			name: 'Rodrigo',
			isDefault: false,
			definition
		});
		await client.update({
			workspaceId: 'workspace-1',
			profileId: 'voice-1',
			expectedRevision: 3,
			name: 'Rodrigo Dias',
			definition
		});
		await client.setDefault({
			workspaceId: 'workspace-1',
			profileId: 'voice-2',
			expectedRevision: 1
		});
		await client.assignAccount({
			workspaceId: 'workspace-1',
			accountId: 'account/1',
			voiceProfileId: null
		});
		await client.delete({
			workspaceId: 'workspace-1',
			profileId: 'voice-1',
			expectedRevision: 4,
			confirm: true
		});

		expect(POST).toHaveBeenNthCalledWith(1, '/voice-profiles', {
			body: expect.objectContaining({
				workspace_id: 'workspace-1',
				name: 'Rodrigo',
				is_default: false,
				definition: expect.objectContaining({
					identity_summary: 'A technical founder.',
					traits: ['Direct']
				})
			}),
			signal: undefined
		});
		expect(PUT).toHaveBeenNthCalledWith(1, '/voice-profiles/{id}', {
			params: { path: { id: 'voice-1' } },
			body: expect.objectContaining({ expected_revision: 3, name: 'Rodrigo Dias' }),
			signal: undefined
		});
		expect(POST).toHaveBeenNthCalledWith(2, '/voice-profiles/{id}/default', {
			params: { path: { id: 'voice-2' } },
			body: { workspace_id: 'workspace-1', expected_revision: 1 },
			signal: undefined
		});
		expect(PUT).toHaveBeenNthCalledWith(2, '/voice-profile-assignments/{account_id}', {
			params: { path: { account_id: 'account/1' } },
			body: { workspace_id: 'workspace-1', voice_profile_id: '' },
			signal: undefined
		});
		expect(DELETE).toHaveBeenCalledWith('/voice-profiles/{id}', {
			params: {
				path: { id: 'voice-1' },
				query: { workspace_id: 'workspace-1', expected_revision: 4, confirm: true }
			},
			signal: undefined
		});
	});

	it('passes the server problem detail to the editor', async () => {
		const GET = vi.fn().mockResolvedValue({
			data: undefined,
			error: { detail: 'Workspace access is required.' },
			response: response(403)
		});
		const client = createOpenPostVoiceProfilesClient({ client: typedClient({ GET }) });

		await expect(client.list('workspace-1')).rejects.toThrow('Workspace access is required.');
	});
});
