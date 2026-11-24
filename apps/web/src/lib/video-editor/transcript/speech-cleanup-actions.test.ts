import { beforeEach, expect, it } from 'vitest';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { collectTranscriptSourceWords } from './speech-cleanup';
import { buildTranscriptSelectionRanges } from './transcript-edit-model';
import { applyTranscriptTargetRangeRemoval } from './speech-cleanup-actions';

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks([
		...createDefaultTracks(),
		{
			id: 'captions',
			name: 'Captions',
			kind: 'video',
			order: 2,
			height: 64,
			visible: true,
			locked: false,
			muted: false,
			solo: false
		}
	]);
});

function fixture(): TimelineItem[] {
	return [
		{
			id: 'speech',
			originId: 'independent-lineage',
			type: 'audio',
			mediaId: 'recording',
			trackId: 'track-audio-main',
			from: 0,
			durationInFrames: 90,
			label: 'Speech',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30
		},
		{
			id: 'caption',
			type: 'subtitle',
			trackId: 'captions',
			from: 0,
			durationInFrames: 90,
			label: 'Transcript',
			captionSource: {
				type: 'transcript',
				clipId: 'speech',
				mediaId: 'recording',
				sourceStartSeconds: 0,
				sourceEndSeconds: 3,
				playbackSpeed: 1
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 90,
					text: 'This works',
					words: [
						{ id: 'this', text: 'This', startFrame: 0, endFrame: 6 },
						{ id: 'works', text: 'works', startFrame: 30, endFrame: 60 }
					]
				}
			]
		}
	];
}

it('cuts a staged word from speech with an independent lineage and repairs its caption in one undo step', () => {
	const items = fixture();
	timelineStore._setItems(items);
	const words = collectTranscriptSourceWords(timelineStore.items, ['speech'], 30).filter(
		(word) => word.text === 'This'
	);
	expect(words).toHaveLength(1);
	applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(words));
	expect(timelineStore.items.find((item) => item.type === 'audio')?.durationInFrames).toBe(84);
	expect(timelineStore.items.find((item) => item.type === 'subtitle')?.cues?.[0]?.text).toBe(
		'works'
	);
	expect(
		timelineStore.items.find((item) => item.type === 'subtitle')?.cues?.[0]?.words?.[0]?.startFrame
	).toBe(24);
	commandHistory.undo();
	expect(timelineStore.itemById.get('caption')?.cues?.[0]?.text).toBe('This works');
	expect(timelineStore.itemById.get('speech')?.durationInFrames).toBe(90);
});

it('leaves locked captions unchanged when their source is cut', () => {
	timelineStore._setItems(
		fixture().map((item) => (item.id === 'speech' ? { ...item, originId: 'speech' } : item))
	);
	timelineStore._setTracks(
		timelineStore.tracks.map((track) =>
			track.id === 'captions' ? { ...track, locked: true } : track
		)
	);
	const words = collectTranscriptSourceWords(timelineStore.items, ['speech'], 30).filter(
		(word) => word.text === 'This'
	);
	const before = structuredClone(timelineStore.itemById.get('caption'));
	applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(words));
	expect(timelineStore.itemById.get('caption')).toEqual(before);
	expect(timelineStore.items.find((item) => item.type === 'audio')?.durationInFrames).toBe(84);
});

it('ripples unrelated clips on a caption track without cutting managed captions twice', () => {
	timelineStore._setTracks(timelineStore.tracks.map((track) => ({ ...track, syncLock: true })));
	timelineStore._setItems([
		...fixture(),
		{
			id: 'title',
			type: 'text',
			text: 'Title',
			label: 'Title',
			trackId: 'captions',
			from: 90,
			durationInFrames: 30
		}
	]);
	const words = collectTranscriptSourceWords(timelineStore.items, ['speech'], 30).filter(
		(word) => word.text === 'This'
	);
	applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(words));
	expect(timelineStore.itemById.get('title')?.from).toBe(84);
	expect(
		collectTranscriptSourceWords(
			timelineStore.items,
			timelineStore.items.filter((item) => item.type === 'audio').map((item) => item.id),
			30
		).find((word) => word.text === 'works')?.timelineStartFrame
	).toBe(24);
});
