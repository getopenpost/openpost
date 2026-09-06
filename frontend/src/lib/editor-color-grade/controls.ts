import type { EditorColorGradeAdjustments } from './model';

export const EDITOR_COLOR_ADJUSTMENT_KEYS = [
	'brightness',
	'contrast',
	'saturation',
	'temperature',
	'tint',
	'vibrance',
	'hue',
	'exposure',
	'highlights',
	'shadows'
] as const satisfies readonly (keyof EditorColorGradeAdjustments)[];

export const EDITOR_COLOR_ADJUSTMENT_GROUPS = [
	{
		id: 'tone',
		keys: ['brightness', 'exposure', 'contrast', 'highlights', 'shadows']
	},
	{
		id: 'color',
		keys: ['temperature', 'tint', 'vibrance', 'saturation', 'hue']
	}
] as const;

export const EDITOR_COLOR_ADJUSTMENT_RANGES = {
	brightness: { min: -1, max: 1 },
	exposure: { min: -1, max: 1 },
	contrast: { min: -1, max: 1 },
	highlights: { min: -1, max: 1 },
	shadows: { min: -1, max: 1 },
	temperature: { min: -1, max: 1 },
	tint: { min: -1, max: 1 },
	vibrance: { min: -1, max: 1 },
	saturation: { min: -1, max: 1 },
	hue: { min: -1, max: 1 }
} as const satisfies Record<keyof EditorColorGradeAdjustments, { min: number; max: number }>;

export const EDITOR_COLOR_WHEELS = [
	{
		hue: 'shadowsHue',
		amount: 'shadowsAmount',
		level: 'lift',
		masterChip: true,
		display: { scale: 1, bias: 0, step: 0.01, decimals: 2 },
		ring: { min: -2, max: 2, fromDeg: 0 }
	},
	{
		hue: 'midtonesHue',
		amount: 'midtonesAmount',
		level: 'gamma',
		masterChip: true,
		display: { scale: 1, bias: -1, step: 0.01, decimals: 2 },
		ring: { min: 0, max: 2, fromDeg: 0 }
	},
	{
		hue: 'highlightsHue',
		amount: 'highlightsAmount',
		level: 'gain',
		masterChip: true,
		display: { scale: 1, bias: 0, step: 0.01, decimals: 2 },
		ring: { min: 0, max: 2, fromDeg: 180 }
	},
	{
		hue: 'offsetHue',
		amount: 'offsetAmount',
		level: 'offset',
		masterChip: false,
		display: { scale: 100, bias: 25, step: 0.25, decimals: 2 },
		ring: { min: -2, max: 2, fromDeg: 0 }
	}
] as const;

export const EDITOR_COLOR_PRIMARY_TOP_PARAMETERS = [
	'temperature',
	'tint',
	'contrast',
	'pivot',
	'midDetail'
] as const;

export const EDITOR_COLOR_PRIMARY_BOTTOM_PARAMETERS = [
	'colorBoost',
	'shadows',
	'highlights',
	'saturation',
	'hue',
	'lumMix'
] as const;

export const EDITOR_COLOR_CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const;
export type EditorColorCurveChannel = (typeof EDITOR_COLOR_CURVE_CHANNELS)[number];

export const EDITOR_COLOR_SCOPE_OPTIONS = [
	'waveform',
	'parade',
	'vectorscope',
	'histogram'
] as const;
export type EditorColorScope = (typeof EDITOR_COLOR_SCOPE_OPTIONS)[number];

export const EDITOR_COLOR_COMPARISON_MODES = ['after', 'before', 'split'] as const;
export type EditorColorComparisonMode = (typeof EDITOR_COLOR_COMPARISON_MODES)[number];
