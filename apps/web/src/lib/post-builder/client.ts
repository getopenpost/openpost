import type { components } from '@openpost/api-contract';
import { applyAPIRequestHeaders, client } from '$lib/api/client';
import { queryTransportRequest } from '$lib/query/transport';
import type { ScreenshotDocument } from '@openpost/query-catalog';

export interface PublicationBuildMediaPlan {
	treatment: string;
	role: string;
	brief: string;
	source_ref?: string;
	template_id?: string;
	document?: ScreenshotDocument | null;
	alt_text?: string;
}

export interface PublicationBuildDirection {
	outcome?: string;
	audience?: string;
	angle?: string;
	tone_adjustment?: string;
	media_preference?: string;
}

export interface PublicationBuildAngle {
	id: string;
	label: string;
	hook: string;
	thesis: string;
	approach: string;
	objective: string;
	desired_reaction: string;
	evidence: string;
	media: PublicationBuildMediaPlan;
	build_direction: PublicationBuildDirection;
}

export interface PublicationOpportunity {
	id: string;
	title: string;
	why_it_fits: string;
	why_now: string;
	signal_date: string;
	hook: string;
	angles: Array<{
		id: string;
		label: string;
		thesis: string;
		approach: string;
	}>;
	platform_treatments: Array<{
		platform: string;
		objective: string;
		format: string;
		rationale: string;
		media: string;
	}>;
}

export interface PublicationBuildAsset {
	media_id: string;
	role: 'context' | 'evidence' | 'artifact';
	may_publish: boolean;
}

export interface PublicationBuildRequest {
	series_count?: number;
	option_count?: 0 | 4;
	workspace_id: string;
	idea: string;
	account_ids: string[];
	social_set_id?: string;
	voice_profile_id?: string;
	context_urls?: string[];
	context_notes?: string;
	context_may_publish?: boolean;
	assets?: PublicationBuildAsset[];
	direction?: PublicationBuildDirection;
	destination_policy?: 'recommend' | 'require_all';
}

export interface PublicationBuildDestinationPlan {
	account_id: string;
	platform: string;
	objective: string;
	archetype: string;
	output_profile: string;
	preview: string;
	segments: Array<{ body: string; title?: string; description?: string }>;
	media: PublicationBuildMediaPlan;
	warnings?: string[];
	follow_up_notes?: string[];
}

export interface PublicationBuildResult {
	series?: components['schemas']['SeriesConcept'][];
	sources?: Array<{
		id: string;
		kind: string;
		label: string;
		mime_type?: string;
		publishable: boolean;
	}>;
	options?: PublicationPostOption[];
	canonical_text: string;
	direction: {
		thesis: string;
		outcome: string;
		audience: string;
		angle: string;
		route: string;
		media: PublicationBuildMediaPlan;
	};
	destinations: PublicationBuildDestinationPlan[];
	skipped?: Array<{ account_id: string; platform: string; reason: string }>;
	review_flags?: Array<{
		account_id?: string;
		field: string;
		severity: string;
		message: string;
	}>;
}

export interface PublicationPostOption extends Omit<PublicationBuildResult, 'options'> {
	id: string;
	label: string;
}

export interface PublicationBuild {
	series_origin?: components['schemas']['SeriesOrigin'];
	id: string;
	workspace_id: string;
	publication_id?: string;
	state: 'queued' | 'building' | 'ready' | 'committed' | 'failed' | 'cancelled';
	phase:
		| 'queued'
		| 'sources'
		| 'directing'
		| 'drafting'
		| 'reviewing'
		| 'ready'
		| 'committing'
		| 'committed'
		| 'failed'
		| 'cancelled';
	revision: number;
	result?: PublicationBuildResult;
	error_code?: string;
	error_message?: string;
	updated_at: string;
	context_urls?: string[];
	assets?: PublicationBuildAsset[];
	social_set_id?: string;
	voice_profile_id?: string;
	input?: {
		idea: string;
		sources?: Array<{ id: string; text?: string; publishable?: boolean }>;
		direction?: PublicationBuildDirection;
		destinations: Array<{ account_id: string }>;
		option_count?: number;
		series_count?: number;
	};
}

export async function commitPublicationOption(
	buildId: string,
	optionId: string,
	media: Array<{ account_id: string; media_id: string }>,
	option: PublicationPostOption,
	revision: number
) {
	const result = await client.POST('/publication-builds/{id}/options/{option_id}/commit', {
		params: { path: { id: buildId, option_id: optionId } },
		body: {
			expected_revision: revision,
			media,
			edits: option.destinations.map((destination) => ({
				account_id: destination.account_id,
				segments: destination.segments,
				document: destination.media.document ?? undefined
			}))
		}
	});
	if (result.error || !result.data)
		throw new Error(result.error?.detail || 'Could not create the draft.');
	return result.data;
}

export async function savePublicationOption(
	buildId: string,
	option: PublicationPostOption,
	revision: number
): Promise<PublicationBuild> {
	const result = await client.PUT('/publication-builds/{id}/options/{option_id}', {
		params: { path: { id: buildId, option_id: option.id } },
		body: {
			expected_revision: revision,
			edits: option.destinations.map((destination) => ({
				account_id: destination.account_id,
				segments: destination.segments,
				document: destination.media.document ?? undefined
			}))
		}
	});
	if (result.error || !result.data)
		throw new Error(result.error?.detail || 'Could not save the post edits.');
	// SAFETY: The backend enforces the same Build state and phase values as getPublicationBuild.
	return result.data as PublicationBuild;
}

// Recovered device edits are validated by the existing server mutation before
// being rendered. Never trust a stored visual document as an API response.
export function recoverPublicationOption(
	buildId: string,
	optionId: string,
	body: string
): Promise<PublicationBuild> {
	return apiMutationRequest(
		`/publication-builds/${encodeURIComponent(buildId)}/options/${encodeURIComponent(optionId)}`,
		{ method: 'PUT', body }
	);
}

type MutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MutationRequestInit extends RequestInit {
	method: MutationMethod;
}

async function apiMutationRequest<T>(
	path: string,
	init: MutationRequestInit,
	signal?: AbortSignal
): Promise<T> {
	const headers = applyAPIRequestHeaders(new Headers(init.headers));
	if (init.body) headers.set('Content-Type', 'application/json');
	const response = await fetch(`/api/v1${path}`, {
		...init,
		headers,
		credentials: 'include',
		signal
	});
	if (!response.ok) {
		let message = `OpenPost could not complete this AI request (${response.status}).`;
		try {
			// SAFETY: Problem responses are inspected only for optional string fields and retain a bounded fallback.
			const problem = (await response.json()) as {
				detail?: string;
				title?: string;
			};
			message = problem.detail || problem.title || message;
		} catch {
			// Keep the bounded fallback when the server did not return a problem document.
		}
		throw new Error(message);
	}
	// SAFETY: Each endpoint wrapper fixes T to the matching generated HTTP response contract.
	return (await response.json()) as T;
}

export interface ShortenedPostText {
	text: string;
	truncated: boolean;
}

export async function shortenPostText(input: {
	workspaceId: string;
	text: string;
	platform: string;
	maxCharacters: number;
}): Promise<ShortenedPostText> {
	const result = await apiMutationRequest<ShortenedPostText>('/post-builder/shorten', {
		method: 'POST',
		body: JSON.stringify({
			workspace_id: input.workspaceId,
			text: input.text,
			platform: input.platform,
			max_characters: input.maxCharacters
		})
	});
	return { text: result.text, truncated: result.truncated };
}

export function discoverPublicationOpportunities(
	input: {
		workspace_id: string;
		focus?: string;
		audience?: string;
		voice_profile_id?: string;
		platforms: string[];
		limit: number;
	},
	signal?: AbortSignal
): Promise<{ opportunities: PublicationOpportunity[] }> {
	return apiMutationRequest(
		'/publication-opportunities/discover',
		{
			method: 'POST',
			body: JSON.stringify(input)
		},
		signal
	);
}

export function planPublicationAngles(
	input: PublicationBuildRequest,
	signal?: AbortSignal
): Promise<{ angles: PublicationBuildAngle[] }> {
	return apiMutationRequest(
		'/publication-builds/angles',
		{
			method: 'POST',
			body: JSON.stringify(input)
		},
		signal
	);
}

export function createPublicationBuild(
	input: PublicationBuildRequest,
	idempotencyKey: string,
	signal?: AbortSignal
): Promise<PublicationBuild> {
	return apiMutationRequest(
		'/publication-builds',
		{
			method: 'POST',
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify(input)
		},
		signal
	);
}

export function getPublicationBuild(id: string, signal?: AbortSignal): Promise<PublicationBuild> {
	const requestSignal = signal ?? new AbortController().signal;
	return queryTransportRequest(requestSignal, (transportSignal) =>
		client.GET('/publication-builds/{id}', {
			params: { path: { id } },
			signal: transportSignal
		})
	).then(({ data, error, response }) => {
		if (error || !data) throw postBuilderRequestError(error, response.status);
		// SAFETY: PublicationBuild narrows the generated Build state and phase strings to values
		// enforced by the same backend endpoint without changing its response shape.
		return data as PublicationBuild;
	});
}

export function cancelPublicationBuild(id: string): Promise<PublicationBuild> {
	return apiMutationRequest(`/publication-builds/${encodeURIComponent(id)}/cancel`, {
		method: 'POST'
	});
}

export function retryPublicationBuild(id: string): Promise<PublicationBuild> {
	return apiMutationRequest(`/publication-builds/${encodeURIComponent(id)}/retry`, {
		method: 'POST'
	});
}

function postBuilderRequestError(
	error: { detail?: string; title?: string } | undefined,
	status: number
): Error {
	return new Error(
		error?.detail || error?.title || `OpenPost could not complete this AI request (${status}).`
	);
}
