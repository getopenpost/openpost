import type { EngineTranscriptWord } from '../types';

export interface RawWhisperWord {
	text: string;
	timestamp: [number | null, number | null];
	confidence?: number;
}

const FALLBACK_WORD_SECONDS = 0.5;
const MIN_WORD_SECONDS = 0.01;

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

function isValidTimestamp(value: number | null): value is number {
	return isNumber(value) && Number.isFinite(value) && value >= 0;
}

function nextKnownStart(
	words: readonly RawWhisperWord[],
	index: number,
	after: number
): number | null {
	for (let nextIndex = index + 1; nextIndex < words.length; nextIndex++) {
		const start = words[nextIndex]?.timestamp[0] ?? null;
		if (isValidTimestamp(start) && start > after) return start;
	}
	return null;
}

/**
 * Whisper can leave the first or final word timestamp open at a decoding boundary.
 * Preserve that recognized text with a conservative inferred span instead of silently
 * dropping it from the saved transcript.
 */
export function resolveWhisperWordTimings(
	rawWords: readonly RawWhisperWord[],
	chunkTimestamp: number,
	chunkDuration: number
): EngineTranscriptWord[] {
	const words: EngineTranscriptWord[] = [];
	let previousEnd = 0;

	rawWords.forEach((rawWord, index) => {
		if (!rawWord.text.trim()) return;

		const rawStart = rawWord.timestamp[0];
		const rawEnd = rawWord.timestamp[1];
		let start = isValidTimestamp(rawStart)
			? rawStart
			: isValidTimestamp(rawEnd)
				? Math.max(previousEnd, rawEnd - FALLBACK_WORD_SECONDS)
				: previousEnd;
		start = Math.min(Math.max(0, start), chunkDuration);

		const nextStart = nextKnownStart(rawWords, index, start);
		let end = isValidTimestamp(rawEnd) && rawEnd > start ? rawEnd : null;
		end ??= nextStart ?? Math.min(chunkDuration, start + FALLBACK_WORD_SECONDS);
		if (end <= start && start === chunkDuration && chunkDuration > 0) {
			start = Math.max(0, chunkDuration - MIN_WORD_SECONDS);
			end = chunkDuration;
		}
		if (end <= start && start < chunkDuration) {
			end = Math.min(chunkDuration, start + MIN_WORD_SECONDS);
		}
		if (end <= start) return;

		previousEnd = end;
		const word: EngineTranscriptWord = {
			text: rawWord.text,
			start: start + chunkTimestamp,
			end: end + chunkTimestamp
		};
		if (isNumber(rawWord.confidence)) {
			word.confidence = rawWord.confidence;
		}
		words.push(word);
	});

	return words;
}
