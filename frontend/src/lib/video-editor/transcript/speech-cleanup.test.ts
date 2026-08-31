import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { applyTranscriptTargetRangeRemoval } from './speech-cleanup-actions';
import {
	collectTranscriptSourceWords,
	detectTranscriptSilenceRanges,
	detectFillerRanges,
	FILLER_REMOVAL_PRESETS
} from './speech-cleanup';

const source: TimelineItem = {
	id: 'source',
	trackId: 'video',
	from: 90,
	durationInFrames: 150,
	label: 'Interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 300,
	sourceEnd: 600,
	sourceFps: 30,
	speed: 2
};

function transcript(
	words: Array<{ id: string; text: string; start: number; end: number }>
): TimelineItem {
	return {
		id: 'captions',
		trackId: 'captions',
		from: 90,
		durationInFrames: 150,
		label: 'Auto captions',
		type: 'subtitle',
		captionSource: {
			type: 'transcript',
			clipId: source.id,
			mediaId: 'media',
			sourceStartSeconds: 10,
			playbackSpeed: 2
		},
		cues: [
			{
				id: 'cue',
				startFrame: words[0]?.start ?? 0,
				endFrame: words.at(-1)?.end ?? 1,
				text: words.map((word) => word.text).join(' '),
				words: words.map((word) => ({
					id: word.id,
					text: word.text,
					startFrame: word.start,
					endFrame: word.end
				}))
			}
		]
	};
}

describe('speech cleanup transcript mapping', () => {
	it('maps caption frames back to exact source seconds after trim and retime', () => {
		const captions = transcript([{ id: 'um', text: 'Um,', start: 15, end: 24 }]);
		expect(collectTranscriptSourceWords([source, captions], [source.id], 30)).toMatchObject([
			{ mediaId: 'media', text: 'Um,', start: 11, end: 11.6 }
		]);
	});

	it('keeps only words that overlap the selected source pieces', () => {
		const captions = transcript([
			{ id: 'before', text: 'uh', start: 15, end: 20 },
			{ id: 'inside', text: 'um', start: 90, end: 99 }
		]);
		const tail = { ...source, id: 'tail', sourceStart: 450, sourceEnd: 600 };
		const words = collectTranscriptSourceWords([source, tail, captions], [tail.id], 30);
		expect(words.map((word) => word.wordId)).toEqual(['inside']);
	});

	it('orders repeated source uses by timeline position and dedupes linked companions', () => {
		const captions = transcript([{ id: 'word', text: 'again', start: 15, end: 24 }]);
		const repeat = { ...source, id: 'repeat', from: 300 };
		const linkedAudio = {
			...source,
			id: 'audio',
			type: 'audio' as const,
			linkedGroupId: 'pair'
		};
		const linkedVideo = { ...source, linkedGroupId: 'pair' };
		const words = collectTranscriptSourceWords(
			[linkedVideo, linkedAudio, repeat, captions],
			[linkedVideo.id, linkedAudio.id, repeat.id],
			30
		);
		expect(words).toMatchObject([
			{ sourceItemId: 'source', timelineStartFrame: 105, timelineEndFrame: 114 },
			{ sourceItemId: 'repeat', timelineStartFrame: 315, timelineEndFrame: 324 }
		]);
	});

	it('projects reversed source words onto ascending timeline spans', () => {
		const reversed = {
			...source,
			from: 100,
			durationInFrames: 90,
			sourceStart: 300,
			sourceEnd: 390,
			speed: 1,
			isReversed: true
		};
		const captions = transcript([{ id: 'backward', text: 'backward', start: 30, end: 60 }]);
		captions.captionSource = {
			type: 'transcript',
			clipId: reversed.id,
			mediaId: 'media',
			sourceStartSeconds: 10,
			playbackSpeed: 1
		};
		const words = collectTranscriptSourceWords([reversed, captions], [reversed.id], 30);
		expect(words).toMatchObject([
			{ start: 11, end: 12, timelineStartFrame: 130, timelineEndFrame: 160 }
		]);
	});
});

describe('filler detection', () => {
	it('canonicalizes stretched speech and rejects long false positives', () => {
		const captions = transcript([
			{ id: 'uh', text: 'Uhhhh...', start: 15, end: 24 },
			{ id: 'long-like', text: 'like', start: 30, end: 90 }
		]);
		const words = collectTranscriptSourceWords([source, captions], [source.id], 30);
		const ranges = detectFillerRanges(words, FILLER_REMOVAL_PRESETS[2]!.settings);
		expect(ranges.media).toHaveLength(1);
		expect(ranges.media?.[0]?.text).toBe('Uhhhh...');
	});

	it('matches the longest phrase and merges cuts separated only by padding', () => {
		const captions = transcript([
			{ id: 'you', text: 'you', start: 15, end: 18 },
			{ id: 'know', text: 'know', start: 18, end: 22 },
			{ id: 'um', text: 'um', start: 23, end: 27 },
			{ id: 'work', text: 'work', start: 60, end: 66 }
		]);
		const words = collectTranscriptSourceWords([source, captions], [source.id], 30);
		const ranges = detectFillerRanges(words);
		expect(ranges.media).toHaveLength(1);
		expect(ranges.media?.[0]?.text).toBe('you know um');
		expect(ranges.media?.[0]?.words.map((word) => word.wordId)).toEqual(['you', 'know', 'um']);
	});

	it('does not join identical timestamps from separate media', () => {
		const words = collectTranscriptSourceWords(
			[
				source,
				{ ...source, id: 'other', mediaId: 'other-media' },
				transcript([{ id: 'one', text: 'um', start: 15, end: 20 }]),
				{
					...transcript([{ id: 'two', text: 'uh', start: 15, end: 20 }]),
					id: 'other-captions',
					captionSource: {
						type: 'transcript',
						clipId: 'other',
						mediaId: 'other-media',
						sourceStartSeconds: 10,
						playbackSpeed: 2
					}
				}
			],
			['source', 'other'],
			30
		);
		const ranges = detectFillerRanges(words);
		expect(Object.values(ranges).flat()).toHaveLength(2);
	});
});

describe('transcript-gap silence detection', () => {
	it('keeps padding around speech and ignores gaps below the chosen minimum', () => {
		const captions = transcript([
			{ id: 'hello', text: 'hello', start: 15, end: 30 },
			{ id: 'again', text: 'again', start: 60, end: 75 }
		]);
		const ranges = detectTranscriptSilenceRanges([source, captions], [source.id], 30, {
			minSilenceMs: 500,
			paddingStartMs: 100,
			paddingEndMs: 100
		});
		expect(ranges.media).toEqual([
			{ start: 10.1, end: 10.9 },
			{ start: 12.1, end: 13.9 },
			{ start: 15.1, end: 19.9 }
		]);
	});

	it('never treats a missing transcript as proof of silence', () => {
		expect(
			detectTranscriptSilenceRanges([source], [source.id], 30, {
				minSilenceMs: 1,
				paddingStartMs: 0,
				paddingEndMs: 0
			})
		).toEqual({});
	});
});

describe('transcript range removal', () => {
	it('does not change transcript captions for a source on a locked track', () => {
		const unlockedTrack: TimelineTrack = {
			id: 'unlocked',
			name: 'Unlocked',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const lockedTrack: TimelineTrack = {
			...unlockedTrack,
			id: 'locked',
			name: 'Locked',
			locked: true,
			order: 1
		};
		const captionsTrack: TimelineTrack = {
			...unlockedTrack,
			id: 'captions',
			name: 'Captions',
			order: 2
		};
		const clip = (id: string, trackId: string, mediaId: string): TimelineItem => ({
			id,
			trackId,
			from: 0,
			durationInFrames: 90,
			label: id,
			type: 'video',
			mediaId,
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		});
		const caption = (id: string, clipId: string, mediaId: string, text: string): TimelineItem => ({
			id,
			trackId: captionsTrack.id,
			from: 0,
			durationInFrames: 90,
			label: id,
			type: 'subtitle',
			captionSource: {
				type: 'transcript',
				clipId,
				mediaId,
				sourceStartSeconds: 0,
				playbackSpeed: 1
			},
			cues: [
				{
					id: `${id}-cue`,
					startFrame: 30,
					endFrame: 60,
					text,
					words: [{ id: `${id}-word`, startFrame: 30, endFrame: 60, text }]
				}
			]
		});
		const unlockedClip = clip('unlocked-clip', unlockedTrack.id, 'unlocked-media');
		const lockedClip = clip('locked-clip', lockedTrack.id, 'locked-media');
		const unlockedCaption = caption(
			'unlocked-caption',
			unlockedClip.id,
			'unlocked-media',
			'Change me'
		);
		const lockedCaption = caption('locked-caption', lockedClip.id, 'locked-media', 'Keep me');
		timelineStore.__resetForTesting();
		timelineStore.setAll({
			tracks: [unlockedTrack, lockedTrack, captionsTrack],
			items: [unlockedClip, lockedClip, unlockedCaption, lockedCaption],
			currentFrame: 0,
			fps: 30
		});
		commandHistory.clearHistory();

		const result = applyTranscriptTargetRangeRemoval(
			{
				[unlockedClip.id]: { mediaId: 'unlocked-media', ranges: [{ start: 1, end: 2 }] },
				[lockedClip.id]: { mediaId: 'locked-media', ranges: [{ start: 1, end: 2 }] }
			},
			[
				{
					id: 'unlocked-word',
					mediaId: 'unlocked-media',
					sourceItemId: unlockedClip.id,
					subtitleItemId: unlockedCaption.id,
					cueId: 'unlocked-caption-cue',
					wordId: 'unlocked-caption-word',
					text: 'Change me',
					start: 1,
					end: 2
				},
				{
					id: 'locked-word',
					mediaId: 'locked-media',
					sourceItemId: lockedClip.id,
					subtitleItemId: lockedCaption.id,
					cueId: 'locked-caption-cue',
					wordId: 'locked-caption-word',
					text: 'Keep me',
					start: 1,
					end: 2
				}
			]
		);

		expect(result).toMatchObject({ analyzedItemCount: 1, removedItemCount: 1 });
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(timelineStore.itemById.get(lockedClip.id)).toMatchObject({
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 90
		});
		expect(timelineStore.itemById.get(lockedCaption.id)?.cues?.[0]?.text).toBe('Keep me');
	});
});
