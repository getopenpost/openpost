import { describe, expect, it } from 'vitest';
import { resolveBackgroundRemovalPublicPath } from './background-removal';

describe('Studio background removal', () => {
	it('resolves the bundled root-relative model path against the current app URL', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'/studio-models/',
				'https://app.openpost.social/studio/design-1'
			)
		).toBe('https://app.openpost.social/studio-models/');
	});

	it('normalizes operator overrides with a trailing slash', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'https://models.example.test/openpost',
				'https://app.openpost.social/'
			)
		).toBe('https://models.example.test/openpost/');
	});
});
