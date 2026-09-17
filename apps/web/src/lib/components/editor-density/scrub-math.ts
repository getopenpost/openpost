/**
 * Anchor-pixel scrub math for editor-density workstation controls.
 *
 * Contract (ProUI `pro-number-input` behavior, ported to Svelte):
 * - Steps are counted from the pixel where the press started: 1 step per 4px.
 * - Returning the pointer to the press pixel restores the exact start value.
 * - Shift multiplies stride x5, Alt/Option slows to x0.2.
 * - Keyboard arrows move 1 step; Shift x5; Alt x0.2.
 */

export const SCRUB_PX_PER_STEP = 4;
export const SCRUB_SHIFT_MULTIPLIER = 5;
export const SCRUB_ALT_MULTIPLIER = 0.2;

export interface ScrubModifiers {
	shift?: boolean;
	alt?: boolean;
}

export function strideMultiplier(modifiers: ScrubModifiers = {}): number {
	let multiplier = 1;
	if (modifiers.shift) multiplier *= SCRUB_SHIFT_MULTIPLIER;
	if (modifiers.alt) multiplier *= SCRUB_ALT_MULTIPLIER;
	return multiplier;
}

/** Whole steps for a horizontal drag distance, counted from the press pixel. */
export function stepsFromPixels(distancePx: number, modifiers: ScrubModifiers = {}): number {
	const raw = (distancePx / SCRUB_PX_PER_STEP) * strideMultiplier(modifiers);
	return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Value after scrubbing `distancePx` from `startValue`. Distance 0 returns start exactly. */
export function scrubValue(
	startValue: number,
	distancePx: number,
	step: number,
	modifiers: ScrubModifiers = {},
	min?: number,
	max?: number
): number {
	return clampValue(startValue + stepsFromPixels(distancePx, modifiers) * step, min, max);
}

/** Keyboard nudge: one step in `direction` (+1/-1), Shift x5, Alt x0.2. */
export function nudgeValue(
	current: number,
	direction: 1 | -1,
	step: number,
	modifiers: ScrubModifiers = {},
	min?: number,
	max?: number
): number {
	return clampValue(current + direction * step * strideMultiplier(modifiers), min, max);
}

export function clampValue(value: number, min?: number, max?: number): number {
	if (min !== undefined && value < min) return min;
	if (max !== undefined && value > max) return max;
	return value;
}

/** Fixed-precision display that never renders "-0.00". */
export function formatFixed(value: number, precision: number): string {
	const rounded = Number(value.toFixed(precision));
	return (rounded === 0 ? 0 : rounded).toFixed(precision);
}

/** Parse typed input; null when empty or not a finite number. */
export function parseNumeric(raw: string): number | null {
	if (raw.trim() === '') return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}
