import type { EasingConfig } from '$lib/video-editor/project/types';

export const EASE_OUT_SOFT: EasingConfig = {
	type: 'cubic-bezier',
	bezier: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }
};

export const EASE_IN_SOFT: EasingConfig = {
	type: 'cubic-bezier',
	bezier: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 }
};

export const SPRING_SETTLE: EasingConfig = {
	type: 'spring',
	spring: { tension: 220, friction: 18, mass: 0.9 }
};

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function animationWindowFrames(
	seconds: number,
	durationInFrames: number,
	fps: number
): number {
	if (durationInFrames <= 1) return 0;
	return Math.max(1, Math.min(durationInFrames - 1, Math.round(fps * seconds)));
}
