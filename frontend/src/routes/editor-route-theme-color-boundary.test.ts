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
const imageEditorFabricAdapter = new URL('../lib/image-editor/fabric-adapter.ts', import.meta.url);
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
const colorMiniTimeline = new URL(
	'../lib/video-editor/components/color-mini-timeline.svelte',
	import.meta.url
);
const timelineNavigator = new URL(
	'../lib/video-editor/components/timeline-navigator.svelte',
	import.meta.url
);
const audioEqCurve = new URL(
	'../lib/video-editor/components/audio-eq-curve-editor.svelte',
	import.meta.url
);
const colorPrimaryControls = new URL(
	'../lib/video-editor/components/color-primary-controls.svelte',
	import.meta.url
);
const gpuCurves = new URL(
	'../lib/video-editor/components/gpu-curves-editor.svelte',
	import.meta.url
);
const speedRamp = new URL(
	'../lib/video-editor/components/speed-ramp-editor.svelte',
	import.meta.url
);
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
					'The authored document background is fixed output data; all editor chrome follows the resolved theme.',
				expected: ['#000000']
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
			{ url: audioEqCurve, marker: 'audio-eq-curve' },
			{ url: colorPrimaryControls, marker: 'color-wheel' },
			{ url: gpuCurves, marker: 'curves' },
			{ url: speedRamp, marker: 'speed-curve' },
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

	it('keeps mixed signal editors on semantic chrome outside their protected plots', async () => {
		const cases = [
			{
				name: 'audio mixer',
				component: 'audio-mixer-panel',
				required: [
					'border-right: 1px solid var(--video-editor-border);',
					'background: var(--video-editor-control);',
					'outline: 2px solid var(--video-editor-focus);'
				]
			},
			{
				name: 'color effect header',
				component: 'color-effect-header',
				required: [
					'border-[var(--video-editor-border)]',
					'bg-[var(--video-editor-control)]',
					'color: var(--video-editor-muted);'
				]
			},
			{
				name: 'color grading dock',
				component: 'color-grading-dock',
				required: [
					'border-[var(--video-editor-border)]',
					'bg-[var(--video-editor-panel)]',
					'text-[var(--video-editor-text)]'
				]
			},
			{
				name: 'color primary controls',
				component: 'color-primary-controls',
				required: [
					'background: var(--video-editor-field);',
					'color: var(--video-editor-field-text);',
					'border-color: var(--video-editor-focus-border);'
				]
			},
			{
				name: 'color scopes',
				component: 'color-scopes',
				required: [
					'bg-[var(--video-editor-panel)]',
					'text-[var(--video-editor-muted)]',
					'background: var(--video-editor-control-hover);'
				]
			},
			{
				name: 'color workspace',
				component: 'color-workspace',
				required: [
					'border: 1px solid var(--video-editor-border);',
					'background: var(--video-editor-control-hover);',
					'outline: 2px solid var(--video-editor-focus);'
				]
			},
			{
				name: 'GPU curves',
				component: 'gpu-curves-editor',
				required: [
					'bg-[var(--video-editor-panel)]',
					'bg-[var(--video-editor-selection)]',
					'focus-visible:outline-[var(--video-editor-focus)]'
				]
			},
			{
				name: 'speed ramp',
				component: 'speed-ramp-editor',
				required: [
					'bg-[var(--video-editor-control)]',
					'bg-[var(--video-editor-field)]',
					'focus-visible:outline-[var(--video-editor-focus)]'
				]
			}
		];

		for (const { name, component, required } of cases) {
			const source = await readFile(videoEditorComponent(component), 'utf8');
			for (const token of required) {
				expect(source, `${name} must inherit organization theme chrome`).toContain(token);
			}
		}
	});

	it('keeps light-scheme workspace and timeline chrome free of fixed dark surfaces', async () => {
		const previewSource = await readFile(videoPreview, 'utf8');
		const timelineSource = await readFile(videoTimeline, 'utf8');
		const colorTimelineSource = await readFile(colorMiniTimeline, 'utf8');

		expect(previewSource).toContain('bg-[var(--canvas-pasteboard)]');
		expect(previewSource).not.toContain('bg-[oklch(0.205_0.008_55)]');

		for (const fixedDarkSurface of [
			'bg-[oklch(0.16_0.008_55)]',
			'bg-[oklch(0.13_0.006_55)]',
			'bg-[oklch(0.18_0.012_55)]',
			'bg-[oklch(0.145_0.008_55)]'
		]) {
			expect(timelineSource).not.toContain(fixedDarkSurface);
		}
		expect(timelineSource).toContain('bg-[var(--timeline-track)]');

		for (const semanticRole of [
			'bg-[var(--video-editor-panel)]',
			'bg-[var(--timeline-track)]',
			'text-[var(--video-editor-text)]',
			'border-[var(--video-editor-border)]'
		]) {
			expect(colorTimelineSource).toContain(semanticRole);
		}
		for (const fixedDarkSurface of [
			'bg-[#24252b]',
			'bg-[#17181d]',
			'bg-[#202127]',
			'bg-[#1d1e23]'
		]) {
			expect(colorTimelineSource).not.toContain(fixedDarkSurface);
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

	it('keeps deep inspector and asset chrome off the fixed dark palette', async () => {
		const fixedDarkChrome = [
			'border-white',
			'text-white',
			'bg-black/',
			'bg-white/',
			'focus-visible:outline-white',
			'bg-[oklch(0.18_',
			'bg-[oklch(0.22_',
			'bg-[oklch(0.25_',
			'bg-[oklch(0.28_',
			'bg-[oklch(0.32_'
		];

		for (const name of [
			'ai-caption-controls',
			'animated-image-playback-section',
			'asset-library-panel',
			'audio-ducking-panel',
			'audio-effects-panel',
			'audio-eq-panel',
			'background-properties-panel',
			'clip-audio-core-section',
			'clip-crop-section',
			'clip-playback-section',
			'clip-transform-section',
			'color-keyframe-panel',
			'color-workspace',
			'composition-control-overrides',
			'composition-controls-authoring',
			'corner-pin-properties-panel',
			'editor-assistant-panel',
			'editor-workspace-switcher',
			'effect-browser-panel',
			'effect-picker',
			'effects-panel',
			'gpu-param-control',
			'lottie-properties-panel',
			'local-model-cache-control',
			'media-task-progress',
			'motion-presets-panel',
			'motion-workspace-empty',
			'motion-workspace-panel',
			'preview-diagnostics-panel',
			'project-canvas-panel',
			'property-runtime-panel',
			'saved-animation-library',
			'scene-browser-panel',
			'shape-properties-panel',
			'sticker-browser-panel',
			'stock-browser-panel',
			'text-motion-panel',
			'text-properties-panel',
			'text-template-browser',
			'transition-browser-panel',
			'transition-properties-panel',
			'workspace-gate-panel'
		]) {
			const source = await readFile(videoEditorComponent(name), 'utf8');
			const renderedSource = source.replace(/<script[\s\S]*?<\/script>/u, '');
			for (const forbidden of fixedDarkChrome) {
				expect(renderedSource, `${name} still contains ${forbidden}`).not.toContain(forbidden);
			}
		}
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

	it('keeps the Motion workspace empty state in the resolved editor theme', async () => {
		const source = await readFile(videoEditorComponent('motion-workspace-empty'), 'utf8');

		expect(source).toContain('bg-[var(--video-editor-canvas)]');
		expect(source).toContain('border-[var(--video-editor-border)]');
		expect(source).toContain('bg-[var(--video-editor-control)]');
		expect(rawColors(source)).toEqual([]);
	});

	it('themes the timeline navigator instead of drawing a permanent dark scrollbar', async () => {
		const source = await readFile(timelineNavigator, 'utf8');

		expect(source).toContain('bg-[var(--video-editor-panel)]');
		expect(source).toContain('bg-[var(--video-editor-control)]');
		expect(source).toContain('border-[var(--video-editor-border)]');
		expect(source).toContain('bg-[var(--video-editor-selection)]');
		expect(source).not.toContain('bg-[oklch(0.16_0.008_55)]');
		expect(source).not.toContain('bg-[oklch(0.22_0.012_55)]');
		const layout = await readFile(layoutStyles, 'utf8');
		expect(layout).toContain('scrollbar-color: var(--editor-border) var(--editor-canvas);');
	});

	it('derives image editor chrome from the active theme action color', async () => {
		const source = await readFile(imageEditorShell, 'utf8');

		expect(source).toContain('--image-editor-accent: var(--primary);');
		expect(source).not.toContain('--image-editor-accent: oklch(');
	});

	it('keeps image output geometry on protected canvas roles', async () => {
		const [canvas, adapter, layout] = await Promise.all([
			readFile(imageEditorCanvas, 'utf8'),
			readFile(imageEditorFabricAdapter, 'utf8'),
			readFile(layoutStyles, 'utf8')
		]);

		expect(canvas).toContain('var(--canvas-pasteboard)');
		expect(canvas).toContain('var(--canvas-grid)');
		expect(canvas).toContain('var(--canvas-selection)');
		expect(canvas).toContain('var(--canvas-handle)');
		expect(canvas).not.toContain('hover:text-foreground');
		expect(canvas).not.toContain('var(--background) 72%');
		expect(adapter).toContain('cornerColor: this.selectionColor');
		expect(adapter).toContain('cornerStrokeColor: this.handleColor');
		expect(adapter).toContain('borderColor: this.selectionColor');
		expect(layout).toContain(':is(.video-editor-theme, .image-editor-theme)');
	});
});
