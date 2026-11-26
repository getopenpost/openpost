import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTracks } from '../../project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	addTrack,
	createTrackGroup,
	moveTrack,
	removeTrackGroupWithContents,
	removeEmptyTracks,
	ungroupTracks
} from './tracks';

describe('timeline track actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds video above visual tracks and audio below audio tracks as one undoable edit', () => {
		const videoId = addTrack('video', 'Video 2');
		const audioId = addTrack('audio', 'Audio 2');
		const video = timelineStore.tracks.find((track) => track.id === videoId)!;
		const audio = timelineStore.tracks.find((track) => track.id === audioId)!;
		expect(video.order).toBeLessThan(
			Math.min(...createDefaultTracks().map((track) => track.order))
		);
		expect(audio.order).toBeGreaterThan(
			Math.max(...createDefaultTracks().map((track) => track.order))
		);
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.tracks.some((track) => track.id === audioId)).toBe(false);
	});

	it('removes empty tracks and their orphaned groups in one undoable edit', () => {
		timelineStore._setItems([
			{
				id: 'clip',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30,
				label: 'Clip',
				type: 'video'
			}
		]);
		const groupId = createTrackGroup(['track-video-overlay'], 'Empty overlays')!;
		commandHistory.clearHistory();

		expect(removeEmptyTracks('track-video-main')).toEqual(['track-video-overlay', 'track-audio']);
		expect(timelineStore.tracks.map((track) => track.id)).toEqual(['track-video-main']);
		expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_EMPTY_TRACKS');

		commandHistory.undo();
		expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(true);
		expect(timelineStore.tracks).toHaveLength(4);
	});

	it('groups non-contiguous tracks into one ordered block and undoes atomically', () => {
		const groupId = createTrackGroup(['track-video-overlay', 'track-audio'], 'Talking head');
		expect(groupId).toBeTruthy();
		const ordered = timelineStore.tracks.toSorted((left, right) => left.order - right.order);
		expect(ordered.map((track) => track.id)).toEqual([
			groupId,
			'track-video-overlay',
			'track-audio',
			'track-video-main'
		]);
		expect(ordered.slice(1, 3).every((track) => track.parentTrackId === groupId)).toBe(true);
		expect(commandHistory.getLastCommandType()).toBe('CREATE_TRACK_GROUP');
		commandHistory.undo();
		expect(timelineStore.tracks.some((track) => track.isGroup)).toBe(false);
	});

	it('ungroups without losing clips and requires an explicit action to delete contents', () => {
		timelineStore._setItems([
			{
				id: 'clip',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 30,
				label: 'Clip',
				type: 'video'
			}
		]);
		const groupId = createTrackGroup(['track-video-overlay'], 'Overlay group')!;
		expect(ungroupTracks(groupId)).toBe(true);
		expect(timelineStore.itemById.has('clip')).toBe(true);
		commandHistory.undo();
		expect(removeTrackGroupWithContents(groupId)).toBe(true);
		expect(timelineStore.itemById.has('clip')).toBe(false);
		commandHistory.undo();
		expect(timelineStore.itemById.has('clip')).toBe(true);
	});

	it('moves a group as one block and reorders children only inside their group', () => {
		const groupId = createTrackGroup(['track-video-overlay', 'track-video-main'], 'Visuals')!;
		expect(moveTrack(groupId, 1)).toBe(true);
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.id)
		).toEqual(['track-audio', groupId, 'track-video-overlay', 'track-video-main']);
		expect(moveTrack('track-video-main', -1)).toBe(true);
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.id)
		).toEqual(['track-audio', groupId, 'track-video-main', 'track-video-overlay']);
		expect(commandHistory.getLastCommandType()).toBe('MOVE_TRACK');
	});
});
