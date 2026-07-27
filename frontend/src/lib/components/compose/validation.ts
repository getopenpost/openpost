import type { components } from '$lib/api/types';

export type ValidationIssue = components['schemas']['ValidationIssue'];

export interface ComposerIssue {
	id: string;
	message: string;
	severity: 'error' | 'warning';
}

const sharedComposerIssueCodes = new Set(['media_required']);

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
	return Array.from(
		new Set(messages.map((message) => message?.trim()).filter(Boolean) as string[])
	);
}

export function composerIssues(
	localErrors: string[],
	validationIssues: ValidationIssue[]
): ComposerIssue[] {
	const issues: ComposerIssue[] = localErrors.map((message, index) => ({
		id: `local-${index}-${message}`,
		message,
		severity: 'error'
	}));
	for (const issue of validationIssues) {
		if (isAccountSpecificIssue(issue)) continue;
		issues.push({
			id: `${issue.code}-${issue.field ?? ''}-${issue.media_id ?? ''}-${issue.message}`,
			message: issue.message,
			severity: issue.severity === 'warning' ? 'warning' : 'error'
		});
	}
	return issues.filter(
		(issue, index) =>
			issues.findIndex(
				(candidate) => candidate.message === issue.message && candidate.severity === issue.severity
			) === index
	);
}
