/**
 * Timeline easing functions.
 *
 * Ported from FreeCut (MIT) - shared/utils/easing.ts.
 */
import {
	DEFAULT_BEZIER_POINTS,
	DEFAULT_SPRING_PARAMS,
	type BezierControlPoints,
	type EasingConfig,
	type EasingType,
	type SpringParameters
} from '$lib/video-editor/project/types';

function linear(progress: number): number {
	return progress;
}

function hold(_progress: number): number {
	return 0;
}

export function easeIn(progress: number): number {
	return progress * progress;
}

export function easeOut(progress: number): number {
	return progress * (2 - progress);
}

export function easeInOut(progress: number): number {
	return progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
}

export function cubicBezier(progress: number, points: BezierControlPoints): number {
	const { x1, y1, x2, y2 } = points;
	if (progress === 0) return 0;
	if (progress === 1) return 1;

	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;

	let curveProgress = progress;
	for (let iteration = 0; iteration < 8; iteration += 1) {
		const x = ((ax * curveProgress + bx) * curveProgress + cx) * curveProgress;
		const distance = x - progress;
		if (Math.abs(distance) < 1e-6) break;

		const derivative = (3 * ax * curveProgress + 2 * bx) * curveProgress + cx;
		if (Math.abs(derivative) < 1e-6) break;

		curveProgress -= distance / derivative;
		curveProgress = Math.max(0, Math.min(1, curveProgress));
	}

	return ((ay * curveProgress + by) * curveProgress + cy) * curveProgress;
}

function springEasing(progress: number, params: SpringParameters): number {
	const { tension, friction, mass } = params;
	if (progress === 0) return 0;
	if (progress === 1) return 1;

	const omega0 = Math.sqrt(tension / mass);
	const zeta = friction / (2 * Math.sqrt(tension * mass));
	const settleTime = 4 / (zeta * omega0);
	const scaledProgress = progress * settleTime;

	let value: number;
	if (zeta < 1) {
		const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
		value =
			1 -
			Math.exp(-zeta * omega0 * scaledProgress) *
				(Math.cos(omegaD * scaledProgress) +
					((zeta * omega0) / omegaD) * Math.sin(omegaD * scaledProgress));
	} else if (zeta === 1) {
		value = 1 - Math.exp(-omega0 * scaledProgress) * (1 + omega0 * scaledProgress);
	} else {
		const firstRoot = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
		const secondRoot = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
		value =
			1 -
			(secondRoot * Math.exp(firstRoot * scaledProgress) -
				firstRoot * Math.exp(secondRoot * scaledProgress)) /
				(secondRoot - firstRoot);
	}

	return Math.max(0, Math.min(1.2, value));
}

const easingFunctions = {
	linear,
	'ease-in': easeIn,
	'ease-out': easeOut,
	'ease-in-out': easeInOut,
	hold,
	'cubic-bezier': (progress) => cubicBezier(progress, DEFAULT_BEZIER_POINTS),
	spring: (progress) => springEasing(progress, DEFAULT_SPRING_PARAMS)
} satisfies Record<EasingType, (progress: number) => number>;

export function applyEasing(progress: number, type: EasingType): number {
	return (easingFunctions[type] ?? linear)(Math.max(0, Math.min(1, progress)));
}

export function applyEasingConfig(progress: number, config: EasingConfig): number {
	const clampedProgress = Math.max(0, Math.min(1, progress));
	switch (config.type) {
		case 'cubic-bezier':
			return cubicBezier(clampedProgress, config.bezier ?? DEFAULT_BEZIER_POINTS);
		case 'spring':
			return springEasing(clampedProgress, config.spring ?? DEFAULT_SPRING_PARAMS);
		default:
			return (easingFunctions[config.type] ?? linear)(clampedProgress);
	}
}
