import { beforeEach, describe, expect, it } from 'vitest';
import type {
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem
} from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { editorKeyframes } from '../keyframe-editor';
import { buildEffectKeyframeProperty } from '../../effects/effect-keyframes';
import { createDefaultTracks } from '../../project/defaults';
import {
	activeValueAt,
	beginAnimatedPropertyEdit,
	cancelAnimatedPropertyEdit,
	clearKeyframesForItems,
	commitAnimatedPropertyEdit,
	createPositionSpatialTangents,
	duplicateKeyframes,
	insertKeyframes,
	interpolateAt,
	removeKeyframe,
	removeKeyframes,
	setAnimatedProperties,
	setAnimatedProperty,
	setPositionAtFrame,
	setPositionSpatialTangents,
	setKeyframe,
	setKeyframeEasing,
	updateAnimatedPropertiesLive,
	updateKeyframes
} from './keyframes';

function getItem(id: string): TimelineItem {
	const item = timelineStore.itemById.get(id);
	if (!item) throw new Error(`missing item ${id}`);
	return item;
}

function trackOf(item: TimelineItem, property: KeyframeProperty): KeyframeTrack {
	const track = item.keyframes?.[property];
	if (!track) throw new Error(`no ${property} track`);
	return track;
}

describe('setKeyframe', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
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

	it('inserts keyframes keeping frames ascending', () => {
		setKeyframe('a', 'opacity', 40, 0.5);
		setKeyframe('a', 'opacity', 10, 0);
		setKeyframe('a', 'opacity', 25, 0.25);
		const item = getItem('a');
		expect(trackOf(item, 'opacity')).toMatchObject({
			frames: [10, 25, 40],
			values: [0, 0.25, 0.5]
		});
		expect(commandHistory.undoStack.length).toBe(3);
	});

	it('replaces an existing keyframe at the same frame', () => {
		setKeyframe('a', 'volume', 20, 0.8);
		setKeyframe('a', 'volume', 20, 0.2);
		const track = trackOf(getItem('a'), 'volume');
		expect(track.frames).toEqual([20]);
		expect(track.values).toEqual([0.2]);
		expect(commandHistory.undoStack.length).toBe(2);
	});

	it('promotes width, height, and anchor axes into coupled vector lanes', () => {
		timelineStore._updateItems([
			{
				id: 'a',
				patch: { transform: { width: 400, height: 200, anchorX: 200, anchorY: 100 } }
			}
		]);
		expect(setKeyframe('a', 'width', 10, 800)).toBe(true);
		expect(setKeyframe('a', 'height', 10, 100)).toBe(true);
		expect(setKeyframe('a', 'anchorX', 10, 300)).toBe(true);
		expect(setKeyframe('a', 'anchorY', 10, 50)).toBe(true);
		const animated = getItem('a');
		expect(animated.vectorKeyframes?.scale?.[0]?.value).toEqual({ x: 200, y: 50 });
		expect(animated.vectorKeyframes?.anchor?.[0]?.value).toEqual({ x: 300, y: 50 });
		expect(animated.keyframes?.width).toBeUndefined();
		expect(animated.keyframes?.height).toBeUndefined();
		expect(editorKeyframes(animated, 'width')[0]?.value).toBe(200);
	});

	it('edits, duplicates, and removes scale keys through virtual axis rows', () => {
		timelineStore._updateItems([
			{
				id: 'a',
				patch: { transform: { width: 400, height: 200 } }
			}
		]);
		setKeyframe('a', 'width', 0, 400);
		setKeyframe('a', 'width', 20, 800);
		const first = editorKeyframes(getItem('a'), 'width')[0];
		expect(first).toBeDefined();
		if (!first) return;
		expect(updateKeyframes('a', [{ ref: first, frame: 5, value: 125 }])).toBe(true);
		expect(getItem('a').vectorKeyframes?.scale?.[0]).toMatchObject({
			frame: 5,
			value: { x: 125, y: 100 }
		});
		expect(duplicateKeyframes('a', [{ ref: { ...first, frame: 5 }, frame: 10, value: 150 }])).toBe(
			true
		);
		expect(getItem('a').vectorKeyframes?.scale?.map((keyframe) => keyframe.frame)).toEqual([
			5, 10, 20
		]);
		const duplicate = editorKeyframes(getItem('a'), 'width').find(
			(keyframe) => keyframe.frame === 10
		);
		expect(duplicate).toBeDefined();
		expect(duplicate && removeKeyframes('a', [duplicate])).toBe(true);
		expect(getItem('a').vectorKeyframes?.scale?.map((keyframe) => keyframe.frame)).toEqual([5, 20]);
	});

	it('skips the history step when nothing changes', () => {
		setKeyframe('a', 'opacity', 15, 0.5);
		expect(commandHistory.undoStack.length).toBe(1);
		setKeyframe('a', 'opacity', 15, 0.5);
		expect(commandHistory.undoStack.length).toBe(1);
	});

	it('undoes back to the previous keyframe state', () => {
		setKeyframe('a', 'opacity', 10, 0);
		commandHistory.undo();
		const item = getItem('a');
		expect(item.keyframes?.opacity).toBeUndefined();
	});

	it('returns false and records nothing for a missing item', () => {
		expect(setKeyframe('missing', 'opacity', 0, 1)).toBe(false);
		expect(commandHistory.undoStack.length).toBe(0);
	});

	it('rejects keys outside clip bounds and inside transition-owned frames', () => {
		const right: TimelineItem = {
			id: 'right',
			trackId: 't',
			from: 160,
			durationInFrames: 60,
			label: '',
			type: 'video'
		};
		timelineStore._setItems([...timelineStore.items, right]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: 'a',
				toItemId: right.id
			}
		]);

		expect(setKeyframe('a', 'opacity', -1, 0)).toBe(false);
		expect(setKeyframe('a', 'opacity', 60, 0)).toBe(false);
		expect(setKeyframe('a', 'opacity', 54, 0)).toBe(false);
		expect(setKeyframe('a', 'opacity', 53, 0)).toBe(true);
		expect(trackOf(getItem('a'), 'opacity').frames).toEqual([53]);
	});

	it('changes one outgoing segment to a configured spring and restores it on undo', () => {
		setKeyframe('a', 'opacity', 10, 0);
		setKeyframe('a', 'opacity', 40, 1);
		const config = {
			type: 'spring' as const,
			spring: { tension: 220, friction: 18, mass: 0.9 }
		};

		expect(setKeyframeEasing('a', 'opacity', 10, 'spring', config)).toBe(true);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			easings: ['spring', 'linear'],
			easingConfigs: [config, null]
		});

		commandHistory.undo();
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			easings: ['linear', 'linear'],
			easingConfigs: [null, null]
		});
	});
});

describe('removeKeyframe', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		keyframeSelectionStore.clear();
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 60,
				label: '',
				type: 'video'
			}
		]);
	});

	it('removes only the keyed frame and keeps the rest sorted', () => {
		setKeyframe('a', 'opacity', 10, 0);
		setKeyframe('a', 'opacity', 20, 0.5);
		setKeyframe('a', 'opacity', 30, 1);
		expect(removeKeyframe('a', 'opacity', 20)).toBe(true);
		const track = trackOf(getItem('a'), 'opacity');
		expect(track.frames).toEqual([10, 30]);
		expect(track.values).toEqual([0, 1]);
	});

	it('drops the property once its last keyframe is removed', () => {
		setKeyframe('a', 'opacity', 10, 0);
		expect(removeKeyframe('a', 'opacity', 10)).toBe(true);
		const item = getItem('a');
		expect(item.keyframes?.opacity).toBeUndefined();
	});

	it('restores the removed keyframe on undo', () => {
		setKeyframe('a', 'volume', 12, 0.4);
		removeKeyframe('a', 'volume', 12);
		commandHistory.undo();
		expect(trackOf(getItem('a'), 'volume')).toMatchObject({ frames: [12], values: [0.4] });
	});

	it('returns false for absent tracks or frames', () => {
		expect(removeKeyframe('a', 'volume', 5)).toBe(false);
		setKeyframe('a', 'volume', 5, 1);
		expect(removeKeyframe('a', 'volume', 6)).toBe(false);
		expect(commandHistory.undoStack.length).toBe(1);
	});
});

describe('clearKeyframesForItems', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		keyframeSelectionStore.clear();
		const tracks = createDefaultTracks();
		timelineStore._setTracks(
			tracks.map((track) =>
				track.id === 'track-video-overlay' ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([
			{
				id: 'first',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60,
				label: 'First',
				type: 'video',
				keyframes: {
					opacity: { frames: [0, 30], values: [0, 1] },
					rotation: { frames: [10], values: [15] }
				},
				vectorKeyframes: {
					position: [
						{ id: 'p0', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' },
						{ id: 'p1', frame: 30, value: { x: 100, y: 50 }, easing: 'linear' }
					]
				}
			},
			{
				id: 'second',
				trackId: 'track-video-main',
				from: 60,
				durationInFrames: 60,
				label: 'Second',
				type: 'video',
				keyframes: { opacity: { frames: [0, 20, 40], values: [1, 0.5, 1] } }
			},
			{
				id: 'locked',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 60,
				label: 'Locked',
				type: 'video',
				keyframes: { opacity: { frames: [0], values: [1] } }
			}
		]);
	});

	it('clears one scalar lane across the selection in one undo step and skips locks', () => {
		keyframeSelectionStore.replace('first', ['legacy:opacity:0:0']);
		const result = clearKeyframesForItems(['first', 'second', 'locked'], 'opacity');

		expect(result).toEqual({
			changedItemIds: ['first', 'second'],
			lockedItemIds: ['locked'],
			keyframesRemoved: 5
		});
		expect(getItem('first').keyframes?.opacity).toBeUndefined();
		expect(getItem('first').keyframes?.rotation?.frames).toEqual([10]);
		expect(getItem('first').vectorKeyframes?.position).toHaveLength(2);
		expect(getItem('second').keyframes).toBeUndefined();
		expect(getItem('locked').keyframes?.opacity?.frames).toEqual([0]);
		expect(keyframeSelectionStore.ids.size).toBe(0);
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(getItem('first').keyframes?.opacity?.frames).toEqual([0, 30]);
		expect(getItem('second').keyframes?.opacity?.frames).toEqual([0, 20, 40]);
	});

	it('clears a coupled vector lane without deleting scalar animation', () => {
		const result = clearKeyframesForItems(['first'], 'position');
		expect(result.keyframesRemoved).toBe(2);
		expect(getItem('first').vectorKeyframes).toBeUndefined();
		expect(getItem('first').keyframes?.opacity?.frames).toEqual([0, 30]);
		expect(commandHistory.getLastCommandType()).toBe('CLEAR_KEYFRAMES_FOR_ITEMS');
	});

	it('clears every scalar and vector lane while counting vector points once', () => {
		const result = clearKeyframesForItems(['first', 'second']);
		expect(result.keyframesRemoved).toBe(8);
		expect(getItem('first').keyframes).toBeUndefined();
		expect(getItem('first').vectorKeyframes).toBeUndefined();
		expect(getItem('second').keyframes).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});

describe('batch keyframe editing', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		timelineStore._setItems([
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 60,
				label: '',
				type: 'video',
				keyframes: {
					opacity: {
						frames: [10, 20, 30],
						values: [0, 0.5, 1],
						ids: ['a', 'b', 'c'],
						easings: ['hold', 'cubic-bezier', 'linear'],
						easingConfigs: [
							null,
							{
								type: 'cubic-bezier',
								bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 }
							},
							null
						]
					}
				}
			}
		]);
	});

	it('moves a selection atomically and carries easing with each key', () => {
		expect(
			updateKeyframes('a', [
				{ ref: { property: 'opacity', frame: 10, id: 'a' }, frame: 15, value: 0.1 },
				{ ref: { property: 'opacity', frame: 20, id: 'b' }, frame: 25, value: 0.6 }
			])
		).toBe(true);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			frames: [15, 25, 30],
			values: [0.1, 0.6, 1],
			ids: ['a', 'b', 'c'],
			easings: ['hold', 'cubic-bezier', 'linear']
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(trackOf(getItem('a'), 'opacity').frames).toEqual([10, 20, 30]);
	});

	it('lets a moved key replace an unselected collision like FreeCut', () => {
		expect(
			updateKeyframes('a', [
				{ ref: { property: 'opacity', frame: 10, id: 'a' }, frame: 20, value: 0.25 }
			])
		).toBe(true);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			frames: [20, 30],
			values: [0.25, 1],
			ids: ['a', 'c']
		});
	});

	it('rejects invalid group targets without a partial write', () => {
		expect(
			updateKeyframes('a', [
				{ ref: { property: 'opacity', frame: 10, id: 'a' }, frame: 15, value: 0.1 },
				{ ref: { property: 'opacity', frame: 20, id: 'b' }, frame: 15, value: 0.6 }
			])
		).toBe(false);
		expect(trackOf(getItem('a'), 'opacity').frames).toEqual([10, 20, 30]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('duplicates keys with source easing and one undo step', () => {
		expect(
			duplicateKeyframes('a', [
				{ ref: { property: 'opacity', frame: 20, id: 'b' }, frame: 40, value: 0.75 }
			])
		).toBe(true);
		const track = getItem('a').keyframes?.opacity;
		expect(track).toMatchObject({
			frames: [10, 20, 30, 40],
			values: [0, 0.5, 1, 0.75],
			easings: ['hold', 'cubic-bezier', 'linear', 'cubic-bezier']
		});
		expect(track?.easingConfigs?.[3]).toEqual(track?.easingConfigs?.[1]);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('removes a selection across lanes atomically', () => {
		setKeyframe('a', 'rotation', 12, 90);
		commandHistory.clearHistory();
		expect(
			removeKeyframes('a', [
				{ property: 'opacity', frame: 20, id: 'b' },
				{ property: 'rotation', frame: 12 }
			])
		).toBe(true);
		expect(trackOf(getItem('a'), 'opacity').frames).toEqual([10, 30]);
		expect(getItem('a').keyframes?.rotation).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('pastes several lanes with easing as one undoable insert', () => {
		const refs = insertKeyframes('a', [
			{
				property: 'opacity',
				frame: 40,
				value: 0.25,
				easing: 'cubic-bezier',
				easingConfig: {
					type: 'cubic-bezier',
					bezier: { x1: 0.1, y1: 0.3, x2: 0.7, y2: 0.9 }
				}
			},
			{ property: 'rotation', frame: 15, value: 90, easing: 'hold' }
		]);
		expect(refs).toHaveLength(2);
		expect(refs.every((ref) => Boolean(ref.id))).toBe(true);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			frames: [10, 20, 30, 40],
			values: [0, 0.5, 1, 0.25],
			easings: ['hold', 'cubic-bezier', 'linear', 'cubic-bezier']
		});
		expect(trackOf(getItem('a'), 'rotation')).toMatchObject({
			frames: [15],
			values: [90],
			easings: ['hold']
		});
		expect(commandHistory.getLastCommandType()).toBe('INSERT_KEYFRAMES');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(getItem('a').keyframes?.rotation).toBeUndefined();
	});

	it('pastes a coupled position point with spatial handles and stable virtual refs', () => {
		const spatial = {
			inTangent: { x: -30, y: 5 },
			outTangent: { x: 40, y: 20 },
			continuous: false
		};
		const refs = insertKeyframes('a', [
			{
				property: 'x',
				frame: 25,
				value: 120,
				easing: 'ease-out',
				vectorGroupId: 'source-position',
				spatial
			},
			{
				property: 'y',
				frame: 25,
				value: -80,
				easing: 'ease-out',
				vectorGroupId: 'source-position',
				spatial
			}
		]);
		const position = getItem('a').vectorKeyframes?.position;
		expect(position).toHaveLength(1);
		expect(position?.[0]).toMatchObject({
			frame: 25,
			value: { x: 120, y: -80 },
			easing: 'ease-out',
			spatial
		});
		expect(refs).toMatchObject([
			{ property: 'x', frame: 25, vectorId: position?.[0]?.id },
			{ property: 'y', frame: 25, vectorId: position?.[0]?.id }
		]);
		expect(refs[1]?.id).toBe(`${position?.[0]?.id}:y`);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('replaces a paste collision without changing its stable identity', () => {
		const refs = insertKeyframes('a', [
			{ property: 'opacity', frame: 20, value: 0.8, easing: 'ease-out' }
		]);
		expect(refs).toMatchObject([{ property: 'opacity', frame: 20, id: 'b' }]);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			frames: [10, 20, 30],
			values: [0, 0.8, 1],
			ids: ['a', 'b', 'c'],
			easings: ['hold', 'ease-out', 'linear']
		});
	});

	it('rejects a mixed valid and transition-blocked paste without a partial write', () => {
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 12,
				fromItemId: 'a',
				toItemId: 'right'
			}
		]);
		expect(
			insertKeyframes('a', [
				{ property: 'rotation', frame: 12, value: 30 },
				{ property: 'opacity', frame: 54, value: 0.2 }
			])
		).toEqual([]);
		expect(getItem('a').keyframes?.rotation).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('keeps a legacy key identity stable when the first edit materializes metadata', () => {
		timelineStore._updateItems([
			{
				id: 'a',
				patch: {
					keyframes: {
						...getItem('a').keyframes,
						rotation: { frames: [12, 24], values: [45, 90] }
					}
				}
			}
		]);
		commandHistory.clearHistory();
		const keyframe = editorKeyframes(getItem('a'), 'rotation')[0]!;
		expect(updateKeyframes('a', [{ ref: keyframe, frame: 14, value: 50 }])).toBe(true);
		expect(trackOf(getItem('a'), 'rotation')).toMatchObject({
			frames: [14, 24],
			ids: [keyframe.id, 'legacy:rotation:24:1']
		});
	});
});

describe('interpolateAt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	function itemWithTrack(frames: number[], values: number[]): TimelineItem {
		return {
			id: 'a',
			trackId: 't',
			from: 0,
			durationInFrames: 100,
			label: '',
			type: 'video',
			keyframes: { opacity: { frames, values } }
		};
	}

	it('returns null when the track is missing or empty', () => {
		const bare: TimelineItem = {
			id: 'b',
			trackId: 't',
			from: 0,
			durationInFrames: 10,
			label: '',
			type: 'video'
		};
		expect(interpolateAt(bare, 'opacity', 5)).toBeNull();
		expect(interpolateAt(itemWithTrack([], []), 'volume', 5)).toBeNull();
	});

	it('holds a single keyframe constant', () => {
		const item = itemWithTrack([30], [0.75]);
		expect(interpolateAt(item, 'opacity', 0)).toBe(0.75);
		expect(interpolateAt(item, 'opacity', 99)).toBe(0.75);
	});

	it('clamps constant before the first and after the last keyframe', () => {
		const item = itemWithTrack([10, 50], [0.2, 0.6]);
		expect(interpolateAt(item, 'opacity', 0)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 9)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 51)).toBe(0.6);
		expect(interpolateAt(item, 'opacity', 200)).toBe(0.6);
	});

	it('hits keyframes exactly and interpolates linearly between them', () => {
		const item = itemWithTrack([10, 50], [0.2, 0.6]);
		expect(interpolateAt(item, 'opacity', 10)).toBe(0.2);
		expect(interpolateAt(item, 'opacity', 50)).toBe(0.6);
		expect(interpolateAt(item, 'opacity', 30)).toBeCloseTo(0.4, 12);
		expect(interpolateAt(item, 'opacity', 20)).toBeCloseTo(0.3, 12);
	});

	it('uses the outgoing easing stored on each keyframe segment', () => {
		const item: TimelineItem = {
			id: 'eased',
			trackId: 't',
			from: 0,
			durationInFrames: 20,
			label: '',
			type: 'video',
			keyframes: {
				opacity: {
					frames: [0, 10, 20],
					values: [0, 1, 0],
					easings: ['hold', 'cubic-bezier', 'linear'],
					easingConfigs: [
						null,
						{
							type: 'cubic-bezier',
							bezier: { x1: 0.1, y1: 0.9, x2: 0.2, y2: 1 }
						},
						null
					]
				}
			}
		};

		expect(interpolateAt(item, 'opacity', 5)).toBe(0);
		expect(interpolateAt(item, 'opacity', 15)).toBeLessThan(0.2);
	});
});

describe('setAnimatedProperty', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		keyframeSelectionStore.clear();
		timelineStore._setItems([
			{
				id: 'animated',
				trackId: 't',
				from: 10,
				durationInFrames: 30,
				label: '',
				type: 'video',
				transform: { x: 0, opacity: 1 }
			}
		]);
	});

	it('updates the base value when auto-key is off and no lane exists', () => {
		expect(setAnimatedProperty('animated', 'x', 15, 0.25, false)).toBe(true);
		expect(getItem('animated').transform?.x).toBe(0.25);
		expect(getItem('animated').keyframes?.x).toBeUndefined();
	});

	it('updates the base value outside the clip when no keyframe lane exists', () => {
		expect(setAnimatedProperty('animated', 'x', 0, 0.25, false)).toBe(true);
		expect(getItem('animated').transform?.x).toBe(0.25);
		expect(getItem('animated').keyframes?.x).toBeUndefined();
	});

	it('starts a lane when auto-key is on', () => {
		expect(setAnimatedProperty('animated', 'opacity', 15, 0.5, true)).toBe(true);
		expect(getItem('animated').keyframes?.opacity).toMatchObject({ frames: [5], values: [0.5] });
	});

	it('extends an existing lane even when auto-key is off', () => {
		setAnimatedProperty('animated', 'opacity', 15, 0.5, true);
		setAnimatedProperty('animated', 'opacity', 20, 0.75, false);
		expect(getItem('animated').keyframes?.opacity).toMatchObject({
			frames: [5, 10],
			values: [0.5, 0.75]
		});
	});

	it('updates an effect base param until auto-key starts its lane', () => {
		timelineStore._updateItems([
			{
				id: 'animated',
				patch: {
					effects: [
						{
							id: 'contrast',
							type: 'gpu',
							effectId: 'gpu-contrast',
							enabled: true,
							params: { amount: 1 }
						}
					]
				}
			}
		]);
		commandHistory.clearHistory();
		const property = buildEffectKeyframeProperty('gpu-contrast', 'contrast', 'amount');

		expect(setAnimatedProperty('animated', property, 15, 1.5, false)).toBe(true);
		expect(getItem('animated').effects?.[0]).toMatchObject({ params: { amount: 1.5 } });
		expect(getItem('animated').keyframes?.[property]).toBeUndefined();

		expect(setAnimatedProperty('animated', property, 20, 2.25, true)).toBe(true);
		expect(getItem('animated').keyframes?.[property]).toMatchObject({
			frames: [10],
			values: [2.25]
		});
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('rejects keys outside the clip bounds', () => {
		expect(setAnimatedProperty('animated', 'x', 40, 1, true)).toBe(false);
		expect(getItem('animated').keyframes).toBeUndefined();
	});

	it('commits a gizmo transform as one undo entry', () => {
		setAnimatedProperties('animated', 15, { x: 12, y: -8 }, () => false);
		expect(getItem('animated').transform).toMatchObject({ x: 12, y: -8 });
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('updates unanimated base properties when the playhead is outside the clip', () => {
		expect(setAnimatedProperties('animated', 0, { x: 12, y: -8 }, () => false)).toBe(true);
		expect(getItem('animated').transform).toMatchObject({ x: 12, y: -8 });
	});

	it('collapses repeated inspector preview writes into one undoable edit', () => {
		const before = beginAnimatedPropertyEdit();
		updateAnimatedPropertiesLive('animated', 15, { x: 120, y: 40 }, () => false);
		updateAnimatedPropertiesLive('animated', 15, { x: 240, y: 80 }, () => false);
		expect(commandHistory.undoStack).toHaveLength(0);

		commitAnimatedPropertyEdit(before, ['animated'], ['x', 'y']);
		expect(getItem('animated').transform).toMatchObject({ x: 240, y: 80 });
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(getItem('animated').transform).toMatchObject({ x: 0 });
		expect(getItem('animated').transform?.y).toBeUndefined();
	});

	it('restores the pre-gesture state when an inspector scrub is cancelled', () => {
		const before = beginAnimatedPropertyEdit();
		updateAnimatedPropertiesLive('animated', 15, { x: 320 }, () => false);
		expect(getItem('animated').transform?.x).toBe(320);

		cancelAnimatedPropertyEdit(before);
		expect(getItem('animated').transform?.x).toBe(0);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('edits a motion point as one X/Y undo entry', () => {
		timelineStore._updateItems([
			{
				id: 'animated',
				patch: {
					keyframes: {
						x: {
							frames: [0, 20],
							values: [-10, 10],
							easings: ['ease-in', 'linear'],
							easingConfigs: [{ type: 'ease-in' }, null]
						}
					}
				}
			}
		]);
		commandHistory.clearHistory();
		expect(setPositionAtFrame('animated', 20, 25, 30)).toBe(true);
		expect(getItem('animated').keyframes?.x).toBeUndefined();
		expect(getItem('animated').keyframes?.y).toBeUndefined();
		expect(getItem('animated').vectorKeyframes?.position).toMatchObject([
			{ frame: 0, value: { x: -10, y: 0 }, easing: 'ease-in' },
			{ frame: 10, value: { x: 25, y: 30 }, easing: 'ease-in' },
			{ frame: 20, value: { x: 10, y: 0 }, easing: 'linear' }
		]);
		expect(getItem('animated').animationVersion).toBe(2);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(getItem('animated').vectorKeyframes).toBeUndefined();
		expect(getItem('animated').keyframes?.x).toBeDefined();
	});

	it('promotes a legacy path when spatial handles are created and keeps edits coupled', () => {
		timelineStore._updateItems([
			{
				id: 'animated',
				patch: {
					keyframes: {
						x: { frames: [0, 20], values: [-30, 30], ids: ['x-a', 'x-b'] },
						y: { frames: [0, 20], values: [0, 60], ids: ['y-a', 'y-b'] }
					}
				}
			}
		]);
		commandHistory.clearHistory();
		keyframeSelectionStore.replace('animated', ['x-a', 'y-a']);

		expect(createPositionSpatialTangents('animated', 10)).toBe(true);
		let position = getItem('animated').vectorKeyframes?.position;
		expect(position?.[0]?.spatial).toEqual({
			inTangent: { x: -20, y: -20 },
			outTangent: { x: 20, y: 20 },
			continuous: true
		});
		expect(getItem('animated').keyframes).toBeUndefined();
		expect([...keyframeSelectionStore.forItem('animated')]).toEqual([
			position?.[0]?.id,
			`${position?.[0]?.id}:y`
		]);
		expect(commandHistory.undoStack).toHaveLength(1);

		expect(
			setPositionSpatialTangents('animated', 10, {
				inTangent: { x: -40, y: 10 },
				outTangent: { x: 15, y: 25 },
				continuous: false
			})
		).toBe(true);
		position = getItem('animated').vectorKeyframes?.position;
		expect(position?.[0]?.spatial).toMatchObject({
			inTangent: { x: -40, y: 10 },
			outTangent: { x: 15, y: 25 },
			continuous: false
		});

		const xRef = editorKeyframes(getItem('animated'), 'x')[0];
		if (!xRef) throw new Error('missing promoted X keyframe');
		expect(updateKeyframes('animated', [{ ref: xRef, frame: 2, value: -25 }])).toBe(true);
		position = getItem('animated').vectorKeyframes?.position;
		expect(position?.[0]).toMatchObject({
			frame: 2,
			value: { x: -25, y: 0 },
			spatial: {
				inTangent: { x: -40, y: 10 },
				outTangent: { x: 15, y: 25 }
			}
		});

		const refs = [
			editorKeyframes(getItem('animated'), 'x')[0]!,
			editorKeyframes(getItem('animated'), 'y')[0]!
		];
		expect(
			duplicateKeyframes(
				'animated',
				refs.map((ref) => ({ ref, frame: 8, value: ref.value + 5 }))
			)
		).toBe(true);
		position = getItem('animated').vectorKeyframes?.position;
		expect(position?.map((keyframe) => keyframe.frame)).toEqual([2, 8, 20]);
		expect(position?.[1]).toMatchObject({
			value: { x: -20, y: 5 },
			spatial: {
				inTangent: { x: -40, y: 10 },
				outTangent: { x: 15, y: 25 }
			}
		});
		expect(position?.[1]?.id).not.toBe(position?.[0]?.id);

		const yDuplicate = editorKeyframes(getItem('animated'), 'y').find(
			(keyframe) => keyframe.frame === 8
		);
		if (!yDuplicate) throw new Error('missing duplicated Y keyframe');
		expect(removeKeyframes('animated', [yDuplicate])).toBe(true);
		expect(
			getItem('animated').vectorKeyframes?.position?.map((keyframe) => keyframe.frame)
		).toEqual([2, 20]);
	});
});

describe('activeValueAt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('converts absolute timeline frames to item-relative frames', () => {
		const item: TimelineItem = {
			id: 'a',
			trackId: 't',
			from: 100,
			durationInFrames: 60,
			label: '',
			type: 'video',
			keyframes: { volume: { frames: [0, 30], values: [0, 1] } }
		};
		expect(activeValueAt(item, 'volume', 100)).toBe(0);
		expect(activeValueAt(item, 'volume', 115)).toBeCloseTo(0.5, 12);
		expect(activeValueAt(item, 'volume', 130)).toBe(1);
		expect(activeValueAt(item, 'volume', 90)).toBe(0);
		expect(activeValueAt(item, 'volume', 160)).toBe(1);
	});
});
