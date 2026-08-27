import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const files = [
	'lottie-properties-panel.svelte',
	'property-runtime-panel.svelte',
	'shape-properties-panel.svelte',
	'motion-presets-panel.svelte',
	'text-motion-panel.svelte',
	'color-workspace.svelte',
	'gpu-param-control.svelte',
	'effects-panel.svelte',
	'keyframe-easing-editor.svelte',
	'composition-controls-authoring.svelte'
] as const;

const nativePattern = /<(input|select|textarea)\b/g;
const primitiveMarkers: Array<{ file: string; marker: string }> = [
	{ file: 'lottie-properties-panel.svelte', marker: 'AppSelect' },
	{ file: 'property-runtime-panel.svelte', marker: 'AppSelect' },
	{ file: 'shape-properties-panel.svelte', marker: 'AppSelect' },
	{ file: 'motion-presets-panel.svelte', marker: 'Slider' },
	{ file: 'text-motion-panel.svelte', marker: 'Slider' },
	{ file: 'color-workspace.svelte', marker: 'Slider' },
	{ file: 'gpu-param-control.svelte', marker: 'Input' },
	{ file: 'effects-panel.svelte', marker: 'Input' },
	{ file: 'keyframe-easing-editor.svelte', marker: 'Slider' },
	{ file: 'composition-controls-authoring.svelte', marker: 'AppSelect' }
];

describe('video editor primitive migration', () => {
	for (const file of files) {
		it(`${file} has no native form controls`, () => {
			const content = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
			const matches = [...content.matchAll(nativePattern)];
			expect(matches, `${file} should not contain native <input>/<select>/<textarea>`).toEqual([]);
		});
	}

	for (const { file, marker } of primitiveMarkers) {
		it(`${file} imports shared primitive ${marker}`, () => {
			const content = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
			expect(content).toContain(marker);
		});
	}
});
