/**
 * Exact-first transcript search with a bounded typo-tolerant fallback.
 * Ported from FreeCut (MIT) - src/features/timeline/utils/transcript-fuzzy.ts.
 */

/** Fold case and diacritics while keeping spaces and punctuation. */
export function normalizeTranscriptSearch(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '');
}

/** Letters and numbers only, for edit-distance matching. */
function wordKey(text: string): string {
	return normalizeTranscriptSearch(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Levenshtein distance with an early ceiling. Values above max collapse to
 * max + 1 so long transcripts do not spend work on impossible matches.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	if (Math.abs(a.length - b.length) > max) return max + 1;

	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	let current = new Array<number>(b.length + 1);
	for (let aIndex = 1; aIndex <= a.length; aIndex++) {
		current[0] = aIndex;
		let rowMinimum = aIndex;
		const aCode = a.charCodeAt(aIndex - 1);
		for (let bIndex = 1; bIndex <= b.length; bIndex++) {
			const cost = aCode === b.charCodeAt(bIndex - 1) ? 0 : 1;
			const value = Math.min(
				(previous[bIndex] ?? 0) + 1,
				(current[bIndex - 1] ?? 0) + 1,
				(previous[bIndex - 1] ?? 0) + cost
			);
			current[bIndex] = value;
			rowMinimum = Math.min(rowMinimum, value);
		}
		if (rowMinimum > max) return max + 1;
		[previous, current] = [current, previous];
	}
	return previous[b.length] ?? max + 1;
}

function fuzzyThreshold(length: number): number {
	if (length <= 3) return 1;
	if (length <= 6) return 2;
	return 3;
}

export interface TranscriptMatchSpan {
	start: number;
	end: number;
}

export interface TranscriptMatchResult {
	spans: TranscriptMatchSpan[];
	approximate: boolean;
}

function matchPhrase(words: readonly string[], queryWords: string[]): TranscriptMatchSpan[] {
	const keys = queryWords.map(wordKey).filter(Boolean);
	if (keys.length === 0 || keys.length > words.length) return [];

	const spans: TranscriptMatchSpan[] = [];
	for (let start = 0; start + keys.length <= words.length; start++) {
		let matched = true;
		for (let offset = 0; offset < keys.length; offset++) {
			const token = wordKey(words[start + offset] ?? '');
			const needle = keys[offset] ?? '';
			const tokenMatches = offset < keys.length - 1 ? token === needle : token.startsWith(needle);
			if (!tokenMatches) {
				matched = false;
				break;
			}
		}
		if (matched) {
			spans.push({ start, end: start + keys.length - 1 });
			start += keys.length - 1;
		}
	}
	return spans;
}

/**
 * Match words in document order. Phrases match consecutive words. Single-word
 * queries use exact substring matching first, then bounded fuzzy matching only
 * when exact matching found nothing.
 */
export function findTranscriptWordMatches(
	words: readonly string[],
	query: string
): TranscriptMatchResult {
	const trimmed = query.trim();
	if (!trimmed) return { spans: [], approximate: false };

	const queryWords = trimmed.split(/\s+/);
	if (queryWords.length > 1) {
		return { spans: matchPhrase(words, queryWords), approximate: false };
	}

	const needle = normalizeTranscriptSearch(trimmed);
	const exact: TranscriptMatchSpan[] = [];
	for (let index = 0; index < words.length; index++) {
		if (normalizeTranscriptSearch(words[index] ?? '').includes(needle)) {
			exact.push({ start: index, end: index });
		}
	}
	if (exact.length > 0) return { spans: exact, approximate: false };

	const key = wordKey(trimmed);
	if (key.length < 3) return { spans: [], approximate: false };
	const maxDistance = fuzzyThreshold(key.length);
	const fuzzy: TranscriptMatchSpan[] = [];
	for (let index = 0; index < words.length; index++) {
		if (boundedLevenshtein(key, wordKey(words[index] ?? ''), maxDistance) <= maxDistance) {
			fuzzy.push({ start: index, end: index });
		}
	}
	return { spans: fuzzy, approximate: fuzzy.length > 0 };
}
