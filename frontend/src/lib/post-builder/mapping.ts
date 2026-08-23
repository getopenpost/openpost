import type {
	CreatePostBuilderRunInput,
	PostBuilderDirection,
	PostBuilderMode,
	PostBuilderOpportunity,
	PostBuilderRun,
	PostBuilderRunPhase,
	PostBuilderSource
} from './types';

export type PostBuilderValidationCode =
	| 'workspace_required'
	| 'source_required'
	| 'opportunity_required'
	| 'destinations_required';

export interface PostBuilderDraftInput {
	workspaceId: string;
	mode: PostBuilderMode;
	sourceText: string;
	sources: PostBuilderSource[];
	selectedOpportunityId?: string;
	selectedOpportunityAngleId?: string;
	socialSetId?: string;
	selectedAccountIds: string[];
	voiceProfileId?: string;
	direction?: PostBuilderDirection;
	requiresDestinations?: boolean;
}

const phaseProgress = {
	queued: 6,
	understanding: 22,
	planning: 44,
	drafting: 68,
	preparing_media: 88,
	ready: 100,
	failed: 100,
	cancelled: 100
} satisfies Record<PostBuilderRunPhase, number>;

function sourceIsReady(source: PostBuilderSource): boolean {
	return source.status === undefined || source.status === 'ready';
}

export function trimOptional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

export function uniqueValues(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizePostBuilderDirection(
	direction: PostBuilderDirection | undefined
): PostBuilderDirection {
	if (!direction) return { research: 'auto', destinationStrategy: 'selected' };
	return {
		goal: trimOptional(direction.goal),
		audience: trimOptional(direction.audience),
		angle: trimOptional(direction.angle),
		tone: trimOptional(direction.tone),
		media: trimOptional(direction.media),
		length: trimOptional(direction.length),
		research: direction.research ?? 'auto',
		destinationStrategy: direction.destinationStrategy ?? 'selected'
	};
}

export function validatePostBuilderDraft(
	input: PostBuilderDraftInput
): PostBuilderValidationCode[] {
	const issues: PostBuilderValidationCode[] = [];
	if (!input.workspaceId.trim()) issues.push('workspace_required');
	if (input.mode === 'source') {
		const usableSources = input.sources.some(sourceIsReady);
		if (!input.sourceText.trim() && !usableSources) issues.push('source_required');
	} else if (!input.selectedOpportunityId?.trim()) {
		issues.push('opportunity_required');
	}
	if (input.requiresDestinations !== false && uniqueValues(input.selectedAccountIds).length === 0) {
		issues.push('destinations_required');
	}
	return issues;
}

export function createPostBuilderRunInput(input: PostBuilderDraftInput): CreatePostBuilderRunInput {
	const request: CreatePostBuilderRunInput = {
		workspaceId: input.workspaceId.trim(),
		mode: input.mode,
		sourceText: input.sourceText.trim(),
		sourceIds: uniqueValues(input.sources.filter(sourceIsReady).map((source) => source.id)),
		accountIds: uniqueValues(input.selectedAccountIds),
		direction: normalizePostBuilderDirection(input.direction)
	};
	const opportunityId = trimOptional(input.selectedOpportunityId);
	const opportunityAngleId = trimOptional(input.selectedOpportunityAngleId);
	const socialSetId = trimOptional(input.socialSetId);
	const voiceProfileId = trimOptional(input.voiceProfileId);
	if (opportunityId) request.opportunityId = opportunityId;
	if (opportunityAngleId) request.opportunityAngleId = opportunityAngleId;
	if (socialSetId) request.socialSetId = socialSetId;
	if (voiceProfileId) request.voiceProfileId = voiceProfileId;
	return request;
}

export function postBuilderRunIsActive(run: PostBuilderRun | null | undefined): boolean {
	return Boolean(
		run &&
		(run.phase === 'queued' ||
			run.phase === 'understanding' ||
			run.phase === 'planning' ||
			run.phase === 'drafting' ||
			run.phase === 'preparing_media')
	);
}

export function postBuilderRunIsTerminal(run: PostBuilderRun): boolean {
	return !postBuilderRunIsActive(run);
}

export function postBuilderRunProgress(run: PostBuilderRun): number {
	if (Number.isFinite(run.progress)) {
		return Math.max(0, Math.min(100, Math.round(run.progress ?? 0)));
	}
	return phaseProgress[run.phase];
}

export function postBuilderDirectionLabel(direction: PostBuilderDirection | undefined): string {
	if (!direction) return 'Auto';
	const manualFields = [
		direction.goal,
		direction.audience,
		direction.angle,
		direction.tone,
		direction.media,
		direction.length
	].filter((value) => Boolean(value?.trim())).length;
	const strategyIsManual =
		direction.research === 'off' ||
		direction.research === 'required' ||
		direction.destinationStrategy === 'curated';
	const changes = manualFields + (strategyIsManual ? 1 : 0);
	return changes === 0 ? 'Auto' : `${changes} ${changes === 1 ? 'choice' : 'choices'}`;
}

export function opportunitySourcePreview(opportunity: PostBuilderOpportunity): string {
	return [opportunity.title.trim(), opportunity.summary.trim()].filter(Boolean).join('\n\n');
}
