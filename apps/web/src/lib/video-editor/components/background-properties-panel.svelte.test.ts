import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '../project/types';
import { createDefaultTracks } from '../project/defaults';
import { DEFAULT_PATTERN_BACKGROUND } from '../backgrounds/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import BackgroundPropertiesPanel from './background-properties-panel.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('shows and edits an existing background rotation key without requiring auto-key', async () => {
	const item: TimelineItem = {
		id: 'background',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		type: 'background',
		label: 'Pattern',
		background: { ...DEFAULT_PATTERN_BACKGROUND },
		keyframes: { backgroundRotation: { frames: [0, 60], values: [0, 60] } }
	};
	timelineStore._setItems([item]);
	timelineStore._setCurrentFrame(30);
	const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
	const rotation = screen.getByRole('slider', {
		name: m.video_editor_background_rotation(),
		exact: true
	});
	await expect.element(rotation).toHaveAttribute('aria-valuenow', '30');
	// SAFETY: the slider role is rendered by the shared HTML slider primitive.
	(rotation.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowRight}');
	const value = Number(rotation.element().getAttribute('aria-valuenow'));
	expect(value).not.toBe(30);
	expect(
		resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).background?.rotation
	).toBe(value);
	expect(
		resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).background?.rotation
	).toBe(0);
});

it('keeps an unanimated background unchanged when its track is locked', async () => {
	const item: TimelineItem = {
		id: 'locked',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		type: 'background',
		label: 'Pattern',
		background: { ...DEFAULT_PATTERN_BACKGROUND }
	};
	timelineStore._setTracks(createDefaultTracks().map((track) => ({ ...track, locked: true })));
	timelineStore._setItems([item]);
	const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
	const rotation = screen.getByRole('slider', {
		name: m.video_editor_background_rotation(),
		exact: true
	});
	// SAFETY: the slider role is rendered by the shared HTML slider primitive.
	(rotation.element() as HTMLElement).focus();
	await userEvent.keyboard('{ArrowRight}');
	expect(timelineStore.itemById.get(item.id)?.background?.rotation).toBe(0);
	expect(commandHistory.canUndo).toBe(false);
});
