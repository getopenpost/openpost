import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ColorKeyframePanel from './color-keyframe-panel.svelte';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Interview',
	type: 'video',
	effects: [
		{
			id: 'wheels',
			type: 'gpu',
			effectId: 'gpu-color-wheels',
			enabled: true,
			params: getGpuEffectDefaultParams('gpu-color-wheels')
		}
	]
};

beforeEach(() => {
	localStorage.removeItem('timeline:keyframeEditorMode');
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], currentFrame: 15, fps: 30 });
	commandHistory.clearHistory();
});

test('adds an effect keyframe at the playhead and exposes it in the value graph', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorKeyframePanel, { itemId: item.id, onedit });
	const addButtons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Add "]')
	);
	expect(addButtons.length).toBeGreaterThan(0);
	addButtons[0]?.click();

	await vi.waitFor(() => {
		const tracks = Object.values(timelineStore.itemById.get(item.id)?.keyframes ?? {});
		expect(tracks.some((keyframes) => keyframes.frames.includes(15))).toBe(true);
	});
	expect(onedit).toHaveBeenCalledOnce();
	expect(commandHistory.undoStack).toHaveLength(1);
	expect(screen.container.querySelector('[data-keyframe-side-ruler]')).not.toBeNull();
	expect(screen.container.querySelector('[data-keyframe-side-playhead]')).not.toBeNull();

	await screen.getByRole('tab', { name: 'Graph' }).click();
	expect(localStorage.getItem('timeline:keyframeEditorMode')).toBe('graph');
	await expect
		.element(screen.getByRole('application', { name: /keyframe value graph/i }))
		.toBeVisible();
});
