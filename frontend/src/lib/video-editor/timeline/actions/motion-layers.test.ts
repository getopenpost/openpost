import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import {
	applyMotionLayersToItems,
	applyMotionPresetAsLayers,
	removeMotionLayerFromItems,
	setMotionLayerEnabled
} from './motion-layers';
import { createMotionAnimationLayer } from '../motion-layer-eval';
import type { ResolvedMotionTransform } from '../motion-presets';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';

const track: TimelineTrack = {
	id: 'v1',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};
const anchor: ResolvedMotionTransform = {
	x: 0,
	y: 0,
	width: 400,
	height: 300,
	rotation: 0,
	opacity: 1
};

function item(id: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: id,
		type: 'video',
		transform: { x: 0, y: 0, width: 400, height: 300 }
	};
}
function layer(name = 'Fade in'): ReturnType<typeof createMotionAnimationLayer> {
	return createMotionAnimationLayer({
		name,
		source: 'built-in-preset',
		sourcePresetId: 'fade-in',
		anchor,
		payloads: [
			{ property: 'opacity', frame: 0, value: 0, easing: 'linear' },
			{ property: 'opacity', frame: 15, value: 1, easing: 'linear' }
		]
	});
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({ tracks: [track], items: [item('a'), item('b')], fps: 30 });
});

describe('motion layers actions', () => {
	it('adds additive layers atomically and records one undo step', () => {
		const l = layer();
		expect(applyMotionLayersToItems([{ itemId: 'a', layer: l }])).toBe(1);
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('a')?.motionLayers).toBeUndefined();
		commandHistory.redo();
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(1);
	});

	it('applies multi-selection as one edit and stacks independently', () => {
		const l1 = layer('A');
		const l2 = layer('B');
		applyMotionLayersToItems([
			{ itemId: 'a', layer: l1 },
			{ itemId: 'b', layer: l2 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].name).toBe('A');
		expect(timelineStore.itemById.get('b')?.motionLayers?.[0].name).toBe('B');
	});

	it('allows multiple layers on same clip and removes one without touching others', () => {
		const l1 = layer('A');
		const l2 = layer('B');
		applyMotionLayersToItems([{ itemId: 'a', layer: l1 }]);
		applyMotionLayersToItems([{ itemId: 'a', layer: l2 }]);
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(2);
		removeMotionLayerFromItems(['a'], l1.id);
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(1);
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].id).toBe(l2.id);
		expect(commandHistory.undoStack).toHaveLength(3);
		commandHistory.undo();
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(2);
	});

	it('toggles enable without removing layer', () => {
		const l = layer();
		applyMotionLayersToItems([{ itemId: 'a', layer: l }]);
		expect(setMotionLayerEnabled(['a'], l.id, false)).toBe(1);
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].enabled).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].enabled).toBe(true);
	});

	it('applies layer to all selected items as one undo across freecut semantics', () => {
		const base = layer('Slide');
		const second = { ...base, id: base.id };
		applyMotionLayersToItems([
			{ itemId: 'a', layer: base },
			{ itemId: 'b', layer: second }
		]);
		removeMotionLayerFromItems(['a', 'b'], base.id);
		expect(timelineStore.itemById.get('a')?.motionLayers).toHaveLength(0);
		expect(timelineStore.itemById.get('b')?.motionLayers).toHaveLength(0);
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('applyMotionPresetAsLayers shares one logical id across two items and toggles both in one undo', () => {
		timelineStore.setAll({
			tracks: [track],
			items: [item('a'), item('b')],
			fps: 30
		});
		const applied = applyMotionPresetAsLayers({
			itemIds: ['a', 'b'],
			presetId: 'fade-in',
			frameWidth: 1920,
			frameHeight: 1080,
			fps: 30
		});
		expect(applied).toBe(2);
		const a = timelineStore.itemById.get('a')?.motionLayers?.[0];
		const b = timelineStore.itemById.get('b')?.motionLayers?.[0];
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		expect(a!.id).toBe(b!.id);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(setMotionLayerEnabled(['a', 'b'], a!.id, false)).toBe(2);
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].enabled).toBe(false);
		expect(timelineStore.itemById.get('b')?.motionLayers?.[0].enabled).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get('a')?.motionLayers?.[0].enabled).toBe(true);
	});

	it('preserves existing animated anchor for additive layers over vector lanes', () => {
		const withVectors: TimelineItem = {
			...item('a'),
			vectorKeyframes: {
				position: [
					{ id: 'v1', frame: 0, value: { x: 50, y: 80 }, easing: 'linear' },
					{ id: 'v2', frame: 30, value: { x: 150, y: 80 }, easing: 'linear' }
				],
				scale: [{ id: 's1', frame: 0, value: { x: 120, y: 120 }, easing: 'linear' }]
			},
			transform: { x: 999, y: 999, width: 999, height: 999 }
		};
		timelineStore.setAll({ tracks: [track], items: [withVectors], fps: 30 });
		// Anchor at Entrance (fade-in) should be at frame ~15, where vector position is ~100, scale 120%
		const before = timelineStore.itemById.get('a')!;
		expect(before.vectorKeyframes?.position).toHaveLength(2);
		const applied = applyMotionPresetAsLayers({
			itemIds: ['a'],
			presetId: 'slide-in-left',
			frameWidth: 1920,
			frameHeight: 1080,
			fps: 30
		});
		expect(applied).toBe(1);
		const layer = timelineStore.itemById.get('a')?.motionLayers?.[0];
		expect(layer).toBeDefined();
		// Layer should be additive: at frame 0 the layer + existing vector should not jump
		// The layer tracks should be built from animated anchor, not base 999
		const xTrack = layer!.tracks.find((t) => t.property === 'x');
		expect(xTrack).toBeDefined();
		// x contribution at frame 0 should be offset from animated pose, not from 999
		expect(Math.abs(xTrack!.keyframes[0]!.value)).toBeLessThan(600);
	});
});
