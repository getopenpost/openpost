import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { layoutTextBlock, lineInkWidth } from './text-block-layout';
import { parseFontSizePx, type TextMeasurer } from './text-measurer';

function measurer(advancePerEm = 0.5): TextMeasurer {
	return {
		measure(text, cssFont, letterSpacing) {
			const fontSize = parseFontSizePx(cssFont);
			return text.length * fontSize * advancePerEm + text.length * letterSpacing;
		},
		fontMetrics(cssFont) {
			const fontSize = parseFontSizePx(cssFont);
			return { ascent: fontSize * 0.8, descent: fontSize * 0.2 };
		}
	};
}

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: 'Text',
		text: 'CINEMA',
		type: 'text',
		color: '#ffffff',
		...overrides
	};
}

describe('text block layout', () => {
	it('matches CSS trailing letter spacing and centers the occupied box', () => {
		const layout = layoutTextBlock(
			item({ fontSize: 119, letterSpacing: 4, textAlign: 'center' }),
			1536,
			324,
			measurer()
		);
		const line = layout.lines[0]!;
		expect(line.width).toBeCloseTo(6 * 119 * 0.5 + 6 * 4);
		expect(line.startX).toBeCloseTo((1536 - line.width) / 2);
		expect(line.startX + lineInkWidth(line) / 2).toBeCloseTo(1536 / 2 - 2);
	});

	it('breaks an overlong inline word without losing its span style', () => {
		const layout = layoutTextBlock(
			item({
				text: 'ABCDEFGHIJ',
				textSpans: [{ text: 'ABCDEFGHIJ', fontSize: 20, color: '#ffd400' }],
				spanLayout: 'inline',
				paddingX: 0,
				paddingY: 0
			}),
			50,
			100,
			measurer()
		);
		expect(layout.lines.map((line) => line.text)).toEqual(['ABCDE', 'FGHIJ']);
		expect(layout.lines.flatMap((line) => line.runs?.map((run) => run.color) ?? [])).toEqual([
			'#ffd400',
			'#ffd400'
		]);
	});
});
