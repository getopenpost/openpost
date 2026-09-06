import { beforeEach, describe, expect, it } from 'vitest';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	addAdjustmentLayer,
	addItemsSpeedPoint,
	addMarker,
	addShapeItem,
	addTextItem,
	addTextTemplateItem,
	clearAllMarkers,
	closeAllGapsOnTrack,
	closeGapAtPosition,
	joinItems,
	linkItems,
	removeItems,
	removeMarker,
	rippleDeleteItems,
	selectMarker,
	setCurrentFrame,
	setItemSpeed,
	setItemsReversed,
	splitItemsAtFrame,
	trimItemEnd,
	updateItemsSpeedPoint,
	updateItemProperties,
	updateMarker,
	unlinkItems
} from './items';
import { transitionsStore } from './transitions-store.svelte';

function clip(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		sourceStart: 0,
		sourceEnd: 30,
		...overrides
	};
}

describe('timeline marker actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('blocks user seeks during a voiceover take and restores them after unlock', () => {
		setCurrentFrame(12);
		expect(timelineStore.currentFrame).toBe(12);

		timelineStore._setSeekLocked(true);
		setCurrentFrame(90);
		expect(timelineStore.currentFrame).toBe(12);
		editorSession.clock.seek(75);
		expect(timelineStore.currentFrame).toBe(12);

		timelineStore._setSeekLocked(false);
		setCurrentFrame(90);
		expect(timelineStore.currentFrame).toBe(90);
	});
});

describe('sequence color grade item', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('owns a locked track and follows the complete sequence range', () => {
		timelineStore._setItems([clip({ durationInFrames: 30 })]);
		const id = addAdjustmentLayer('Sequence grade', {
			frame: 0,
			durationInFrames: 30,
			sequenceColorGrade: true
		});
		const grade = timelineStore.itemById.get(id);
		expect(grade?.from).toBe(0);
		expect(grade?.durationInFrames).toBe(30);
		expect(grade?.sequenceColorGrade).toBe(true);
		expect(timelineStore.tracks.find((track) => track.id === grade?.trackId)?.locked).toBe(true);

		timelineStore._addItem(clip({ id: 'later', from: 40, durationInFrames: 20 }));
		expect(timelineStore.itemById.get(id)?.durationInFrames).toBe(60);
	});

	it('creates a clean output track independent of hidden, grouped, and solo source state', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main'
					? {
							...track,
							visible: false,
							solo: true,
							muted: true,
							parentTrackId: 'group',
							audioEq: { enabled: true }
						}
					: track
			)
		);
		const id = addAdjustmentLayer('Sequence grade', { sequenceColorGrade: true });
		const grade = timelineStore.itemById.get(id);
		const track = timelineStore.tracks.find((candidate) => candidate.id === grade?.trackId);

		expect(track).toMatchObject({
			kind: 'video',
			locked: true,
			visible: true,
			muted: false,
			solo: false
		});
		expect(track?.parentTrackId).toBeUndefined();
		expect(track?.audioEq).toBeUndefined();
	});

	it('creates a sequence grade when every source track is locked', () => {
		timelineStore._setTracks(timelineStore.tracks.map((track) => ({ ...track, locked: true })));

		const id = addAdjustmentLayer('Sequence grade', { sequenceColorGrade: true });
		expect(timelineStore.itemById.get(id)?.sequenceColorGrade).toBe(true);
	});
});

describe('timeline delete actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('deletes without closing the gap and honors linked-selection mode', () => {
		timelineStore._setItems([
			clip({ id: 'video', from: 30, linkedGroupId: 'pair' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				from: 30,
				type: 'audio',
				linkedGroupId: 'pair'
			}),
			clip({ id: 'later', from: 60 })
		]);

		expect(removeItems(['video'], false)).toEqual(['video']);
		expect(timelineStore.items.map((item) => item.id)).toEqual(['audio', 'later']);
		expect(timelineStore.itemById.get('later')?.from).toBe(60);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_ITEMS');

		commandHistory.undo();
		expect(removeItems(['video'], true)).toEqual(['video', 'audio']);
		expect(timelineStore.items.map((item) => item.id)).toEqual(['later']);
	});

	it('does not delete items from locked tracks', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main' ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([clip({ id: 'locked' })]);

		expect(removeItems(['locked'])).toEqual([]);
		expect(rippleDeleteItems(['locked'])).toEqual([]);
		expect(timelineStore.itemById.has('locked')).toBe(true);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('ripple deletes one range across edited and sync-locked tracks atomically', () => {
		timelineStore._setItems([
			clip({ id: 'before', from: 0 }),
			clip({ id: 'remove', from: 30, sourceStart: 30, sourceEnd: 60 }),
			clip({ id: 'after', from: 60, sourceStart: 60, sourceEnd: 90 }),
			clip({
				id: 'continuous-audio',
				trackId: 'track-audio',
				type: 'audio',
				from: 0,
				durationInFrames: 120,
				sourceStart: 0,
				sourceEnd: 120
			})
		]);

		const removedIds = rippleDeleteItems(['remove'], false);
		expect(removedIds).toContain('remove');
		expect(timelineStore.itemById.get('after')?.from).toBe(30);
		expect(
			timelineStore.items
				.filter((item) => item.trackId === 'track-audio')
				.sort((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 30, sourceStart: 0, sourceEnd: 30 },
			{ from: 30, durationInFrames: 60, sourceStart: 60, sourceEnd: 120 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RIPPLE_DELETE');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.id)).toEqual([
			'before',
			'remove',
			'after',
			'continuous-audio'
		]);
	});
});

describe('timeline gap closing actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('closes one exact gap across sync-locked tracks in one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video-before', from: 0, durationInFrames: 30 }),
			clip({ id: 'video-after', from: 60, durationInFrames: 30 }),
			clip({
				id: 'audio-before',
				trackId: 'track-audio',
				type: 'audio',
				from: 0,
				durationInFrames: 30
			}),
			clip({
				id: 'audio-after',
				trackId: 'track-audio',
				type: 'audio',
				from: 60,
				durationInFrames: 30
			})
		]);

		expect(closeGapAtPosition('track-video-main', 45)).toBe(true);
		expect(timelineStore.itemById.get('video-after')?.from).toBe(30);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(30);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('CLOSE_GAP');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video-after')?.from).toBe(60);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(60);
	});

	it('does nothing on occupied or trailing space and on effectively locked tracks', () => {
		timelineStore._setItems([
			clip({ id: 'before', from: 0, durationInFrames: 30 }),
			clip({ id: 'after', from: 60, durationInFrames: 30 })
		]);

		expect(closeGapAtPosition('track-video-main', 10)).toBe(false);
		expect(closeGapAtPosition('track-video-main', 100)).toBe(false);
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main' ? { ...track, locked: true } : track
			)
		);
		expect(closeGapAtPosition('track-video-main', 45)).toBe(false);
		expect(commandHistory.canUndo).toBe(false);

		timelineStore._setTracks([
			{
				id: 'locked-group',
				name: 'Locked group',
				isGroup: true,
				height: 96,
				locked: true,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			},
			...createDefaultTracks().map((track, index) =>
				track.id === 'track-video-main'
					? { ...track, parentTrackId: 'locked-group', order: index + 1 }
					: { ...track, order: index + 1 }
			)
		]);
		expect(closeGapAtPosition('track-video-main', 45)).toBe(false);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('keeps a linked companion aligned when its track opts out of sync lock', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-audio' ? { ...track, syncLock: false } : track
			)
		);
		timelineStore._setItems([
			clip({ id: 'video-before', from: 0, durationInFrames: 30 }),
			clip({
				id: 'video-after',
				from: 60,
				durationInFrames: 30,
				linkedGroupId: 'pair'
			}),
			clip({
				id: 'audio-after',
				trackId: 'track-audio',
				type: 'audio',
				from: 60,
				durationInFrames: 30,
				linkedGroupId: 'pair'
			})
		]);

		expect(closeGapAtPosition('track-video-main', 45)).toBe(true);
		expect(timelineStore.itemById.get('video-after')?.from).toBe(30);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(30);
	});

	it('rejects gap closing when an opted-out linked companion cannot move safely', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-audio' ? { ...track, syncLock: false, locked: true } : track
			)
		);
		timelineStore._setItems([
			clip({ id: 'video-before', from: 0, durationInFrames: 30 }),
			clip({
				id: 'video-after',
				from: 60,
				durationInFrames: 30,
				linkedGroupId: 'pair'
			}),
			clip({
				id: 'audio-after',
				trackId: 'track-audio',
				type: 'audio',
				from: 60,
				durationInFrames: 30,
				linkedGroupId: 'pair'
			})
		]);

		expect(closeGapAtPosition('track-video-main', 45)).toBe(false);
		expect(timelineStore.itemById.get('video-after')?.from).toBe(60);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(60);
		expect(commandHistory.canUndo).toBe(false);

		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-audio' ? { ...track, locked: false } : track
			)
		);
		timelineStore._setItems([
			...timelineStore.items,
			clip({
				id: 'audio-blocker',
				trackId: 'track-audio',
				type: 'audio',
				from: 30,
				durationInFrames: 30,
				linkedGroupId: undefined
			})
		]);
		expect(closeGapAtPosition('track-video-main', 45)).toBe(false);
		expect(timelineStore.itemById.get('video-after')?.from).toBe(60);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(60);
		expect(commandHistory.canUndo).toBe(false);
	});
});

describe('addTextItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('links the full existing groups behind a multi-item selection', () => {
		const video = clip({ id: 'video', linkedGroupId: 'old-group' });
		const audio = clip({
			id: 'audio',
			trackId: 'track-audio',
			type: 'audio',
			linkedGroupId: 'old-group'
		});
		const secondAudio = clip({
			id: 'second-audio',
			trackId: 'track-audio',
			type: 'audio'
		});
		timelineStore._setItems([video, audio, secondAudio]);

		expect(linkItems(['video', 'second-audio'])).toBe(true);
		const group = timelineStore.itemById.get('video')?.linkedGroupId;
		expect(group).toBeTruthy();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([group, group, group]);
		expect(commandHistory.getLastCommandType()).toBe('LINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([
			'old-group',
			'old-group',
			undefined
		]);
	});

	it('reverses linked video and audio together as one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video', linkedGroupId: 'group' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group'
			})
		]);

		expect(setItemsReversed(['video'], true)).toEqual(['video', 'audio']);
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true]);
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEMS_REVERSED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([undefined, undefined]);
	});

	it('retimes linked A/V from the exact source span and scales animation in one undo step', () => {
		timelineStore._setItems([
			clip({
				id: 'video',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2,
				keyframes: { opacity: { frames: [0, 29], values: [0, 1] } }
			}),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2,
				keyframes: { volume: { frames: [0, 29], values: [0, 1] } }
			})
		]);

		expect(setItemSpeed('video', 1)).toBe(true);
		expect(
			timelineStore.items.map((item) => ({
				id: item.id,
				speed: item.speed,
				duration: item.durationInFrames
			}))
		).toEqual([
			{ id: 'video', speed: 1, duration: 60 },
			{ id: 'audio', speed: 1, duration: 60 }
		]);
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).toEqual([0, 58]);
		expect(timelineStore.itemById.get('audio')?.keyframes?.volume?.frames).toEqual([0, 58]);
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEM_SPEED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.durationInFrames)).toEqual([30, 30]);
		expect(timelineStore.items.map((item) => item.speed)).toEqual([2, 2]);
	});

	it('rejects a linked rate stretch that would create a visual same-track overlap', () => {
		timelineStore._setItems([
			clip({
				id: 'video',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2
			}),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2
			}),
			clip({ id: 'video-blocker', from: 50, durationInFrames: 30 }),
			clip({
				id: 'audio-mix',
				trackId: 'track-audio',
				type: 'audio',
				from: 40,
				durationInFrames: 30
			})
		]);

		expect(setItemSpeed('video', 1)).toBe(false);
		expect(
			timelineStore.items.slice(0, 2).map((item) => ({
				speed: item.speed,
				duration: item.durationInFrames
			}))
		).toEqual([
			{ speed: 2, duration: 30 },
			{ speed: 2, duration: 30 }
		]);
		expect(commandHistory.canUndo).toBe(false);
	});
});
