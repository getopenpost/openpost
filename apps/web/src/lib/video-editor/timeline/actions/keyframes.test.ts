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
	setAnimatedGpuEffectParamsOnItems,
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
		expect(trackOf(getItem('a'), 'volume')).toMatchObject({
			frames: [12],
			values: [0.4]
		});
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
				{
					ref: { property: 'opacity', frame: 10, id: 'a' },
					frame: 15,
					value: 0.1
				},
				{
					ref: { property: 'opacity', frame: 20, id: 'b' },
					frame: 25,
					value: 0.6
				}
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
				{
					ref: { property: 'opacity', frame: 10, id: 'a' },
					frame: 20,
					value: 0.25
				}
			])
		).toBe(true);
		expect(trackOf(getItem('a'), 'opacity')).toMatchObject({
			frames: [20, 30],
			values: [0.25, 1],
			ids: ['a', 'c']
		});
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
});

describe('interpolateAt', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
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

	it('starts a lane when auto-key is on', () => {
		expect(setAnimatedProperty('animated', 'opacity', 15, 0.5, true)).toBe(true);
		expect(getItem('animated').keyframes?.opacity).toMatchObject({
			frames: [5],
			values: [0.5]
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
		expect(getItem('animated').effects?.[0]).toMatchObject({
			params: { amount: 1.5 }
		});
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
});

describe('setAnimatedGpuEffectParamsOnItems', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		timelineStore._setItems([
			{
				id: 'graded',
				trackId: 't',
				from: 10,
				durationInFrames: 30,
				label: '',
				type: 'video',
				effects: [
					{
						id: 'graded-wheels',
						type: 'gpu',
						effectId: 'gpu-color-wheels',
						enabled: true,
						params: { lift: 0.1, gain: 1.4 }
					}
				]
			},
			{
				id: 'fresh',
				trackId: 't',
				from: 10,
				durationInFrames: 30,
				label: '',
				type: 'image'
			}
		]);
	});

	it('preserves each clip grade and creates missing grades as one undoable edit', () => {
		expect(
			setAnimatedGpuEffectParamsOnItems(
				['graded', 'fresh'],
				'gpu-color-wheels',
				15,
				{ lift: 0.25 },
				() => false
			)
		).toBe(true);

		const graded = getItem('graded').effects?.[0];
		expect(graded?.type === 'gpu' ? graded.params : null).toMatchObject({
			lift: 0.25,
			gain: 1.4
		});
		const fresh = getItem('fresh').effects?.find(
			(effect) => effect.type === 'gpu' && effect.effectId === 'gpu-color-wheels'
		);
		expect(fresh?.type === 'gpu' ? fresh.params.lift : null).toBe(0.25);
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(getItem('graded').effects?.[0]).toMatchObject({
			params: { lift: 0.1, gain: 1.4 }
		});
		expect(getItem('fresh').effects).toBeUndefined();
	});

	it('keys current resolved grades for existing and first-use effects', () => {
		expect(
			setAnimatedGpuEffectParamsOnItems(
				['graded', 'fresh'],
				'gpu-color-wheels',
				20,
				{ lift: -0.2 },
				() => true
			)
		).toBe(true);

		const graded = getItem('graded');
		expect(
			graded.keyframes?.[buildEffectKeyframeProperty('gpu-color-wheels', 'graded-wheels', 'lift')]
		).toMatchObject({ frames: [10], values: [-0.2] });
		const fresh = getItem('fresh');
		const freshEffect = fresh.effects?.find(
			(effect) => effect.type === 'gpu' && effect.effectId === 'gpu-color-wheels'
		);
		if (!freshEffect || freshEffect.type !== 'gpu') throw new Error('missing first-use grade');
		expect(
			fresh.keyframes?.[buildEffectKeyframeProperty('gpu-color-wheels', freshEffect.id, 'lift')]
		).toMatchObject({ frames: [10], values: [-0.2] });
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
