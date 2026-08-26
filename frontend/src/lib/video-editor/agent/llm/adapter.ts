import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types';
import { parseLlmWorkerResponse, type LlmWorkerResponse } from './worker-protocol';
import type { JsonValue } from '../types';
import GemmaWorker from './gemma-worker.ts?worker';

const DEFAULT_MAX_TOKENS = 768;

interface PendingGeneration {
	resolve: (text: string) => void;
	reject: (error: Error) => void;
	onToken?: (delta: string, text: string) => void;
	text: string;
	signal?: AbortSignal;
	onAbort?: () => void;
	aborted?: boolean;
}

export class GemmaLlmAdapter implements LlmAdapter {
	readonly id = 'gemma';
	readonly label = 'Gemma 4 (on-device)';

	private worker: Worker | null = null;
	private workerGeneration = 0;
	private lifecycleGeneration = 0;
	private ready = false;
	private loadPromise: Promise<void> | null = null;
	private loadResolve: (() => void) | null = null;
	private loadReject: ((error: Error) => void) | null = null;
	private onProgress: ((progress: LlmLoadProgress) => void) | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, PendingGeneration>();
	private generationTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly createWorker: () => Worker = () => new GemmaWorker(),
		private readonly terminationDelayMs = 500
	) {}

	isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
	}

	load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void> {
		this.onProgress = onProgress ?? null;
		if (this.ready) return Promise.resolve();
		if (this.loadPromise) return this.loadPromise;
		if (!this.isSupported()) {
			return Promise.reject(new Error('WebGPU is required to run the on-device assistant.'));
		}
		const worker = this.ensureWorker();
		this.loadPromise = new Promise<void>((resolve, reject) => {
			this.loadResolve = resolve;
			this.loadReject = reject;
		});
		worker.postMessage({ type: 'load' });
		return this.loadPromise;
	}

	async generate(messages: LlmMessage[], options: LlmGenerateOptions = {}): Promise<string> {
		const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
		const temperature = options.temperature ?? 0;
		const topP = options.topP ?? 0.9;
		if (
			!Number.isInteger(maxTokens) ||
			!Number.isFinite(maxTokens) ||
			maxTokens <= 0 ||
			maxTokens > 2048
		) {
			throw new RangeError('maxTokens must be a finite integer between 1 and 2048');
		}
		if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
			throw new RangeError('temperature must be a finite number between 0 and 2');
		}
		if (!Number.isFinite(topP) || topP < 0 || topP > 1) {
			throw new RangeError('topP must be a finite number between 0 and 1');
		}
		await this.load(this.onProgress ?? undefined);
		const lifecycle = this.lifecycleGeneration;
		const queued = this.generationTail.then(
			() => this.startGeneration(messages, options, maxTokens, temperature, topP, lifecycle),
			() => this.startGeneration(messages, options, maxTokens, temperature, topP, lifecycle)
		);
		this.generationTail = queued.then(
			() => undefined,
			() => undefined
		);
		return queued;
	}

	private startGeneration(
		messages: LlmMessage[],
		options: LlmGenerateOptions,
		maxTokens: number,
		temperature: number,
		topP: number,
		lifecycle: number
	): Promise<string> {
		if (lifecycle !== this.lifecycleGeneration) {
			return Promise.reject(new Error('Assistant session ended.'));
		}
		if (options.signal?.aborted) {
			return Promise.reject(new DOMException('Aborted', 'AbortError'));
		}
		const worker = this.ensureWorker();
		const id = this.nextId++;
		return new Promise<string>((resolve, reject) => {
			const entry: PendingGeneration = {
				resolve,
				reject,
				onToken: options.onToken,
				text: '',
				signal: options.signal
			};
			if (options.signal) {
				if (options.signal.aborted) {
					reject(new DOMException('Aborted', 'AbortError'));
					return;
				}
				entry.onAbort = () => {
					entry.aborted = true;
					worker.postMessage({ type: 'cancel', id });
				};
				options.signal.addEventListener('abort', entry.onAbort, { once: true });
			}
			this.pending.set(id, entry);
			worker.postMessage({
				type: 'generate',
				id,
				messages,
				maxTokens,
				temperature,
				topP
			});
		});
	}

	dispose(): void {
		this.lifecycleGeneration++;
		this.ready = false;
		if (!this.worker) {
			if (this.loadReject) {
				this.loadReject(new Error('Assistant disposed'));
				this.loadPromise = null;
				this.loadResolve = null;
				this.loadReject = null;
			}
			for (const [, entry] of this.pending) {
				this.detachSignal(entry);
				entry.reject(new Error('Assistant disposed'));
			}
			this.pending.clear();
			return;
		}
		this.workerGeneration++;
		this.worker.postMessage({ type: 'dispose' });
		const worker = this.worker;
		this.worker = null;
		if (this.loadReject) {
			this.loadReject(new Error('Assistant disposed'));
		}
		this.loadPromise = null;
		this.loadResolve = null;
		this.loadReject = null;
		for (const [, entry] of this.pending) {
			this.detachSignal(entry);
			entry.reject(new Error('Assistant disposed'));
		}
		this.pending.clear();
		setTimeout(() => worker.terminate(), this.terminationDelayMs);
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.workerGeneration++;
		const generation = this.workerGeneration;
		const worker = this.createWorker();
		worker.addEventListener('message', (event: MessageEvent<JsonValue>) => {
			if (generation !== this.workerGeneration) return;
			const message = parseLlmWorkerResponse(event.data);
			if (!message) {
				this.failWorker(
					worker,
					generation,
					new Error('Assistant worker sent an invalid response.')
				);
				return;
			}
			this.handleMessage(message);
		});
		worker.addEventListener('error', (event: ErrorEvent) => {
			if (generation !== this.workerGeneration) return;
			this.failWorker(worker, generation, new Error(event.message || 'Worker error'));
		});
		worker.addEventListener('messageerror', () => {
			if (generation !== this.workerGeneration) return;
			this.failWorker(worker, generation, new Error('Assistant worker message could not be read.'));
		});
		this.worker = worker;
		return worker;
	}

	private handleMessage(message: LlmWorkerResponse): void {
		switch (message.type) {
			case 'progress': {
				this.onProgress?.({ stage: message.stage, percent: message.percent });
				break;
			}
			case 'ready': {
				this.ready = true;
				const resolve = this.loadResolve;
				this.loadResolve = null;
				this.loadReject = null;
				this.loadPromise = null;
				resolve?.();
				break;
			}
			case 'token': {
				const entry = this.pending.get(message.id);
				if (!entry) break;
				entry.text += message.delta;
				entry.onToken?.(message.delta, entry.text);
				break;
			}
			case 'result': {
				const entry = this.pending.get(message.id);
				if (!entry) break;
				this.detachSignal(entry);
				this.pending.delete(message.id);
				if (entry.aborted) entry.reject(new DOMException('Aborted', 'AbortError'));
				else entry.resolve(message.text);
				break;
			}
			case 'error': {
				if (message.id === undefined) {
					const worker = this.worker;
					if (worker) this.failWorker(worker, this.workerGeneration, new Error(message.message));
					break;
				}
				const entry = this.pending.get(message.id);
				if (!entry) break;
				this.detachSignal(entry);
				this.pending.delete(message.id);
				entry.reject(
					entry.aborted ? new DOMException('Aborted', 'AbortError') : new Error(message.message)
				);
				break;
			}
			case 'disposed':
				break;
		}
	}

	private failWorker(worker: Worker, generation: number, error: Error): void {
		if (generation !== this.workerGeneration || this.worker !== worker) return;
		this.workerGeneration++;
		this.lifecycleGeneration++;
		this.worker = null;
		this.ready = false;
		const rejectLoad = this.loadReject;
		this.loadPromise = null;
		this.loadResolve = null;
		this.loadReject = null;
		rejectLoad?.(error);
		for (const [, entry] of this.pending) {
			this.detachSignal(entry);
			entry.reject(error);
		}
		this.pending.clear();
		worker.terminate();
	}

	private detachSignal(entry: PendingGeneration): void {
		if (entry.signal && entry.onAbort) {
			entry.signal.removeEventListener('abort', entry.onAbort);
		}
	}
}

export const gemmaLlmAdapter = new GemmaLlmAdapter();
