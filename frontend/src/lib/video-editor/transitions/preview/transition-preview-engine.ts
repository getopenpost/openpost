/** Ported from FreeCut's MIT-licensed transition preview, using OpenPost's Canvas renderers. */

import { transitionRegistry } from '../index';
import type { FlipDirection, SlideDirection, TransitionDefinition, WipeDirection } from '../types';

export const TRANSITION_PREVIEW_WIDTH = 160;
export const TRANSITION_PREVIEW_HEIGHT = 90;

const FRAME_A_URL = new URL('./frame-a.svg', import.meta.url).href;
const FRAME_B_URL = new URL('./frame-b.svg', import.meta.url).href;
const BRIGHT_POSTER_IDS = new Set(['fade', 'dipToColorDissolve', 'flip']);

type PreviewCanvas = HTMLCanvasElement | OffscreenCanvas;
export type PreviewDirection = WipeDirection | SlideDirection | FlipDirection | undefined;

export interface TransitionPreviewFrames {
	a: PreviewCanvas;
	b: PreviewCanvas;
}

interface PosterJob {
	presentationId: string;
	direction?: PreviewDirection;
	key: string;
	waiters: PosterWaiter[];
}

interface PosterWaiter {
	signal?: AbortSignal;
	resolve: (canvas: PreviewCanvas | null) => void;
}

let framesPromise: Promise<TransitionPreviewFrames | null> | null = null;
let renderCanvas: PreviewCanvas | null = null;
const posterCache = new Map<string, PreviewCanvas>();
const posterQueue: PosterJob[] = [];
const posterJobsByKey = new Map<string, PosterJob>();
let posterQueueScheduled = false;
let posterQueueRunning = false;
const POSTERS_PER_FRAME = 2;

function createCanvas(width: number, height: number): PreviewCanvas | null {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(width, height);
}

async function loadFrame(url: string): Promise<PreviewCanvas> {
	const canvas = createCanvas(TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	if (!canvas || typeof Image === 'undefined')
		throw new Error('Transition preview is unavailable.');
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Transition preview canvas is unavailable.');
	const image = new Image();
	image.src = url;
	if (typeof image.decode === 'function') await image.decode();
	else {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Transition preview image failed to load.'));
		});
	}
	context.drawImage(image, 0, 0, TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	return canvas;
}

export function getTransitionPreviewFrames(): Promise<TransitionPreviewFrames | null> {
	framesPromise ??= Promise.all([loadFrame(FRAME_A_URL), loadFrame(FRAME_B_URL)])
		.then(([a, b]) => ({ a, b }))
		.catch(() => null);
	return framesPromise;
}

function defaultProperties(definition: TransitionDefinition): Record<string, unknown> {
	return Object.fromEntries(
		(definition.parameters ?? []).map((parameter) => [parameter.key, parameter.defaultValue])
	);
}

export function transitionPosterProgress(presentationId: string): number {
	return BRIGHT_POSTER_IDS.has(presentationId) ? 0.1 : 0.5;
}

export function renderTransitionPreviewFrame(
	frames: TransitionPreviewFrames,
	presentationId: string,
	direction: PreviewDirection,
	progress: number
): PreviewCanvas | null {
	renderCanvas ??= createCanvas(TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	const context = renderCanvas?.getContext('2d');
	if (!renderCanvas || !context) return null;
	context.clearRect(0, 0, TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	const definition = transitionRegistry.getDefinition(presentationId);
	const renderer = transitionRegistry.getRenderer(presentationId)?.renderCanvas;
	if (!definition || !renderer) return null;
	try {
		renderer(
			context as OffscreenCanvasRenderingContext2D,
			frames.a as OffscreenCanvas,
			frames.b as OffscreenCanvas,
			progress,
			direction,
			{ width: TRANSITION_PREVIEW_WIDTH, height: TRANSITION_PREVIEW_HEIGHT },
			defaultProperties(definition)
		);
		return renderCanvas;
	} catch {
		return null;
	}
}

function copyCanvas(source: PreviewCanvas): PreviewCanvas | null {
	const copy = createCanvas(TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	const context = copy?.getContext('2d');
	if (!copy || !context) return null;
	context.drawImage(source, 0, 0, TRANSITION_PREVIEW_WIDTH, TRANSITION_PREVIEW_HEIGHT);
	return copy;
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

async function renderPosterJob(job: PosterJob): Promise<PreviewCanvas | null> {
	const cached = posterCache.get(job.key);
	if (cached) return cached;
	const frames = await getTransitionPreviewFrames();
	if (!frames || activePosterWaiters(job).length === 0) return null;
	const rendered = renderTransitionPreviewFrame(
		frames,
		job.presentationId,
		job.direction,
		transitionPosterProgress(job.presentationId)
	);
	const poster = rendered ? copyCanvas(rendered) : null;
	if (poster) posterCache.set(job.key, poster);
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
			const poster = await renderPosterJob(job);
			for (const waiter of activePosterWaiters(job)) waiter.resolve(poster);
			job.waiters = [];
			posterJobsByKey.delete(job.key);
		}
	} finally {
		posterQueueRunning = false;
		schedulePosterQueue();
	}
}

export function getTransitionPreviewPoster(
	presentationId: string,
	direction?: PreviewDirection,
	signal?: AbortSignal
): Promise<PreviewCanvas | null> {
	const key = `${presentationId}:${direction ?? ''}`;
	const cached = posterCache.get(key);
	if (cached) return Promise.resolve(cached);
	if (signal?.aborted) return Promise.resolve(null);
	return new Promise((resolve) => {
		const existing = posterJobsByKey.get(key);
		if (existing) existing.waiters.push({ signal, resolve });
		else {
			const job = {
				presentationId,
				direction,
				key,
				waiters: [{ signal, resolve }]
			} satisfies PosterJob;
			posterJobsByKey.set(key, job);
			posterQueue.push(job);
		}
		schedulePosterQueue();
	});
}
