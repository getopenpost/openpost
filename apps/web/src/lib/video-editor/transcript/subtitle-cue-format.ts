/** Parse and rebuild common SRT, VTT, and ASS cue formatting. Ported from FreeCut (MIT). */

import type { TextSpan } from '../project/types';

export interface SubtitleCueAlignment {
	textAlign: 'left' | 'center' | 'right';
	verticalAlign: 'top' | 'middle' | 'bottom';
}

export interface ParsedSubtitleCue {
	spans: TextSpan[];
	plainText: string;
	isEmpty: boolean;
	alignment?: SubtitleCueAlignment;
}

interface SpanFormat {
	fontStyle?: 'italic';
	fontWeight?: 700;
	underline?: true;
	color?: string;
}

export interface CueFormatFlags {
	italic: boolean;
	bold: boolean;
	underline: boolean;
}

interface TextToken {
	kind: 'text';
	value: string;
}

interface OpenToken {
	kind: 'open';
	format: SpanFormat;
}

interface CloseToken {
	kind: 'close';
}

interface AlignmentToken {
	kind: 'alignment';
	alignment: SubtitleCueAlignment;
}

interface UnknownToken {
	kind: 'unknown';
}

type CueToken = TextToken | OpenToken | CloseToken | AlignmentToken | UnknownToken;

const TAG_PATTERN = /<\/?(?:i|b|u|font|c|v|ruby|rt|lang)\b[^>]*>|\{\\an[1-9]\}|\{\\[^}]*\}/gi;

function assAlignment(code: string): SubtitleCueAlignment | undefined {
	switch (code) {
		case '1':
			return { textAlign: 'left', verticalAlign: 'bottom' };
		case '2':
			return { textAlign: 'center', verticalAlign: 'bottom' };
		case '3':
			return { textAlign: 'right', verticalAlign: 'bottom' };
		case '4':
			return { textAlign: 'left', verticalAlign: 'middle' };
		case '5':
			return { textAlign: 'center', verticalAlign: 'middle' };
		case '6':
			return { textAlign: 'right', verticalAlign: 'middle' };
		case '7':
			return { textAlign: 'left', verticalAlign: 'top' };
		case '8':
			return { textAlign: 'center', verticalAlign: 'top' };
		case '9':
			return { textAlign: 'right', verticalAlign: 'top' };
	}
}

function classifyTag(tag: string): CueToken {
	const alignmentMatch = /^\{\\an([1-9])\}$/i.exec(tag);
	if (alignmentMatch) {
		const alignment = assAlignment(alignmentMatch[1] ?? '');
		return alignment ? { kind: 'alignment', alignment } : { kind: 'unknown' };
	}
	if (tag.startsWith('{')) return { kind: 'unknown' };
	if (/^<\/[a-z]+\b/i.test(tag)) return { kind: 'close' };

	const opening = /^<([a-z]+)\b([^>]*)>$/i.exec(tag);
	if (!opening) return { kind: 'unknown' };
	const name = opening[1]?.toLowerCase();
	const attributes = opening[2] ?? '';
	switch (name) {
		case 'i':
			return { kind: 'open', format: { fontStyle: 'italic' } };
		case 'b':
			return { kind: 'open', format: { fontWeight: 700 } };
		case 'u':
			return { kind: 'open', format: { underline: true } };
		case 'font': {
			const colorMatch = /color\s*=\s*"?([^"\s>]+)"?/i.exec(attributes);
			return {
				kind: 'open',
				format: colorMatch?.[1] ? { color: colorMatch[1] } : {}
			};
		}
		default:
			return { kind: 'open', format: {} };
	}
}

function tokenize(raw: string): CueToken[] {
	const tokens: CueToken[] = [];
	TAG_PATTERN.lastIndex = 0;
	let lastIndex = 0;
	for (const match of raw.matchAll(TAG_PATTERN)) {
		const start = match.index ?? 0;
		if (start > lastIndex) tokens.push({ kind: 'text', value: raw.slice(lastIndex, start) });
		tokens.push(classifyTag(match[0]));
		lastIndex = start + match[0].length;
	}
	if (lastIndex < raw.length) tokens.push({ kind: 'text', value: raw.slice(lastIndex) });
	return tokens;
}

function spanMatchesFormat(span: TextSpan, format: SpanFormat): boolean {
	return (
		span.fontStyle === format.fontStyle &&
		span.fontWeight === format.fontWeight &&
		span.underline === format.underline &&
		span.color === format.color
	);
}

export function parseSubtitleCueText(raw: string): ParsedSubtitleCue {
	if (!raw) return { spans: [], plainText: '', isEmpty: true };
	const formatStack: SpanFormat[] = [{}];
	const spans: TextSpan[] = [];
	let plainText = '';
	let alignment: SubtitleCueAlignment | undefined;

	for (const token of tokenize(raw)) {
		switch (token.kind) {
			case 'text': {
				if (!token.value) break;
				const format = formatStack.at(-1) ?? {};
				const last = spans.at(-1);
				if (last && spanMatchesFormat(last, format)) last.text += token.value;
				else spans.push({ text: token.value, ...format });
				plainText += token.value;
				break;
			}
			case 'open':
				formatStack.push({ ...(formatStack.at(-1) ?? {}), ...token.format });
				break;
			case 'close':
				if (formatStack.length > 1) formatStack.pop();
				break;
			case 'alignment':
				alignment = token.alignment;
				break;
			case 'unknown':
				break;
		}
	}

	const trimmed = plainText.trim();
	return {
		spans,
		plainText: trimmed,
		isEmpty: trimmed.length === 0,
		alignment
	};
}

export function getCueFormatFlags(parsed: ParsedSubtitleCue): CueFormatFlags {
	if (parsed.spans.length === 0) return { bold: false, italic: false, underline: false };
	return {
		bold: parsed.spans.every((span) => span.fontWeight === 700),
		italic: parsed.spans.every((span) => span.fontStyle === 'italic'),
		underline: parsed.spans.every((span) => span.underline === true)
	};
}

function assCodeForAlignment(alignment: SubtitleCueAlignment): string | undefined {
	const key = `${alignment.textAlign}|${alignment.verticalAlign}`;
	switch (key) {
		case 'left|bottom':
			return '1';
		case 'center|bottom':
			return '2';
		case 'right|bottom':
			return '3';
		case 'left|middle':
			return '4';
		case 'center|middle':
			return '5';
		case 'right|middle':
			return '6';
		case 'left|top':
			return '7';
		case 'center|top':
			return '8';
		case 'right|top':
			return '9';
	}
}

export function buildCueText(
	plainText: string,
	flags: CueFormatFlags,
	previousText: string
): string {
	let result = plainText;
	if (flags.underline) result = `<u>${result}</u>`;
	if (flags.italic) result = `<i>${result}</i>`;
	if (flags.bold) result = `<b>${result}</b>`;
	const alignment = parseSubtitleCueText(previousText).alignment;
	const code = alignment ? assCodeForAlignment(alignment) : undefined;
	return code ? `{\\an${code}}${result}` : result;
}

export function toggleCueFormat(text: string, format: keyof CueFormatFlags): string {
	const parsed = parseSubtitleCueText(text);
	const current = getCueFormatFlags(parsed);
	return buildCueText(parsed.plainText, { ...current, [format]: !current[format] }, text);
}
