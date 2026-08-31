import { applyAPIRequestHeaders } from '$lib/api/client';

export interface PublicationBuildMediaPlan {
	treatment: string;
	role: string;
	brief: string;
	source_ref?: string;
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
	angles: Array<{ id: string; label: string; thesis: string; approach: string }>;
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

export interface PublicationBuild {
	id: string;
	workspace_id: string;
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
}

export interface VoiceProfileSummary {
	id: string;
	name: string;
	is_default: boolean;
}

async function apiRequest<T>(
	path: string,
	init: RequestInit = {},
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
			const problem = (await response.json()) as { detail?: string; title?: string };
			message = problem.detail || problem.title || message;
		} catch {
			// Keep the bounded fallback when the server did not return a problem document.
		}
		throw new Error(message);
	}
	// SAFETY: Each endpoint wrapper fixes T to the matching generated HTTP response contract.
	return (await response.json()) as T;
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
	return apiRequest(
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
	return apiRequest(
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
	return apiRequest(
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
	return apiRequest(`/publication-builds/${encodeURIComponent(id)}`, {}, signal);
}

export function cancelPublicationBuild(id: string): Promise<PublicationBuild> {
	return apiRequest(`/publication-builds/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export function retryPublicationBuild(id: string): Promise<PublicationBuild> {
	return apiRequest(`/publication-builds/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export function listVoiceProfiles(workspaceID: string): Promise<VoiceProfileSummary[]> {
	return apiRequest(`/voice-profiles?workspace_id=${encodeURIComponent(workspaceID)}`);
}
