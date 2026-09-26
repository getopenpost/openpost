import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OnCanvasTools from './on-canvas-tools.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';

function motionItem(): TimelineItem {
	// SAFETY: the motion-path group test only reads transform, keyframes, and timing fields, all present in this literal.
	return {
		id: 'video-1',
		trackId: 'track-1',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		transform: { x: 0, y: 0, width: 960, height: 540 },
		keyframes: {
			x: { frames: [0, 10], values: [0, 100] },
			y: { frames: [0, 10], values: [0, 50] }
		}
	} as TimelineItem;
}

function hooks() {
	return {
		ontransformdraft: vi.fn(),
		oncropdraft: vi.fn(),
		oncornerpindraft: vi.fn(),
		ontextediting: vi.fn(),
		oncommitvalues: vi.fn(() => false),
		oncommitposition: vi.fn(() => false),
		oncreatespatial: vi.fn(() => false),
		oncommitspatial: vi.fn(() => false),
		oncommittext: vi.fn(),
		oncommitcornerpin: vi.fn(),
		onseek: vi.fn(),
		onedit: vi.fn()
	};
}

describe('on-canvas motion path group', () => {
	it('exposes the position motion path as a named group containing its keyframes', async () => {
		const screen = await render(OnCanvasTools, {
			props: {
				item: motionItem(),
				canvasWidth: 1920,
				canvasHeight: 1080,
				currentFrame: 0,
				...hooks()
			}
		});
		await screen.getByRole('button', { name: 'Motion' }).click();
		const group = screen.getByRole('group', { name: 'Position motion path' });
		await expect.element(group).toBeVisible();
		// The frame-0 keyframe point stays keyboard-reachable inside the group.
		await expect
			.element(group.getByRole('button', { name: 'Position keyframe at frame 0' }))
			.toBeVisible();
	});
});
