import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import PreviewPlayer from './preview-player.svelte';
import '../../../routes/layout.css';

afterEach(() => {
	colorPreviewStore.__resetForTesting();
	editorSession.project = null;
});

it('repaints a paused sequence when its comparison mode changes', async () => {
	const project = createBlankProject('Comparison');
	project.timeline!.items = [
		{
			id: 'shape',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			label: 'Red',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			transform: { x: 0, y: 0, width: 1920, height: 1080 }
		},
		{
			id: 'grade',
			type: 'adjustment',
			label: 'Grade',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			sequenceColorGrade: true,
			effects: [
				{
					id: 'gray',
					type: 'gpu',
					effectId: 'gpu-saturation',
					enabled: true,
					params: { amount: 0 }
				}
			]
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	const screen = await render(PreviewPlayer, { onedit: vi.fn() });
	const pixel = () => {
		const canvas = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]')!;
		return canvas?.getContext('2d')?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
	};
	await expect.poll(() => pixel()?.[0]).toBeGreaterThan(20);
	await expect.poll(() => Math.abs((pixel()?.[0] ?? 0) - (pixel()?.[1] ?? 0))).toBeLessThan(3);
	colorPreviewStore.setComparisonMode('before', ['grade']);
	await expect.poll(() => (pixel()?.[0] ?? 0) - (pixel()?.[1] ?? 0)).toBeGreaterThan(100);
	colorPreviewStore.setComparisonMode('after');
	await expect.poll(() => Math.abs((pixel()?.[0] ?? 0) - (pixel()?.[1] ?? 0))).toBeLessThan(3);
});
