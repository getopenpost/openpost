import { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import { getLocaleTag } from '$lib/i18n';
import { formatBytes } from '$lib/byte-size';
import type { components } from '$lib/api/types';

export type ValidationIssue = components['schemas']['ValidationIssue'];

export interface ComposerIssue {
	id: string;
	message: string;
	severity: 'error' | 'warning';
	code?: string;
	accountId?: string;
	targetLabel?: string;
	provider?: string;
	field?: string;
	segmentId?: string;
	scopeId?: string;
	mediaId?: string;
}

export interface ComposerIssueDestination {
	accountId: string;
	provider: string;
	label: string;
}

export interface TargetedComposerIssue {
	id: string;
	message: string;
	severity?: 'error' | 'warning';
	accountId: string;
	targetLabel: string;
	provider?: string;
}

const sharedComposerIssueCodes = new Set(['media_required']);

const textLimitIssueCodes = new Set(['text_too_long', 'dynamic_text_limit']);

export function isTextLimitIssue(issue: Pick<ComposerIssue, 'code'>): boolean {
	return Boolean(issue.code && textLimitIssueCodes.has(issue.code));
}

export function isSharedComposerIssue(issue: ValidationIssue): boolean {
	return sharedComposerIssueCodes.has(issue.code);
}

export function isAccountSpecificIssue(issue: ValidationIssue): boolean {
	if (isSharedComposerIssue(issue)) return false;
	return Boolean(issue.provider?.trim() || issue.profile?.trim() || issue.output_profile?.trim());
}

export function issueMatchesProvider(issue: ValidationIssue, provider: string): boolean {
	return issue.provider?.trim().toLowerCase() === provider.trim().toLowerCase();
}

export function uniqueIssueMessages(messages: Array<string | null | undefined>): string[] {
	const normalized = messages
		.map((message) => message?.trim())
		.filter((message): message is string => Boolean(message));
	return Array.from(new Set(normalized));
}

const imageSizeParameters = z.object({
	size_bytes: z.number().finite().nonnegative(),
	max_size_bytes: z.number().finite().positive()
});

function issueMessage(issue: ValidationIssue): string {
	if (issue.code !== 'media_size') return issue.message;
	const parameters = imageSizeParameters.safeParse(issue.parameters);
	if (!parameters.success) return issue.message;
	const options = {
		base: 'si',
		locale: getLocaleTag(),
		maximumFractionDigits: 2
	} satisfies Parameters<typeof formatBytes>[1];
	const size = formatBytes(parameters.data.size_bytes, options);
	const limit = formatBytes(parameters.data.max_size_bytes, options);
	return size && limit ? m.compose_image_size_limit({ size, limit }) : issue.message;
}

export function composerIssues(
	localErrors: string[],
	validationIssues: ValidationIssue[],
	destinations: ComposerIssueDestination[] = [],
	targetedIssues: TargetedComposerIssue[] = []
): ComposerIssue[] {
	const issues: ComposerIssue[] = localErrors.map((message, index) => ({
		id: `local-${index}-${message}`,
		message,
		severity: 'error'
	}));
	for (const issue of targetedIssues) {
		issues.push({
			...issue,
			severity: issue.severity ?? 'error'
		});
	}
	for (const issue of validationIssues) {
		if (issue.severity === 'info') continue;
		const matchingDestinations = isAccountSpecificIssue(issue)
			? destinations.filter((destination) => issueMatchesProvider(issue, destination.provider))
			: [];
		const targets = isAccountSpecificIssue(issue)
			? matchingDestinations.length > 0
				? matchingDestinations
				: [
						{
							accountId: '',
							provider: issue.provider ?? '',
							label: issue.provider ?? ''
						}
					]
			: [{ accountId: '', provider: '', label: '' }];
		for (const target of targets) {
			issues.push({
				id: `${issue.code}-${target.accountId}-${issue.segment_id ?? ''}-${issue.scope_id ?? ''}-${issue.field ?? ''}-${issue.media_id ?? ''}-${issue.message}`,
				message: issueMessage(issue),
				severity: issue.severity === 'warning' ? 'warning' : 'error',
				code: issue.code,
				accountId: target.accountId || undefined,
				targetLabel: target.label || undefined,
				provider: issue.provider || undefined,
				field: issue.field || undefined,
				segmentId: issue.segment_id || undefined,
				scopeId: issue.scope_id || undefined,
				mediaId: issue.media_id || undefined
			});
		}
	}
	return issues.filter(
		(issue, index) =>
			issues.findIndex(
				(candidate) =>
					candidate.message === issue.message &&
					candidate.severity === issue.severity &&
					candidate.accountId === issue.accountId &&
					candidate.segmentId === issue.segmentId &&
					candidate.scopeId === issue.scopeId &&
					candidate.field === issue.field &&
					candidate.mediaId === issue.mediaId
			) === index
	);
}
