import type {
	EditorColorEffectParam as GpuParamValue,
	EditorColorEffectParams as GpuParamValues
} from './rendering';
import { EDITOR_COLOR_CURVE_CHANNELS, type EditorColorCurveChannel } from './controls';
export interface CurvePoint {
	x: number;
	y: number;
}
export const CURVE_CHANNELS = EDITOR_COLOR_CURVE_CHANNELS;
export type CurveChannel = EditorColorCurveChannel;
export const CURVE_MAX_POINTS = 16;
export const CURVE_POINT_MIN_GAP = 0.04;
const defaults = { shadowX: 0.25, shadowY: 0.25, highlightX: 0.75, highlightY: 0.75 };

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

/**
 * Click-to-add insertion index for a curve channel, ported from FreeCut (MIT)
 * `getInsertIndexForCurvePoint` in features/effects/components/panels/gpu-curves-panel.tsx.
 *
 * Insertion uses half the drag minimum gap (`CURVE_POINT_MIN_GAP / 2`) so clicks
 * land between close neighbors that dragging would refuse to cross; endpoint
 * lanes stay pinned at x = 0 and x = 1, so inserts clamp to interior slots.
 */
export function curvePointInsertIndex(
	points: readonly CurvePoint[],
	position: CurvePoint
): number | null {
	if (points.length >= CURVE_MAX_POINTS) return null;
	const nextIndex = points.findIndex((point) => position.x < point.x);
	const index = nextIndex < 0 ? points.length - 1 : nextIndex;
	const previous = points[index - 1];
	const next = points[index];
	if (!previous || !next) return null;
	const insertGap = CURVE_POINT_MIN_GAP / 2;
	if (position.x - previous.x < insertGap || next.x - position.x < insertGap) {
		return null;
	}
	return index;
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

export function curvesLutKey(params: GpuParamValues): string {
	return JSON.stringify(CURVE_CHANNELS.map((channel) => readCurveChannelPoints(params, channel)));
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
