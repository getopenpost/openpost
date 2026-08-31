import { describe, expect, it } from 'vitest';
import {
	formatSegmentInterchange,
	inferSegmentInterchangeFormat,
	parseSegmentInterchange
} from './interchange';
import { createSegment } from './model';

const context = { sourceId: 'source-1', duration: 180 };

describe('Quick Cut segment interchange', () => {
	it('imports a quoted CSV fixture with seconds and timecodes', () => {
		const csv =
			'\uFEFFStart,End,Name\r\n1.25,00:05.500,"Intro, first take"\r\n00:10,00:12,"A ""quoted"" label"\r\n';
		const segments = parseSegmentInterchange(csv, 'csv-timecode', context);

		expect(
			segments.map(({ sourceId, start, end, name }) => ({ sourceId, start, end, name }))
		).toEqual([
			{ sourceId: 'source-1', start: 1.25, end: 5.5, name: 'Intro, first take' },
			{ sourceId: 'source-1', start: 10, end: 12, name: 'A "quoted" label' }
		]);
	});

	it('round-trips human-readable TSV without losing labels', () => {
		const original = [
			createSegment(0.125, 65.5, { sourceId: 'source-1', name: 'Opening' }),
			createSegment(3661.25, 3662.75, { sourceId: 'source-1', name: 'After an hour' })
		];
		const text = formatSegmentInterchange(original, 'tsv-timecode');
		const parsed = parseSegmentInterchange(text, 'tsv-timecode', {
			...context,
			duration: 4000
		});

		expect(parsed.map(({ start, end, name }) => ({ start, end, name }))).toEqual(
			original.map(({ start, end, name }) => ({ start, end, name }))
		);
	});

	it('turns chapter markers into sorted contiguous ranges through source end', () => {
		const text = `Video notes
1:15 Closing
00:00 Intro
00:30 - Main section`;
		const segments = parseSegmentInterchange(text, 'chapters', {
			sourceId: 'source-1',
			duration: 100
		});

		expect(segments.map(({ start, end, name }) => ({ start, end, name }))).toEqual([
			{ start: 0, end: 30, name: 'Intro' },
			{ start: 30, end: 75, name: 'Main section' },
			{ start: 75, end: 100, name: 'Closing' }
		]);
	});

	it('imports SRT cue timing and joins multi-line caption labels', () => {
		const text = `1
00:00:01,000 --> 00:00:02,500
First line
second line

2
00:00:04.250 --> 00:00:06.000 align:start
Next cue
`;
		const segments = parseSegmentInterchange(text, 'srt', context);

		expect(segments.map(({ start, end, name }) => ({ start, end, name }))).toEqual([
			{ start: 1, end: 2.5, name: 'First line second line' },
			{ start: 4.25, end: 6, name: 'Next cue' }
		]);
	});

	it('exports standards-shaped chapter text and SRT', () => {
		const segments = [
			createSegment(0, 2.5, { sourceId: 'source-1', name: 'Intro' }),
			createSegment(65.25, 70, { sourceId: 'source-1', name: 'Detail' })
		];

		expect(formatSegmentInterchange(segments, 'chapters')).toBe('00:00 Intro\n01:05 Detail');
		expect(formatSegmentInterchange(segments, 'srt')).toContain(
			'00:01:05,250 --> 00:01:10,000\r\nDetail'
		);
	});

	it('rejects malformed and out-of-bounds data instead of silently clamping it', () => {
		expect(() =>
			parseSegmentInterchange('Start,End,Name\nnope,5,Bad', 'csv-seconds', context)
		).toThrow(/invalid start or end/iu);
		expect(() =>
			parseSegmentInterchange('Start,End,Name\n170,190,Too late', 'csv-seconds', context)
		).toThrow(/outside the source duration/iu);
	});

	it('infers the browser-supported import formats from file extensions', () => {
		expect(inferSegmentInterchangeFormat('cuts.csv')).toBe('csv-timecode');
		expect(inferSegmentInterchangeFormat('cuts.tsv')).toBe('tsv-timecode');
		expect(inferSegmentInterchangeFormat('chapters.txt')).toBe('chapters');
		expect(inferSegmentInterchangeFormat('captions.srt')).toBe('srt');
	});
});
