import { describe, expect, it } from 'vitest';
import {
	PASSWORD_MAX_CHARACTERS,
	PASSWORD_MIN_CHARACTERS,
	passwordCharacterCount
} from './password-policy';

describe('password policy', () => {
	it('matches the server character bounds', () => {
		expect(PASSWORD_MIN_CHARACTERS).toBe(12);
		expect(PASSWORD_MAX_CHARACTERS).toBe(1024);
	});

	it('counts an astral Unicode character once', () => {
		expect(passwordCharacterCount('🔐'.repeat(12))).toBe(12);
	});
});
