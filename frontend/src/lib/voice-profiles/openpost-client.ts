import { client as defaultClient } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type {
	AssignVoiceProfileAccountInput,
	CreateVoiceProfileInput,
	DeleteVoiceProfileInput,
	SetDefaultVoiceProfileInput,
	UpdateVoiceProfileInput,
	VoiceProfile,
	VoiceProfileDefinition,
	VoiceProfilesClient
} from './types';

type APIClient = Pick<typeof defaultClient, 'GET' | 'POST' | 'PUT' | 'DELETE'>;
type APIProblem = components['schemas']['ErrorModel'];
type WireVoiceDefinition = components['schemas']['Definition'];
type WireVoiceProfile = components['schemas']['VoiceProfile'];

interface OpenPostVoiceProfilesClientDependencies {
	client?: APIClient;
}

export function createOpenPostVoiceProfilesClient(
	dependencies: OpenPostVoiceProfilesClientDependencies = {}
): VoiceProfilesClient {
	const client = dependencies.client ?? defaultClient;

	return {
		async list(workspaceId, options) {
			const { data, error, response } = await client.GET('/voice-profiles', {
				params: { query: { workspace_id: workspaceId } },
				signal: options?.signal
			});
			if (error) throw clientError(error, response.status);
			return (data ?? []).map(mapVoiceProfile);
		},

		async create(input, options) {
			const { data, error, response } = await client.POST('/voice-profiles', {
				body: createBody(input),
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			return mapVoiceProfile(data);
		},

		async update(input, options) {
			const { data, error, response } = await client.PUT('/voice-profiles/{id}', {
				params: { path: { id: input.profileId } },
				body: updateBody(input),
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			return mapVoiceProfile(data);
		},

		async setDefault(input, options) {
			const { data, error, response } = await client.POST('/voice-profiles/{id}/default', {
				params: { path: { id: input.profileId } },
				body: revisionBody(input),
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			return mapVoiceProfile(data);
		},

		async delete(input, options) {
			const { error, response } = await client.DELETE('/voice-profiles/{id}', {
				params: {
					path: { id: input.profileId },
					query: {
						workspace_id: input.workspaceId,
						expected_revision: input.expectedRevision,
						confirm: input.confirm
					}
				},
				signal: options?.signal
			});
			if (error) throw clientError(error, response.status);
		},

		async assignAccount(input, options) {
			const { error, response } = await client.PUT('/voice-profile-assignments/{account_id}', {
				params: { path: { account_id: input.accountId } },
				body: assignmentBody(input),
				signal: options?.signal
			});
			if (error) throw clientError(error, response.status);
		}
	};
}

function createBody(
	input: CreateVoiceProfileInput
): components['schemas']['CreateVoiceProfileInputBody'] {
	return {
		workspace_id: input.workspaceId,
		name: input.name,
		is_default: input.isDefault,
		definition: definitionBody(input.definition)
	};
}

function updateBody(
	input: UpdateVoiceProfileInput
): components['schemas']['UpdateVoiceProfileInputBody'] {
	return {
		workspace_id: input.workspaceId,
		expected_revision: input.expectedRevision,
		name: input.name,
		definition: definitionBody(input.definition)
	};
}

function revisionBody(
	input: SetDefaultVoiceProfileInput
): components['schemas']['SetDefaultVoiceProfileInputBody'] {
	return {
		workspace_id: input.workspaceId,
		expected_revision: input.expectedRevision
	};
}

function assignmentBody(
	input: AssignVoiceProfileAccountInput
): components['schemas']['AssignVoiceProfileInputBody'] {
	return {
		workspace_id: input.workspaceId,
		voice_profile_id: input.voiceProfileId ?? ''
	};
}

function definitionBody(definition: VoiceProfileDefinition): WireVoiceDefinition {
	return {
		identity_summary: definition.identitySummary,
		preferred_language: definition.preferredLanguage,
		traits: definition.traits,
		vocabulary: definition.vocabulary,
		recurring_expressions: definition.recurringExpressions,
		expertise: definition.expertise,
		opinions: definition.opinions,
		humor: definition.humor,
		formality: definition.formality,
		boundaries: definition.boundaries,
		forbidden_phrases: definition.forbiddenPhrases,
		disliked_patterns: definition.dislikedPatterns,
		examples: definition.examples.map((example) => ({
			text: example.text,
			platform: example.platform,
			why_it_fits: example.whyItFits
		})),
		corrections: definition.corrections,
		interview_answers: definition.interviewAnswers
	};
}

function mapVoiceProfile(profile: WireVoiceProfile): VoiceProfile {
	return {
		id: profile.id,
		workspaceId: profile.workspace_id,
		name: profile.name,
		isDefault: profile.is_default,
		revision: profile.revision,
		schemaVersion: profile.schema_version,
		definition: mapDefinition(profile.definition),
		assignedAccountIds: profile.assigned_account_ids ?? [],
		createdAt: profile.created_at,
		updatedAt: profile.updated_at
	};
}

function mapDefinition(definition: WireVoiceDefinition): VoiceProfileDefinition {
	return {
		identitySummary: definition.identity_summary ?? '',
		preferredLanguage: definition.preferred_language ?? '',
		traits: definition.traits ?? [],
		vocabulary: definition.vocabulary ?? [],
		recurringExpressions: definition.recurring_expressions ?? [],
		expertise: definition.expertise ?? [],
		opinions: definition.opinions ?? [],
		humor: definition.humor ?? '',
		formality: definition.formality ?? '',
		boundaries: definition.boundaries ?? [],
		forbiddenPhrases: definition.forbidden_phrases ?? [],
		dislikedPatterns: definition.disliked_patterns ?? [],
		examples: (definition.examples ?? []).map((example) => ({
			text: example.text,
			platform: example.platform,
			whyItFits: example.why_it_fits
		})),
		corrections: (definition.corrections ?? []).map((correction) => ({ ...correction })),
		interviewAnswers: (definition.interview_answers ?? []).map((answer) => ({ ...answer }))
	};
}

function clientError(problem: APIProblem | undefined, status: number): Error {
	return new Error(
		problem?.detail?.trim() ||
			problem?.title?.trim() ||
			(status > 0 ? `Request failed (${status})` : 'Request failed')
	);
}
