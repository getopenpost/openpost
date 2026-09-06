import { describe, expect, it } from 'vitest';
import {
	builtInThemeReference,
	builtInManifestReference,
	sameThemeReference,
	sameThemeFamily,
	themeReferenceKey,
	WORKSHOP_REFERENCE
} from './theme-library-model';

describe('theme library references', () => {
	it('uses the versioned API identity for built-in selections', () => {
		expect(builtInThemeReference('notebook')).toEqual({
			kind: 'built_in',
			id: 'notebook',
			version: 1
		});
		expect(themeReferenceKey(WORKSHOP_REFERENCE)).toBe('built_in:workshop:1');
		expect(builtInManifestReference('studio', 'builtin-v4')).toEqual({
			kind: 'built_in',
			id: 'studio',
			version: 4
		});
	});

	it('does not collapse distinct published revisions into one selection', () => {
		const third = { kind: 'custom', id: 'northstar', version: 3 };
		const fourth = { kind: 'custom', id: 'northstar', version: 4 };
		expect(sameThemeReference(third, fourth)).toBe(false);
		expect(sameThemeFamily(third, fourth)).toBe(true);
	});
});
