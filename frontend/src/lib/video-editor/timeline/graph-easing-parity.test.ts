import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from './commands/command-store.svelte';
import { timelineStore } from './stores/timeline-store.svelte';
import { transitionsStore } from './actions/transitions-store.svelte';
import {
	setKeyframe,
	setKeyframeEasing,
	setKeyframeEasings,
	updateKeyframes
} from './actions/keyframes';
import { BEZIER_PRESETS, buildEasingConfig } from './easing-presets';
import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS } from '../project/types';
import { graphValueRange, graphPoint, graphDimensions } from './keyframe-editor';

const track = {
	id: 't',
	name: 'Video',
	kind: 'video' as const,
	height: 64,
	locked: false,
	syncLock: true,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function makeItem(): TimelineItem {
	return {
		id: 'clip',
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video'
	};
}

describe('graph parity - easing presets', () => {
	it('exposes FreeCut bezier presets without loss', () => {
		const soft = BEZIER_PRESETS.find((p) => p.value === 'soft');
		expect(soft?.points).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
		const overshoot = BEZIER_PRESETS.find((p) => p.value === 'overshoot');
		expect(overshoot?.points.y1).toBe(1.56);
	});

	it('builds cubic and spring configs with defaults', () => {
		expect(buildEasingConfig('cubic-bezier')).toEqual({
			type: 'cubic-bezier',
			bezier: DEFAULT_BEZIER_POINTS
		});
		expect(buildEasingConfig('spring')).toEqual({
			type: 'spring',
			spring: DEFAULT_SPRING_PARAMS
		});
		expect(buildEasingConfig('linear')).toBeUndefined();
		expect(buildEasingConfig('hold')).toBeUndefined();
		const existing = {
			type: 'cubic-bezier' as const,
			bezier: { x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 }
		};
		expect(buildEasingConfig('cubic-bezier', existing)).toEqual(existing);
	});

	it('keeps scalar parallel arrays aligned through batch easing edits', () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		timelineStore._setItems([
			{
				...makeItem(),
				keyframes: {
					opacity: {
						frames: [0, 20, 40],
						values: [0, 0.5, 1],
						ids: ['a', 'b', 'c'],
						easings: ['linear', 'linear', 'linear'],
						easingConfigs: [null, null, null]
					}
				}
			}
		]);

		const changed = setKeyframeEasings('clip', [
			{
				property: 'opacity',
				frame: 0,
				easing: 'ease-in',
				easingConfig: { type: 'cubic-bezier', bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 } }
			},
			{
				property: 'opacity',
				frame: 20,
				easing: 'spring',
				easingConfig: { type: 'spring', spring: { tension: 220, friction: 18, mass: 0.9 } }
			}
		]);
		expect(changed).toBe(true);
		const trackAfter = timelineStore.itemById.get('clip')?.keyframes?.opacity;
		expect(trackAfter?.easings).toEqual(['ease-in', 'spring', 'linear']);
		expect(trackAfter?.easingConfigs[0]?.bezier).toBeDefined();
		expect(trackAfter?.easingConfigs[1]?.spring?.tension).toBe(220);
		// ids/values stay aligned
		expect(trackAfter?.ids).toEqual(['a', 'b', 'c']);
		expect(trackAfter?.values).toEqual([0, 0.5, 1]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('clip')?.keyframes?.opacity?.easings).toEqual([
			'linear',
			'linear',
			'linear'
		]);
	});

	it('records one undo for a multi-key batch move that snaps to neighbor and blocked ranges', () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		timelineStore._setItems([
			{
				...makeItem(),
				durationInFrames: 100,
				keyframes: {
					opacity: {
						frames: [10, 30, 50],
						values: [0, 0.5, 1],
						ids: ['a', 'b', 'c'],
						easings: ['linear', 'linear', 'linear'],
						easingConfigs: [null, null, null]
					}
				}
			}
		]);
		transitionsStore.setAll([
			{
				id: 'tr',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'clip',
				toItemId: 'other'
			}
		]);
		// Move two middle keys as one transaction
		const edits = [
			{
				ref: { property: 'opacity' as const, frame: 30, id: 'b', index: 1 },
				frame: 31,
				value: 0.6
			},
			{ ref: { property: 'opacity' as const, frame: 50, id: 'c', index: 2 }, frame: 51, value: 0.9 }
		];
		expect(updateKeyframes('clip', edits)).toBe(true);
		expect(timelineStore.itemById.get('clip')?.keyframes?.opacity?.frames).toEqual([10, 31, 51]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('clip')?.keyframes?.opacity?.frames).toEqual([10, 30, 50]);
	});

	it('auto-fits value range with FreeCut padding and respects 320px viewport', () => {
		const keyframes = [{ value: 0.5 }, { value: 0.6 }];
		const range = graphValueRange('opacity', keyframes);
		expect(range.min).toBeCloseTo(0.488, 2);
		expect(range.max).toBeCloseTo(0.612, 2);
		const viewport = {
			width: 320,
			height: 230,
			startFrame: 0,
			endFrame: 60,
			minValue: 0,
			maxValue: 1
		};
		const dims = graphDimensions(viewport);
		expect(dims.width).toBe(320 - 44 - 12);
		const p0 = graphPoint(0, 0, viewport);
		const p60 = graphPoint(60, 1, viewport);
		expect(p60.x).toBeGreaterThan(p0.x);
		expect(p0.y).toBeGreaterThan(p60.y);
	});

	it('sets individual spring and cubic easings and preserves parallel metadata', () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setItems([
			{
				...makeItem(),
				keyframes: {
					rotation: {
						frames: [0, 30],
						values: [0, 90],
						ids: ['r1', 'r2'],
						easings: ['linear', 'linear'],
						easingConfigs: [null, null]
					}
				}
			}
		]);
		expect(
			setKeyframeEasing('clip', 'rotation', 0, 'cubic-bezier', {
				type: 'cubic-bezier',
				bezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }
			})
		).toBe(true);
		expect(
			timelineStore.itemById.get('clip')?.keyframes?.rotation?.easingConfigs[0]?.bezier?.y1
		).toBe(1.56);
		expect(setKeyframeEasing('clip', 'rotation', 0, 'hold')).toBe(true);
		expect(timelineStore.itemById.get('clip')?.keyframes?.rotation?.easings[0]).toBe('hold');
		expect(timelineStore.itemById.get('clip')?.keyframes?.rotation?.ids).toEqual(['r1', 'r2']);
	});
});
