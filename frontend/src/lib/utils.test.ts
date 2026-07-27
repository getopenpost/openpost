import { describe, expect, it } from 'vitest';
import { formatAccountHandle } from './utils';

describe('formatAccountHandle', () => {
	it('adds a handle prefix when it is missing', () => {
		expect(formatAccountHandle('rodgds')).toBe('@rodgds');
	});

	it('does not duplicate an existing handle prefix', () => {
		expect(formatAccountHandle('@rodgds')).toBe('@rodgds');
	});

	it('normalizes whitespace and repeated prefixes', () => {
		expect(formatAccountHandle('  @@rodgds  ')).toBe('@rodgds');
	});

	it('returns an empty string when no username is available', () => {
		expect(formatAccountHandle(undefined)).toBe('');
		expect(formatAccountHandle('@@')).toBe('');
	});
});
