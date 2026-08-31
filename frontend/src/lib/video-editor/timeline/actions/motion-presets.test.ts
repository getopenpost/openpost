import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { applyMotionPreset } from './motion-presets';
import type { MotionPresetId } from '../motion-presets';

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'track',
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'video',
		transform: {
			x: 100,
			y: 200,
			width: 400,
			height: 300,
			rotation: 0,
			opacity: 1
		},
		...overrides
	};
}

function apply(itemIds: string[], presetId: MotionPresetId = 'fade-in', mode = 'replace' as const) {
	return applyMotionPreset({
		itemIds,
		presetId,
		mode,
		frameWidth: 1920,
		frameHeight: 1080,
		fps: 30
	});
}

describe('applyMotionPreset', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('applies a multi-clip preset as one undoable edit', () => {
		timelineStore._setItems([item('one'), item('two')]);
		expect(apply(['one', 'two'])).toEqual({ ok: true, appliedKeyframes: 4 });
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity).toMatchObject({
			frames: [0, 15],
			values: [0, 1]
		});
		expect(timelineStore.itemById.get('two')?.keyframes?.opacity).toMatchObject({
			frames: [0, 15],
			values: [0, 1]
		});
		const firstSources = timelineStore.itemById.get('one')?.keyframes?.opacity?.sources;
		expect(firstSources).toHaveLength(2);
		expect(firstSources?.[0]).toMatchObject({
			kind: 'built-in-preset',
			presetId: 'fade-in'
		});
		expect(firstSources?.[1]?.applicationId).toBe(firstSources?.[0]?.applicationId);
		expect(
			timelineStore.itemById.get('two')?.keyframes?.opacity?.sources?.[0]?.applicationId
		).not.toBe(firstSources?.[0]?.applicationId);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items.every((candidate) => candidate.keyframes === undefined)).toBe(true);
	});

	it('replaces every motion property only inside the new preset window', () => {
		timelineStore._setItems([
			item('animated', {
				keyframes: {
					opacity: { frames: [0, 8, 40], values: [0.2, 0.4, 0.8] },
					rotation: { frames: [5, 40], values: [30, 90] }
				}
			})
		]);
		expect(apply(['animated'])).toMatchObject({ ok: true });
		expect(timelineStore.itemById.get('animated')?.keyframes?.opacity).toMatchObject({
			frames: [0, 15, 40],
			values: [0, 1, 0.8]
		});
		expect(timelineStore.itemById.get('animated')?.keyframes?.rotation).toMatchObject({
			frames: [40],
			values: [90]
		});
	});

	it('adds missing diamonds without overwriting authored collisions', () => {
		timelineStore._setItems([
			item('animated', {
				keyframes: {
					opacity: { frames: [0], values: [0.35], ids: ['authored'] }
				}
			})
		]);
		const result = applyMotionPreset({
			itemIds: ['animated'],
			presetId: 'fade-in',
			mode: 'add',
			frameWidth: 1920,
			frameHeight: 1080,
			fps: 30
		});
		expect(result).toEqual({ ok: true, appliedKeyframes: 1 });
		expect(timelineStore.itemById.get('animated')?.keyframes?.opacity).toMatchObject({
			frames: [0, 15],
			values: [0.35, 0.35],
			ids: ['authored', expect.any(String)]
		});
	});

	it('aborts every selected clip when one generated frame belongs to a transition', () => {
		timelineStore._setItems([
			item('left', { durationInFrames: 30 }),
			item('right', { from: 30, durationInFrames: 30 })
		]);
		transitionsStore.setAll([
			{
				id: 'cut',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: 'left',
				toItemId: 'right'
			}
		]);
		expect(apply(['left', 'right'], 'fade-out')).toEqual({
			ok: false,
			reason: 'transition-blocked'
		});
		expect(timelineStore.items.every((candidate) => candidate.keyframes === undefined)).toBe(true);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('keeps coupled position animation coupled and preserves the untouched axis', () => {
		timelineStore._setItems([
			item('spatial', {
				transform: {
					x: 50,
					y: 75,
					width: 400,
					height: 300,
					opacity: 1,
					rotation: 0
				},
				keyframes: {
					x: { frames: [8], values: [999] },
					y: { frames: [8], values: [999] }
				},
				vectorKeyframes: {
					position: [
						{
							id: 'old-start',
							frame: 0,
							value: { x: 10, y: 20 },
							easing: 'linear'
						},
						{
							id: 'far',
							frame: 30,
							value: { x: 300, y: 400 },
							easing: 'linear'
						}
					]
				}
			})
		]);
		expect(apply(['spatial'], 'slide-in-left')).toMatchObject({ ok: true });
		const updated = timelineStore.itemById.get('spatial');
		expect(updated?.keyframes?.x).toBeUndefined();
		expect(updated?.keyframes?.y).toBeUndefined();
		expect(updated?.vectorKeyframes?.position).toMatchObject([
			{ frame: 0, value: { x: -430, y: 75 } },
			{ frame: 15, value: { x: 50, y: 75 } },
			{ id: 'far', frame: 30, value: { x: 300, y: 400 } }
		]);
		expect(
			updated?.vectorKeyframes?.position?.slice(0, 2).every((keyframe) => keyframe.source)
		).toBe(true);
		expect(updated?.vectorKeyframes?.position?.[2]?.source).toBeUndefined();
	});

	it('applies scale presets to text without changing its layout box', () => {
		timelineStore._setItems([item('title', { type: 'text', text: 'Hello' })]);
		expect(apply(['title'], 'pop-in')).toEqual({ ok: true, appliedKeyframes: 6 });
		expect(timelineStore.itemById.get('title')).toMatchObject({
			transform: { width: 400, height: 300 },
			keyframes: {
				scaleX: { frames: [0, 15], values: [0.6, 1] },
				scaleY: { frames: [0, 15], values: [0.6, 1] }
			}
		});
		expect(timelineStore.itemById.get('title')?.keyframes?.width).toBeUndefined();
		expect(timelineStore.itemById.get('title')?.keyframes?.height).toBeUndefined();
	});
});
