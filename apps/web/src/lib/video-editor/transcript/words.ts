/**
 * Ported from FreeCut (MIT) — media-library/transcription/workers/
 * whisper.worker.ts dedupe helpers, reshaped as pure functions over offset
 * TranscriptWord lists so chunk stitching is testable without a worker.
 */

import type { TranscriptWord } from './cues';

const DUPLICATE_WORD_START_TOLERANCE_SECONDS = 0.5;

function normalizeWordText(text: string): string {
	return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function mergeChunkWords(
	left: TranscriptWord[],
	right: TranscriptWord[],
	overlapSeconds: number
): TranscriptWord[] {
	if (left.length === 0) return [...right].sort((a, b) => a.startSeconds - b.startSeconds);
	if (right.length === 0) return [...left].sort((a, b) => a.startSeconds - b.startSeconds);

	const leftEnd = left[left.length - 1]!.endSeconds;
	const overlapZoneStart = leftEnd - Math.max(overlapSeconds, 0);

	const merged = [...left];
	for (const word of right) {
		const normalized = normalizeWordText(word.text);
		if (!normalized) {
			continue;
		}
		const isDuplicate = left.some((candidate) => {
			if (normalizeWordText(candidate.text) !== normalized) return false;
			if (candidate.endSeconds <= overlapZoneStart) return false;
			const startsClose =
				Math.abs(candidate.startSeconds - word.startSeconds) <=
				DUPLICATE_WORD_START_TOLERANCE_SECONDS;
			const overlaps =
				candidate.startSeconds < word.endSeconds && word.startSeconds < candidate.endSeconds;
			return startsClose || overlaps;
		});
		if (!isDuplicate) merged.push(word);
	}

	return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

export function wordsToTranscriptText(words: TranscriptWord[]): string {
	return words
		.map((word) => word.text.trim())
		.filter((text) => text.length > 0)
		.join(' ');
}
