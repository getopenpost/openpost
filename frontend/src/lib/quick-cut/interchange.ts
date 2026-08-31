import { createSegment, MIN_SEGMENT_DURATION_SECONDS } from './model';
import type { QuickCutSegment } from './types';

export type SegmentInterchangeFormat =
	| 'csv-seconds'
	| 'csv-timecode'
	| 'tsv-timecode'
	| 'chapters'
	| 'srt';

interface ParsedRange {
	start: number;
	end?: number;
	name?: string;
}

interface ParseContext {
	sourceId: string;
	duration: number;
}

const TIMESTAMP_PATTERN = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d+)?`;

function parseTimestamp(value: string): number | null {
	const trimmed = value.trim().replace(',', '.');
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isFinite(seconds) ? seconds : null;
	}

	const parts = trimmed.split(':');
	if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === '')) return null;
	const values = parts.map(Number);
	if (values.some((part) => !Number.isFinite(part) || part < 0)) return null;
	const seconds = values.at(-1)!;
	const minutes = values.at(-2)!;
	const hours = values.length === 3 ? values[0]! : 0;
	if (seconds >= 60 || minutes >= 60) return null;
	return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestamp(seconds: number, fractionDigits = 3): string {
	const safeSeconds = Math.max(0, seconds);
	const fraction = Math.round((safeSeconds - Math.floor(safeSeconds)) * 10 ** fractionDigits);
	const rollover = fraction === 10 ** fractionDigits;
	const adjusted = rollover ? safeSeconds + 1 : safeSeconds;
	const adjustedHours = Math.floor(adjusted / 3600);
	const adjustedMinutes = Math.floor((adjusted % 3600) / 60);
	const adjustedSeconds = Math.floor(adjusted % 60);
	const adjustedFraction = rollover ? 0 : fraction;
	const base = `${String(adjustedHours).padStart(2, '0')}:${String(adjustedMinutes).padStart(2, '0')}:${String(adjustedSeconds).padStart(2, '0')}`;
	return fractionDigits > 0
		? `${base}.${String(adjustedFraction).padStart(fractionDigits, '0')}`
		: base;
}

function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const input = text.replace(/^\uFEFF/, '');

	for (let index = 0; index < input.length; index += 1) {
		const character = input[index]!;
		if (quoted) {
			if (character === '"' && input[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				field += character;
			}
			continue;
		}

		if (character === '"' && field === '') {
			quoted = true;
		} else if (character === delimiter) {
			row.push(field);
			field = '';
		} else if (character === '\n' || character === '\r') {
			row.push(field);
			field = '';
			if (row.some((value) => value.trim() !== '')) rows.push(row);
			row = [];
			if (character === '\r' && input[index + 1] === '\n') index += 1;
		} else {
			field += character;
		}
	}

	if (quoted) throw new Error('The segment file has an unclosed quoted field.');
	row.push(field);
	if (row.some((value) => value.trim() !== '')) rows.push(row);
	return rows;
}

function parseDelimitedRanges(text: string, delimiter: ',' | '\t'): ParsedRange[] {
	const rows = parseDelimited(text, delimiter);
	const firstRow = rows[0]?.map((value) => value.trim().toLowerCase());
	const dataRows = firstRow?.[0] === 'start' ? rows.slice(1) : rows;
	return dataRows.map((row, index) => {
		const start = parseTimestamp(row[0] ?? '');
		const endText = row[1]?.trim() ?? '';
		const end = endText === '' ? undefined : parseTimestamp(endText);
		if (start === null || (endText !== '' && end === null)) {
			throw new Error(`Row ${index + 1} has an invalid start or end time.`);
		}
		const name = row[2]?.trim();
		return { start, end: end ?? undefined, name: name || undefined };
	});
}

function parseChapters(text: string): ParsedRange[] {
	const linePattern = new RegExp(`^\\s*(${TIMESTAMP_PATTERN})(?:\\s*[-–—]?)?\\s+(.+?)\\s*$`, 'u');
	const markers = text
		.split(/\r?\n/u)
		.flatMap((line) => {
			const match = line.match(linePattern);
			if (!match) return [];
			const start = parseTimestamp(match[1]!);
			if (start === null) return [];
			return [{ start, name: match[2]!.trim() }];
		})
		.sort((left, right) => left.start - right.start);
	return markers.map((marker, index) => ({ ...marker, end: markers[index + 1]?.start }));
}

function parseSrt(text: string): ParsedRange[] {
	const timingPattern = new RegExp(
		`^\\s*(${TIMESTAMP_PATTERN})\\s*-->\\s*(${TIMESTAMP_PATTERN})(?:\\s+.*)?$`,
		'u'
	);
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/u);
	const ranges: ParsedRange[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index]!.match(timingPattern);
		if (!match) continue;
		const start = parseTimestamp(match[1]!);
		const end = parseTimestamp(match[2]!);
		if (start === null || end === null) continue;
		const nameLines: string[] = [];
		for (index += 1; index < lines.length && lines[index]!.trim() !== ''; index += 1) {
			nameLines.push(lines[index]!.trim());
		}
		ranges.push({ start, end, name: nameLines.join(' ').trim() || undefined });
	}
	return ranges;
}

function finishRanges(ranges: ParsedRange[], context: ParseContext): QuickCutSegment[] {
	if (ranges.length === 0) throw new Error('No valid segments were found.');
	return ranges.map((range, index) => {
		const end = range.end ?? ranges[index + 1]?.start ?? context.duration;
		if (range.start < 0 || range.start > context.duration || end > context.duration + 0.001) {
			throw new Error(`Segment ${index + 1} is outside the source duration.`);
		}
		if (end - range.start < MIN_SEGMENT_DURATION_SECONDS) {
			throw new Error(
				`Segment ${index + 1} is shorter than ${MIN_SEGMENT_DURATION_SECONDS} seconds.`
			);
		}
		return createSegment(range.start, Math.min(end, context.duration), {
			sourceId: context.sourceId,
			name: range.name
		});
	});
}

export function parseSegmentInterchange(
	text: string,
	format: SegmentInterchangeFormat,
	context: ParseContext
): QuickCutSegment[] {
	let ranges: ParsedRange[];
	switch (format) {
		case 'csv-seconds':
		case 'csv-timecode':
			ranges = parseDelimitedRanges(text, ',');
			break;
		case 'tsv-timecode':
			ranges = parseDelimitedRanges(text, '\t');
			break;
		case 'chapters':
			ranges = parseChapters(text);
			break;
		case 'srt':
			ranges = parseSrt(text);
			break;
	}
	return finishRanges(ranges, context);
}

function quoteField(value: string, delimiter: ',' | '\t'): string {
	if (!value.includes(delimiter) && !/["\r\n]/u.test(value)) return value;
	return `"${value.replaceAll('"', '""')}"`;
}

function formatDelimited(
	segments: QuickCutSegment[],
	delimiter: ',' | '\t',
	formatTime: (seconds: number) => string
): string {
	const rows = [
		['Start', 'End', 'Name'],
		...segments.map((segment) => [
			formatTime(segment.start),
			formatTime(segment.end),
			segment.name ?? ''
		])
	];
	return `${rows.map((row) => row.map((value) => quoteField(value, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}

function formatChapterTimestamp(seconds: number): string {
	const full = formatTimestamp(seconds, 0);
	return full.startsWith('00:') ? full.slice(3) : full;
}

export function formatSegmentInterchange(
	segments: QuickCutSegment[],
	format: SegmentInterchangeFormat
): string {
	switch (format) {
		case 'csv-seconds':
			return formatDelimited(segments, ',', (seconds) => String(seconds));
		case 'csv-timecode':
			return formatDelimited(segments, ',', (seconds) => formatTimestamp(seconds));
		case 'tsv-timecode':
			return formatDelimited(segments, '\t', (seconds) => formatTimestamp(seconds));
		case 'chapters':
			return segments
				.map(
					(segment, index) =>
						`${formatChapterTimestamp(segment.start)} ${segment.name || `Chapter ${index + 1}`}`
				)
				.join('\n');
		case 'srt':
			return segments
				.map(
					(segment, index) =>
						`${index + 1}\r\n${formatTimestamp(segment.start).replace('.', ',')} --> ${formatTimestamp(segment.end).replace('.', ',')}\r\n${segment.name || `Segment ${index + 1}`}\r\n`
				)
				.join('\r\n');
	}
}

export function inferSegmentInterchangeFormat(fileName: string): SegmentInterchangeFormat {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.tsv')) return 'tsv-timecode';
	if (lower.endsWith('.srt')) return 'srt';
	if (lower.endsWith('.txt')) return 'chapters';
	return 'csv-timecode';
}
