import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import {
	buildInsertedGapPreviewUpdatesForSyncLockedTracks,
	buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
	propagateInsertedGapToSyncLockedTracks,
	propagateRemovedIntervalsToSyncLockedTracks
} from './sync-lock-ripple';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 30,
		sourceFps: 30,
		...overrides
	};
}

function track(id: string, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: id.includes('audio') ? 'audio' : 'video',
		height: 48,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	transitionsStore.setAll([]);
	timelineStore.setAll({
		tracks: [track('video'), track('audio')],
		fps: 30
	});
});

describe('sync-lock ripple previews', () => {
	it('does not ripple children of a locked group', () => {
		const tracks = [
			track('video'),
			track('group', { isGroup: true, kind: undefined, locked: true }),
			track('audio', { parentTrackId: 'group' })
		];
		expect(
			buildInsertedGapPreviewUpdatesForSyncLockedTracks({
				items: [item({ id: 'audio', trackId: 'audio', from: 60 })],
				tracks,
				editedTrackIds: new Set(['video']),
				cutFrame: 30,
				amount: 15
			})
		).toEqual([]);
	});

	it('previews every removed-interval overlap shape on sync-locked tracks', () => {
		const items = [
			item({ id: 'edited', trackId: 'video', from: 50, durationInFrames: 30 }),
			item({
				id: 'straddled',
				trackId: 'audio',
				from: 40,
				durationInFrames: 60
			}),
			item({ id: 'covered', trackId: 'audio', from: 50, durationInFrames: 30 }),
			item({ id: 'after', trackId: 'audio', from: 110, durationInFrames: 10 })
		];

		expect(
			buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
				items,
				tracks: timelineStore.tracks,
				editedTrackIds: new Set(['video']),
				intervals: [{ start: 50, end: 80 }]
			})
		).toEqual([
			{ id: 'straddled', durationInFrames: 30 },
			{ id: 'covered', hidden: true },
			{ id: 'after', from: 80 }
		]);
	});

	it('previews an inserted gap by growing straddlers and shifting later items', () => {
		const items = [
			item({
				id: 'straddled',
				trackId: 'audio',
				from: 90,
				durationInFrames: 30
			}),
			item({ id: 'after', trackId: 'audio', from: 130, durationInFrames: 10 })
		];

		expect(
			buildInsertedGapPreviewUpdatesForSyncLockedTracks({
				items,
				tracks: timelineStore.tracks,
				editedTrackIds: new Set(['video']),
				cutFrame: 100,
				amount: 20
			})
		).toEqual([
			{ id: 'straddled', durationInFrames: 50 },
			{ id: 'after', from: 150 }
		]);
	});
});

describe('sync-lock ripple commits', () => {
	it('splits a straddled item and inserts a gap without losing source continuity', () => {
		timelineStore._setItems([
			item({
				id: 'straddled',
				trackId: 'audio',
				type: 'audio',
				from: 90,
				durationInFrames: 30,
				sourceStart: 300,
				sourceEnd: 330
			}),
			item({ id: 'after', trackId: 'audio', from: 130, durationInFrames: 10 })
		]);

		const result = propagateInsertedGapToSyncLockedTracks({
			editedTrackIds: new Set(['video']),
			cutFrame: 100,
			amount: 20
		});

		const left = timelineStore.itemById.get('straddled');
		const right = timelineStore.items.find(
			(candidate) => candidate.id !== 'straddled' && candidate.originId === 'straddled'
		);
		expect(left).toMatchObject({
			from: 90,
			durationInFrames: 10,
			sourceStart: 300,
			sourceEnd: 310
		});
		expect(right).toMatchObject({
			from: 120,
			durationInFrames: 20,
			sourceStart: 310,
			sourceEnd: 330
		});
		expect(timelineStore.itemById.get('after')?.from).toBe(150);
		expect(result.removedIds).toEqual([]);
		expect(result.affectedIds).toEqual(expect.arrayContaining(['straddled', right?.id, 'after']));
	});

	it('removes an interval from a straddled item and closes the gap', () => {
		timelineStore._setItems([
			item({
				id: 'straddled',
				trackId: 'audio',
				type: 'audio',
				from: 40,
				durationInFrames: 60,
				sourceStart: 300,
				sourceEnd: 360
			}),
			item({ id: 'after', trackId: 'audio', from: 110, durationInFrames: 10 })
		]);

		const result = propagateRemovedIntervalsToSyncLockedTracks({
			editedTrackIds: new Set(['video']),
			intervals: [{ start: 50, end: 80 }]
		});

		const pieces = timelineStore.items
			.filter((candidate) => candidate.id === 'straddled' || candidate.originId === 'straddled')
			.sort((left, right) => left.from - right.from);
		expect(pieces).toHaveLength(2);
		expect(pieces[0]).toMatchObject({
			from: 40,
			durationInFrames: 10,
			sourceStart: 300,
			sourceEnd: 310
		});
		expect(pieces[1]).toMatchObject({
			from: 50,
			durationInFrames: 20,
			sourceStart: 340,
			sourceEnd: 360
		});
		expect(timelineStore.itemById.get('after')?.from).toBe(80);
		expect(result.removedIds).toHaveLength(1);
		expect(timelineStore.itemById.has(result.removedIds[0] ?? '')).toBe(false);
	});

	it('excludes locked tracks and tracks with sync lock disabled', () => {
		timelineStore.setAll({
			tracks: [
				track('video'),
				track('audio-locked', { locked: true }),
				track('audio-free', { syncLock: false })
			]
		});
		timelineStore._setItems([
			item({ id: 'locked', trackId: 'audio-locked', from: 100 }),
			item({ id: 'free', trackId: 'audio-free', from: 100 })
		]);

		const result = propagateInsertedGapToSyncLockedTracks({
			editedTrackIds: new Set(['video']),
			cutFrame: 100,
			amount: 20
		});

		expect(result.affectedIds).toEqual([]);
		expect(timelineStore.itemById.get('locked')?.from).toBe(100);
		expect(timelineStore.itemById.get('free')?.from).toBe(100);
	});

	it('preserves an outgoing transition when a sync-lock removal splits its clip', () => {
		timelineStore.setAll({
			tracks: [track('edited'), track('video')]
		});
		timelineStore._setItems([
			item({ id: 'edited-anchor', trackId: 'edited', durationInFrames: 30 }),
			item({
				id: 'video-1',
				trackId: 'video',
				durationInFrames: 60,
				sourceStart: 20,
				sourceEnd: 80,
				sourceDuration: 120
			}),
			item({
				id: 'video-2',
				trackId: 'video',
				from: 60,
				durationInFrames: 30,
				sourceStart: 20,
				sourceEnd: 50,
				sourceDuration: 120
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video-1',
				toItemId: 'video-2'
			}
		]);

		propagateRemovedIntervalsToSyncLockedTracks({
			editedTrackIds: new Set(['edited']),
			intervals: [{ start: 20, end: 40 }]
		});

		const splitTail = timelineStore.items.find(
			(candidate) =>
				candidate.trackId === 'video' && candidate.id !== 'video-1' && candidate.id !== 'video-2'
		);
		expect(splitTail).toMatchObject({ from: 20, durationInFrames: 20 });
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({
				fromItemId: splitTail?.id,
				toItemId: 'video-2'
			})
		]);
	});

	it('clears a linked group when sync lock splits only one group member', () => {
		timelineStore.setAll({
			tracks: [track('edited'), track('audio')]
		});
		timelineStore._setItems([
			item({ id: 'edited-anchor', trackId: 'edited', durationInFrames: 30 }),
			item({
				id: 'music-bed',
				trackId: 'audio',
				type: 'audio',
				durationInFrames: 60,
				linkedGroupId: 'group-1'
			})
		]);

		propagateInsertedGapToSyncLockedTracks({
			editedTrackIds: new Set(['edited']),
			cutFrame: 20,
			amount: 10
		});

		const segments = timelineStore.items
			.filter((candidate) => candidate.trackId === 'audio')
			.sort((left, right) => left.from - right.from);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toMatchObject({
			id: 'music-bed',
			from: 0,
			durationInFrames: 20,
			linkedGroupId: undefined
		});
		expect(segments[1]).toMatchObject({
			from: 30,
			durationInFrames: 40,
			linkedGroupId: undefined
		});
	});
});
