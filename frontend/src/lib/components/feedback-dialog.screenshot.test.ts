import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./feedback-dialog.svelte', import.meta.url), 'utf8');
const dialogSource = readFileSync(
	new URL('./ui/dialog/dialog-content.svelte', import.meta.url),
	'utf8'
);

describe('feedback screenshot capture', () => {
	it('removes the feedback content and its blur overlay before capture', () => {
		expect(source).toContain("document.documentElement.dataset.feedbackCapturing = 'true'");
		expect(source).toContain('delete document.documentElement.dataset.feedbackCapturing');
		expect(source).toContain("overlayProps={{ 'data-feedback-ignore': '' }}");
		expect(source).toContain(
			":global(html[data-feedback-capturing='true'] [data-feedback-ignore])"
		);
		expect(dialogSource).toContain('<Dialog.Overlay {...overlayProps} />');
	});
});
