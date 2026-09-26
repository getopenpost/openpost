import { afterEach, expect, it, vi } from 'vitest';
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

it('keeps the mask path hint visible text as the accessible name', async () => {
	const item = maskPathItem();
	timelineStore._setItems([item]);
	const screen = await render(ShapePropertiesPanel, { item, onedit: vi.fn() });

	// The hint span shows "Mask type" with the editing hint as a hover tooltip.
	// Its accessible name must include the visible text (WCAG 2.5.3), so it must
	// not carry an aria-label that overrides the visible label with the hint.
	const hint = screen.getByText(m.video_editor_shape_mask_type(), { exact: true }).element();
	expect(hint.getAttribute('aria-label')).toBeNull();
	expect(hint.getAttribute('title')).toBe(m.video_editor_shape_mask_path_hint());
});
