import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pagePath = fileURLToPath(new URL('./+page.svelte', import.meta.url));

describe('OpenPost Video Editor page icon boundary', () => {
	it('keeps product actions themeable and editor tools protected', async () => {
		const source = await readFile(pagePath, 'utf8');

		expect(source).not.toContain('@lucide/svelte');
		for (const role of ['add', 'more-horizontal', 'search', 'settings', 'sparkles']) {
			expect(source, `missing theme icon role ${role}`).toMatch(new RegExp(`["']${role}["']`));
		}
		for (const role of [
			'editor-animation',
			'editor-backgrounds',
			'editor-captions',
			'editor-effects',
			'editor-media',
			'editor-record',
			'editor-scenes',
			'editor-shapes',
			'editor-stickers',
			'editor-text',
			'editor-transitions',
			'loading'
		]) {
			expect(source, `missing protected icon role ${role}`).toMatch(new RegExp(`["']${role}["']`));
		}
	});
});
