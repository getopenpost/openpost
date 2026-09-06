import { describe, expect, it } from 'vitest';
import { canAttachImageEditorPreview } from './preview-generation';

describe('OpenPost Image Editor preview generations', () => {
	it('rejects a completed render when the editor changed while it was in flight', () => {
		expect(canAttachImageEditorPreview(4, 5, true)).toBe(false);
		expect(canAttachImageEditorPreview(5, 5, false)).toBe(false);
		expect(canAttachImageEditorPreview(5, 5, true)).toBe(true);
	});
});
