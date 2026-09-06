/** Framework-free text geometry ported from FreeCut (MIT). */

import type { TextStyleInput } from './text-style';
import { resolveSpanStyles, resolveTextStyle } from './text-style';
import type { TextMeasurer } from './text-measurer';

export interface LaidOutRun {
	text: string;
	cssFont: string;
	fontSize: number;
	letterSpacing: number;
	color: string;
	underline: boolean;
	offsetX: number;
	width: number;
}

export interface LaidOutLine {
	text: string;
	cssFont: string;
	fontSize: number;
	color: string;
	letterSpacing: number;
	underline: boolean;
	width: number;
	top: number;
	baselineY: number;
	startX: number;
	lineHeightPx: number;
	trailingLetterSpacing?: number;
	runs?: LaidOutRun[];
}

export interface TextBlockBackground {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}

export interface TextBlockLayout {
	lines: LaidOutLine[];
	totalHeight: number;
	background?: TextBlockBackground;
}

function breakWord(
	word: string,
	cssFont: string,
	letterSpacing: number,
	maxWidth: number,
	measurer: TextMeasurer
): string[] {
	const segments: string[] = [];
	let current = '';
	for (const character of word) {
		const candidate = current + character;
		if (measurer.measure(candidate, cssFont, letterSpacing) > maxWidth && current) {
			segments.push(current);
			current = character;
		} else {
			current = candidate;
		}
	}
	if (current) segments.push(current);
	return segments;
}

function wrapText(
	text: string,
	cssFont: string,
	letterSpacing: number,
	maxWidth: number,
	measurer: TextMeasurer
): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split('\n')) {
		if (paragraph === '') {
			lines.push('');
			continue;
		}
		let currentLine = '';
		for (const word of paragraph.split(' ')) {
			const candidate = currentLine ? `${currentLine} ${word}` : word;
			if (measurer.measure(candidate, cssFont, letterSpacing) > maxWidth && currentLine) {
				lines.push(currentLine);
				currentLine = word;
				if (measurer.measure(word, cssFont, letterSpacing) > maxWidth) {
					const broken = breakWord(word, cssFont, letterSpacing, maxWidth, measurer);
					for (let index = 0; index < broken.length - 1; index += 1) {
						lines.push(broken[index] ?? '');
					}
					currentLine = broken.at(-1) ?? '';
				}
			} else {
				currentLine = candidate;
			}
		}
		if (currentLine) lines.push(currentLine);
	}
	return lines.length > 0 ? lines : [''];
}

interface InlineWord {
	text: string;
	charStyles: number[];
	leading: string;
	leadingStyles: number[];
}

function tokenizeInlineSpans(spans: ReturnType<typeof resolveSpanStyles>): InlineWord[][] {
	const paragraphs: InlineWord[][] = [[]];
	let currentWord: InlineWord | null = null;
	let pendingSpaces = '';
	let pendingSpaceStyles: number[] = [];

	const startWord = (): InlineWord => {
		const word = {
			text: '',
			charStyles: [],
			leading: pendingSpaces,
			leadingStyles: pendingSpaceStyles
		};
		pendingSpaces = '';
		pendingSpaceStyles = [];
		return word;
	};
	const flushWord = () => {
		if (currentWord) paragraphs.at(-1)!.push(currentWord);
		currentWord = null;
	};
	const flushDanglingSpaces = () => {
		if (pendingSpaces.length > 0) paragraphs.at(-1)!.push(startWord());
	};

	for (const [spanIndex, span] of spans.entries()) {
		for (const character of span.text) {
			if (character === '\n') {
				flushWord();
				flushDanglingSpaces();
				paragraphs.push([]);
			} else if (character === ' ') {
				flushWord();
				pendingSpaces += character;
				pendingSpaceStyles.push(spanIndex);
			} else {
				currentWord ??= startWord();
				currentWord.text += character;
				currentWord.charStyles.push(spanIndex);
			}
		}
	}
	flushWord();
	flushDanglingSpaces();
	return paragraphs;
}

function buildLineRuns(
	text: string,
	charStyles: number[],
	spans: ReturnType<typeof resolveSpanStyles>,
	measurer: TextMeasurer
): LaidOutRun[] {
	if (text.length === 0) return [];
	const runs: LaidOutRun[] = [];
	let runStart = 0;
	let offsetX = 0;
	for (let index = 1; index <= text.length; index += 1) {
		if (index !== text.length && charStyles[index] === charStyles[runStart]) continue;
		const span = spans[charStyles[runStart] ?? 0] ?? spans[0]!;
		const runText = text.slice(runStart, index);
		const width = measurer.measure(runText, span.cssFont, span.letterSpacing);
		runs.push({
			text: runText,
			cssFont: span.cssFont,
			fontSize: span.fontSize,
			letterSpacing: span.letterSpacing,
			color: span.color,
			underline: span.underline,
			offsetX,
			width
		});
		offsetX += width;
		runStart = index;
	}
	return runs;
}

function lineCopyAndStyles(words: InlineWord[], isContinuation: boolean) {
	let text = '';
	const charStyles: number[] = [];
	for (const [wordIndex, word] of words.entries()) {
		if (wordIndex > 0 || !isContinuation) {
			text += word.leading;
			charStyles.push(...word.leadingStyles);
		}
		text += word.text;
		charStyles.push(...word.charStyles);
	}
	return { text, charStyles };
}

function measureStyledText(
	text: string,
	charStyles: number[],
	spans: ReturnType<typeof resolveSpanStyles>,
	measurer: TextMeasurer
): number {
	return buildLineRuns(text, charStyles, spans, measurer).reduce((sum, run) => sum + run.width, 0);
}

function splitInlineWord(
	word: InlineWord,
	availableWidth: number,
	spans: ReturnType<typeof resolveSpanStyles>,
	measurer: TextMeasurer
): InlineWord[] {
	if (word.text.length === 0) return [word];
	const pieces: InlineWord[] = [];
	let text = '';
	let charStyles: number[] = [];
	for (let index = 0; index < word.text.length; index += 1) {
		const character = word.text[index] ?? '';
		const styleIndex = word.charStyles[index] ?? 0;
		const candidateText = text + character;
		const candidateStyles = [...charStyles, styleIndex];
		if (
			text.length > 0 &&
			measureStyledText(candidateText, candidateStyles, spans, measurer) > availableWidth
		) {
			pieces.push({
				text,
				charStyles,
				leading: pieces.length === 0 ? word.leading : '',
				leadingStyles: pieces.length === 0 ? word.leadingStyles : []
			});
			text = character;
			charStyles = [styleIndex];
		} else {
			text = candidateText;
			charStyles = candidateStyles;
		}
	}
	pieces.push({
		text,
		charStyles,
		leading: pieces.length === 0 ? word.leading : '',
		leadingStyles: pieces.length === 0 ? word.leadingStyles : []
	});
	return pieces;
}

function layoutInlineSpanLines(
	spans: ReturnType<typeof resolveSpanStyles>,
	lineHeightFactor: number,
	availableWidth: number,
	measurer: TextMeasurer
): LaidOutLine[] {
	const base = spans[0]!;
	const paragraphs = tokenizeInlineSpans(spans);
	const lines: LaidOutLine[] = [];

	const pushLine = (words: InlineWord[], isContinuation = false) => {
		const { text, charStyles } = lineCopyAndStyles(words, isContinuation);
		const runs = buildLineRuns(text, charStyles, spans, measurer);
		const usedSpans = new Set(charStyles.map((styleIndex) => spans[styleIndex] ?? base));
		if (usedSpans.size === 0) usedSpans.add(base);
		const lineHeightPx = Math.max(
			...Array.from(usedSpans, (span) => span.fontSize * lineHeightFactor)
		);
		const maxAscent = Math.max(
			...Array.from(usedSpans, (span) => measurer.fontMetrics(span.cssFont).ascent)
		);
		const maxDescent = Math.max(
			...Array.from(usedSpans, (span) => measurer.fontMetrics(span.cssFont).descent)
		);
		const baselineOffset = (lineHeightPx - (maxAscent + maxDescent)) / 2 + maxAscent;
		lines.push({
			text,
			cssFont: base.cssFont,
			fontSize: Math.max(...Array.from(usedSpans, (span) => span.fontSize)),
			color: base.color,
			letterSpacing: base.letterSpacing,
			underline: false,
			width: runs.reduce((sum, run) => sum + run.width, 0),
			top: 0,
			baselineY: baselineOffset,
			startX: 0,
			lineHeightPx,
			trailingLetterSpacing: runs.at(-1)?.letterSpacing ?? base.letterSpacing,
			runs
		});
	};

	for (const words of paragraphs) {
		if (words.length === 0) {
			pushLine([]);
			continue;
		}
		let lineWords: InlineWord[] = [];
		let isContinuation = false;
		for (const word of words.flatMap((entry) =>
			splitInlineWord(entry, availableWidth, spans, measurer)
		)) {
			const candidateWords = [...lineWords, word];
			const candidate = lineCopyAndStyles(candidateWords, isContinuation);
			if (
				measureStyledText(candidate.text, candidate.charStyles, spans, measurer) > availableWidth &&
				lineWords.length > 0
			) {
				pushLine(lineWords, isContinuation);
				isContinuation = true;
				lineWords = [word];
			} else {
				lineWords = candidateWords;
			}
		}
		if (lineWords.length > 0) pushLine(lineWords, isContinuation);
	}

	return lines;
}

export function layoutTextBlock(
	item: TextStyleInput,
	boxWidth: number,
	boxHeight: number,
	measurer: TextMeasurer
): TextBlockLayout {
	const style = resolveTextStyle(item);
	const spans = resolveSpanStyles(item);
	const availableWidth = Math.max(1, boxWidth - style.paddingX * 2);
	const availableHeight = boxHeight - style.paddingY * 2;
	const inlineFlow = item.spanLayout === 'inline' && spans.length > 0;
	const lines = inlineFlow
		? layoutInlineSpanLines(spans, style.lineHeight, availableWidth, measurer)
		: [];

	if (!inlineFlow) {
		for (const span of spans) {
			const metrics = measurer.fontMetrics(span.cssFont);
			const lineHeightPx = span.fontSize * style.lineHeight;
			const halfLeading = (lineHeightPx - (metrics.ascent + metrics.descent)) / 2;
			const baselineOffset = halfLeading + metrics.ascent;
			for (const text of wrapText(
				span.text,
				span.cssFont,
				span.letterSpacing,
				availableWidth,
				measurer
			)) {
				lines.push({
					text,
					cssFont: span.cssFont,
					fontSize: span.fontSize,
					color: span.color,
					letterSpacing: span.letterSpacing,
					underline: span.underline,
					width: measurer.measure(text, span.cssFont, span.letterSpacing),
					top: 0,
					baselineY: baselineOffset,
					startX: 0,
					lineHeightPx
				});
			}
		}
	}

	const totalHeight = lines.reduce((sum, line) => sum + line.lineHeightPx, 0);
	const blockTop =
		style.verticalAlign === 'top'
			? style.paddingY
			: style.verticalAlign === 'bottom'
				? boxHeight - style.paddingY - totalHeight
				: style.paddingY + (availableHeight - totalHeight) / 2;

	let cursorTop = blockTop;
	for (const line of lines) {
		line.top = cursorTop;
		line.baselineY = cursorTop + line.baselineY;
		line.startX =
			style.textAlign === 'left'
				? style.paddingX
				: style.textAlign === 'right'
					? boxWidth - style.paddingX - line.width
					: (boxWidth - line.width) / 2;
		cursorTop += line.lineHeightPx;
	}

	let background: TextBlockBackground | undefined;
	if (style.backgroundColor && lines.length > 0) {
		if (style.backgroundFit === 'box') {
			background = {
				x: 0,
				y: 0,
				width: boxWidth,
				height: boxHeight,
				radius: Math.max(0, Math.min(style.borderRadius, boxWidth / 2, boxHeight / 2))
			};
		} else {
			const maxLineWidth = Math.max(...lines.map((line) => line.width));
			const centerX =
				style.textAlign === 'left'
					? style.paddingX + maxLineWidth / 2
					: style.textAlign === 'right'
						? boxWidth - style.paddingX - maxLineWidth / 2
						: boxWidth / 2;
			const width = Math.min(boxWidth, maxLineWidth + style.paddingX * 2);
			const height = totalHeight + style.paddingY * 2;
			background = {
				x: centerX - width / 2,
				y: blockTop - style.paddingY,
				width,
				height,
				radius: Math.max(0, Math.min(style.borderRadius, width / 2, height / 2))
			};
		}
	}

	return { lines, totalHeight, background };
}

export function lineInkWidth(line: LaidOutLine): number {
	return Math.max(0, line.width - (line.trailingLetterSpacing ?? line.letterSpacing));
}
