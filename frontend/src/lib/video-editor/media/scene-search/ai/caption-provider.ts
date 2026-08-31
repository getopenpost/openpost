/** Singleton local scene-caption provider. Ported from FreeCut (MIT). */

import { createLogger } from '../../../workspace-fs/logger';
import type { SceneCaptionData } from '../types';
import { addAbortableWorkerMessageListener } from './worker-message-listener';
import { localAiRuntimeRegistry } from '../../../local-ai/runtime-registry';

export const SCENE_CAPTION_MODEL_ID = 'LiquidAI/LFM2.5-VL-450M-ONNX';
const INIT_TIMEOUT_MS = 180_000;

export interface CaptionModelProgress {
	stage: 'loading-model' | 'captioning' | 'verifying';
	percent: number;
	completed: number;
	total: number;
}

export interface CaptionedScene {
	text: string;
	sceneData?: SceneCaptionData;
}

export interface SceneCutFramePair {
	before: Blob;
	after: Blob;
}

interface CaptionOptions {
	signal?: AbortSignal;
	onProgress?: (progress: CaptionModelProgress) => void;
}

type SceneWorkerMessage =
	| { type: 'ready' }
	| { type: 'progress'; percent: number }
	| { type: 'error'; message: string }
	| { type: 'caption'; id: number; caption: string; sceneData?: SceneCaptionData; error?: string }
	| { type: 'result'; id: number; isSceneCut: boolean; reason: string }
	| { type: 'debug'; id: number }
	| { type: 'disposed' };

const logger = createLogger('SceneCaptionProvider');
let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 0;
let operationTail: Promise<void> = Promise.resolve();
const pendingUnloadCancellations = new Set<() => void>();

function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
	const result = operationTail.then(operation, operation);
	operationTail = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

function createWorker(): Worker {
	return new Worker(new URL('./lfm-scene-worker.ts', import.meta.url), { type: 'module' });
}

function getWorker(): Worker {
	if (!worker) {
		worker = createWorker();
		worker.addEventListener('error', (event) => {
			logger.error('Scene caption worker failed', event.message);
		});
	}
	return worker;
}

function resetWorker(): void {
	for (const cancel of [...pendingUnloadCancellations]) cancel();
	pendingUnloadCancellations.clear();
	if (worker) {
		worker.postMessage({ type: 'dispose' });
		worker.terminate();
	}
	worker = null;
	readyPromise = null;
}

function ensureReady(options: CaptionOptions = {}): Promise<void> {
	if (readyPromise) return readyPromise;
	const activeWorker = getWorker();
	readyPromise = new Promise<void>((resolve, reject) => {
		let detach: () => void = () => undefined;
		let cancelForUnload: () => void = () => undefined;
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Scene caption model timed out while loading'));
		}, INIT_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timeout);
			detach();
			pendingUnloadCancellations.delete(cancelForUnload);
		};
		cancelForUnload = () => {
			cleanup();
			reject(new DOMException('Scene caption runtime was unloaded.', 'AbortError'));
		};
		pendingUnloadCancellations.add(cancelForUnload);
		const onAbort = () => {
			cleanup();
			resetWorker();
			reject(options.signal?.reason ?? new DOMException('Captioning cancelled', 'AbortError'));
		};
		const onMessage = (event: MessageEvent<SceneWorkerMessage>) => {
			const message = event.data;
			if (message.type === 'ready') {
				cleanup();
				resolve();
			} else if (message.type === 'progress') {
				options.onProgress?.({
					stage: 'loading-model',
					percent: message.percent ?? 0,
					completed: 0,
					total: 0
				});
			} else if (message.type === 'error') {
				cleanup();
				reject(new Error(message.message ?? 'Scene caption model failed to load'));
			}
		};
		const listener = addAbortableWorkerMessageListener({
			worker: activeWorker,
			signal: options.signal,
			onAbort,
			onMessage
		});
		if (!listener) return;
		detach = listener;
		activeWorker.postMessage({ type: 'init' });
	});
	readyPromise.catch(() => {
		readyPromise = null;
	});
	return readyPromise;
}

function captionOne(
	image: Blob,
	index: number,
	total: number,
	options: CaptionOptions
): Promise<CaptionedScene> {
	const id = ++nextId;
	const activeWorker = getWorker();
	return new Promise<CaptionedScene>((resolve, reject) => {
		let detach: () => void = () => undefined;
		let cancelForUnload: () => void = () => undefined;
		const cleanup = () => {
			detach();
			pendingUnloadCancellations.delete(cancelForUnload);
		};
		cancelForUnload = () => {
			cleanup();
			reject(new DOMException('Scene caption runtime was unloaded.', 'AbortError'));
		};
		pendingUnloadCancellations.add(cancelForUnload);
		const onAbort = () => {
			cleanup();
			resetWorker();
			reject(options.signal?.reason ?? new DOMException('Captioning cancelled', 'AbortError'));
		};
		const onMessage = (event: MessageEvent<SceneWorkerMessage>) => {
			const message = event.data;
			if (message.id !== id || message.type !== 'caption') return;
			cleanup();
			if (message.error && !message.caption) {
				reject(new Error(message.error));
				return;
			}
			options.onProgress?.({
				stage: 'captioning',
				percent: Math.round(((index + 1) / total) * 100),
				completed: index + 1,
				total
			});
			resolve({
				text: message.caption ?? '',
				sceneData: message.sceneData
			});
		};
		const listener = addAbortableWorkerMessageListener({
			worker: activeWorker,
			signal: options.signal,
			onAbort,
			onMessage
		});
		if (!listener) return;
		detach = listener;
		activeWorker.postMessage({ type: 'describe', id, image });
	});
}

function verifyOne(
	pair: SceneCutFramePair,
	index: number,
	total: number,
	options: CaptionOptions
): Promise<boolean> {
	const id = ++nextId;
	const activeWorker = getWorker();
	return new Promise<boolean>((resolve, reject) => {
		let detach: () => void = () => undefined;
		let cancelForUnload: () => void = () => undefined;
		const cleanup = () => {
			detach();
			pendingUnloadCancellations.delete(cancelForUnload);
		};
		cancelForUnload = () => {
			cleanup();
			reject(new DOMException('Scene model runtime was unloaded.', 'AbortError'));
		};
		pendingUnloadCancellations.add(cancelForUnload);
		const onAbort = () => {
			cleanup();
			resetWorker();
			reject(
				options.signal?.reason ?? new DOMException('Scene verification cancelled', 'AbortError')
			);
		};
		const onMessage = (event: MessageEvent<SceneWorkerMessage>) => {
			const message = event.data;
			if (message.id !== id || message.type !== 'result') return;
			cleanup();
			if (message.reason.startsWith('error:')) {
				reject(new Error(message.reason));
				return;
			}
			options.onProgress?.({
				stage: 'verifying',
				percent: Math.round(((index + 1) / total) * 100),
				completed: index + 1,
				total
			});
			resolve(message.isSceneCut === true);
		};
		const listener = addAbortableWorkerMessageListener({
			worker: activeWorker,
			signal: options.signal,
			onAbort,
			onMessage
		});
		if (!listener) return;
		detach = listener;
		activeWorker.postMessage({ type: 'verify', id, before: pair.before, after: pair.after });
	});
}

export const sceneCaptionProvider = {
	ensureReady,
	async captionImages(images: Blob[], options: CaptionOptions = {}): Promise<CaptionedScene[]> {
		if (images.length === 0) return [];
		return runExclusive(async () => {
			await ensureReady(options);
			const captions: CaptionedScene[] = [];
			for (let index = 0; index < images.length; index += 1) {
				if (options.signal?.aborted) {
					throw options.signal.reason ?? new DOMException('Captioning cancelled', 'AbortError');
				}
				captions.push(await captionOne(images[index]!, index, images.length, options));
			}
			return captions;
		});
	},
	async verifySceneCuts(
		pairs: SceneCutFramePair[],
		options: CaptionOptions = {}
	): Promise<boolean[]> {
		if (pairs.length === 0) return [];
		return runExclusive(async () => {
			await ensureReady(options);
			const decisions: boolean[] = [];
			for (let index = 0; index < pairs.length; index += 1) {
				if (options.signal?.aborted) {
					throw (
						options.signal.reason ?? new DOMException('Scene verification cancelled', 'AbortError')
					);
				}
				decisions.push(await verifyOne(pairs[index]!, index, pairs.length, options));
			}
			return decisions;
		});
	},
	dispose: resetWorker,
	isLoaded: () => worker !== null || readyPromise !== null
};

localAiRuntimeRegistry.register({
	id: 'scene-captions',
	label: 'Scene captions',
	isLoaded: sceneCaptionProvider.isLoaded,
	unload: sceneCaptionProvider.dispose
});
