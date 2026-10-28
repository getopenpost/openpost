import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ShapePropertiesPanel from './shape-properties-panel.svelte';

function maskPathItem(): TimelineItem {
	return {
		id: 'shape-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Mask shape',
		type: 'shape',
		shapeType: 'path',
		isMask: true
	};
}

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('edits a keyed stroke width at the playhead', async () => {
	const item: TimelineItem = {
		...maskPathItem(),
		isMask: false,
		shapeType: 'rectangle',
		strokeEnabled: true,
		strokeWidth: 8,
		keyframes: { strokeWidth: { frames: [0, 60], values: [8, 24] } }
	};
	timelineStore._setItems([item]);
	timelineStore._setCurrentFrame(30);
	commandHistory.clearHistory();
	const screen = await render(ShapePropertiesPanel, { item, onedit: vi.fn() });
	const width = screen.getByRole('spinbutton', {
		name: m.video_editor_shape_stroke_width(),
		exact: true
	});
	await expect.element(width).toHaveValue(16);
	await width.fill('20');
	await userEvent.tab();
	expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).strokeWidth).toBe(20);
	expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).strokeWidth).toBe(8);
	commandHistory.undo();
	await expect.element(width).toHaveValue(16);
});
