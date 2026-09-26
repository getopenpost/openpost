import type { ImageEditorTextRun, ImageEditorTextValue } from './types';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function textGraphemes(text: string): string[] {
	return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

export function textGraphemeOffset(text: string, codeUnitOffset: number): number {
	let offset = 0;
	let count = 0;
	for (const grapheme of textGraphemes(text)) {
		if (offset >= codeUnitOffset) break;
		offset += grapheme.length;
		count++;
	}
	return count;
}

type RunStyle = Omit<ImageEditorTextRun, 'start' | 'end'>;

export interface ImageEditorTextEdit {
	start: number;
	end: number;
	inputType: string;
	previousText?: string;
}

function stylesByGrapheme(text: ImageEditorTextValue): RunStyle[] {
	const styles = Array.from({ length: textGraphemes(text.text).length }, (): RunStyle => ({}));
	for (const run of text.runs ?? []) {
		const { start, end, ...style } = run;
		for (let index = start; index < end && index < styles.length; index++) {
			styles[index] = style;
		}
	}
	return styles;
}

function compactRuns(styles: RunStyle[]): ImageEditorTextRun[] | undefined {
	const runs: ImageEditorTextRun[] = [];
	for (let index = 0; index < styles.length; index++) {
		const style = styles[index];
		if (Object.keys(style).length === 0) continue;
		const previous = runs.at(-1);
		if (previous && previous.end === index && sameStyle(previous, style)) {
			previous.end++;
		} else {
			runs.push({ start: index, end: index + 1, ...style });
		}
	}
	return runs.length ? runs : undefined;
}

function sameStyle(run: ImageEditorTextRun, style: RunStyle): boolean {
	return (
		run.font_weight === style.font_weight &&
		run.font_style === style.font_style &&
		run.underline === style.underline &&
		run.color === style.color
	);
}

export function editTextWithRuns(
	value: ImageEditorTextValue,
	nextText: string,
	edit?: ImageEditorTextEdit
): ImageEditorTextValue {
	if (nextText === value.text) return value;
	const before = textGraphemes(value.text);
	const after = textGraphemes(nextText);
	const anchored =
		edit?.previousText !== undefined && edit.previousText !== value.text
			? null
			: anchoredTextEdit(before, after, edit);
	let prefix = 0;
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
		prefix++;
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	)
		suffix++;
	const start = anchored?.start ?? prefix;
	const end = anchored?.end ?? before.length - suffix;
	const inserted = anchored?.inserted ?? after.length - prefix - suffix;
	const styles = stylesByGrapheme(value);
	const inherited = styles[end > start ? start : start > 0 ? start - 1 : start] ?? {};
	const nextStyles = [
		...styles.slice(0, start),
		...Array.from({ length: inserted }, () => ({ ...inherited })),
		...styles.slice(end)
	];
	return { ...value, text: nextText, runs: compactRuns(nextStyles) };
}

function anchoredTextEdit(
	before: string[],
	after: string[],
	edit?: ImageEditorTextEdit
): { start: number; end: number; inserted: number } | null {
	if (
		!edit ||
		!Number.isInteger(edit.start) ||
		!Number.isInteger(edit.end) ||
		edit.start < 0 ||
		edit.end < edit.start ||
		edit.end > before.length
	)
		return null;
	let { start, end } = edit;
	if (start === end && edit.inputType.startsWith('delete')) {
		const removed = before.length - after.length;
		if (removed < 1) return null;
		if (edit.inputType.endsWith('Backward')) start = Math.max(0, start - removed);
		else if (edit.inputType.endsWith('Forward')) end = Math.min(before.length, end + removed);
		else return null;
	}
	const inserted = after.length - (before.length - (end - start));
	if (inserted < 0) return null;
	if (
		before.slice(0, start).some((part, index) => part !== after[index]) ||
		before.slice(end).some((part, index) => part !== after[start + inserted + index])
	)
		return null;
	return { start, end, inserted };
}

export function styleTextRange(
	value: ImageEditorTextValue,
	start: number,
	end: number,
	style: RunStyle
): ImageEditorTextValue {
	const styles = stylesByGrapheme(value);
	for (let index = start; index < end && index < styles.length; index++) {
		styles[index] = { ...styles[index], ...style };
	}
	return { ...value, runs: compactRuns(styles) };
}

export function textRunStyleAt(value: ImageEditorTextValue, index: number): RunStyle {
	const run = value.runs?.find((candidate) => candidate.start <= index && index < candidate.end);
	if (!run) return {};
	const { start: _start, end: _end, ...style } = run;
	return style;
}

export function validTextRuns(value: ImageEditorTextValue): boolean {
	const length = textGraphemes(value.text).length;
	let lastEnd = 0;
	return (
		(value.runs?.length ?? 0) <= 2000 &&
		(value.runs ?? []).every((run) => {
			const valid =
				Number.isInteger(run.start) &&
				Number.isInteger(run.end) &&
				run.start >= lastEnd &&
				run.end > run.start &&
				run.end <= length &&
				(run.font_weight === undefined ||
					(Number.isInteger(run.font_weight) &&
						run.font_weight >= 100 &&
						run.font_weight <= 900)) &&
				(run.font_style === undefined || ['normal', 'italic'].includes(run.font_style)) &&
				(run.underline === undefined || run.underline === true || run.underline === false) &&
				(run.color === undefined || /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(run.color)) &&
				(run.font_weight !== undefined ||
					run.font_style !== undefined ||
					run.underline !== undefined ||
					run.color !== undefined);
			lastEnd = run.end;
			return valid;
		})
	);
}
