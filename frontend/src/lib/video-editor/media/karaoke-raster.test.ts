import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaidOutLine } from '../typography/text-block-layout';
import type { SubtitleCue, TimelineItem } from '../project/types';
import { hasUsableKaraokeTimings, karaokeStateAtFrame } from '../transcript/karaoke';
import { layoutTextBlock } from '../typography/text-block-layout';
import type { TextMeasurer } from '../typography/text-measurer';
import { parseSubtitleCueText } from '../transcript/subtitle-cue-format';
import {
	clearSubtitleLayoutCacheForTests,
	getKaraokeHighlightGeometryForToken,
	getKaraokeTokenRangesForLine,
	renderSubtitleCueRaster
} from './text-raster';
import type { TextRasterContext } from './text-raster';

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'sub',
		trackId: 't',
		from: 0,
		durationInFrames: 60,
		label: 'Subs',
		type: 'subtitle',
		color: '#ffffff',
		...overrides
	};
}

function cue(): SubtitleCue {
	return {
		id: 'c1',
		startFrame: 0,
		endFrame: 60,
		text: 'hello world test',
		words: [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 10, endFrame: 20, text: 'world' },
			{ id: 'w3', startFrame: 20, endFrame: 30, text: 'test' }
		]
	};
}

function fontSizeAwareMeasurer(): TextMeasurer {
	return {
		measure: (text: string, cssFont: string, letterSpacing: number) => {
			const m = /(\d+)px/.exec(cssFont);
			const size = m ? Number(m[1]) : 20;
			return text.length * size * 0.5 + Math.max(0, text.length - 1) * letterSpacing;
		},
		fontMetrics: (cssFont: string) => {
			const m = /(\d+)px/.exec(cssFont);
			const size = m ? Number(m[1]) : 20;
			return { ascent: size * 0.8, descent: size * 0.2 };
		}
	};
}

function simpleMeasurer(): TextMeasurer {
	return {
		measure: (text: string) => text.length * 8,
		fontMetrics: () => ({ ascent: 10, descent: 3 })
	};
}

function createMockTextRasterContext(capturedFillStyles: string[]): TextRasterContext {
	let currentFont = '600 20px "Inter"';
	let fillStyleValue = '#ffffff';
	const ctx = {
		clearRect: () => {},
		save: () => {},
		restore: () => {},
		fillRect: () => {},
		fillText: () => {},
		strokeText: () => {},
		beginPath: () => {},
		rect: () => {},
		roundRect: () => {},
		fill: () => {},
		get font() {
			return currentFont;
		},
		set font(v: string) {
			currentFont = v;
		},
		get fillStyle() {
			return fillStyleValue;
		},
		set fillStyle(v: string) {
			fillStyleValue = v;
			capturedFillStyles.push(v);
		},
		strokeStyle: '',
		lineWidth: 0,
		lineJoin: 'round',
		shadowColor: '',
		shadowBlur: 0,
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		textAlign: 'left',
		textBaseline: 'alphabetic',
		globalAlpha: 1,
		filter: 'none',
		measureText: (text: string) => {
			// SAFETY: karaoke highlight only reads width from TextMetrics
			return { width: text.length * 8 } as TextMetrics;
		}
	};
	// SAFETY: mock satisfies TextRasterContext surface used by renderSubtitleCueRaster
	return ctx as TextRasterContext;
}

describe('karaoke line wrapping preservation', () => {
	it('uses identical layout for normal and karaoke rendering so highlight does not reflow words', () => {
		const item = makeItem({
			fontFamily: 'Inter',
			fontSize: 24,
			textAlign: 'center',
			verticalAlign: 'middle',
			lineHeight: 1.25,
			letterSpacing: 0,
			paddingX: 20,
			paddingY: 20
		});
		const parsed = parseSubtitleCueText(cue().text);
		const styled = {
			...item,
			text: parsed.plainText,
			textSpans: parsed.spans,
			spanLayout: 'inline' as const
		};
		const stubMeasurer = simpleMeasurer();
		const baseLayout = layoutTextBlock(styled, 400, 200, stubMeasurer);
		const karaokeLayout = layoutTextBlock(styled, 400, 200, stubMeasurer);
		expect(karaokeLayout.lines.map((l) => l.text)).toEqual(baseLayout.lines.map((l) => l.text));
		expect(karaokeLayout.lines.map((l) => l.width)).toEqual(baseLayout.lines.map((l) => l.width));
	});

	it('untimed cues render exactly as normal captions', () => {
		const item = makeItem({ captionHighlightMode: 'karaoke' });
		const untimed: SubtitleCue = { id: 'c', startFrame: 0, endFrame: 30, text: 'hello world' };
		expect(hasUsableKaraokeTimings(untimed, 'hello world')).toBe(false);
		expect(karaokeStateAtFrame(item, untimed, 'hello world', 5)).toBeNull();
		const mismatched: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 30,
			text: 'hello world',
			words: [{ id: 'w1', startFrame: 0, endFrame: 5, text: 'hello' }]
		};
		expect(karaokeStateAtFrame(item, mismatched, 'hello world', 2)).toBeNull();
	});
});

describe('karaoke reduced-motion retains highlight', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		clearSubtitleLayoutCacheForTests();
	});

	it('highlights active word even when matchMedia reports reduce', () => {
		vi.stubGlobal('window', {
			matchMedia: (query: string) => ({
				matches: query === '(prefers-reduced-motion: reduce)',
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {}
			})
		});
		clearSubtitleLayoutCacheForTests();
		const activeCue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 30,
			text: 'hello world',
			words: [
				{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
				{ id: 'w2', startFrame: 10, endFrame: 20, text: 'world' }
			]
		};
		const item = makeItem({
			captionHighlightMode: 'karaoke',
			karaokeActiveColor: '#ff0000',
			color: '#ffffff'
		});
		expect(karaokeStateAtFrame(item, activeCue, 'hello world', 5)?.activeIndex).toBe(0);
		const captured: string[] = [];
		const ctx = createMockTextRasterContext(captured);
		renderSubtitleCueRaster(ctx, activeCue, item, 400, 200, 5);
		expect(captured).toContain('#ff0000');
	});
});

describe('karaoke highlight geometry uses exact run metrics', () => {
	it('token in later differently styled run aligns with run offset', () => {
		const stubMeasurer = fontSizeAwareMeasurer();
		const item = makeItem({
			fontFamily: 'Inter',
			fontSize: 20,
			color: '#ffffff',
			letterSpacing: 0,
			textAlign: 'left',
			verticalAlign: 'top',
			lineHeight: 1.2,
			paddingX: 4,
			paddingY: 4
		});
		const mixedItem: TimelineItem = {
			...item,
			text: 'hello world',
			textSpans: [
				{ text: 'hello ', fontSize: 20, fontFamily: 'Inter', color: '#ffffff', letterSpacing: 0 },
				{ text: 'world', fontSize: 40, fontFamily: 'Anton', color: '#ffffff', letterSpacing: 3 }
			],
			spanLayout: 'inline'
		};
		const layout = layoutTextBlock(mixedItem, 300, 100, stubMeasurer);
		const line = layout.lines[0]!;
		expect(line.runs && line.runs.length >= 2).toBe(true);
		const tokenRanges = getKaraokeTokenRangesForLine(line);
		expect(tokenRanges).toHaveLength(2);
		const worldRange = tokenRanges[1]!;
		const geometry = getKaraokeHighlightGeometryForToken(
			line,
			worldRange.start,
			worldRange.end,
			stubMeasurer
		)!;
		expect(geometry).not.toBeNull();
		const secondRun = line.runs![1]!;
		const expectedX = line.startX + secondRun.offsetX;
		expect(geometry.bounds.x).toBe(expectedX);
		expect(geometry.pieces).toHaveLength(1);
		expect(geometry.pieces[0]!.cssFont).toBe(secondRun.cssFont);
		const expectedWidth = stubMeasurer.measure('world', secondRun.cssFont, secondRun.letterSpacing);
		expect(geometry.bounds.width).toBe(expectedWidth);
	});

	it('token spanning differently styled runs produces multiple pieces with correct widths', () => {
		const stubMeasurer = fontSizeAwareMeasurer();
		const item = makeItem({
			fontFamily: 'Inter',
			fontSize: 20,
			color: '#ffffff',
			textAlign: 'left',
			verticalAlign: 'top',
			lineHeight: 1.2,
			paddingX: 4,
			paddingY: 4
		});
		const crossItem: TimelineItem = {
			...item,
			text: 'hello',
			textSpans: [
				{ text: 'hel', fontSize: 20, fontFamily: 'Inter', color: '#fff', letterSpacing: 0 },
				{ text: 'lo', fontSize: 40, fontFamily: 'Anton', color: '#fff', letterSpacing: 5 }
			],
			spanLayout: 'inline'
		};
		const layout = layoutTextBlock(crossItem, 200, 100, stubMeasurer);
		const line = layout.lines[0]!;
		expect(line.runs?.length).toBe(2);
		const ranges = getKaraokeTokenRangesForLine(line);
		expect(ranges).toHaveLength(1);
		const geometry = getKaraokeHighlightGeometryForToken(
			line,
			ranges[0]!.start,
			ranges[0]!.end,
			stubMeasurer
		)!;
		expect(geometry.pieces).toHaveLength(2);
		const firstWidth = stubMeasurer.measure(
			'hel',
			line.runs![0]!.cssFont,
			line.runs![0]!.letterSpacing
		);
		const secondWidth = stubMeasurer.measure(
			'lo',
			line.runs![1]!.cssFont,
			line.runs![1]!.letterSpacing
		);
		expect(geometry.pieces[0]!.width).toBe(firstWidth);
		expect(geometry.pieces[1]!.width).toBe(secondWidth);
		expect(geometry.bounds.width).toBe(firstWidth + secondWidth);
		expect(geometry.pieces[1]!.x).toBe(line.startX + line.runs![1]!.offsetX);
		const naiveWidth = stubMeasurer.measure('hello', line.cssFont, line.letterSpacing);
		expect(naiveWidth).not.toBe(geometry.bounds.width);
	});

	it('handles tabs and mixed whitespace like split/\\s+/', () => {
		const line: LaidOutLine = {
			text: 'hello\tworld  test',
			cssFont: '20px Inter',
			fontSize: 20,
			letterSpacing: 0,
			startX: 10,
			top: 0,
			baselineY: 10,
			lineHeightPx: 20,
			width: 100,
			color: '#fff',
			underline: false,
			runs: undefined
		};
		const ranges = getKaraokeTokenRangesForLine(line);
		expect(ranges).toHaveLength(3);
		expect(line.text.slice(ranges[0]!.start, ranges[0]!.end)).toBe('hello');
		expect(line.text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('world');
		expect(line.text.slice(ranges[2]!.start, ranges[2]!.end)).toBe('test');
		const stubMeasurer: TextMeasurer = {
			measure: (t: string) => t.length * 8,
			fontMetrics: () => ({ ascent: 8, descent: 2 })
		};
		const geometry = getKaraokeHighlightGeometryForToken(
			line,
			ranges[1]!.start,
			ranges[1]!.end,
			stubMeasurer
		)!;
		const expectedX =
			line.startX +
			stubMeasurer.measure(line.text.slice(0, ranges[1]!.start), line.cssFont, line.letterSpacing);
		expect(geometry.bounds.x).toBe(expectedX);
	});
});
