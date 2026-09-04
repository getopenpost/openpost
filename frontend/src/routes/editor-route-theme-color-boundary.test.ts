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
const imageEditorCanvas = new URL(
	'../lib/image-editor/components/image-editor-canvas.svelte',
	import.meta.url
);
const videoPreview = new URL(
	'../lib/video-editor/components/preview-player.svelte',
	import.meta.url
);
const videoTimeline = new URL(
	'../lib/video-editor/components/timeline-panel.svelte',
	import.meta.url
);
const compositionTimeline = new URL(
	'../lib/video-editor/components/composition-timeline.svelte',
	import.meta.url
);
const colorScopes = new URL('../lib/video-editor/components/color-scopes.svelte', import.meta.url);
const layoutStyles = new URL('./layout.css', import.meta.url);
const videoEditorComponent = (name: string) =>
	new URL(`../lib/video-editor/components/${name}.svelte`, import.meta.url);

const rawColorPattern =
	/oklch\([^)]*\)|#[\dA-Fa-f]{3,8}\b|(?:bg|border|fill|outline|ring|stroke|text)-(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow)(?:-\d{2,3})?(?:\/\d+)?/g;

function rawColors(source: string): string[] {
	return [...source.matchAll(rawColorPattern)].map((match) => match[0]).sort();
}

describe('editor route theme color boundary', () => {
	it('keeps editor chrome on the resolved semantic palette', async () => {
		const source = await readFile(layoutStyles, 'utf8');
		const editorScope = source.match(/\.video-editor-theme\s*\{(?<body>[^}]*)\}/)?.groups?.body;

		expect(editorScope).toBeDefined();
		expect(editorScope).toContain('--video-editor-canvas: var(--background);');
		expect(editorScope).toContain('--video-editor-panel: var(--card);');
		expect(editorScope).toContain('--video-editor-control: var(--action-ordinary);');
		expect(editorScope).toContain('--video-editor-control-hover: var(--action-ordinary-hover);');
		expect(editorScope).toContain('--video-editor-border: var(--border);');
		expect(editorScope).toContain('--video-editor-muted: var(--muted-foreground);');
		expect(editorScope).toContain('--video-editor-text: var(--foreground);');
		expect(editorScope).toContain('--video-editor-focus: var(--ring);');
		expect(editorScope).not.toContain('var(--editor-');
	});

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

	it('marks every fixed-color editor surface as protected media geometry', async () => {
		const protectedCases = [
			{ url: imageEditorCanvas, marker: 'canvas' },
			{ url: videoPreview, marker: 'preview' },
			{ url: videoTimeline, marker: 'timeline' },
			{ url: compositionTimeline, marker: 'composition-timeline' },
			{ url: colorScopes, marker: 'scopes' },
			{ url: recorderRoute, marker: 'capture-preview' },
			{ url: recorderRoute, marker: 'input-meter' }
		];

		for (const { url, marker } of protectedCases) {
			const source = await readFile(url, 'utf8');
			expect(source, `${marker} must remain an explicit protected subtree`).toContain(
				`data-editor-protected="${marker}"`
			);
		}
	});

	it('keeps representative editor dialogs and popovers free of raw chrome colors', async () => {
		for (const name of [
			'clear-keyframes-dialog',
			'editor-settings-dialog',
			'export-dialog',
			'media-info-popover',
			'media-recovery-dialog',
			'media-url-import-dialog',
			'motion-composition-dialog',
			'project-details-dialog',
			'speech-cleanup-dialog',
			'unsupported-audio-import-dialog'
		]) {
			const source = await readFile(videoEditorComponent(name), 'utf8');
			expect(rawColors(source), `${name} is ordinary themed product chrome`).toEqual([]);
		}
	});

	it('keeps dialog raw colors on an exact protected media-status allowlist', async () => {
		const cases = [
			{ name: 'bento-layout-dialog', expected: [] },
			{ name: 'marker-list-popover', expected: [] },
			{
				name: 'recording-dialog',
				expected: ['bg-emerald-400', 'bg-red-400', 'bg-red-500', 'bg-white/10']
			}
		];

		for (const { name, expected } of cases) {
			const source = await readFile(videoEditorComponent(name), 'utf8');
			expect(rawColors(source), `${name} may retain only protected media/status truth`).toEqual(
				expected.toSorted()
			);
		}

		const recordingSource = await readFile(videoEditorComponent('recording-dialog'), 'utf8');
		expect(recordingSource).toContain('data-editor-protected="input-meter"');
	});

	it('keeps the default editor work path on semantic chrome colors', async () => {
		const cases = [
			{ name: 'agent-chat-panel', expected: [] },
			{ name: 'audio-effects-panel', expected: [] },
			{ name: 'background-panel', expected: [] },
			{ name: 'media-pool-list', expected: [] },
			{ name: 'project-browser', expected: [] },
			{
				name: 'clip-properties-panel',
				expected: ['#000000', '#000000', '#000000', '#ffffff']
			},
			{ name: 'edit-inspector-tabs', expected: [] },
			{ name: 'sequence-tabs', expected: [] },
			{ name: 'source-monitor', expected: [] },
			{ name: 'transcription-controls', expected: [] },
			{ name: 'transport-bar', expected: [] },
			{ name: 'transcript-panel', expected: [] },
			{ name: 'workspace-indicator', expected: [] }
		];

		for (const { name, expected } of cases) {
			const source = await readFile(videoEditorComponent(name), 'utf8');
			expect(rawColors(source), `${name} must inherit ordinary organization chrome`).toEqual(
				expected.toSorted()
			);
		}

		const sourceMonitor = await readFile(videoEditorComponent('source-monitor'), 'utf8');
		expect(sourceMonitor).toContain('data-editor-protected="source-media"');
	});

	it('keeps audio effect ranges on the shared editor slider', async () => {
		const source = await readFile(videoEditorComponent('audio-effects-panel'), 'utf8');

		expect(source).toContain('<Slider');
		expect(source).not.toContain('type="range"');
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
