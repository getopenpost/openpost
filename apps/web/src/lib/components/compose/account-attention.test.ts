import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { isActionableAccountIssue } from './account-attention';

type ValidationIssue = components['schemas']['ValidationIssue'];

function issue(code: string, severity: ValidationIssue['severity'] = 'warning'): ValidationIssue {
	return { code, severity, message: code, fallback_message: code };
}

describe('actionable account issues', () => {
	it('does not mark generic quota information as actionable', () => {
		expect(isActionableAccountIssue(issue('quota_warning'))).toBe(false);
	});

	it('keeps actionable warnings and ignores informational issues', () => {
		expect(isActionableAccountIssue(issue('media_aspect'))).toBe(true);
		expect(isActionableAccountIssue(issue('media_aspect', 'info'))).toBe(false);
	});
});
