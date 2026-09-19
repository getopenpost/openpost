import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import { scopeSamples } from '../effects/scope-samples.svelte';
import PreviewLayer from './preview-layer.svelte';

const item: TimelineItem = {
	id: 'shape-1',
	trackId: 'visuals',
	from: 0,
	durationInFrames: 60,
	label: 'Shape',
	type: 'shape',
	shapeType: 'rectangle',
	fillColor: '#ff6600'
};

const props = {
	item,
	displayFrame: 0,
	canvasWidth: 640,
	canvasHeight: 360,
	selected: true,
	onselect: () => undefined
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	colorPreviewStore.__resetForTesting();
});

afterEach(() => {
	colorPreviewStore.__resetForTesting();
	vi.restoreAllMocks();
});

it('samples a paused layer only while its scopes are visible', async () => {
	vi.spyOn(performance, 'now').mockReturnValue(1_000);
	const publish = vi.spyOn(scopeSamples, 'publishCanvas');
	const screen = await render(PreviewLayer, props);

	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	expect(publish).not.toHaveBeenCalled();

	colorPreviewStore.setScopeSampleItemId(item.id);
	await expect.poll(() => publish.mock.calls.length).toBeGreaterThan(0);
	const visiblePublishCount = publish.mock.calls.length;

	colorPreviewStore.setScopeSampleItemId(null);
	await screen.rerender({ ...props, displayFrame: 1 });
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	expect(publish).toHaveBeenCalledTimes(visiblePublishCount);

	colorPreviewStore.setScopeSampleItemId(item.id);
	await expect.poll(() => publish.mock.calls.length).toBeGreaterThan(visiblePublishCount);
});
