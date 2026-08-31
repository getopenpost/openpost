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

	it('adds, edits, removes, clears, and restores markers through history', () => {
		const first = addMarker(12);
		const second = addMarker(42);
		expect(timelineStore.markers).toMatchObject([
			{ id: first, frame: 12, color: '#d97746' },
			{ id: second, frame: 42, color: '#d97746' }
		]);

		expect(updateMarker(first, { frame: 18, label: 'Beat', color: '#22c55e' })).toBe(true);
		expect(timelineStore.markers[0]).toMatchObject({
			id: first,
			frame: 18,
			label: 'Beat',
			color: '#22c55e'
		});
		commandHistory.undo();
		expect(timelineStore.markers[0]).toMatchObject({ id: first, frame: 12 });
		expect(selectMarker(second)).toBe(true);
		expect(timelineStore.selectedMarkerId).toBe(second);
		expect(timelineStore.currentFrame).toBe(42);
		expect(selectMarker('missing')).toBe(false);

		timelineStore._setSelectedMarkerId(first);
		removeMarker(first);
		expect(timelineStore.selectedMarkerId).toBeNull();
		expect(timelineStore.markers.map((marker) => marker.id)).toEqual([second]);
		expect(clearAllMarkers()).toBe(true);
		expect(timelineStore.markers).toEqual([]);
		commandHistory.undo();
		expect(timelineStore.markers.map((marker) => marker.id)).toEqual([second]);
	});
});

describe('timeline navigation lock', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
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

	it('closes every target-track gap and sync-lock interval as one edit', () => {
		timelineStore._setItems([
			clip({ id: 'video-a', from: 20, durationInFrames: 20 }),
			clip({ id: 'video-b', from: 60, durationInFrames: 20 }),
			clip({ id: 'video-c', from: 100, durationInFrames: 20 }),
			clip({
				id: 'audio-late',
				trackId: 'track-audio',
				type: 'audio',
				from: 100,
				durationInFrames: 20
			})
		]);

		expect(closeAllGapsOnTrack('track-video-main')).toBe(true);
		expect(
			timelineStore.items
				.filter((item) => item.trackId === 'track-video-main')
				.map(({ id, from }) => ({ id, from }))
		).toEqual([
			{ id: 'video-a', from: 0 },
			{ id: 'video-b', from: 20 },
			{ id: 'video-c', from: 40 }
		]);
		expect(timelineStore.itemById.get('audio-late')?.from).toBe(40);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('CLOSE_ALL_GAPS');
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

	it('adds three seconds of text to the top visual track at the playhead and undoes it', () => {
		setCurrentFrame(75);

		const id = addTextItem('Add text');

		expect(timelineStore.itemById.get(id)).toMatchObject({
			id,
			trackId: 'track-video-overlay',
			from: 75,
			durationInFrames: 90,
			label: 'Add text',
			text: 'Add text',
			type: 'text'
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_TEXT_ITEM');

		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('creates a complete styled template as one undoable item', () => {
		setCurrentFrame(12);
		const id = addTextTemplateItem('breaking-update', {
			label: 'Breaking',
			sample: {
				eyebrow: 'BREAKING',
				title: 'Major update',
				subtitle: 'Developing now'
			}
		});

		expect(timelineStore.itemById.get(id)).toMatchObject({
			type: 'text',
			from: 12,
			textStylePresetId: 'breaking-update',
			textSpans: [{ text: 'BREAKING' }, { text: 'Major update' }, { text: 'Developing now' }]
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_TEXT_ITEM');
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});
});

describe('addShapeItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds a fully styled primitive at the playhead', () => {
		setCurrentFrame(42);
		const id = addShapeItem('star');
		const shape = timelineStore.itemById.get(id);

		expect(shape).toMatchObject({
			trackId: 'track-video-overlay',
			from: 42,
			durationInFrames: 90,
			type: 'shape',
			shapeType: 'star',
			shapePoints: 5,
			shapeInnerRadius: 0.5,
			fillEnabled: true,
			fillColor: '#f97316',
			strokeEnabled: false
		});
		expect(shape?.transform?.width).toBeGreaterThan(0);
		expect(shape?.transform?.height).toBeGreaterThan(0);
		expect(commandHistory.getLastCommandType()).toBe('ADD_SHAPE_ITEM');
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('skips a visual track locked by its group', () => {
		const [overlay, main, audio] = createDefaultTracks();
		if (!overlay || !main || !audio) throw new Error('Default tracks are required.');
		timelineStore._setTracks([
			{
				id: 'locked-group',
				name: 'Locked visuals',
				isGroup: true,
				height: 96,
				order: 0,
				locked: true,
				visible: true,
				muted: false,
				solo: false,
				volume: 1
			},
			{ ...overlay, order: 1, parentTrackId: 'locked-group' },
			{ ...main, order: 2 },
			{ ...audio, order: 3 }
		]);

		const id = addShapeItem('rectangle');
		expect(timelineStore.itemById.get(id)?.trackId).toBe(main.id);
	});

	it('starts a pen path across the full project canvas', () => {
		const id = addShapeItem('path');
		expect(timelineStore.itemById.get(id)).toMatchObject({
			type: 'shape',
			shapeType: 'path',
			fillEnabled: false,
			strokeEnabled: true,
			transform: {
				width: 1920,
				height: 1080,
				aspectRatioLocked: false
			}
		});
	});

	it('creates a gradient card without a second styling command', () => {
		const id = addShapeItem('rectangle', 'Linear gradient', {
			fillType: 'linear',
			gradientStartColor: '#f97316',
			gradientEndColor: '#6366f1',
			gradientAngle: 135
		});
		expect(timelineStore.itemById.get(id)).toMatchObject({
			type: 'shape',
			fillType: 'linear',
			gradientStartColor: '#f97316',
			gradientEndColor: '#6366f1',
			gradientAngle: 135
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_SHAPE_ITEM');
	});

	it('rejects topology patches while path vertex keys exist', () => {
		const id = addShapeItem('path');
		timelineStore._updateItems([
			{
				id,
				patch: {
					pathVertices: [
						{
							position: [0.2, 0.2],
							inHandle: [0, 0],
							outHandle: [0, 0]
						},
						{
							position: [0.8, 0.8],
							inHandle: [0, 0],
							outHandle: [0, 0]
						}
					],
					pathClosed: false,
					keyframes: {
						'pathVertex:0:positionX': { frames: [0], values: [0.2] }
					}
				}
			}
		]);
		commandHistory.clearHistory();
		updateItemProperties(id, { shapeType: 'rectangle' });
		updateItemProperties(id, { pathClosed: true });
		updateItemProperties(id, { pathVertices: [] });
		expect(timelineStore.itemById.get(id)).toMatchObject({
			shapeType: 'path',
			pathClosed: false
		});
		expect(timelineStore.itemById.get(id)?.pathVertices).toHaveLength(2);
		expect(commandHistory.canUndo).toBe(false);
	});
});

describe('addAdjustmentLayer', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds an empty grade layer to the top visual track as one undoable step', () => {
		setCurrentFrame(45);

		const id = addAdjustmentLayer('Adjustment layer');

		expect(timelineStore.itemById.get(id)).toMatchObject({
			trackId: 'track-video-overlay',
			from: 45,
			durationInFrames: 90,
			label: 'Adjustment layer',
			type: 'adjustment',
			effects: []
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_ADJUSTMENT_LAYER');
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('creates a higher visual track when the top track is occupied at the playhead', () => {
		timelineStore._setItems([
			clip({
				id: 'overlay',
				trackId: 'track-video-overlay',
				from: 30,
				durationInFrames: 90
			})
		]);
		setCurrentFrame(45);

		const id = addAdjustmentLayer('Adjustment layer');
		const adjustment = timelineStore.itemById.get(id);
		const adjustmentTrack = timelineStore.tracks.find((track) => track.id === adjustment?.trackId);

		expect(adjustmentTrack?.order).toBe(-1);
		expect(adjustmentTrack?.name).toBe('Adjustment layer');
		expect(timelineStore.tracks).toHaveLength(4);
		commandHistory.undo();
		expect(timelineStore.tracks).toHaveLength(3);
		expect(timelineStore.items).toHaveLength(1);
	});
});

describe('generated visual item placement', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('puts simultaneous text and shape items on separate visual tracks', () => {
		setCurrentFrame(30);

		const itemIds = [
			addTextItem('First title'),
			addTextItem('Second title'),
			addShapeItem('rectangle')
		];
		const trackIds = itemIds.map((id) => timelineStore.itemById.get(id)?.trackId);

		expect(new Set(trackIds).size).toBe(3);
		expect(timelineStore.tracks).toHaveLength(4);
	});
});

describe('linked item actions', () => {
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

	it('does not create a link for one selected clip', () => {
		timelineStore._setItems([clip({ id: 'video' })]);

		expect(linkItems(['video'])).toBe(false);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('splits generated transcript captions with their source clip in one undo step', () => {
		const video = clip({
			id: 'video',
			durationInFrames: 60,
			sourceEnd: 60,
			sourceFps: 30
		});
		const captions: TimelineItem = {
			id: 'captions',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 60,
			label: 'Auto captions',
			type: 'subtitle',
			captionSource: {
				type: 'transcript',
				clipId: video.id,
				mediaId: 'media',
				sourceStartSeconds: 0,
				sourceEndSeconds: 2,
				playbackSpeed: 1,
				isReversed: false
			},
			cues: [
				{
					id: 'cue',
					startFrame: 5,
					endFrame: 45,
					text: 'Hello before after',
					words: [
						{ id: 'hello', text: 'Hello', startFrame: 5, endFrame: 15 },
						{ id: 'before', text: 'before', startFrame: 20, endFrame: 28 },
						{ id: 'after', text: 'after', startFrame: 35, endFrame: 45 }
					]
				}
			]
		};
		const originalItems = structuredClone([captions, video]);
		// Caption-first storage order proves the split action resolves the source dependency first.
		timelineStore._setItems([captions, video]);

		const result = splitItemsAtFrame(30, [captions.id, video.id]);
		const rightVideo = timelineStore.itemById.get(result.right[0]!)!;
		const splitCaptions = timelineStore.items.filter((item) => item.type === 'subtitle');

		expect(splitCaptions).toHaveLength(2);
		expect(splitCaptions[0]).toMatchObject({
			id: captions.id,
			from: 0,
			durationInFrames: 30,
			captionSource: {
				clipId: video.id,
				sourceStartSeconds: 0,
				sourceEndSeconds: 1
			},
			cues: [{ text: 'Hello before' }]
		});
		expect(splitCaptions[1]).toMatchObject({
			from: 30,
			durationInFrames: 30,
			captionSource: {
				clipId: rightVideo.id,
				sourceStartSeconds: 1,
				sourceEndSeconds: 2
			},
			cues: [
				{
					startFrame: 5,
					endFrame: 15,
					text: 'after',
					words: [{ text: 'after', startFrame: 5, endFrame: 15 }]
				}
			]
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toEqual(originalItems);
	});

	it('keeps a source clip whole when its generated caption track is locked', () => {
		const video = clip({
			id: 'video',
			durationInFrames: 60,
			sourceEnd: 60,
			sourceFps: 30
		});
		const captions: TimelineItem = {
			id: 'captions',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 60,
			label: 'Auto captions',
			type: 'subtitle',
			captionSource: { type: 'transcript', clipId: video.id, mediaId: 'media' },
			cues: [{ id: 'cue', text: 'Locked', startFrame: 0, endFrame: 30 }]
		};
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === captions.trackId ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([video, captions]);
		commandHistory.clearHistory();

		expect(splitItemsAtFrame(30, [video.id])).toEqual({ left: [], right: [] });
		expect(timelineStore.items).toHaveLength(2);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('unlinks every member of a selected clip group as one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video', linkedGroupId: 'group' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group'
			})
		]);

		expect(unlinkItems(['video'])).toBe(true);
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([undefined, undefined]);
		expect(commandHistory.getLastCommandType()).toBe('UNLINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual(['group', 'group']);
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

	it('does not reverse clips on locked tracks', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main' ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([clip({ id: 'video' })]);

		expect(setItemsReversed(['video'], true)).toEqual([]);
		expect(timelineStore.itemById.get('video')?.isReversed).toBeUndefined();
		expect(commandHistory.canUndo).toBe(false);
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

	it('allows an audio-only rate stretch to overlap for mixing', () => {
		timelineStore._setItems([
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2
			}),
			clip({
				id: 'audio-mix',
				trackId: 'track-audio',
				type: 'audio',
				from: 40,
				durationInFrames: 30
			})
		]);

		expect(setItemSpeed('audio', 1)).toBe(true);
		expect(timelineStore.itemById.get('audio')).toMatchObject({
			speed: 1,
			durationInFrames: 60
		});
	});

	it('rejects an end extension that would create a visual same-track overlap', () => {
		timelineStore._setItems([
			clip({ id: 'video', durationInFrames: 30 }),
			clip({ id: 'blocker', from: 40, durationInFrames: 30 })
		]);

		expect(trimItemEnd('video', 50)).toBe(false);
		expect(timelineStore.itemById.get('video')?.durationInFrames).toBe(30);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('allows an audio end extension to overlap for mixing', () => {
		timelineStore._setItems([
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				durationInFrames: 30
			}),
			clip({
				id: 'mix',
				trackId: 'track-audio',
				type: 'audio',
				from: 40,
				durationInFrames: 30
			})
		]);

		expect(trimItemEnd('audio', 50)).toBe(true);
		expect(timelineStore.itemById.get('audio')?.durationInFrames).toBe(50);
	});

	it('authors one source-anchored speed point across linked A/V and undoes it atomically', () => {
		timelineStore._setItems([
			clip({
				id: 'video',
				linkedGroupId: 'group',
				durationInFrames: 120,
				sourceEnd: 120,
				sourceFps: 30
			}),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group',
				durationInFrames: 120,
				sourceEnd: 120,
				sourceFps: 30
			})
		]);

		const added = addItemsSpeedPoint(['video'], 30);
		expect(added.changed).toEqual(['video', 'audio']);
		expect(added.pointId).toBeDefined();
		if (!added.pointId) return;

		const edited = updateItemsSpeedPoint(['video'], added.pointId, {
			speed: 2,
			easing: 'hold'
		});
		expect(edited.changed).toEqual(['video', 'audio']);
		expect(timelineStore.itemById.get('video')?.speedRamp).toEqual(
			timelineStore.itemById.get('audio')?.speedRamp
		);
		expect(timelineStore.itemById.get('video')?.durationInFrames).toBeLessThan(120);
		expect(timelineStore.itemById.get('audio')?.durationInFrames).toBe(
			timelineStore.itemById.get('video')?.durationInFrames
		);
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_ITEMS_SPEED_POINT');

		commandHistory.undo();
		expect(
			timelineStore.itemById.get('video')?.speedRamp?.find((point) => point.id === added.pointId)
				?.speed
		).toBe(1);
		expect(timelineStore.itemById.get('video')?.durationInFrames).toBe(120);
	});

	it('joins linked split siblings and repairs transition endpoints as one undo step', () => {
		const linkedGroupId = 'linked';
		const originId = 'source-edit';
		const videoLeft = clip({
			id: 'video-left',
			originId,
			linkedGroupId,
			sourceEnd: 30
		});
		const videoRight = clip({
			id: 'video-right',
			originId,
			linkedGroupId,
			from: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		const audioLeft = clip({
			id: 'audio-left',
			originId,
			linkedGroupId,
			trackId: 'track-audio',
			type: 'audio',
			sourceEnd: 30
		});
		const audioRight = clip({
			id: 'audio-right',
			originId,
			linkedGroupId,
			trackId: 'track-audio',
			type: 'audio',
			from: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		const next = clip({
			id: 'next',
			originId: 'next-origin',
			from: 60,
			sourceStart: 60,
			sourceEnd: 90
		});
		timelineStore._setItems([videoLeft, videoRight, audioLeft, audioRight, next]);
		transitionsStore.setAll([
			{
				id: 'internal',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video-left',
				toItemId: 'video-right'
			},
			{
				id: 'external',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video-right',
				toItemId: 'next'
			}
		]);

		expect(joinItems(['video-left', 'video-right'])).toEqual(['video-left', 'audio-left']);
		expect(timelineStore.items.map((item) => item.id)).toEqual([
			'video-left',
			'audio-left',
			'next'
		]);
		expect(timelineStore.itemById.get('video-left')).toMatchObject({
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60
		});
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({
				id: 'external',
				fromItemId: 'video-left',
				toItemId: 'next'
			})
		]);
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(5);
		expect(transitionsStore.list).toHaveLength(2);
	});
});
