import { describe, expect, it } from 'vitest';
import { formatSrt, parseSrt } from './srt';

describe('parseSrt', () => {
	it('parses indexed blocks with comma timestamps', () => {
		const cues = parseSrt(
			'1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue'
		);
		expect(cues.length).toBe(2);
		expect(cues[0]).toEqual({ startSeconds: 1, endSeconds: 3.5, text: 'Hello world' });
		expect(cues[1]!.startSeconds).toBe(4);
	});

	it('accepts VTT-style dots and skips header/cue-settings', () => {
		const cues = parseSrt(
			'WEBVTT\n\n00:00.000 --> 00:02.000 position:50%\nFirst\n\n00:05.000 --> 00:07.000\nSecond'
		);
		expect(cues.length).toBe(2);
		expect(cues[0]!.text).toBe('First');
	});

	it('sorts out-of-order cues and drops empty text', () => {
		const cues = parseSrt(
			'1\n00:00:05,000 --> 00:00:06,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\n\n3\n00:00:00,500 --> 00:00:01,000\nfirst'
		);
		expect(cues.map((cue) => cue.text)).toEqual(['first', 'later']);
	});
});

describe('formatSrt', () => {
	it('serializes numbered blocks that round-trip through the parser', () => {
		const srt = formatSrt([
			{ startSeconds: 0.5, endSeconds: 2, text: 'Alpha\nBeta' },
			{ startSeconds: 61.25, endSeconds: 63, text: 'Gamma' }
		]);
		const cues = parseSrt(srt);
		expect(cues.length).toBe(2);
		expect(cues[0]!.startSeconds).toBeCloseTo(0.5);
		expect(cues[0]!.text).toBe('Alpha\nBeta');
		expect(cues[1]!.endSeconds).toBe(63);
	});
});
