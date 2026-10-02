import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import PreviewPlayer from './preview-player.svelte';
import ShapePropertiesPanel from './shape-properties-panel.svelte';
import '../../../routes/layout.css';

it('repaints a paused alpha mask immediately after native inversion and Undo', async () => {
	const project = createBlankProject('Mask inversion');
	project.timeline!.items = [
		{
			id: 'mask',
			type: 'shape',
			shapeType: 'ellipse',
			label: 'Mask',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 60,
			isMask: true,
			maskType: 'alpha',
			maskFeather: 10,
			maskInvert: false,
			transform: { x: 0, y: 0, width: 800, height: 600 }
		},
		{
			id: 'red',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			label: 'Red',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			transform: { x: 0, y: 0, width: 1920, height: 1080 }
		}
	];
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	const screen = await render(PreviewPlayer, { onedit: vi.fn() });
	screen.container.style.cssText = 'display:flex;width:960px;height:600px';
	const controls = await render(ShapePropertiesPanel, {
		item: timelineStore.itemById.get('mask')!,
		onedit: vi.fn()
	});
	const red = (fraction: number) => {
		const canvas = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		return (
			canvas?.getContext('2d')?.getImageData(canvas.width * fraction, canvas.height / 2, 1, 1)
				.data[0] ?? 0
		);
	};
	try {
		await expect.poll(() => red(0.5)).toBeGreaterThan(200);
		await expect.poll(() => red(0.1)).toBeLessThan(20);
		await controls.getByRole('checkbox', { name: 'Invert mask', exact: true }).click();
		expect(timelineStore.itemById.get('mask')!.maskInvert).toBe(true);
		await expect.poll(() => red(0.1)).toBeGreaterThan(200);
		await expect.poll(() => red(0.5)).toBeLessThan(20);
		commandHistory.undo();
		await expect.poll(() => red(0.5)).toBeGreaterThan(200);
		await expect.poll(() => red(0.1)).toBeLessThan(20);
		commandHistory.redo();
		await expect.poll(() => red(0.1)).toBeGreaterThan(200);
		updateItemProperties('mask', { maskOpacity: 0 });
		await expect.poll(() => red(0.1)).toBeLessThan(20);
		updateItemProperties('mask', { maskOpacity: 100, maskFeather: 0 });
		await expect.poll(() => red(0.73)).toBeGreaterThan(200);
		const hardOutside = red(0.73);
		updateItemProperties('mask', { maskFeather: 100 });
		await expect.poll(() => red(0.73)).toBeLessThan(hardOutside - 30);
		commandHistory.undo();
		await expect.poll(() => red(0.73)).toBe(hardOutside);
	} finally {
		await controls.unmount();
		await screen.unmount();
		commandHistory.clearHistory();
		timelineStore.__resetForTesting();
		editorSession.project = null;
	}
});
