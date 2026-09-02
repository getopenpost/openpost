import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const videoEditorRoute = new URL('./video-editor/+page.svelte', import.meta.url);
const newVideoEditorRoute = new URL('./video-editor/new/+page.svelte', import.meta.url);
const fullVideoEditorRoute = new URL('./video-editor/[id]/+page.svelte', import.meta.url);
const recorderRoute = new URL('./record/+page.svelte', import.meta.url);
const imageEditorRoute = new URL('./image-editor/[id]/+page.svelte', import.meta.url);
const imageEditorShell = new URL(
	'../lib/image-editor/components/image-editor-shell.svelte',
	import.meta.url
);

const rawColorPattern =
	/oklch\([^)]*\)|#[\dA-Fa-f]{3,8}\b|(?:bg|border|fill|outline|ring|stroke|text)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow)(?:-\d{2,3})?(?:\/\d+)?/g;

function rawColors(source: string): string[] {
	return [...source.matchAll(rawColorPattern)].map((match) => match[0]).sort();
}

describe('editor route theme color boundary', () => {
	it('keeps raw colors only where editor output needs fixed neutral geometry', async () => {
		const routeCases = [
			{
				name: 'video editor library',
				url: videoEditorRoute,
				reason: 'The project library is product chrome and has no fixed-color output geometry.',
				expected: []
			},
			{
				name: 'new video editor project',
				url: newVideoEditorRoute,
				reason: 'Project creation is product chrome and has no fixed-color output geometry.',
				expected: []
			},
			{
				name: 'full video editor',
				url: fullVideoEditorRoute,
				reason:
					'The document background, preview pasteboard, scopes, and timeline keep fixed neutral output colors.',
				expected: [
					'#000000',
					'oklch(0.135_0.007_55)',
					'oklch(0.145_0.008_55)',
					'oklch(0.145_0.008_55)',
					'oklch(0.205_0.008_55)',
					'oklch(0.205_0.008_55)',
					'oklch(0.205_0.008_55)'
				]
			},
			{
				name: 'recorder',
				url: recorderRoute,
				reason:
					'The capture preview and live input meter keep fixed neutral and signal colors for media truth.',
				expected: [
					'bg-emerald-400',
					'bg-red-400',
					'bg-white/10',
					'oklch(0.12_0.008_55)',
					'oklch(0.3_0.01_55)'
				]
			},
			{
				name: 'image editor route',
				url: imageEditorRoute,
				reason:
					'The route is product chrome; fixed image output colors live inside the editor canvas.',
				expected: []
			}
		];

		for (const routeCase of routeCases) {
			const source = await readFile(routeCase.url, 'utf8');
			expect(rawColors(source), `${routeCase.name}: ${routeCase.reason}`).toEqual(
				routeCase.expected.toSorted()
			);
		}
	});

	it('uses the resolved editor palette for every video route shell', async () => {
		for (const route of [
			videoEditorRoute,
			newVideoEditorRoute,
			fullVideoEditorRoute,
			recorderRoute
		]) {
			const source = await readFile(route, 'utf8');
			expect(source).toContain('video-editor-theme');
			expect(source).toContain('bg-[var(--video-editor-canvas)]');
			expect(source).toContain('text-[var(--video-editor-text)]');
			expect(source).toContain('border-[var(--video-editor-border)]');
			expect(source).toContain('focus-visible:outline-[var(--video-editor-focus)]');
		}
	});

	it('derives image editor chrome from the active theme action color', async () => {
		const source = await readFile(imageEditorShell, 'utf8');

		expect(source).toContain('--image-editor-accent: var(--primary);');
		expect(source).not.toContain('--image-editor-accent: oklch(');
	});
});
