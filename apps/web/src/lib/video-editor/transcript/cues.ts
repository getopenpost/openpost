/**
 * Caption cue building: word-level transcript tokens grouped into subtitle
 * cues that respect per-line character limits, line counts, and max duration.
 *
 * Pure timeline-frame math so the Whisper worker (#123) can feed it later;
 * SRT/VTT import can reuse the same grouping for plain-text cues.
 */

import type { SubtitleCue } from '../project/types';

export interface TranscriptWord {
	text: string;
	/** Word start/end in seconds from media start. */
	startSeconds: number;
	endSeconds: number;
}

export interface CueBuildOptions {
	fps: number;
	maxCharsPerLine?: number;
	maxLines?: number;
	maxDurationSeconds?: number;
}

export interface BuiltCue {
	startFrame: number;
	endFrame: number;
	lines: string[];
}

const DEFAULT_MAX_CHARS_PER_LINE = 32;
const DEFAULT_MAX_LINES = 2;
const DEFAULT_MAX_DURATION_SECONDS = 5;

function wrapWords(words: string[], maxCharsPerLine: number, maxLines: number): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > maxCharsPerLine && current) {
			lines.push(current);
			current = word;
			if (lines.length === maxLines) return [...lines, '…'];
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines;
}

export function buildCuesFromWords(
	words: TranscriptWord[],
	options: CueBuildOptions
): SubtitleCue[] {
	const maxChars = options.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE;
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxDuration = options.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
	const { fps } = options;

	const cues: SubtitleCue[] = [];
	let batch: TranscriptWord[] = [];

	const flush = (): void => {
		if (batch.length === 0) return;
		const first = batch[0]!;
		const last = batch[batch.length - 1]!;
		const lines = wrapWords(
			batch.map((word) => word.text),
			maxChars,
			maxLines
		);
		cues.push({
			id: crypto.randomUUID(),
			startFrame: Math.round(first.startSeconds * fps),
			endFrame: Math.max(
				Math.round(last.endSeconds * fps),
				Math.round(first.startSeconds * fps) + 1
			),
			text: lines.join('\n'),
			words: batch.map((word) => ({
				id: crypto.randomUUID(),
				startFrame: Math.round(word.startSeconds * fps),
				endFrame: Math.max(
					Math.round(word.endSeconds * fps),
					Math.round(word.startSeconds * fps) + 1
				),
				text: word.text
			}))
		});
		batch = [];
	};

	for (const word of words) {
		if (batch.length > 0) {
			const first = batch[0]!;
			const spansTooLong = word.endSeconds - first.startSeconds > maxDuration;
			if (spansTooLong) flush();
		}
		batch.push(word);
	}
	flush();

	return cues;
}

/**
 * Convert word timings into removal ranges (timeline frames, relative to an
 * item's source window start) for filler-word or manual word deletion.
 */
export function wordRangesToSourceFrames(
	words: TranscriptWord[],
	fps: number,
	offsetSeconds = 0
): Array<{ startFrame: number; endFrame: number }> {
	return words.map((word) => ({
		startFrame: Math.max(0, Math.round((word.startSeconds - offsetSeconds) * fps)),
		endFrame: Math.round((word.endSeconds - offsetSeconds) * fps)
	}));
}
