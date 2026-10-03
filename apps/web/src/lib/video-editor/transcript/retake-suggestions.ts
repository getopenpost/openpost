import type { TranscriptSourceWord } from './speech-cleanup';

const MIN_REPEATED_WORDS = 4;
const MIN_DISTINCT_WORDS = 3;
const MAX_REPEATED_WORDS = 12;
const MAX_RESTART_WORDS = 24;
const MAX_INTERRUPTION_WORDS = 8;
const MAX_RESTART_SECONDS = 12;
const MIN_RESTART_PAUSE_SECONDS = 0.3;
const MAX_WORD_GAP_SECONDS = 4;
const RESTART_PADDING_SECONDS = 0.08;
const CONTEXT_WORDS = 16;
const SENTENCE_END = /[.!?。！？]["'”’)]*$/u;

export interface RetakeSuggestion {
	id: string;
	mediaId: string;
	sourceItemId: string;
	start: number;
	end: number;
	repeatedText: string;
	beforeText: string;
	afterText: string;
}

function normalizedWord(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function sourceRuns(words: readonly TranscriptSourceWord[]): TranscriptSourceWord[][] {
	const instances = new Map<string, TranscriptSourceWord[]>();
	for (const word of words) {
		if (!word.sourceItemId) continue;
		const key = JSON.stringify([word.mediaId, word.sourceItemId]);
		const instance = instances.get(key) ?? [];
		instance.push(word);
		instances.set(key, instance);
	}
	const runs: TranscriptSourceWord[][] = [];
	for (const instance of instances.values()) {
		let run: TranscriptSourceWord[] = [];
		for (const word of instance) {
			const previous = run.at(-1);
			if (
				!Number.isFinite(word.start) ||
				!Number.isFinite(word.end) ||
				word.start < 0 ||
				word.end <= word.start ||
				!normalizedWord(word.text)
			) {
				if (run.length) runs.push(run);
				run = [];
				continue;
			}
			if (
				previous &&
				(word.start < previous.end || word.start - previous.end > MAX_WORD_GAP_SECONDS)
			) {
				runs.push(run);
				run = [];
			}
			run.push(word);
		}
		if (run.length) runs.push(run);
	}
	return runs;
}

function textOf(words: readonly TranscriptSourceWord[]): string {
	return words.map((word) => word.text).join(' ');
}

function afterContext(words: readonly TranscriptSourceWord[], restart: number): string {
	const context = words.slice(restart, restart + CONTEXT_WORDS);
	const sentenceEnd = context.findIndex((word) => SENTENCE_END.test(word.text));
	return textOf(sentenceEnd < 0 ? context : context.slice(0, sentenceEnd + 1));
}

/** Suggest exact repeated starts for explicit review, never infer which take is better. */
export function suggestRetakes(words: readonly TranscriptSourceWord[]): RetakeSuggestion[] {
	const suggestions: RetakeSuggestion[] = [];
	for (const run of sourceRuns(words)) {
		const normalized = run.map((word) => normalizedWord(word.text));
		for (let start = 0; start < run.length - MIN_REPEATED_WORDS * 2; start++) {
			const first = run[start]!;
			for (
				let restart = start + MIN_REPEATED_WORDS;
				restart < Math.min(run.length - MIN_REPEATED_WORDS, start + MAX_RESTART_WORDS);
				restart++
			) {
				const next = run[restart]!;
				const previous = run[restart - 1]!;
				if (next.start - first.start > MAX_RESTART_SECONDS) break;
				if (next.start - previous.end < MIN_RESTART_PAUSE_SECONDS) continue;
				const attempt = run.slice(start, restart);
				if (attempt.some((word) => SENTENCE_END.test(word.text))) break;
				let repeated = 0;
				while (
					repeated < Math.min(restart - start, MAX_REPEATED_WORDS) &&
					restart + repeated < run.length &&
					normalized[start + repeated] === normalized[restart + repeated]
				) {
					repeated++;
				}
				if (
					repeated < MIN_REPEATED_WORDS ||
					restart + repeated >= run.length ||
					restart - start - repeated > MAX_INTERRUPTION_WORDS ||
					new Set(normalized.slice(start, start + repeated)).size < MIN_DISTINCT_WORDS
				)
					continue;
				suggestions.push({
					id: `${first.sourceItemId}:${first.id}:${next.id}`,
					mediaId: first.mediaId,
					sourceItemId: first.sourceItemId!,
					start: first.start,
					end: Math.max(previous.end, next.start - RESTART_PADDING_SECONDS),
					repeatedText: textOf(run.slice(start, start + repeated)),
					beforeText: textOf(attempt),
					afterText: afterContext(run, restart)
				});
				// Keep successive restarts separate without overlapping removal suggestions.
				start = restart - 1;
				break;
			}
		}
	}
	return suggestions;
}
