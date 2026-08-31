import { describe, expect, it } from 'vitest';
import {
	captionFramesToSourceRange,
	sourceRangeToCaptionFrames,
	type ResolvedTranscriptCaptionTiming
} from './caption-source-mapping';

const forward: ResolvedTranscriptCaptionTiming = {
	sourceStartSeconds: 10,
	sourceEndSeconds: 20,
	playbackSpeed: 2,
	isReversed: false
};

describe('transcript caption source mapping', () => {
	it('round-trips forward cue frames through retimed source seconds', () => {
		const source = captionFramesToSourceRange(15, 30, forward, 30);
		expect(source).toEqual({ start: 11, end: 12 });
		expect(sourceRangeToCaptionFrames(source, forward, 30, 150)).toEqual({
			start: 15,
			end: 30
		});
	});

	it('round-trips reversed cue frames from the exclusive source end', () => {
		const reversed = { ...forward, isReversed: true };
		const source = captionFramesToSourceRange(15, 30, reversed, 30);
		expect(source).toEqual({ start: 18, end: 19 });
		expect(sourceRangeToCaptionFrames(source, reversed, 30, 150)).toEqual({
			start: 15,
			end: 30
		});
	});
});
