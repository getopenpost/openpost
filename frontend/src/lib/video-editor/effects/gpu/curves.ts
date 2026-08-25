/** CPU-baked RGB curves LUT. Ported from FreeCut (MIT). */
import type { GpuParamSchema, GpuParamValue, GpuParamValues, GpuShaderDefinition } from './types';

export interface CurvePoint {
	x: number;
	y: number;
}
export const CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
export const CURVE_MAX_POINTS = 16;
export const CURVE_POINT_MIN_GAP = 0.04;
const defaults = { shadowX: 0.25, shadowY: 0.25, highlightX: 0.75, highlightY: 0.75 };

const schema: GpuParamSchema[] = CURVE_CHANNELS.flatMap((channel) => {
	const label = `${channel.slice(0, 1).toUpperCase()}${channel.slice(1)}`;
	return [
		{
			name: `${channel}ShadowX`,
			label: `${label} shadow X`,
			min: 0.02,
			max: 0.94,
			step: 0.01,
			default: defaults.shadowX
		},
		{
			name: `${channel}ShadowY`,
			label: `${label} shadow Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.shadowY
		},
		{
			name: `${channel}HighlightX`,
			label: `${label} highlight X`,
			min: 0.06,
			max: 0.98,
			step: 0.01,
			default: defaults.highlightX
		},
		{
			name: `${channel}HighlightY`,
			label: `${label} highlight Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.highlightY
		},
		{
			name: curvePointsParamKey(channel),
			label: `${label} points`,
			type: 'text' as const,
			default: '',
			maxLength: 1024,
			visibleWhen: () => false
		}
	];
});

export const curves: GpuShaderDefinition = {
	id: 'gpu-curves',
	label: 'Curves',
	category: 'color',
	entryPoint: 'curvesFragment',
	fragmentSource: `
uniform sampler2D uDataTex;
vec3 sampleCurveLut(float value) {
  float u = (clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return texture(uDataTex, vec2(u, 0.5)).rgb;
}
vec4 curvesFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  return vec4(sampleCurveLut(color.r).r, sampleCurveLut(color.g).g, sampleCurveLut(color.b).b, color.a);
}`,
	schema,
	uniformValues: () => ({}),
	dataTexture: {
		key: curvesLutKey,
		build: (params) => ({ width: 256, height: 1, data: buildCurvesLut(params) })
	}
};

export function buildCurvesLut(params: GpuParamValues): Uint8Array {
	const channelPoints = new Map(
		CURVE_CHANNELS.map((channel) => [channel, readCurveChannelPoints(params, channel)])
	);
	const data = new Uint8Array(256 * 4);
	for (let index = 0; index < 256; index++) {
		const input = index / 255;
		const master = evaluateMonotoneCurve(channelPoints.get('master'), input);
		data[index * 4] = Math.round(evaluateMonotoneCurve(channelPoints.get('red'), master) * 255);
		data[index * 4 + 1] = Math.round(
			evaluateMonotoneCurve(channelPoints.get('green'), master) * 255
		);
		data[index * 4 + 2] = Math.round(
			evaluateMonotoneCurve(channelPoints.get('blue'), master) * 255
		);
		data[index * 4 + 3] = 255;
	}
	return data;
}

function isStringValue(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumberValue(value: unknown): value is number {
	return typeof value === 'number';
}

function legacyPointsFor(params: GpuParamValues, channel: CurveChannel): CurvePoint[] {
	return [
		{ x: 0, y: 0 },
		{
			x: finite(params[`${channel}ShadowX`], defaults.shadowX),
			y: finite(params[`${channel}ShadowY`], defaults.shadowY)
		},
		{
			x: finite(params[`${channel}HighlightX`], defaults.highlightX),
			y: finite(params[`${channel}HighlightY`], defaults.highlightY)
		},
		{ x: 1, y: 1 }
	].toSorted((left, right) => left.x - right.x);
}

export function curvePointsParamKey(channel: CurveChannel): string {
	return `${channel}Points`;
}

export function resetCurveChannelParams(channel: CurveChannel): GpuParamValues {
	return {
		[curvePointsParamKey(channel)]: '',
		[`${channel}ShadowX`]: defaults.shadowX,
		[`${channel}ShadowY`]: defaults.shadowY,
		[`${channel}HighlightX`]: defaults.highlightX,
		[`${channel}HighlightY`]: defaults.highlightY
	};
}

export function serializeCurveChannelPoints(points: readonly CurvePoint[]): string {
	return JSON.stringify(sanitizeCurveChannelPoints(points).map((point) => [point.x, point.y]));
}

export function sanitizeCurveChannelPoints(points: readonly CurvePoint[]): CurvePoint[] {
	const cleaned = points
		.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
		.map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
		.toSorted((left, right) => left.x - right.x);
	const endpointEpsilon = 0.000001;
	const explicitStart = cleaned.find((point) => point.x <= endpointEpsilon);
	const explicitEnd = cleaned.findLast((point) => point.x >= 1 - endpointEpsilon);
	const start: CurvePoint = { x: 0, y: explicitStart?.y ?? 0 };
	const end: CurvePoint = { x: 1, y: explicitEnd?.y ?? 1 };
	const candidates = cleaned
		.filter((point) => point.x > endpointEpsilon && point.x < 1 - endpointEpsilon)
		.slice(0, CURVE_MAX_POINTS - 2);
	let previousX = 0;
	const interior = candidates.map((point, index) => {
		const minimum = previousX + CURVE_POINT_MIN_GAP;
		const maximum = 1 - (candidates.length - index) * CURVE_POINT_MIN_GAP;
		const x = Number(Math.max(minimum, Math.min(maximum, point.x)).toFixed(6));
		previousX = x;
		return { x, y: point.y };
	});
	return [start, ...interior, end];
}

export function readCurveChannelPoints(
	params: GpuParamValues,
	channel: CurveChannel
): CurvePoint[] {
	const raw = params[curvePointsParamKey(channel)];
	if (isStringValue(raw) && raw.length > 0) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const points = parsed.flatMap((entry): CurvePoint[] => {
					if (
						!Array.isArray(entry) ||
						entry.length < 2 ||
						!isNumberValue(entry[0]) ||
						!isNumberValue(entry[1])
					) {
						return [];
					}
					return [{ x: entry[0], y: entry[1] }];
				});
				if (points.length === parsed.length && points.length >= 2) {
					return sanitizeCurveChannelPoints(points);
				}
			}
		} catch {
			// Corrupt point JSON falls back to the stable numeric controls below.
		}
	}
	return legacyPointsFor(params, channel);
}

export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
	return points.every((point) => Math.abs(point.x - point.y) < 0.0005);
}

function curvesLutKey(params: GpuParamValues): string {
	return schema.map((entry) => params[entry.name] ?? entry.default).join('|');
}

function finite(value: GpuParamValue | undefined, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export function evaluateMonotoneCurve(
	points: readonly CurvePoint[] | undefined,
	inputValue: number
): number {
	const source = points?.length
		? points
		: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 }
			];
	const input = clamp(inputValue);
	const slopes = source.slice(0, -1).map((point, index) => {
		const next = source[index + 1] ?? point;
		return (next.y - point.y) / Math.max(0.000001, next.x - point.x);
	});
	const tangents = source.map((_, index) => {
		if (index === 0) return slopes[0] ?? 0;
		if (index === source.length - 1) return slopes[index - 1] ?? 0;
		const previous = slopes[index - 1] ?? 0;
		const next = slopes[index] ?? 0;
		return previous * next <= 0 ? 0 : (previous + next) / 2;
	});
	for (let index = 0; index < slopes.length; index++) {
		const slope = slopes[index] ?? 0;
		if (Math.abs(slope) < 0.000001) {
			tangents[index] = 0;
			tangents[index + 1] = 0;
			continue;
		}
		const a = (tangents[index] ?? 0) / slope;
		const b = (tangents[index + 1] ?? 0) / slope;
		if (a * a + b * b > 9) {
			const scale = 3 / Math.sqrt(a * a + b * b);
			tangents[index] = scale * a * slope;
			tangents[index + 1] = scale * b * slope;
		}
	}
	let segment = source.length - 2;
	for (let index = 0; index < source.length - 1; index++) {
		if (input <= (source[index + 1]?.x ?? 1)) {
			segment = index;
			break;
		}
	}
	const left = source[segment] ?? source[0];
	const right = source[segment + 1] ?? left;
	const width = Math.max(0.000001, right.x - left.x);
	const t = clamp((input - left.x) / width);
	const t2 = t * t;
	const t3 = t2 * t;
	return clamp(
		(2 * t3 - 3 * t2 + 1) * left.y +
			(t3 - 2 * t2 + t) * width * (tangents[segment] ?? 0) +
			(-2 * t3 + 3 * t2) * right.y +
			(t3 - t2) * width * (tangents[segment + 1] ?? 0)
	);
}

function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}
