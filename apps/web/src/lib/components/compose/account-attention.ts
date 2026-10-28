import type { components } from '$lib/api/types';

type ValidationIssue = components['schemas']['ValidationIssue'];

const informationalIssueCodes = new Set(['quota_warning']);

export function isActionableAccountIssue(issue: ValidationIssue): boolean {
	return issue.severity !== 'info' && !informationalIssueCodes.has(issue.code);
}
