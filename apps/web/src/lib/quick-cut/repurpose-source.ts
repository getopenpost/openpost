import type { RepurposeCandidate, RepurposeRequest } from '$lib/query/repurpose';
import { getSelectedAudioStreams } from './model';
import type { QuickCutSource } from './types';

export function repurposeAudioTrack(source: QuickCutSource): number | undefined {
	const streams = getSelectedAudioStreams(source);
	return (
		streams.find((stream) => stream.index === source.transcript?.audioTrackIndex)?.index ??
		streams[0]?.index
	);
}

export function repurposeSourceKey(source: QuickCutSource): string {
	return JSON.stringify({
		id: source.id,
		fingerprint: source.contentFingerprint,
		size: source.size,
		lastModified: source.lastModified,
		duration: source.duration,
		videoTrack: source.selectedVideoTrackIndex,
		audioTracks: source.selectedAudioTrackIndices,
		transcript: source.transcript
	});
}

export async function repurposeSourceSnapshot(
	source: QuickCutSource
): Promise<RepurposeRequest['source']> {
	const key = repurposeSourceKey(source);
	const id = source.id;
	const duration = source.duration;
	const track = repurposeAudioTrack(source);
	const transcript = source.transcript;
	if (track === undefined || transcript?.audioTrackIndex !== track || !transcript.words.length) {
		throw new Error('A source transcript is required.');
	}
	const words = transcript.words.map(({ text, start, end }) => ({
		text,
		start,
		end
	}));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	return {
		id,
		revision: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
			''
		),
		audio_track_index: track,
		duration,
		words
	};
}

export function validateRepurposeCandidates(
	candidates: RepurposeCandidate[],
	source: RepurposeRequest['source']
): boolean {
	const words = source.words ?? [];
	return (
		candidates.length <= 3 &&
		new Set(candidates.map((candidate) => candidate.id)).size === candidates.length &&
		candidates.every((candidate) => {
			const first = words[candidate.first_word];
			const last = words[candidate.last_word];
			return (
				Number.isInteger(candidate.first_word) &&
				Number.isInteger(candidate.last_word) &&
				candidate.first_word >= 0 &&
				candidate.last_word >= candidate.first_word &&
				first &&
				last &&
				candidate.start === first.start &&
				candidate.end === last.end &&
				candidate.end > candidate.start
			);
		})
	);
}
