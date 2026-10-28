import { afterEach, expect, it } from 'vitest';
import { mapTimelineFrameToLottieFrame } from '../../lottie/frame-provider';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import { planTrimGesture } from '../edit-gesture';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('preserves reversed Lottie source phase through a start trim gesture', () => {
	timelineStore._setItems([
		{
			id: 'animation',
			type: 'lottie',
			label: 'Animation',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			speed: 1.5,
			lottiePhaseOffset: 5
		}
	]);
	{
		const plan = planTrimGesture(
			timelineStore.items[0]!,
			'start',
			20,
			timelineStore.items,
			30,
			[],
			0
		);
		timelineStore._updateItems([{ id: 'animation', patch: plan.patch }]);
	}
	const item = timelineStore.items[0]!;
	const frame = mapTimelineFrameToLottieFrame({
		localFrame: 20 - item.from + (item.lottiePhaseOffset ?? 0),
		projectFps: 30,
		speed: item.speed!,
		totalFrames: 120,
		frameRate: 60,
		loop: true,
		reversed: true
	});
	// 25 authored frames at 1.5x and 60/30 source/project FPS advance 75 source frames.
	expect(frame).toBe(44);
});
