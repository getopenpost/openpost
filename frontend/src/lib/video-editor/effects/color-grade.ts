/** Color-grade stack and Resolve-style picker math shared by the editor UI and preview. */

import type { GpuEffect, ItemEffect } from './types';
import { getGpuEffect } from './gpu/registry';

export interface GradeEffectSnapshot {
	effectId: string;
	params: Record<string, number | string | boolean>;
	enabled: boolean;
}

export interface PickedColor {
	r: number;
	g: number;
	b: number;
}

export interface AutoBalanceCurrent {
	lift: number;
	gain: number;
	temperature: number;
	tint: number;
}

export interface WhiteBalanceCorrection {
	temperature: number;
	tint: number;
}

const LIFT_MIN = -2;
const LIFT_MAX = 2;
const GAIN_MIN = 0;
const GAIN_MAX = 16;
const WHITE_BALANCE_LIMIT = 100;

export function isColorGradeEffect(effect: ItemEffect): effect is GpuEffect {
	return effect.type === 'gpu' && getGpuEffect(effect.effectId)?.category === 'color';
}

export function hasColorGrade(effects: readonly ItemEffect[] | undefined): boolean {
	return effects?.some(isColorGradeEffect) ?? false;
}

export function hasEnabledColorGrade(effects: readonly ItemEffect[] | undefined): boolean {
	return effects?.some((effect) => isColorGradeEffect(effect) && effect.enabled) ?? false;
}

/** Remove color-category GPU effects without touching blur, keying, stylize, or CSS effects. */
export function withoutColorGradeEffects(effects: readonly ItemEffect[] | undefined): ItemEffect[] {
	return (effects ?? []).filter((effect) => !isColorGradeEffect(effect));
}

export function snapshotColorGrade(
	effects: readonly ItemEffect[] | undefined
): GradeEffectSnapshot[] {
	return (effects ?? []).filter(isColorGradeEffect).map((effect) => ({
		effectId: effect.effectId,
		params: { ...effect.params },
		enabled: effect.enabled
	}));
}

/** Replace only the grade portion of a stack, preserving the first grade slot and all other effects. */
export function replaceColorGradeInStack(
	effects: readonly ItemEffect[] | undefined,
	grade: readonly GradeEffectSnapshot[],
	createId: () => string = () => crypto.randomUUID()
): ItemEffect[] {
	const replacements: GpuEffect[] = grade.map((entry) => ({
		id: createId(),
		type: 'gpu',
		effectId: entry.effectId,
		params: { ...entry.params },
		enabled: entry.enabled
	}));
	let inserted = false;
	const next: ItemEffect[] = [];
	for (const effect of effects ?? []) {
		if (!isColorGradeEffect(effect)) {
			next.push(effect);
			continue;
		}
		if (!inserted) {
			next.push(...replacements);
			inserted = true;
		}
	}
	if (!inserted) next.push(...replacements);
	return next;
}

export function luma601({ r, g, b }: PickedColor): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Temp and tint changes that make the picked sample neutral under the color-wheels shader. */
export function whiteBalanceFromPick(
	picked: PickedColor,
	currentTemperature: number,
	currentTint: number
): WhiteBalanceCorrection {
	const temperatureDelta = (picked.b - picked.r) / 0.2;
	const tintDelta = (picked.g - (picked.r + picked.b) / 2) / 0.15;
	return {
		temperature: clamp(
			round4(currentTemperature + temperatureDelta * 100),
			-WHITE_BALANCE_LIMIT,
			WHITE_BALANCE_LIMIT
		),
		tint: clamp(round4(currentTint + tintDelta * 100), -WHITE_BALANCE_LIMIT, WHITE_BALANCE_LIMIT)
	};
}

export function blackPointFromPick(pickedLuma: number, currentLift: number): number {
	return clamp(round4(currentLift - pickedLuma), LIFT_MIN, LIFT_MAX);
}

export function whitePointFromPick(pickedLuma: number, currentGain: number): number {
	return clamp(round4(currentGain / Math.max(pickedLuma, 0.05)), GAIN_MIN, GAIN_MAX);
}

/** Stretch the 1st and 99th luma percentiles and neutralize the average frame color. */
export function autoBalanceFromFrame(
	imageData: Pick<ImageData, 'data' | 'width' | 'height'>,
	current: AutoBalanceCurrent
): AutoBalanceCurrent {
	const { data } = imageData;
	const lumas: number[] = [];
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	for (let offset = 0; offset < data.length; offset += 4) {
		if ((data[offset + 3] ?? 0) === 0) continue;
		const r = (data[offset] ?? 0) / 255;
		const g = (data[offset + 1] ?? 0) / 255;
		const b = (data[offset + 2] ?? 0) / 255;
		lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
		sumR += r;
		sumG += g;
		sumB += b;
	}
	if (lumas.length === 0) return { ...current };
	lumas.sort((left, right) => left - right);
	const percentile = (amount: number) =>
		lumas[clamp(Math.round(amount * (lumas.length - 1)), 0, lumas.length - 1)] ?? 0;
	const black = percentile(0.01);
	const white = percentile(0.99);
	const count = lumas.length;
	const balance = whiteBalanceFromPick(
		{ r: sumR / count, g: sumG / count, b: sumB / count },
		current.temperature,
		current.tint
	);
	return {
		lift: clamp(round4(current.lift - black), LIFT_MIN, LIFT_MAX),
		gain: clamp(round4(current.gain / Math.max(white - black, 0.05)), GAIN_MIN, GAIN_MAX),
		temperature: balance.temperature,
		tint: balance.tint
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}
