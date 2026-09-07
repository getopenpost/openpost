import { describe, expect, it } from 'vitest';
import {
	customStopsList,
	parseGradientStops,
	resolveGradientPreviewHexes,
	serializeGradientStops
} from './gradient-stops';

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
		expect(customStopsList({})).toEqual(['#000000', '#ffffff']);
		expect(customStopsList({ customStops: 42 })).toEqual(['#000000', '#ffffff']);
	});
});

describe('serializeGradientStops', () => {
	it('round-trips through the stored comma string', () => {
		const stops = ['#000000', '#ff0000', '#ffffff'];
		expect(parseGradientStops(serializeGradientStops(stops))).toEqual(stops);
	});
});

describe('resolveGradientPreviewHexes', () => {
	const presets = {
		inferno: ['#000004', '#f0f921'],
		custom: ['#111111', '#eeeeee']
	};

	it('resolves named presets', () => {
		expect(resolveGradientPreviewHexes('inferno', '', presets)).toEqual(['#000004', '#f0f921']);
	});

	it('falls back to inferno for unknown presets', () => {
		expect(resolveGradientPreviewHexes('nope', '', presets)).toEqual(['#000004', '#f0f921']);
	});

	it('resolves custom lists from the stored string', () => {
		expect(resolveGradientPreviewHexes('custom', '#111111, #eeeeee', presets)).toEqual([
			'#111111',
			'#eeeeee'
		]);
	});
});
