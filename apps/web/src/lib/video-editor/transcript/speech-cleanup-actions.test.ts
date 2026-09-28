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
});

it.each(['This', 'works'])(
	'preserves source times after cutting %s, then cuts the next retained word',
	(firstWord) => {
		const items = fixture();
		items[1]!.cues![0]!.words!.push({ id: 'later', text: 'later', startFrame: 75, endFrame: 84 });
		items[1]!.cues![0]!.text = 'This works later';
		timelineStore._setItems(items);
		const currentWords = () =>
			collectTranscriptSourceWords(
				timelineStore.items,
				timelineStore.items.filter((item) => item.type === 'audio').map((item) => item.id),
				30
			);
		const first = currentWords().filter((word) => word.text === firstWord);
		applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(first));
		const later = currentWords().find((word) => word.text === 'later');
		expect(later?.start).toBeCloseTo(2.5);
		expect(later?.end).toBeCloseTo(2.8);
		expect(later?.timelineStartFrame).toBe(firstWord === 'This' ? 69 : 45);
		const next = currentWords().filter((word) => word.text === 'later');
		applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(next));
		expect(currentWords().map((word) => word.text)).not.toContain('later');
		const retained = timelineStore.items.filter((item) => item.type === 'audio');
		expect(
			retained.some((item) => (item.sourceStart ?? 0) < 84 && (item.sourceEnd ?? 0) > 75)
		).toBe(false);
		commandHistory.undo();
		expect(currentWords().find((word) => word.text === 'later')?.start).toBeCloseTo(2.5);
		expect(currentWords().find((word) => word.text === 'later')?.end).toBeCloseTo(2.8);
		commandHistory.redo();
		expect(currentWords().map((word) => word.text)).not.toContain('later');
	}
);

it('cuts words from a caption trimmed to start after its source clip', () => {
	const items = fixture();
	const caption = items.find((item) => item.type === 'subtitle')!;
	caption.from = 30;
	caption.durationInFrames = 60;
	caption.captionSource = {
		type: 'transcript',
		clipId: 'speech',
		mediaId: 'recording',
		sourceStartSeconds: 1,
		sourceEndSeconds: 3,
		playbackSpeed: 1
	};
	caption.cues = [
		{
			id: 'cue',
			startFrame: 0,
			endFrame: 60,
			text: 'This works',
			words: [
				{ id: 'this', text: 'This', startFrame: 0, endFrame: 6 },
				{ id: 'works', text: 'works', startFrame: 15, endFrame: 30 }
			]
		}
	];
	timelineStore._setItems(items);
	const words = collectTranscriptSourceWords(timelineStore.items, ['speech'], 30).filter(
		(word) => word.text === 'This'
	);
	applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(words));
	const retained = collectTranscriptSourceWords(
		timelineStore.items,
		timelineStore.items.filter((item) => item.type === 'audio').map((item) => item.id),
		30
	);
	expect(retained.map((word) => word.text)).toEqual(['works']);
	expect(retained[0]?.start).toBeCloseTo(1.5);
	expect(retained[0]?.timelineStartFrame).toBe(39);
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
