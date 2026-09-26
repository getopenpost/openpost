import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import KeyframeValueGraph from './keyframe-value-graph.svelte';

const item: TimelineItem = {
	id: 'graph-roles',
	trackId: 't',
	from: 0,
	durationInFrames: 100,
	label: '',
	type: 'video',
	keyframes: {
		opacity: {
			frames: [0, 30],
			values: [0, 1],
			easings: ['ease-in-out', 'linear']
		}
	}
};

it('exposes pointer-only graph affordances as images instead of phantom sliders', async () => {
	const screen = await render(KeyframeValueGraph, {
		item,
		property: 'opacity',
		currentFrame: 10,
		onscrub: vi.fn(),
		onedit: vi.fn()
	});

	// Bezier handles only render for the selected segment, so select the first point.
	const point = screen.getByRole('button', {
		name: m.video_editor_keyframe_graph_point({ property: 'opacity', frame: 0 })
	});
	// SAFETY: point-button locators resolve to SVG g hosts, which support focus().
	(point.element() as HTMLElement).focus();
	await userEvent.keyboard('{Enter}');

	// SAFETY: role=img locators resolve to SVG graphics hosts in this harness.
	const outgoing = screen.getByRole('img', {
		name: m.video_editor_keyframe_graph_outgoing_handle()
	});
	await expect
		.element(outgoing)
		.toHaveAttribute('aria-label', m.video_editor_keyframe_graph_outgoing_handle());

	const incoming = screen.getByRole('img', {
		name: m.video_editor_keyframe_graph_incoming_handle()
	});
	await expect
		.element(incoming)
		.toHaveAttribute('aria-label', m.video_editor_keyframe_graph_incoming_handle());

	const playhead = screen.getByRole('img', {
		name: m.video_editor_keyframe_graph_playhead()
	});
	await expect
		.element(playhead)
		.toHaveAttribute('aria-label', m.video_editor_keyframe_graph_playhead());

	// The easing itself stays keyboard-adjustable through the segment button.
	const segment = screen.getByRole('button', {
		name: m.video_editor_keyframe_graph_segment_easing({ frame: 0 })
	});
	await expect
		.element(segment)
		.toHaveAttribute('aria-label', m.video_editor_keyframe_graph_segment_easing({ frame: 0 }));

	// No keyboard-operable slider role may remain on pointer-only affordances.
	expect(screen.container.querySelector('[role="slider"]')).toBeNull();
});
