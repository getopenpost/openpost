import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCryptoRandomUUID } from './crypto-random-uuid';

afterEach(() => vi.unstubAllGlobals());

describe('crypto random UUID compatibility', () => {
	it('installs a compatible method for existing browser call sites', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (bytes: Uint8Array) => bytes.fill(9)
		});

		installCryptoRandomUUID();

		expect(globalThis.crypto.randomUUID()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});
});
