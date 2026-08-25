import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import {
	applyMotionLayersToItems,
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
});
