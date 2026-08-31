import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ShapePropertiesPanel from './shape-properties-panel.svelte';

const track: TimelineTrack = {
	id: 'shape-track',
	name: 'Shapes',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function shape(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'shape',
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: 'Shape',
		type: 'shape',
		shapeType: 'path',
		fillEnabled: true,
		strokeEnabled: true,
		pathClosed: false,
		transform: { width: 320, height: 180 },
		...overrides
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [shape()], currentFrame: 0, fps: 30 });
});

describe('ShapePropertiesPanel masks', () => {
	it('swaps resolved gradient stops in one undoable edit', async () => {
		timelineStore.setAll({
			tracks: [track],
			items: [
				shape({
					shapeType: 'rectangle',
					fillType: 'linear',
					fillColor: '#111111',
					gradientStartColor: '#112233',
					gradientEndColor: '#445566'
				})
			],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(ShapePropertiesPanel, {
			item: timelineStore.itemById.get('shape')!,
			onedit
		});

		await screen.getByRole('button', { name: 'Swap' }).click();
		expect(timelineStore.itemById.get('shape')).toMatchObject({
			fillColor: '#445566',
			gradientStartColor: '#445566',
			gradientEndColor: '#112233'
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('shape')).toMatchObject({
			gradientStartColor: '#112233',
			gradientEndColor: '#445566'
		});
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('enables a closed clip mask and exposes alpha controls through undoable commands', async () => {
		const onedit = vi.fn();
		const screen = await render(ShapePropertiesPanel, {
			item: timelineStore.itemById.get('shape')!,
			onedit
		});

		await screen.getByRole('checkbox', { name: 'Use as mask' }).click();
		let item = timelineStore.itemById.get('shape');
		expect(item).toMatchObject({
			isMask: true,
			maskType: 'clip',
			maskFeather: 0,
			maskOpacity: 100,
			maskInvert: false,
			pathClosed: true,
			blendMode: 'normal'
		});
		await screen.rerender({ item: item! });
		expect(screen.getByRole('checkbox', { name: 'Fill' }).query()).toBeNull();
		await expect
			.element(screen.getByText('Masks every visible clip on the tracks below.'))
			.toBeVisible();

		await screen.getByRole('button', { name: 'Mask type' }).click();
		await screen.getByRole('option', { name: 'Alpha' }).click();
		item = timelineStore.itemById.get('shape');
		expect(item?.maskType).toBe('alpha');
		expect(item?.maskFeather).toBe(10);
		await screen.rerender({ item: item! });
		const feather = screen.getByRole('spinbutton', { name: 'Feather (px)' }).query();
		if (!(feather instanceof HTMLInputElement)) {
			throw new Error('mask feather control did not render');
		}
		feather.value = '24';
		feather.dispatchEvent(new Event('change', { bubbles: true }));
		await screen.getByRole('checkbox', { name: 'Invert mask' }).click();

		expect(timelineStore.itemById.get('shape')).toMatchObject({
			maskType: 'alpha',
			maskFeather: 24,
			maskInvert: true
		});
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(4);
		screen.container.style.width = '260px';
		const panel = screen.container.querySelector('section');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});

	it('edits trim paths and true stroke tapers through undoable controls', async () => {
		const onedit = vi.fn();
		const screen = await render(ShapePropertiesPanel, {
			item: timelineStore.itemById.get('shape')!,
			onedit
		});
		const changeNumber = (name: string, value: string) => {
			const input = screen.getByRole('spinbutton', { name }).query();
			if (!(input instanceof HTMLInputElement)) throw new Error(`${name} did not render`);
			input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		};

		await expect.element(screen.getByText('Trim path')).toBeVisible();
		await expect.element(screen.getByText('Stroke taper')).toBeVisible();
		changeNumber('End (%)', '40');
		changeNumber('Start width (%)', '0');
		changeNumber('Start length (%)', '100');

		expect(timelineStore.itemById.get('shape')).toMatchObject({
			trimPathEnd: 40,
			taperStartWidth: 0,
			taperStartLength: 100
		});
		expect(onedit).toHaveBeenCalledTimes(3);
		commandHistory.undo();
		commandHistory.undo();
		commandHistory.undo();
		expect(timelineStore.itemById.get('shape')?.trimPathEnd).toBeUndefined();
		expect(timelineStore.itemById.get('shape')?.taperStartWidth).toBeUndefined();
		expect(timelineStore.itemById.get('shape')?.taperStartLength).toBeUndefined();
	});

	it('hides stroke-only trim and taper controls while the shape is a mask', async () => {
		timelineStore._setItems([
			shape({
				strokeEnabled: true,
				isMask: true,
				maskType: 'clip'
			})
		]);
		const screen = await render(ShapePropertiesPanel, {
			item: timelineStore.itemById.get('shape')!,
			onedit: vi.fn()
		});

		expect(screen.container.textContent).not.toContain('Trim path');
		expect(screen.container.textContent).not.toContain('Stroke taper');
	});
});
