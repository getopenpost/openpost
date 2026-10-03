import { describe, expect, it } from 'vitest';
import { repurposeSourceSnapshot, validateRepurposeCandidates } from './repurpose-source';
import type { QuickCutSource } from './types';

const source: QuickCutSource = {
	id: 'source',
	name: 'launch.mp4',
	size: 10,
	mimeType: 'video/mp4',
	duration: 20,
	width: 640,
	height: 360,
	videoCodec: 'avc',
	audioCodec: 'aac',
	sampleRate: 48000,
	channels: 1,
	rotation: 0,
	fps: 30,
	keyframeTimestamps: [],
	keyframeState: 'unknown',
	videoStreams: [],
	audioStreams: [
		{ index: 1, codec: 'aac', sampleRate: 48000, channels: 1 },
		{ index: 2, codec: 'aac', sampleRate: 48000, channels: 1 }
	],
	selectedAudioTrackIndices: [1, 2],
	transcript: {
		audioTrackIndex: 2,
		words: [
			{ text: 'A useful lesson', start: 1, end: 3 },
			{ text: 'with an example', start: 4, end: 6 }
		]
	}
};

describe('Repurpose source admission', () => {
	it('keeps the cached transcript track and changes revision when words or selected tracks change', async () => {
		const first = await repurposeSourceSnapshot(source);
		expect(first.audio_track_index).toBe(2);
		const edited = structuredClone(source);
		edited.transcript!.words[0]!.text = 'A corrected lesson';
		expect((await repurposeSourceSnapshot(edited)).revision).not.toBe(first.revision);
		const differentSelection = { ...source, selectedAudioTrackIndices: [2] };
		expect((await repurposeSourceSnapshot(differentSelection)).revision).not.toBe(first.revision);
		await expect(
			repurposeSourceSnapshot({ ...source, selectedAudioTrackIndices: [1] })
		).rejects.toThrow();
	});
	it('accepts no candidates but rejects invented times and reversed word bounds', async () => {
		const snapshot = await repurposeSourceSnapshot(source);
		const candidate = {
			id: 'clip',
			title: 'Lesson',
			rationale: 'A complete thought',
			context_warning: '',
			first_word: 0,
			last_word: 1,
			start: 1,
			end: 6
		};
		expect(validateRepurposeCandidates([], snapshot)).toBe(true);
		expect(validateRepurposeCandidates([candidate], snapshot)).toBe(true);
		expect(validateRepurposeCandidates([{ ...candidate, start: 0.9 }], snapshot)).toBe(false);
		expect(
			validateRepurposeCandidates([{ ...candidate, first_word: 1, last_word: 0 }], snapshot)
		).toBe(false);
		expect(validateRepurposeCandidates([candidate, candidate], snapshot)).toBe(false);
	});
});
