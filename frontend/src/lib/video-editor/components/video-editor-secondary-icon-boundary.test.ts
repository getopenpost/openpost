import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentDirectory = fileURLToPath(new URL('.', import.meta.url));
const firstComponent = 'motion-presets-panel.svelte';
const lastComponent = 'workspace-indicator.svelte';

const protectedEditorGlyphs = {
	'motion-presets-panel.svelte': {
		icons: ['layers-3'],
		reason: 'The stacked layers identify a composite motion clip, not a general product action.'
	},
	'preview-diagnostics-panel.svelte': {
		icons: ['activity'],
		reason: 'The activity trace identifies the live preview diagnostics instrument.'
	},
	'project-canvas-panel.svelte': {
		icons: ['arrow-left-right'],
		reason: 'The opposing arrows directly manipulate the canvas dimensions.'
	},
	'render-queue-panel.svelte': {
		icons: ['list-video'],
		reason: 'The film queue glyph identifies the render queue as an editor instrument.'
	},
	'saved-exports-panel.svelte': {
		icons: ['folder-open'],
		reason: 'The folder glyph identifies a directory entry in the local export browser.'
	},
	'scene-browser-panel.svelte': {
		icons: ['layout-grid', 'list', 'palette'],
		reason: 'These glyphs select scene-analysis views and palette matching modes.'
	},
	'shape-properties-panel.svelte': {
		icons: ['arrow-left-right'],
		reason: 'The opposing arrows directly swap the two gradient endpoints.'
	},
	'source-monitor.svelte': {
		icons: ['chevron-left', 'chevron-right', 'repeat-2', 'skip-back', 'skip-forward'],
		reason: 'These controls are the source monitor transport and marked-range replay instrument.'
	},
	'speed-ramp-editor.svelte': {
		icons: ['plus', 'trash-2'],
		reason: 'These buttons directly add and remove points from the speed-ramp curve.'
	},
	'timeline-panel.svelte': {
		icons: [
			'combine',
			'diamond',
			'flag',
			'link-2',
			'magnet',
			'maximize-2',
			'music',
			'sliders-horizontal',
			'unlink',
			'zoom-in',
			'zoom-out'
		],
		reason: 'These glyphs control timeline editing, keyframes, snapping, markers, mixing, and zoom.'
	},
	'timeline-track-header.svelte': {
		icons: ['folder', 'lock', 'lock-open', 'radio', 'ungroup', 'volume-2', 'volume-x'],
		reason: 'These glyphs expose track hierarchy, inherited state, solo, grouping, and audio state.'
	},
	'timeline-voiceover-control.svelte': {
		icons: ['headphones', 'mic', 'square'],
		reason: 'These glyphs identify voiceover monitoring, recording, and stop transport controls.'
	},
	'transcript-panel.svelte': {
		icons: ['bold', 'italic', 'underline'],
		reason: 'These glyphs are direct subtitle text-formatting controls.'
	},
	'transport-bar.svelte': {
		icons: [
			'chevron-left',
			'chevron-right',
			'gauge',
			'maximize',
			'minimize',
			'skip-back',
			'square',
			'volume-1',
			'volume-2',
			'volume-x',
			'zoom-in',
			'zoom-out'
		],
		reason:
			'These glyphs are preview transport, monitoring, quality, zoom, and fullscreen controls.'
	}
} satisfies Record<string, { icons: string[]; reason: string }>;

function hasProtectedEditorGlyphs(
	componentName: string
): componentName is keyof typeof protectedEditorGlyphs {
	return Object.hasOwn(protectedEditorGlyphs, componentName);
}

describe('Video Editor secondary semantic icon boundary', () => {
	it('keeps ordinary actions themeable and only allows documented editor instruments', async () => {
		const componentNames = (await readdir(componentDirectory))
			.filter((name) => name.endsWith('.svelte') && name >= firstComponent && name <= lastComponent)
			.sort();

		for (const componentName of componentNames) {
			const source = await readFile(`${componentDirectory}/${componentName}`, 'utf8');
			const directIcons = [...source.matchAll(/from '@lucide\/svelte\/icons\/([^']+)'/g)]
				.map((match) => match[1])
				.sort();
			const exception = hasProtectedEditorGlyphs(componentName)
				? protectedEditorGlyphs[componentName]
				: undefined;

			expect(
				directIcons,
				exception
					? `${componentName}: ${exception.reason}`
					: `${componentName} has no approved direct editor glyphs`
			).toEqual(exception?.icons.toSorted() ?? []);
		}
	});
});
