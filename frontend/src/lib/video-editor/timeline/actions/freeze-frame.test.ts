import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commitFreezeFrame, freezeFrameBlockReason } from './freeze-frame.svelte';
import { transitionsStore } from './transitions-store.svelte';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 96,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function video(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: track.id,
		from: 30,
		durationInFrames: 60,
		label: 'Launch video',
		type: 'video',
		mediaId: 'source',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 120,
		sourceFps: 30,
		sourceWidth: 1920,
		sourceHeight: 1080,
		transform: { x: 10, opacity: 1 },
		crop: { top: 0, right: 0, bottom: 0, left: 0 },
		keyframes: {
			x: { frames: [0, 40], values: [10, 90] },
			opacity: { frames: [0, 40], values: [1, 0.5] },
			cropLeft: { frames: [0, 40], values: [0, 80] }
		},
		...overrides
	};
}

function cutTransition(): TimelineTransition {
	return {
		id: 'outgoing',
		type: 'crossfade',
		presentation: 'dissolve',
		durationInFrames: 10,
		alignment: 0.5,
		fromItemId: 'clip',
		toItemId: 'next'
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], fps: 30 });
	transitionsStore.clear();
	commandHistory.clearHistory();
});

describe('commitFreezeFrame', () => {
	it('inserts the resolved still, ripples the track, repairs transitions, and undoes atomically', () => {
		const source = video();
		const next = video({
			id: 'next',
			from: 90,
			sourceStart: 60,
			sourceEnd: 120,
			keyframes: undefined
		});
		timelineStore._setItems([structuredClone(source), structuredClone(next)]);
		transitionsStore.setAll([cutTransition()]);

		const freezeId = commitFreezeFrame({
			source,
			playheadFrame: 50,
			timelineFps: 30,
			durationInFrames: 60,
			media: {
				id: 'freeze-media',
				fileName: 'freeze-frame.png',
				width: 1920,
				height: 1080
			}
		});

		expect(freezeId).toBeTruthy();
		const left = timelineStore.itemById.get('clip');
		const right = timelineStore.items.find(
			(item) => item.originId === 'clip' && item.id !== 'clip'
		);
		const freeze = freezeId ? timelineStore.itemById.get(freezeId) : undefined;
		expect(left).toMatchObject({
			from: 30,
			durationInFrames: 20,
			sourceStart: 0,
			sourceEnd: 20
		});
		expect(right).toMatchObject({
			from: 110,
			durationInFrames: 40,
			sourceStart: 20,
			sourceEnd: 60
		});
		expect(timelineStore.itemById.get('next')?.from).toBe(150);
		expect(freeze?.crop?.left).toBeCloseTo(40 / 1920);
		expect(freeze).toMatchObject({
			type: 'image',
			from: 50,
			durationInFrames: 60,
			mediaId: 'freeze-media',
			transform: { x: 50, opacity: 0.75 }
		});
		expect(freeze?.keyframes).toBeUndefined();
		expect(transitionsStore.list[0]).toMatchObject({
			fromItemId: right?.id,
			toItemId: 'next'
		});
		expect(commandHistory.getLastCommandType()).toBe('INSERT_FREEZE_FRAME');

		commandHistory.undo();
		expect(timelineStore.items).toEqual([source, next]);
		expect(transitionsStore.list).toEqual([cutTransition()]);
	});

	it('keeps descending source windows continuous when the source clip is reversed', () => {
		const source = video({ from: 0, isReversed: true });
		timelineStore._setItems([structuredClone(source)]);

		const freezeId = commitFreezeFrame({
			source,
			playheadFrame: 20,
			timelineFps: 30,
			durationInFrames: 60,
			media: {
				id: 'freeze',
				fileName: 'freeze.png',
				width: 1920,
				height: 1080
			}
		});

		expect(freezeId).toBeTruthy();
		expect(timelineStore.itemById.get('clip')).toMatchObject({
			sourceStart: 40,
			sourceEnd: 60,
			isReversed: true
		});
		expect(
			timelineStore.items.find((item) => item.originId === 'clip' && item.id !== 'clip')
		).toMatchObject({
			sourceStart: 0,
			sourceEnd: 40,
			isReversed: true,
			from: 80
		});
	});

	it('rejects transition overlaps and clips changed during asynchronous extraction', () => {
		const source = video();
		const next = video({ id: 'next', from: 90, keyframes: undefined });
		timelineStore._setItems([structuredClone(source), structuredClone(next)]);
		transitionsStore.setAll([cutTransition()]);
		expect(freezeFrameBlockReason(source, 88)).toBe('transition-overlap');

		timelineStore._updateItems([{ id: source.id, patch: { speed: 2 } }]);
		expect(
			commitFreezeFrame({
				source,
				playheadFrame: 50,
				timelineFps: 30,
				durationInFrames: 60,
				media: {
					id: 'freeze',
					fileName: 'freeze.png',
					width: 1920,
					height: 1080
				}
			})
		).toBeNull();
		expect(timelineStore.items).toHaveLength(2);
		expect(commandHistory.canUndo).toBe(false);
	});
});
