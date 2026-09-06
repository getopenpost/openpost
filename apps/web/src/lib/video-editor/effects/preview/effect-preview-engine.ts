/**
 * Live effect previews rendered by the same WebGL2 compositor as playback and export.
 * Ported from FreeCut's effect-thumbnail engine and adapted to OpenPost's registry.
 */

import { createGpuCompositor, type GpuCompositor } from '../gpu/compositor';
import { getGpuEffect } from '../gpu/registry';
import { normalizeGpuParam, type GpuParamValues, type GpuShaderDefinition } from '../gpu/types';
import { EFFECT_DEFINITIONS, effectUnit, type CssFilterType } from '../types';
import type { EffectTemplate } from '../../timeline/effect-drop';

export const EFFECT_PREVIEW_WIDTH = 160;
export const EFFECT_PREVIEW_HEIGHT = 90;

const SAMPLE_URL = new URL('./effect-preview-sample.svg', import.meta.url).href;

interface PreviewPipeline {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	compositor: GpuCompositor;
}

let pipeline: PreviewPipeline | null = null;
let pipelinePromise: Promise<PreviewPipeline | null> | null = null;
let samplePromise: Promise<HTMLCanvasElement | OffscreenCanvas | null> | null = null;
let cssPreviewCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
const posterCache = new Map<string, EffectPreviewFrame>();

interface PosterJob {
	effects: readonly EffectTemplate[];
	key: string;
	waiters: PosterWaiter[];
}

interface PosterWaiter {
	signal?: AbortSignal;
	resolve: (frame: EffectPreviewFrame | null) => void;
}

const posterQueue: PosterJob[] = [];
const posterJobsByKey = new Map<string, PosterJob>();
let posterQueueScheduled = false;
let posterQueueRunning = false;
const POSTERS_PER_FRAME = 1;

export interface EffectPreviewFrame {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	mode: 'gpu' | 'css' | 'fallback';
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
	return createHtmlCanvas(width, height) ?? createOffscreenCanvas(width, height);
}

function createHtmlCanvas(width: number, height: number): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function createOffscreenCanvas(width: number, height: number): OffscreenCanvas | null {
	return typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(width, height);
}

function clonePreviewCanvas(
	source: HTMLCanvasElement | OffscreenCanvas
): HTMLCanvasElement | OffscreenCanvas | null {
	const copy = createCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
	const context = copy?.getContext('2d');
	if (!copy || !context) return null;
	context.drawImage(source, 0, 0, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
	return copy;
}

function previewKey(effects: readonly EffectTemplate[]): string {
	return JSON.stringify(
		effects.map((effect) =>
			effect.kind === 'gpu'
				? ['gpu', effect.effectId, effect.enabled !== false, effect.params ?? null]
				: ['css', effect.effectType, effect.enabled !== false, effect.amount ?? null]
		)
	);
}

function schedulePosterQueue(): void {
	if (posterQueueScheduled || posterQueueRunning || posterQueue.length === 0) return;
	posterQueueScheduled = true;
	const run = () => {
		posterQueueScheduled = false;
		void drainPosterQueue();
	};
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- SSR and unit tests may not expose the optional browser scheduler.
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
	else queueMicrotask(run);
}

function activePosterWaiters(job: PosterJob): PosterWaiter[] {
	const active: PosterWaiter[] = [];
	for (const waiter of job.waiters) {
		if (waiter.signal?.aborted) waiter.resolve(null);
		else active.push(waiter);
	}
	job.waiters = active;
	return active;
}

async function renderPosterJob(job: PosterJob): Promise<EffectPreviewFrame | null> {
	const cached = posterCache.get(job.key);
	if (cached) return cached;
	const sample = await getEffectPreviewSample();
	if (!sample || activePosterWaiters(job).length === 0) return null;
	if (job.effects.some((effect) => effect.kind === 'gpu')) {
		await ensureEffectPreviewPipeline();
		if (activePosterWaiters(job).length === 0) return null;
	}
	const rendered = renderEffectPreviewFrame(sample, job.effects, 1);
	const canvas = clonePreviewCanvas(rendered.canvas);
	if (!canvas) return null;
	const poster = { canvas, mode: rendered.mode } satisfies EffectPreviewFrame;
	posterCache.set(job.key, poster);
	return poster;
}

async function drainPosterQueue(): Promise<void> {
	if (posterQueueRunning) return;
	posterQueueRunning = true;
	try {
		const batch: PosterJob[] = [];
		while (batch.length < POSTERS_PER_FRAME && posterQueue.length > 0) {
			const job = posterQueue.shift();
			if (!job) break;
			if (activePosterWaiters(job).length === 0) {
				posterJobsByKey.delete(job.key);
				continue;
			}
			batch.push(job);
		}
		for (const job of batch) {
			const frame = await renderPosterJob(job);
			for (const waiter of activePosterWaiters(job)) waiter.resolve(frame);
			job.waiters = [];
			posterJobsByKey.delete(job.key);
		}
	} finally {
		posterQueueRunning = false;
		schedulePosterQueue();
	}
}

/** Queue and cache static cards so opening or scrolling the catalog cannot compile every shader at once. */
export function getEffectPreviewPoster(
	effects: readonly EffectTemplate[],
	signal?: AbortSignal
): Promise<EffectPreviewFrame | null> {
	const key = previewKey(effects);
	const cached = posterCache.get(key);
	if (cached) return Promise.resolve(cached);
	if (signal?.aborted) return Promise.resolve(null);
	return new Promise((resolve) => {
		const existing = posterJobsByKey.get(key);
		if (existing) existing.waiters.push({ signal, resolve });
		else {
			const job = {
				effects,
				key,
				waiters: [{ signal, resolve }]
			} satisfies PosterJob;
			posterJobsByKey.set(key, job);
			posterQueue.push(job);
		}
		schedulePosterQueue();
	});
}

export function ensureEffectPreviewPipeline(): Promise<PreviewPipeline | null> {
	if (pipelinePromise) return pipelinePromise;
	pipelinePromise = Promise.resolve().then(() => {
		const candidates = [
			createHtmlCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT),
			createOffscreenCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT)
		];
		for (const canvas of candidates) {
			if (!canvas) continue;
			const compositor = createGpuCompositor(canvas);
			if (!compositor) continue;
			pipeline = { canvas, compositor };
			return pipeline;
		}
		return null;
	});
	return pipelinePromise;
}

function getReadyEffectPreviewPipeline(): PreviewPipeline | null {
	return pipeline;
}

/** Decode the bundled frame once. Every preview draws from this same source. */
export function getEffectPreviewSample(): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
	if (samplePromise) return samplePromise;
	samplePromise = new Promise((resolve) => {
		const canvas = createCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
		// eslint-disable-next-line anti-slop/no-runtime-typeof -- this is the SSR boundary for the browser Image API.
		if (!canvas || typeof Image === 'undefined') {
			resolve(null);
			return;
		}
		const context = canvas.getContext('2d');
		if (!context) {
			resolve(null);
			return;
		}
		const image = new Image();
		image.onload = () => {
			context.drawImage(image, 0, 0, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
			resolve(canvas);
		};
		image.onerror = () => resolve(null);
		image.src = SAMPLE_URL;
	});
	return samplePromise;
}

/** Push neutral defaults toward a useful poster value without leaving the declared range. */
export function getShowcaseParams(definition: GpuShaderDefinition): GpuParamValues {
	return Object.fromEntries(
		definition.schema.map((param) => {
			if (!param.type || param.type === 'number') {
				const value =
					param.default === param.min
						? param.min + (param.max - param.min) * 0.3
						: param.default === param.max
							? param.default
							: param.default + (param.max - param.default) * 0.3;
				return [param.name, value];
			}
			return [param.name, param.default];
		})
	);
}

/** Blend from registry defaults to the poster target. Non-numeric choices use the target. */
export function blendGpuPreviewParams(
	effectId: string,
	target: GpuParamValues,
	strength: number
): GpuParamValues {
	const definition = getGpuEffect(effectId);
	if (!definition) return target;
	return {
		...target,
		...Object.fromEntries(
			definition.schema.map((param) => {
				if (!param.type || param.type === 'number') {
					const goal = Number(normalizeGpuParam(param, target[param.name] ?? param.default));
					return [param.name, param.default + (goal - param.default) * strength];
				}
				return [param.name, target[param.name] ?? param.default];
			})
		)
	};
}

export function cssPreviewFilter(type: CssFilterType, amount: number, strength = 1): string {
	const neutral = type === 'brightness' || type === 'contrast' || type === 'saturation' ? 1 : 0;
	const blended = neutral + (amount - neutral) * strength;
	return `${type}(${blended}${effectUnit(type)})`;
}

function renderGpuEffectPreview(
	sample: TexImageSource,
	effects: readonly { effectId: string; target: GpuParamValues }[],
	strength: number
): (HTMLCanvasElement | OffscreenCanvas) | null {
	const ready = getReadyEffectPreviewPipeline();
	if (!ready) return null;
	const rendered = ready.compositor.render(
		sample,
		EFFECT_PREVIEW_WIDTH,
		EFFECT_PREVIEW_HEIGHT,
		effects.map((effect) => ({
			effectId: effect.effectId,
			params: blendGpuPreviewParams(effect.effectId, effect.target, strength)
		}))
	);
	return rendered ? ready.canvas : null;
}

/** Render a CSS/GPU stack using the same GPU-first, CSS-second order as playback and export. */
export function renderEffectPreviewFrame(
	sample: HTMLCanvasElement | OffscreenCanvas,
	effects: readonly EffectTemplate[],
	strength: number
): EffectPreviewFrame {
	const enabled = effects.filter((effect) => effect.enabled !== false);
	const cssEffects = enabled.filter((effect) => effect.kind === 'css');
	const gpuEffects = enabled.flatMap((effect) => {
		if (effect.kind !== 'gpu') return [];
		const definition = getGpuEffect(effect.effectId);
		if (!definition) return [];
		return [
			{
				effectId: effect.effectId,
				target: effect.params ? { ...effect.params } : getShowcaseParams(definition)
			}
		];
	});

	let source: HTMLCanvasElement | OffscreenCanvas = sample;
	let gpuRendered = false;
	if (gpuEffects.length > 0) {
		const output = renderGpuEffectPreview(source, gpuEffects, strength);
		if (output) {
			source = output;
			gpuRendered = true;
		}
	}
	if (cssEffects.length > 0) {
		cssPreviewCanvas ??= createCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
		const context = cssPreviewCanvas?.getContext('2d');
		if (cssPreviewCanvas && context) {
			context.clearRect(0, 0, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
			context.save();
			context.filter = cssEffects
				.map((effect) => {
					const fallback = EFFECT_DEFINITIONS.find(
						(entry) => entry.type === effect.effectType
					)?.defaultAmount;
					return cssPreviewFilter(effect.effectType, effect.amount ?? fallback ?? 0, strength);
				})
				.join(' ');
			context.drawImage(source, 0, 0, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
			context.restore();
			source = cssPreviewCanvas;
		}
	}

	if (gpuRendered) return { canvas: source, mode: 'gpu' };
	if (cssEffects.length > 0 && source !== sample) return { canvas: source, mode: 'css' };
	return { canvas: sample, mode: 'fallback' };
}

export function prewarmEffectPreviews(): void {
	void ensureEffectPreviewPipeline();
	void getEffectPreviewSample();
}
