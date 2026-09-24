import { describe, expect, it } from 'vitest';
import { customStopsList, parseGradientStops, resolveGradientPreviewHexes } from './gradient-stops';

describe('parseGradientStops', () => {
	it('splits comma-separated stops', () => {
		expect(parseGradientStops('#000000, #ff0000, #ffffff')).toEqual([
			'#000000',
			'#ff0000',
			'#ffffff'
		]);
	});

	it('falls back to black/white below two entries', () => {
		expect(parseGradientStops('#ff0000')).toEqual(['#000000', '#ffffff']);
		expect(parseGradientStops('')).toEqual(['#000000', '#ffffff']);
	});

	it('reads the stored value through the param boundary', () => {
		expect(customStopsList({ customStops: '#111111, #eeeeee' })).toEqual(['#111111', '#eeeeee']);
		expect(customStopsList({ customStops: 42 })).toEqual(['#000000', '#ffffff']);
	});
});

describe('resolveGradientPreviewHexes', () => {
	const presets = {
		inferno: ['#000004', '#f0f921'],
		custom: ['#111111', '#eeeeee']
	};

	it('falls back to inferno for unknown presets', () => {
		expect(resolveGradientPreviewHexes('nope', '', presets)).toEqual(['#000004', '#f0f921']);
	});
});
