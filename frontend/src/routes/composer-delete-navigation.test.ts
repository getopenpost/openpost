import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const postRoute = readFileSync(new URL('./posts/[id]/+page.svelte', import.meta.url), 'utf8');
const publicationRoute = readFileSync(
	new URL('./publications/[id]/+page.svelte', import.meta.url),
	'utf8'
);

describe('composer deletion navigation completion', () => {
	it.each([
		['legacy post route', postRoute],
		['publication route', publicationRoute]
	])('waits for %s navigation before the composer resolves focus', (_name, source) => {
		expect(source).toContain("await goto(resolve('/'))");
		expect(source).toContain('onDeleted={handleSuccess}');
	});
});
