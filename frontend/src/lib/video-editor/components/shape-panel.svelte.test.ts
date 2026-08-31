import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import {
	GENERATED_ITEM_DRAG_MIME,
	parseGeneratedItemDragData
} from '$lib/video-editor/timeline/generated-item-drag';
import ShapePanel from './shape-panel.svelte';

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
});

describe('ShapePanel', () => {
	it('shows all primitives and the pen tool, then inserts the chosen shape', async () => {
		const oninserted = vi.fn();
		const screen = await render(ShapePanel, { oninserted });

		for (const label of [
			'Solid',
			'Linear gradient',
			'Rectangle',
			'Circle',
			'Ellipse',
			'Triangle',
			'Star',
			'Polygon',
			'Heart',
			'Pen'
		]) {
			await expect.element(screen.getByRole('button', { name: label })).toBeVisible();
		}

		await screen.getByRole('button', { name: 'Star' }).click();
		const star = timelineStore.items[0];
		expect(star).toMatchObject({
			type: 'shape',
			shapeType: 'star',
			shapePoints: 5
		});
		expect(oninserted).toHaveBeenCalledWith(star?.id);

		await screen.getByRole('button', { name: 'Linear gradient' }).click();
		expect(timelineStore.items[1]).toMatchObject({
			type: 'shape',
			fillType: 'linear',
			gradientStartColor: '#f97316',
			gradientEndColor: '#6366f1',
			transform: { width: 1920, height: 1080 }
		});

		const dataTransfer = new DataTransfer();
		screen
			.getByRole('button', { name: 'Heart' })
			.element()
			.dispatchEvent(
				new DragEvent('dragstart', {
					bubbles: true,
					cancelable: true,
					dataTransfer
				})
			);
		expect([...dataTransfer.types]).toContain(GENERATED_ITEM_DRAG_MIME);
		expect(parseGeneratedItemDragData(dataTransfer.getData(GENERATED_ITEM_DRAG_MIME))).toEqual({
			version: 1,
			kind: 'shape',
			label: 'Heart',
			shapeType: 'heart'
		});
	});

	it('does not overflow a 260 pixel asset panel', async () => {
		const screen = await render(ShapePanel, { oninserted: vi.fn() });
		// SAFETY: ShapePanel always renders one root div.
		const host = screen.container.firstElementChild as HTMLElement;
		screen.container.style.width = '260px';
		expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
	});
});
