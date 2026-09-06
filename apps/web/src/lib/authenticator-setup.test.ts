import { describe, expect, it, vi } from 'vitest';
import { copyAuthenticatorSetupKey, isAuthenticatorCodeReady } from './authenticator-setup';

describe('authenticator setup', () => {
	it('accepts exactly six numeric code characters', () => {
		expect(isAuthenticatorCodeReady('123456')).toBe(true);
		expect(isAuthenticatorCodeReady('12345')).toBe(false);
		expect(isAuthenticatorCodeReady('1234567')).toBe(false);
		expect(isAuthenticatorCodeReady('12345a')).toBe(false);
	});

	it('copies the exact setup value without transforming it', async () => {
		let copiedValue = '';
		const copied = await copyAuthenticatorSetupKey('test-setup-value', async (value) => {
			copiedValue = value;
		});

		expect(copied).toBe(true);
		expect(copiedValue).toBe('test-setup-value');
	});

	it('reports unavailable and rejected clipboard writes without throwing', async () => {
		const writeText = vi.fn(async () => {
			throw new Error('clipboard unavailable');
		});

		await expect(copyAuthenticatorSetupKey('test-setup-value', writeText)).resolves.toBe(false);
		expect(writeText).toHaveBeenCalledOnce();
		await expect(copyAuthenticatorSetupKey('', writeText)).resolves.toBe(false);
		expect(writeText).toHaveBeenCalledOnce();
	});
});
