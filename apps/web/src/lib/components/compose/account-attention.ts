import type { components } from '$lib/api/types';
import { isSharedComposerIssue } from './validation';

type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
type ValidationIssue = components['schemas']['ValidationIssue'];

const informationalIssueCodes = new Set(['quota_warning']);

export function isActionableAccountIssue(issue: ValidationIssue): boolean {
	return !informationalIssueCodes.has(issue.code);
}

export function accountCapabilityNeedsAttention(capability: ResolvedAccountCapability): boolean {
	const issues = capability.issues ?? [];
	if (issues.some((issue) => !isSharedComposerIssue(issue) && isActionableAccountIssue(issue))) {
		return true;
	}
	if (!capability.compatible) {
		return issues.length === 0 || issues.some((issue) => !isSharedComposerIssue(issue));
	}
	return false;
}
