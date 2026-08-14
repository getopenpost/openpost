import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

describe('editor catalog page states', () => {
	it('delegates initial loading to the gallery-shaped PageContainer recipe', () => {
		expect(routeSource).toContain("loading={catalogSurface === 'loading'}");
		expect(routeSource).toContain('loadingLayout="gallery"');
		expect(routeSource).toContain('loadingItems={8}');
		expect(routeSource).not.toContain('<PageLoading');
	});

	it('renders the failure branch before empty catalog actions', () => {
		expect(routeSource).toContain('{#if catalog.error}');
		expect(routeSource).toContain("{#if catalogSurface !== 'error'}");
		expect(routeSource).toContain("{#if catalogSurface === 'empty'}");
		const actions = routeSource.slice(
			routeSource.indexOf('{#snippet actions()}'),
			routeSource.indexOf('{/snippet}', routeSource.indexOf('{#snippet actions()}'))
		);
		expect(actions).toContain("{#if catalogSurface !== 'error'}");
		expect(actions).toContain('m.editors_new_video()');
		expect(actions).toContain('m.editors_new_design()');
	});

	it('retries a loaded catalog without replacing retained results', () => {
		expect(routeSource).toContain('if (workspaceID) void refreshCurrentCatalog(true);');
	});

	it('returns focus to surviving catalog content after a card is removed', () => {
		expect(routeSource).toContain('bind:ref={catalogReturnFocus}');
		expect(routeSource).toContain('returnFocus={catalogReturnFocus}');
	});
});
