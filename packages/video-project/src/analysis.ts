import { mergeTimeRanges } from './timeline.js';

export interface SpeechRange {
	start_us: number;
	end_us: number;
	confidence?: number;
}

export interface SilenceSuggestion {
	start_us: number;
	end_us: number;
	duration_us: number;
}

export function silenceSuggestions(
	speech: SpeechRange[],
	durationUS: number,
	options: {
		min_silence_us?: number;
		padding_us?: number;
		merge_speech_gap_us?: number;
	} = {}
): SilenceSuggestion[] {
	const minSilenceUS = options.min_silence_us ?? 350_000;
	const paddingUS = options.padding_us ?? 120_000;
	const mergeGapUS = options.merge_speech_gap_us ?? 160_000;
	const paddedSpeech = mergeTimeRanges(
		speech
			.filter((range) => range.end_us > range.start_us)
			.sort((left, right) => left.start_us - right.start_us)
			.reduce<SpeechRange[]>((result, range) => {
				const previous = result.at(-1);
				if (previous && range.start_us - previous.end_us <= mergeGapUS) {
					previous.end_us = Math.max(previous.end_us, range.end_us);
				} else {
					result.push({ ...range });
				}
				return result;
			}, [])
			.map((range) => ({
				start_us: Math.max(0, range.start_us - paddingUS),
				end_us: Math.min(durationUS, range.end_us + paddingUS)
			}))
	);
	const silence: SilenceSuggestion[] = [];
	let cursorUS = 0;
	for (const range of paddedSpeech) {
		if (range.start_us - cursorUS >= minSilenceUS) {
			silence.push({
				start_us: cursorUS,
				end_us: range.start_us,
				duration_us: range.start_us - cursorUS
			});
		}
		cursorUS = Math.max(cursorUS, range.end_us);
	}
	if (durationUS - cursorUS >= minSilenceUS) {
		silence.push({
			start_us: cursorUS,
			end_us: durationUS,
			duration_us: durationUS - cursorUS
		});
	}
	return silence;
}

export interface TranscriptToken {
	text: string;
	start_us: number;
	end_us: number;
	confidence?: number;
}

export interface FillerCandidate extends TranscriptToken {
	index: number;
	reason: 'dictionary' | 'repeated-word' | 'false-start';
}

const DEFAULT_FILLERS: Record<string, Set<string>> = {
	en: new Set(['um', 'uh', 'erm', 'hmm', 'like', 'you know', 'i mean']),
	pt: new Set(['hum', 'ah', 'tipo', 'quer dizer', 'pois'])
};

function normalizeWord(value: string): string {
	return value.toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

export function fillerCandidates(
	words: TranscriptToken[],
	language: string,
	minConfidence = 0.72
): FillerCandidate[] {
	const dictionary = DEFAULT_FILLERS[language.split('-')[0] ?? ''] ?? new Set<string>();
	const candidates: FillerCandidate[] = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index]!;
		const normalized = normalizeWord(word.text);
		const confidence = word.confidence ?? 0;
		if (confidence < minConfidence || !normalized) continue;
		if (dictionary.has(normalized)) {
			candidates.push({ ...word, index, reason: 'dictionary' });
			continue;
		}
		const previous = words[index - 1];
		if (
			previous &&
			normalizeWord(previous.text) === normalized &&
			(previous.confidence ?? 0) >= minConfidence
		) {
			candidates.push({ ...word, index, reason: 'repeated-word' });
			continue;
		}
		if (/[-–—]$/u.test(word.text) && word.end_us - word.start_us < 900_000) {
			candidates.push({ ...word, index, reason: 'false-start' });
		}
	}
	return candidates;
}
