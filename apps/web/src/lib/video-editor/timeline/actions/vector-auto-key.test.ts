import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { autoKeyframeStore } from '../stores/auto-keyframe-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { activeVectorKeyframes } from '../vector-keyframes';
import { setAnimatedProperty } from './keyframes';

describe('setAnimatedProperty vector auto-key aliasing', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		autoKeyframeStore.reset();
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 100,
				durationInFrames: 60,
				label: '',
				type: 'video',
				transform: { x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0 }
			}
		]);
	});

	it('starts the coupled position lane when auto-key is on the sibling axis', () => {
		autoKeyframeStore.toggle('a', 'y');
		const ok = setAnimatedProperty('a', 'x', 110, 50, false);
		expect(ok).toBe(true);
		const lane = activeVectorKeyframes(timelineStore.itemById.get('a')!, 'position');
		expect(lane?.map((keyframe) => keyframe.frame)).toEqual([10]);
		expect(lane?.[0]?.value.x).toBe(50);
	});

	it('writes a base value when neither axis has auto-key', () => {
		const ok = setAnimatedProperty('a', 'x', 110, 50, false);
		expect(ok).toBe(true);
		expect(activeVectorKeyframes(timelineStore.itemById.get('a')!, 'position')).toBeUndefined();
		expect(timelineStore.itemById.get('a')?.transform?.x).toBe(50);
	});
});
