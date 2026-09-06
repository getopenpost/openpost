import { describe, expect, it } from 'vitest';
import { resolveBackgroundRemovalPublicPath } from './background-removal';

describe('OpenPost Image Editor background removal', () => {
	it('resolves the bundled root-relative model path against the current app URL', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'/image-editor-models/',
				'https://app.example.com/image-editor/design-1'
			)
		).toBe('https://app.example.com/image-editor-models/');
	});

	it('normalizes operator overrides with a trailing slash', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'https://models.example.test/openpost',
				'https://app.example.com/'
			)
		).toBe('https://models.example.test/openpost/');
	});
});
