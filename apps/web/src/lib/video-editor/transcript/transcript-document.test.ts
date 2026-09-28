import { expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { transcriptDocument } from './transcript-document';
import { collectSubtitleCues } from './subtitle-export';

it('omits trimmed speech and clips exported captions to the retained caption interval', () => {
	const subtitle: TimelineItem = {
		id: 'captions',
		type: 'subtitle',
		trackId: 'captions',
		label: 'Captions',
		from: 300,
		durationInFrames: 15,
		captionSource: { type: 'transcript', clipId: 'source', mediaId: 'media' },
		cues: [
			{
				id: 'cue',
				startFrame: 6,
				endFrame: 60,
				text: 'Hello world',
				words: [
					{ id: 'hello', text: 'Hello', startFrame: 6, endFrame: 36 },
					{ id: 'world', text: 'world', startFrame: 39, endFrame: 60 }
				]
			}
		]
	};
	expect(
		transcriptDocument([subtitle], 30).map(({ text, startFrame, endFrame }) => ({
			text,
			startFrame,
			endFrame
		}))
	).toEqual([{ text: 'Hello', startFrame: 306, endFrame: 315 }]);
	expect(collectSubtitleCues([subtitle], 30)).toEqual([
		{ text: 'Hello world', startSeconds: 10.2, endSeconds: 10.5 }
	]);
});
