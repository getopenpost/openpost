import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pagePath = fileURLToPath(new URL('./+page.svelte', import.meta.url));

describe('OpenPost Image Editor new-design header boundary', () => {
	it('keeps the exact go-back behavior and heading', async () => {
		const source = await readFile(pagePath, 'utf8');

		expect(source).toContain('onclick={goBack}');
		expect(source).toContain(
			'aria-label={returnToken ? m.editor_back_to_post() : m.common_back()}'
		);
		expect(source).toContain('editorHandoffReturnURL(returnToken');
		expect(source).toContain('history.back()');
		expect(source).toContain('<h1');
		expect(source).toContain('{m.image_editor_new_design()}');
	});
});
