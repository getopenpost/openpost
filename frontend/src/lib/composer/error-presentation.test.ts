import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { composerErrorMessage } from './error-presentation';
import { ComposerClientError, ComposerSessionError, composerErrorCodes } from './session';

describe('composer error presentation', () => {
	afterEach(() => setLocale('en', { reload: false }));

	it('has distinct English and Portuguese presentation for every domain failure', () => {
		setLocale('en', { reload: false });
		const english = composerErrorCodes.map((code) =>
			composerErrorMessage(new ComposerSessionError(code))
		);
		setLocale('pt', { reload: false });
		const portuguese = composerErrorCodes.map((code) =>
			composerErrorMessage(new ComposerSessionError(code))
		);
		for (const [index, code] of composerErrorCodes.entries()) {
			expect(english[index]).not.toBe(code);
			expect(portuguese[index]).not.toBe(code);
			expect(portuguese[index]).not.toBe(english[index]);
		}
	});

	it('preserves precise API details instead of replacing provider truth', () => {
		expect(
			composerErrorMessage(new ComposerClientError('invalid', 'Instagram requires a caption.'))
		).toBe('Instagram requires a caption.');
	});
});
