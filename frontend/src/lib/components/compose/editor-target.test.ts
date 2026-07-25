import { describe, expect, it } from 'vitest';
import { editorAccountIdAfterVariantLoad, initialEditorAccountId } from './editor-target';

describe('initialEditorAccountId', () => {
	it('opens the only divergent destination instead of an empty shared editor', () => {
		expect(initialEditorAccountId(['linkedin-1'], ['linkedin-1'])).toBe('linkedin-1');
	});

	it('opens the first selected destination when every destination is divergent', () => {
		expect(initialEditorAccountId(['linkedin-1', 'x-1'], ['x-1', 'linkedin-1'])).toBe('linkedin-1');
	});

	it('preserves the shared editor while any selected destination remains synced', () => {
		expect(initialEditorAccountId(['linkedin-1', 'x-1'], ['linkedin-1'])).toBeNull();
	});
});

describe('editorAccountIdAfterVariantLoad', () => {
	it('opens the first actual variant on initial load only when every destination is divergent', () => {
		expect(
			editorAccountIdAfterVariantLoad(null, ['linkedin-1', 'x-1'], ['x-1', 'linkedin-1'])
		).toBe('linkedin-1');
		expect(editorAccountIdAfterVariantLoad(null, ['linkedin-1', 'x-1'], ['x-1'])).toBeNull();
	});

	it('preserves a valid manually selected variant on refresh', () => {
		expect(
			editorAccountIdAfterVariantLoad('x-1', ['linkedin-1', 'x-1'], ['linkedin-1', 'x-1'])
		).toBe('x-1');
	});
});
