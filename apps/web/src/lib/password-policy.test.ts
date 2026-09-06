import { describe, expect, it } from 'vitest';
import { passwordCharacterCount } from './password-policy';

describe('password policy', () => {
	it('counts an astral Unicode character once', () => {
		expect(passwordCharacterCount('🔐'.repeat(12))).toBe(12);
	});
});
