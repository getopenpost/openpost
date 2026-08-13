import { describe, expect, it } from 'vitest';
import { normalizeOrganizationAPITokenMode } from './organization-sso-policy';

describe('normalizeOrganizationAPITokenMode', () => {
	it.each([
		['scoped', 'scoped'],
		['deny', 'deny'],
		['allow', 'scoped'],
		['unexpected', 'deny']
	] as const)('normalizes %s to %s', (stored, expected) => {
		expect(normalizeOrganizationAPITokenMode(stored)).toBe(expected);
	});
});
