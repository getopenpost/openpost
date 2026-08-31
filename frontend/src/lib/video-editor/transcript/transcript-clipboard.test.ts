import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import type { TranscriptSourceWord } from './speech-cleanup';
import { buildTranscriptClipboardItems } from './transcript-clipboard';

function mediaItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'video',
		trackId: 'V1',
		from: 90,
		durationInFrames: 300,
		label: 'Interview',
		type: 'video',
		mediaId: 'media',
		sourceStart: 0,
		sourceEnd: 300,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

function word(overrides: Partial<TranscriptSourceWord> = {}): TranscriptSourceWord {
	return {
		id: 'video:captions:cue:word',
		mediaId: 'media',
		sourceItemId: 'video',
		subtitleItemId: 'captions',
		cueId: 'cue',
		wordId: 'word',
		text: 'word',
		start: 1,
		end: 2,
		timelineStartFrame: 120,
		timelineEndFrame: 150,
		...overrides
	};
}

describe('transcript clipboard items', () => {
	it('carries one selected phrase as a source-trimmed media clip', () => {
		const items = [mediaItem()];
		const clones = buildTranscriptClipboardItems(
			[
				word(),
				word({
					id: 'second',
					wordId: 'second',
					start: 2,
					end: 3,
					timelineStartFrame: 150,
					timelineEndFrame: 180
				})
			],
			items,
			30,
			() => 'clone'
		);

		expect(clones).toEqual([
			expect.objectContaining({
				id: 'clone',
				trackId: 'V1',
				from: 120,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				linkedGroupId: undefined
			})
		]);
	});

	it('keeps separate clip runs and preserves their timeline gap', () => {
		const items = [mediaItem(), mediaItem({ id: 'repeat', from: 300 })];
		const clones = buildTranscriptClipboardItems(
			[
				word({ timelineStartFrame: 120, timelineEndFrame: 150 }),
				word({
					id: 'repeat-word',
					sourceItemId: 'repeat',
					timelineStartFrame: 330,
					timelineEndFrame: 360
				})
			],
			items,
			30,
			(() => {
				let id = 0;
				return () => `clone-${++id}`;
			})()
		);

		expect(clones.map((item) => item.from)).toEqual([120, 330]);
		expect(clones.map((item) => item.durationInFrames)).toEqual([30, 30]);
	});

	it('clones linked audio with its own source fps and one fresh link id', () => {
		const items = [
			mediaItem({ linkedGroupId: 'pair' }),
			mediaItem({
				id: 'audio',
				trackId: 'A1',
				type: 'audio',
				sourceFps: 48,
				linkedGroupId: 'pair'
			})
		];
		const ids = ['link', 'video-clone', 'audio-clone'];
		const clones = buildTranscriptClipboardItems([word()], items, 30, () => ids.shift()!);

		expect(clones).toHaveLength(2);
		expect(clones.map((item) => item.trackId)).toEqual(['V1', 'A1']);
		expect(clones.map((item) => item.sourceStart)).toEqual([30, 48]);
		expect(clones.map((item) => item.sourceEnd)).toEqual([60, 96]);
		expect(new Set(clones.map((item) => item.linkedGroupId))).toEqual(new Set(['link']));
	});

	it('uses the full descending source span for reversed transcript words', () => {
		const reversed = mediaItem({ isReversed: true });
		const clones = buildTranscriptClipboardItems(
			[
				word({ start: 2, end: 3, timelineStartFrame: 120, timelineEndFrame: 150 }),
				word({ id: 'earlier', start: 1, end: 2, timelineStartFrame: 150, timelineEndFrame: 180 })
			],
			[reversed],
			30,
			() => 'clone'
		);
		expect(clones[0]).toMatchObject({ sourceStart: 30, sourceEnd: 90 });
	});
});
