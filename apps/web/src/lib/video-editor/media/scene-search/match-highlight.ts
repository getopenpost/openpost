// Ported from FreeCut (MIT) `highlighted-text.tsx`: render `text` with
// marked ranges for each match span. Assumes spans are sorted and
// non-overlapping — rank.ts merges overlaps before returning them.
export interface TextSegment {
	text: string;
	mark: boolean;
}

export function splitTextBySpans(text: string, spans: Array<[number, number]>): TextSegment[] {
	if (spans.length === 0 || text.length === 0)
		return text.length > 0 ? [{ text, mark: false }] : [];
	const segments: TextSegment[] = [];
	let cursor = 0;
	for (const [from, to] of spans) {
		const start = Math.max(0, Math.min(from, text.length));
		const end = Math.max(start, Math.min(to, text.length));
		if (start > cursor) segments.push({ text: text.slice(cursor, start), mark: false });
		if (end > start) segments.push({ text: text.slice(start, end), mark: true });
		cursor = Math.max(cursor, end);
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false });
	return segments;
}
