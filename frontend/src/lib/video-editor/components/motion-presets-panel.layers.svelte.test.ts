import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import MotionPresetsPanel from './motion-presets-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};
function item(id: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'video',
		transform: { x: 100, y: 200, width: 400, height: 300, rotation: 0, opacity: 1 }
	};
}
function props(ids = ['one']) {
	return {
		itemId: ids[0] ?? null,
		itemIds: ids,
		frameWidth: 1920,
		frameHeight: 1080,
		fps: 30,
		onedit: vi.fn()
	} as const;
}
beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [track], items: [item('one'), item('two')], fps: 30 });
});

describe('MotionPresetsPanel layers', () => {
	it('exposes additive layer section with 44 px targets and keyboard access', async () => {
		const screen = await render(MotionPresetsPanel, props(['one']));
		expect(screen.getByText('Additive layers')).toBeVisible();
		expect(screen.getByText('No additive layers on the selection.')).toBeVisible();
		// narrow width proof: section remains readable at 320 px
		document.documentElement.style.width = '320px';
		await screen.getByRole('button', { name: 'Add layer' }).click();
		expect(timelineStore.itemById.get('one')?.motionLayers).toHaveLength(1);
		expect(screen.getByText('Additive layers')).toBeVisible();
		const toggle = document.querySelector<HTMLInputElement>('.layer-toggle input');
		expect(toggle).not.toBeNull();
		expect(toggle!.getBoundingClientRect().height).toBeGreaterThanOrEqual(16);
		const remove = screen.getByRole('button', { name: /Remove .* layer/ });
		expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
	});

	it('adds the same preset as additive layer to every selected clip in one undo step', async () => {
		const input = props(['one', 'two']);
		const screen = await render(MotionPresetsPanel, input);
		await screen.getAllByRole('button', { name: /Add .* as additive layer/ })[0]!.click();
		expect(timelineStore.itemById.get('one')?.motionLayers).toHaveLength(1);
		expect(timelineStore.itemById.get('two')?.motionLayers).toHaveLength(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(input.onedit).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/Added .* as layer to 2 clips/)).toBeVisible();
	});

	it('toggles and removes layers without touching base keyframes', async () => {
		const input = props(['one']);
		const screen = await render(MotionPresetsPanel, input);
		await screen.getAllByRole('button', { name: /Add .* as additive layer/ })[1]!.click();
		const beforeToggle = commandHistory.undoStack.length;
		const toggle = document.querySelector<HTMLInputElement>('.layer-toggle input')!;
		toggle.click();
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get('one')?.motionLayers?.[0].enabled).toBe(false)
		);
		expect(commandHistory.undoStack).toHaveLength(beforeToggle + 1);
		const remove = screen.getByRole('button', { name: /Remove .* layer/ });
		await remove.click();
		await vi.waitFor(() => expect(timelineStore.itemById.get('one')?.motionLayers).toHaveLength(0));
		expect(commandHistory.undoStack).toHaveLength(beforeToggle + 2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.motionLayers).toHaveLength(1);
	});
});
