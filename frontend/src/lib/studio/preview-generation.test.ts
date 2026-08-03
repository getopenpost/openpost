import { describe, expect, it } from 'vitest';
import { canAttachStudioPreview } from './preview-generation';

describe('Studio preview generations', () => {
	it('rejects a completed render when the editor changed while it was in flight', () => {
		expect(canAttachStudioPreview(4, 5, true)).toBe(false);
		expect(canAttachStudioPreview(5, 5, false)).toBe(false);
		expect(canAttachStudioPreview(5, 5, true)).toBe(true);
	});
});
