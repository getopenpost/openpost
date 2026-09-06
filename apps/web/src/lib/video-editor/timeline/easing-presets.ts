/** Named cubic-bezier presets. Ported from FreeCut (MIT). */
import type {
	BezierControlPoints,
	EasingConfig,
	EasingType
} from '$lib/video-editor/project/types';
import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS } from '$lib/video-editor/project/types';

export const BEZIER_PRESETS: ReadonlyArray<{
	value: string;
	label: string;
	points: BezierControlPoints;
}> = [
	{ value: 'soft', label: 'Soft', points: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
	{ value: 'ease-out', label: 'Ease out', points: { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 } },
	{ value: 'ease-in', label: 'Ease in', points: { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 } },
	{
		value: 'ease-in-out',
		label: 'Ease in/out',
		points: { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 }
	},
	{ value: 'overshoot', label: 'Overshoot', points: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
	{ value: 'snap', label: 'Snap', points: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 } },
	{ value: 'out-cubic', label: 'Out cubic', points: { x1: 0.33, y1: 1, x2: 0.68, y2: 1 } },
	{ value: 'out-quart', label: 'Out quart', points: { x1: 0.25, y1: 1, x2: 0.5, y2: 1 } },
	{ value: 'out-quint', label: 'Out quint', points: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 } },
	{ value: 'out-expo', label: 'Out expo', points: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } },
	{ value: 'out-circ', label: 'Out circ', points: { x1: 0, y1: 0.55, x2: 0.45, y2: 1 } },
	{ value: 'in-out-cubic', label: 'In/out cubic', points: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } },
	{ value: 'in-out-quart', label: 'In/out quart', points: { x1: 0.76, y1: 0, x2: 0.24, y2: 1 } },
	{ value: 'in-out-expo', label: 'In/out expo', points: { x1: 0.87, y1: 0, x2: 0.13, y2: 1 } },
	{ value: 'in-cubic', label: 'In cubic', points: { x1: 0.32, y1: 0, x2: 0.67, y2: 0 } },
	{ value: 'in-quart', label: 'In quart', points: { x1: 0.5, y1: 0, x2: 0.75, y2: 0 } },
	{ value: 'in-expo', label: 'In expo', points: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 } }
];

const EASING_BEZIER_PRESETS = {
	'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
	'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
	'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
} satisfies Partial<Record<EasingType, BezierControlPoints>>;

export function getBezierPresetForEasing(easing: EasingType): BezierControlPoints | null {
	return EASING_BEZIER_PRESETS[easing] ? { ...EASING_BEZIER_PRESETS[easing]! } : null;
}

export function areBezierPointsEqual(a: BezierControlPoints, b: BezierControlPoints): boolean {
	return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

export function findMatchingBezierPreset(points: BezierControlPoints): string | null {
	const match = BEZIER_PRESETS.find((preset) => areBezierPointsEqual(preset.points, points));
	return match?.value ?? null;
}

export function clampBezierValue(key: keyof BezierControlPoints, value: number): number {
	if (key === 'x1' || key === 'x2') return Math.max(0, Math.min(1, value));
	return Math.max(-2, Math.min(3, value));
}

export function clampSpringValue(key: 'tension' | 'friction' | 'mass', value: number): number {
	switch (key) {
		case 'tension':
			return Math.max(1, Math.min(1000, value));
		case 'friction':
			return Math.max(1, Math.min(100, value));
		case 'mass':
			return Math.max(0.1, Math.min(10, value));
	}
}

export function buildEasingConfig(
	easing: EasingType,
	existing?: EasingConfig
): EasingConfig | undefined {
	const presetBezier = getBezierPresetForEasing(easing);
	if (presetBezier) return { type: 'cubic-bezier', bezier: presetBezier };
	if (easing === 'cubic-bezier')
		return { type: easing, bezier: existing?.bezier ?? { ...DEFAULT_BEZIER_POINTS } };
	if (easing === 'spring')
		return { type: easing, spring: existing?.spring ?? { ...DEFAULT_SPRING_PARAMS } };
	return undefined;
}
