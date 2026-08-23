import { client as defaultClient } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type { VoiceProfile, VoiceProfileDefinition } from '$lib/voice-profiles';
import type {
	CreatePostBuilderRunInput,
	PostBuilderClaim,
	PostBuilderClient,
	PostBuilderClientOptions,
	PostBuilderCommitResult,
	PostBuilderDestinationDecision,
	PostBuilderMediaPlanItem,
	PostBuilderOpportunity,
	PostBuilderRun
} from './types';

type APIClient = Pick<typeof defaultClient, 'GET' | 'POST'>;
type APIProblem = components['schemas']['ErrorModel'];
type WireVoiceDefinition = components['schemas']['Definition'];
type WireVoiceProfile = components['schemas']['VoiceProfile'];
type WireClaim = components['schemas']['Claim'];
type WireMediaPlan = components['schemas']['MediaPlan'];
type WireBuildResult = components['schemas']['BuildResult'];
type WirePublicationBuild = components['schemas']['Build'];
type WireDiscoveryResult = components['schemas']['DiscoveryResult'];

export interface PostBuilderAvailability {
	builderEnabled: boolean;
	discoveryEnabled: boolean;
}

export interface DiscoverPostBuilderInput {
	workspaceId: string;
	focus?: string;
	audience?: string;
	voiceProfileId?: string;
	platforms: string[];
	limit?: number;
}

export interface OpenPostBuilderClient extends PostBuilderClient {
	availability(options?: PostBuilderClientOptions): Promise<PostBuilderAvailability>;
	listVoices(workspaceId: string, options?: PostBuilderClientOptions): Promise<VoiceProfile[]>;
	discover(
		input: DiscoverPostBuilderInput,
		options?: PostBuilderClientOptions
	): Promise<PostBuilderOpportunity[]>;
}

interface OpenPostBuilderClientDependencies {
	client?: APIClient;
	createIdempotencyKey?: () => string;
}

interface StoredBuilderSubmission {
	signature: string;
	key: string;
}

const submissionStoragePrefix = 'openpost:publication-builder:submission:';

function submissionSignature(body: components['schemas']['CreatePublicationBuildBody']): string {
	const serialized = JSON.stringify(body);
	let hash = 14_695_981_039_346_656_037n;
	for (let index = 0; index < serialized.length; index += 1) {
		hash ^= BigInt(serialized.charCodeAt(index));
		hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
	}
	return `${serialized.length.toString(36)}:${hash.toString(36)}`;
}

function readStoredSubmission(workspaceId: string): StoredBuilderSubmission | undefined {
	const storage = builderStorage();
	if (!storage) return undefined;
	try {
		const raw = storage.getItem(`${submissionStoragePrefix}${workspaceId}`);
		if (!raw) return undefined;
		const separator = raw.indexOf('\n');
		if (separator < 1 || separator === raw.length - 1) return undefined;
		return { signature: raw.slice(0, separator), key: raw.slice(separator + 1) };
	} catch {
		return undefined;
	}
}

function writeStoredSubmission(workspaceId: string, submission: StoredBuilderSubmission): void {
	const storage = builderStorage();
	if (!storage) return;
	try {
		storage.setItem(
			`${submissionStoragePrefix}${workspaceId}`,
			`${submission.signature}\n${submission.key}`
		);
	} catch {
		// In-memory reuse still protects retries while this client remains mounted.
	}
}

function removeStoredSubmission(workspaceId: string): void {
	const storage = builderStorage();
	if (!storage) return;
	try {
		storage.removeItem(`${submissionStoragePrefix}${workspaceId}`);
	} catch {
		// The server still protects the request made with the current in-memory key.
	}
}

function builderStorage(): Storage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}

export function createOpenPostBuilderClient(
	dependencies: OpenPostBuilderClientDependencies = {}
): OpenPostBuilderClient {
	const apiClient = dependencies.client ?? defaultClient;
	const createIdempotencyKey =
		dependencies.createIdempotencyKey ??
		(() => `publication-builder:${globalThis.crypto.randomUUID()}`);
	const submissions = new Map<string, StoredBuilderSubmission>();
	const buildWorkspaces = new Map<string, string>();

	function rememberBuild(build: WirePublicationBuild): void {
		buildWorkspaces.set(build.id, build.workspace_id);
	}

	function keyFor(input: CreatePostBuilderRunInput): string {
		const signature = submissionSignature(publicationBuildBody(input));
		const stored = submissions.get(input.workspaceId) ?? readStoredSubmission(input.workspaceId);
		if (stored?.signature === signature) {
			submissions.set(input.workspaceId, stored);
			return stored.key;
		}
		const next = { signature, key: createIdempotencyKey() };
		submissions.set(input.workspaceId, next);
		writeStoredSubmission(input.workspaceId, next);
		return next.key;
	}

	function finishBuild(runId: string, workspaceId?: string): void {
		const owner = workspaceId || buildWorkspaces.get(runId);
		if (!owner) return;
		buildWorkspaces.delete(runId);
		submissions.delete(owner);
		removeStoredSubmission(owner);
	}

	return {
		async availability(options) {
			const { data, error, response } = await apiClient.GET('/auth/config', {
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			return {
				builderEnabled: data.content_builder_enabled,
				discoveryEnabled: data.content_discovery_enabled
			};
		},
		async create(input, options) {
			const { data, error, response } = await apiClient.POST('/publication-builds', {
				params: { header: { 'Idempotency-Key': keyFor(input) } },
				body: publicationBuildBody(input),
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			rememberBuild(data);
			return mapPublicationBuild(data);
		},
		async load(runId, options) {
			const { data, error, response } = await apiClient.GET('/publication-builds/{id}', {
				params: { path: { id: runId } },
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			rememberBuild(data);
			return mapPublicationBuild(data);
		},
		async cancel(runId, options) {
			const { data, error, response } = await apiClient.POST('/publication-builds/{id}/cancel', {
				params: { path: { id: runId } },
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			rememberBuild(data);
			finishBuild(data.id, data.workspace_id);
			return mapPublicationBuild(data);
		},
		async retry(runId, options) {
			const { data, error, response } = await apiClient.POST('/publication-builds/{id}/retry', {
				params: { path: { id: runId } },
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			rememberBuild(data);
			return mapPublicationBuild(data);
		},
		async commit(runId, options): Promise<PostBuilderCommitResult> {
			const { data, error, response } = await apiClient.POST('/publication-builds/{id}/commit', {
				params: { path: { id: runId } },
				signal: options?.signal
			});
			if (error || !data) throw clientError(error, response.status);
			finishBuild(runId);
			return { publicationId: data.publication_id, href: data.href };
		},
		async listVoices(workspaceId, options) {
			const { data, error, response } = await apiClient.GET('/voice-profiles', {
				params: { query: { workspace_id: workspaceId } },
				signal: options?.signal
			});
			if (error) throw clientError(error, response.status);
			return (data ?? []).map(mapVoiceProfile);
		},
		async discover(input, options) {
			const { data, error, response } = await apiClient.POST(
				'/publication-opportunities/discover',
				{
					body: discoveryBody(input),
					signal: options?.signal
				}
			);
			if (error || !data) throw clientError(error, response.status);
			return (data.opportunities ?? []).map(mapOpportunity);
		}
	};
}

function publicationBuildBody(
	input: CreatePostBuilderRunInput
): components['schemas']['CreatePublicationBuildBody'] {
	return {
		workspace_id: input.workspaceId,
		idea: input.sourceText,
		account_ids: input.accountIds,
		social_set_id: input.socialSetId || undefined,
		voice_profile_id: input.voiceProfileId || undefined,
		context_urls: input.contextUrls,
		assets: input.assets.map((asset) => ({
			media_id: asset.mediaId,
			role: asset.role,
			may_publish: asset.mayPublish
		})),
		direction: {
			outcome: input.direction.goal,
			audience: input.direction.audience,
			angle: input.direction.angle,
			tone_adjustment: input.direction.tone,
			media_preference: input.direction.media
		},
		destination_policy: input.direction.destinationStrategy ?? 'recommend'
	};
}

function discoveryBody(
	input: DiscoverPostBuilderInput
): components['schemas']['DiscoverPublicationOpportunitiesInputBody'] {
	return {
		workspace_id: input.workspaceId,
		focus: input.focus?.trim() || undefined,
		audience: input.audience?.trim() || undefined,
		voice_profile_id: input.voiceProfileId || undefined,
		platforms: [...new Set(input.platforms)],
		limit: input.limit ?? 6
	};
}

function mapPublicationBuild(build: WirePublicationBuild): PostBuilderRun {
	const phase = mapBuildPhase(build.state, build.phase);
	return {
		id: build.id,
		phase,
		updatedAt: build.updated_at,
		canCancel: build.state === 'queued' || build.state === 'building',
		canRetry: build.state === 'failed',
		error: build.error_message
			? { message: build.error_message, code: build.error_code || undefined }
			: undefined,
		result: build.result ? mapBuildResult(build) : undefined
	};
}

function mapBuildPhase(state: string, phase: string): PostBuilderRun['phase'] {
	if (state === 'failed' || phase === 'failed') return 'failed';
	if (state === 'cancelled' || phase === 'cancelled') return 'cancelled';
	if (state === 'ready' || state === 'committed' || phase === 'ready' || phase === 'committed') {
		return 'ready';
	}
	if (phase === 'sources') return 'understanding';
	if (phase === 'directing') return 'planning';
	if (phase === 'drafting') return 'drafting';
	if (phase === 'reviewing') return 'reviewing';
	if (phase === 'committing') return 'opening_composer';
	return 'queued';
}

function mapBuildResult(build: WirePublicationBuild): NonNullable<PostBuilderRun['result']> {
	const result = build.result;
	if (!result) {
		return {
			publicationId: build.publication_id ?? '',
			thesis: 'OpenPost prepared this publication package.',
			destinationDecisions: []
		};
	}
	const labels = new Map(
		(build.input?.destinations ?? []).map((destination) => [destination.account_id, destination])
	);
	const flags = result.review_flags ?? [];
	const destinationDecisions: PostBuilderDestinationDecision[] = [
		...(result.destinations ?? []).map((destination) => {
			const label = labels.get(destination.account_id);
			const destinationFlags = flags.filter(
				(flag) => !flag.account_id || flag.account_id === destination.account_id
			);
			const reasons = [
				...(destination.warnings ?? []),
				...destinationFlags.map((flag) => flag.message)
			].filter(Boolean);
			return {
				accountId: destination.account_id,
				platform: destination.platform,
				accountLabel: label?.label || destination.platform,
				status: destinationFlags.length > 0 ? 'needs_review' : 'included',
				reason: reasons.join(' '),
				formatLabel: destination.output_profile,
				mediaTreatment: mediaPlanLabel(destination.media)
			} satisfies PostBuilderDestinationDecision;
		}),
		...(result.skipped ?? []).map((destination) => ({
			accountId: destination.account_id,
			platform: destination.platform,
			accountLabel: labels.get(destination.account_id)?.label || destination.platform,
			status: 'skipped' as const,
			reason: destination.reason
		}))
	];
	const allClaims = [
		...(result.direction?.claims ?? []),
		...(result.destinations ?? []).flatMap((destination) => destination.claims ?? [])
	];
	const claims = uniqueClaims(allClaims);
	const mediaPlan = uniqueMediaPlans(result);
	const voiceNames = [
		...new Set(
			(build.input?.destinations ?? [])
				.map((destination) => destination.voice?.name?.trim())
				.filter((name): name is string => Boolean(name))
		)
	];
	return {
		publicationId: build.publication_id ?? '',
		thesis:
			result.direction?.thesis?.trim() ||
			result.canonical_text?.trim() ||
			'OpenPost prepared this publication package.',
		angle: result.direction?.angle,
		goal: result.direction?.outcome,
		audience: result.direction?.audience,
		voiceLabel: voiceNames.length === 1 ? voiceNames[0] : undefined,
		destinationDecisions,
		claims,
		mediaPlan
	};
}

function uniqueClaims(claims: WireClaim[]): PostBuilderClaim[] {
	const seen = new Set<string>();
	const output: PostBuilderClaim[] = [];
	for (const claim of claims) {
		const text = claim.text?.trim();
		const key = text?.toLocaleLowerCase();
		if (!text || !key || seen.has(key)) continue;
		seen.add(key);
		output.push({
			id: `claim-${output.length + 1}`,
			text,
			status: mapClaimStatus(claim.status),
			sourceLabel: claim.source_refs?.join(', ')
		});
	}
	return output;
}

function mapClaimStatus(status: string): PostBuilderClaim['status'] {
	if (status === 'supported') return 'verified';
	return 'needs_review';
}

function uniqueMediaPlans(result: WireBuildResult): PostBuilderMediaPlanItem[] {
	const plans = [
		{ platform: '', accountId: '', media: result.direction?.media },
		...(result.destinations ?? []).map((destination) => ({
			platform: destination.platform,
			accountId: destination.account_id,
			media: destination.media
		}))
	];
	const seen = new Set<string>();
	const output: PostBuilderMediaPlanItem[] = [];
	for (const plan of plans) {
		const label = mediaPlanLabel(plan.media);
		if (!label || plan.media?.treatment === 'none') continue;
		const key = `${plan.accountId}:${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const treatment = plan.media?.treatment?.trim();
		output.push({
			id: `media-${output.length + 1}`,
			accountId: plan.accountId || undefined,
			platform: plan.platform || undefined,
			label,
			treatment,
			brief: plan.media?.brief?.trim() || undefined,
			action: mediaPlanAction(treatment),
			status: 'planned'
		});
	}
	return output;
}

function mediaPlanAction(
	treatment: string | undefined
): PostBuilderMediaPlanItem['action'] | undefined {
	if (treatment === 'meme') return 'meme';
	if (treatment === 'statement_card' || treatment === 'carousel' || treatment === 'concept_image') {
		return 'image_editor';
	}
	return undefined;
}

function mediaPlanLabel(media: WireMediaPlan | undefined): string | undefined {
	if (!media) return undefined;
	return [media.treatment, media.brief].filter((value) => value?.trim()).join(': ') || undefined;
}

function mapOpportunity(
	opportunity: NonNullable<WireDiscoveryResult['opportunities']>[number]
): PostBuilderOpportunity {
	const source = opportunity.sources?.[0];
	return {
		id: opportunity.id,
		title: opportunity.title,
		summary: opportunity.why_now || opportunity.hook || opportunity.why_it_fits,
		whyRelevant: opportunity.why_it_fits,
		sourceLabel: source?.publisher || source?.title,
		sourceURL: source?.url,
		sourceURLs: (opportunity.sources ?? []).map((item) => item.url),
		publishedAt: opportunity.signal_date || source?.published_at,
		angles: (opportunity.angles ?? []).map((angle) => ({
			id: angle.id,
			label: angle.label,
			description: [angle.thesis, angle.approach].filter(Boolean).join(' ')
		})),
		treatments: (opportunity.platform_treatments ?? []).map((treatment) => ({
			platform: treatment.platform,
			label: [treatment.format, treatment.rationale, treatment.media].filter(Boolean).join(' - ')
		}))
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
		definition: mapVoiceDefinition(profile.definition),
		assignedAccountIds: profile.assigned_account_ids ?? [],
		createdAt: profile.created_at,
		updatedAt: profile.updated_at
	};
}

function mapVoiceDefinition(definition: WireVoiceDefinition): VoiceProfileDefinition {
	return {
		identitySummary: definition.identity_summary ?? '',
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
		corrections: (definition.corrections ?? []).map((correction) => ({
			original: correction.original,
			preferred: correction.preferred,
			lesson: correction.lesson
		})),
		interviewAnswers: (definition.interview_answers ?? []).map((answer) => ({
			question: answer.question,
			answer: answer.answer
		}))
	};
}

function clientError(problem: APIProblem | undefined, status: number): Error {
	return new Error(
		problem?.detail?.trim() ||
			problem?.title?.trim() ||
			(status > 0 ? `Request failed (${status})` : 'Request failed')
	);
}
