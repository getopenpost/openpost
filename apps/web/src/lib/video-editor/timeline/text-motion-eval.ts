import type {
	TextMotionEasing,
	TextMotionEffect,
	TextMotionOrder,
	TextMotionSlot,
	TextMotionSpec
} from '../project/types';
import { getTextMotionPreset } from './text-motion-presets';
import type { GlyphMotionState, TextMotionChannelContext } from './text-motion-types';

export interface GlyphMotionContext {
	relativeFrame: number;
	durationInFrames: number;
	unitIndex: number;
	unitCount: number;
	fontSize: number;
	boxWidth: number;
	boxHeight: number;
}

interface SlotWindow {
	duration: number;
	stagger: number;
	totalWindow: number;
}

interface ActiveSlot {
	slot: TextMotionSlot;
	effect: TextMotionEffect;
	window: SlotWindow | null;
	startFrame: number;
}

const IDENTITY: GlyphMotionState = {
	dx: 0,
	dy: 0,
	scale: 1,
	rotation: 0,
	alpha: 1,
	soften: 0
};
const randomRankCache = new Map<string, number[]>();

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function easingAt(progress: number, easing: TextMotionEasing): number {
	if (easing === 'linear') return progress;
	if (easing === 'ease-in') return progress * progress;
	if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress);
	if (easing === 'ease-in-out') {
		return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
	}
	const shift = progress - 1;
	const overshoot = 1.70158;
	return 1 + (overshoot + 1) * shift * shift * shift + overshoot * shift * shift;
}

function mulberry32(seed: number): () => number {
	let value = (seed | 0) + 0x9e3779b9;
	return () => {
		value = (value + 0x6d2b79f5) | 0;
		let result = Math.imul(value ^ (value >>> 15), 1 | value);
		result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

function randomRanks(unitCount: number, seed: number): number[] {
	const key = `${unitCount}:${seed}`;
	const cached = randomRankCache.get(key);
	if (cached) return cached;
	const order = Array.from({ length: unitCount }, (_, index) => index);
	const random = mulberry32(seed);
	for (let index = unitCount - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		const current = order[index] ?? index;
		order[index] = order[target] ?? target;
		order[target] = current;
	}
	const ranks = new Array<number>(unitCount).fill(0);
	order.forEach((unit, rank) => {
		ranks[unit] = rank;
	});
	if (randomRankCache.size >= 32) {
		const oldest = randomRankCache.keys().next().value;
		if (oldest !== undefined) randomRankCache.delete(oldest);
	}
	randomRankCache.set(key, ranks);
	return ranks;
}

function orderRank(order: TextMotionOrder, index: number, count: number, seed: number): number {
	if (order === 'forward') return index;
	if (order === 'backward') return count - 1 - index;
	if (order === 'center') return Math.floor(Math.abs(index - (count - 1) / 2));
	return randomRanks(count, seed)[index] ?? index;
}

function maxOrderRank(order: TextMotionOrder, count: number): number {
	return order === 'center' ? Math.floor((count - 1) / 2) : Math.max(0, count - 1);
}

function resolveWindow(effect: TextMotionEffect, count: number, clipDuration: number): SlotWindow {
	const duration = Math.max(0, effect.durationFrames);
	const stagger = Math.max(0, effect.staggerFrames);
	const totalWindow = duration + stagger * maxOrderRank(effect.order, count);
	const maximum = clipDuration / 2;
	if (totalWindow > maximum && totalWindow > 0) {
		const scale = maximum / totalWindow;
		return { duration: duration * scale, stagger: stagger * scale, totalWindow: maximum };
	}
	return { duration, stagger, totalWindow };
}

function resolveActiveSlot(
	spec: TextMotionSpec,
	relativeFrame: number,
	durationInFrames: number,
	unitCount: number
): ActiveSlot | null {
	if (durationInFrames <= 0) return null;
	const outWindow = spec.out ? resolveWindow(spec.out, unitCount, durationInFrames) : null;
	if (spec.out && outWindow) {
		const offset = Math.min(
			Math.max(0, spec.out.offsetFrames ?? 0),
			Math.max(0, durationInFrames - outWindow.totalWindow)
		);
		const startFrame = durationInFrames - offset - outWindow.totalWindow;
		if (relativeFrame >= startFrame) {
			return { slot: 'out', effect: spec.out, window: outWindow, startFrame };
		}
	}
	const inWindow = spec.in ? resolveWindow(spec.in, unitCount, durationInFrames) : null;
	const inOffset =
		spec.in && inWindow
			? Math.min(
					Math.max(0, spec.in.offsetFrames ?? 0),
					Math.max(0, durationInFrames - inWindow.totalWindow)
				)
			: 0;
	if (spec.in && inWindow && relativeFrame < inOffset + inWindow.totalWindow) {
		return { slot: 'in', effect: spec.in, window: inWindow, startFrame: inOffset };
	}
	return spec.loop
		? {
				slot: 'loop',
				effect: spec.loop,
				window: null,
				startFrame: inOffset + (inWindow?.totalWindow ?? 0)
			}
		: null;
}

function channelContext(
	effect: TextMotionEffect,
	context: GlyphMotionContext
): TextMotionChannelContext {
	return {
		unitIndex: context.unitIndex,
		unitCount: Math.max(1, context.unitCount),
		fontSize: context.fontSize,
		boxWidth: context.boxWidth,
		boxHeight: context.boxHeight,
		intensity: clamp(effect.intensity, 0, 2),
		seed: effect.seed
	};
}

function finalize(partial: Partial<GlyphMotionState>): GlyphMotionState | null {
	const state = { ...IDENTITY, ...partial };
	return state.dx === 0 &&
		state.dy === 0 &&
		state.scale === 1 &&
		state.rotation === 0 &&
		state.alpha === 1 &&
		state.soften === 0
		? null
		: state;
}

export function evaluateGlyphMotion(
	spec: TextMotionSpec,
	context: GlyphMotionContext
): GlyphMotionState | null {
	const count = Math.max(1, context.unitCount);
	const active = resolveActiveSlot(spec, context.relativeFrame, context.durationInFrames, count);
	if (!active) return null;
	const preset = getTextMotionPreset(active.effect.presetId);
	if (active.window) {
		const delay =
			orderRank(active.effect.order, context.unitIndex, count, active.effect.seed) *
			active.window.stagger;
		const localFrame = context.relativeFrame - active.startFrame;
		const progress =
			active.window.duration <= 0
				? localFrame >= delay
					? 1
					: 0
				: clamp((localFrame - delay) / active.window.duration, 0, 1);
		return finalize(
			preset.channels(
				easingAt(progress, active.effect.easing),
				channelContext(active.effect, context)
			)
		);
	}
	const delay =
		orderRank(active.effect.order, context.unitIndex, count, active.effect.seed) *
		Math.max(0, active.effect.staggerFrames);
	const localFrame = context.relativeFrame - active.startFrame - delay;
	if (localFrame <= 0) return null;
	const phase = (localFrame / Math.max(1e-6, active.effect.durationFrames)) % 1;
	return finalize(preset.channels(phase, channelContext(active.effect, context)));
}

export function getActiveTextMotionSlot(
	spec: TextMotionSpec,
	relativeFrame: number,
	durationInFrames: number
): TextMotionSlot | null {
	return (
		resolveActiveSlot(spec, relativeFrame, durationInFrames, Number.MAX_SAFE_INTEGER)?.slot ?? null
	);
}

/** Conservative cache-bypass test. False positives cost one render, never a stale frame. */
export function isTextMotionActive(
	spec: TextMotionSpec,
	relativeFrame: number,
	durationInFrames: number
): boolean {
	if (durationInFrames <= 0 || relativeFrame < 0) return false;
	if (spec.loop) return true;
	const maximumWindow = durationInFrames / 2;
	if (spec.in) {
		const offset = Math.max(0, spec.in.offsetFrames ?? 0);
		const window =
			spec.in.staggerFrames > 0
				? maximumWindow
				: Math.min(Math.max(0, spec.in.durationFrames), maximumWindow);
		if (relativeFrame < Math.min(durationInFrames, offset + window)) return true;
	}
	if (spec.out) {
		const offset = Math.max(0, spec.out.offsetFrames ?? 0);
		const window =
			spec.out.staggerFrames > 0
				? maximumWindow
				: Math.min(Math.max(0, spec.out.durationFrames), maximumWindow);
		if (relativeFrame >= Math.max(0, durationInFrames - offset - window)) return true;
	}
	return false;
}
