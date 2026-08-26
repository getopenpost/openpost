import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types';
import type { LlmWorkerResponse } from './worker-protocol';
import GemmaWorker from './gemma-worker.ts?worker';

const DEFAULT_MAX_TOKENS = 768;

interface PendingGeneration {
	resolve: (text: string) => void;
	reject: (error: Error) => void;
	onToken?: (delta: string, text: string) => void;
	text: string;
	signal?: AbortSignal;
	onAbort?: () => void;
}

export class GemmaLlmAdapter implements LlmAdapter {
	readonly id = 'gemma';
	readonly label = 'Gemma 4 (on-device)';

	private worker: Worker | null = null;
	private workerGeneration = 0;
	private loadPromise: Promise<void> | null = null;
	private loadResolve: (() => void) | null = null;
	private loadReject: ((error: Error) => void) | null = null;
	private onProgress: ((progress: LlmLoadProgress) => void) | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, PendingGeneration>();

	constructor(
		private readonly createWorker: () => Worker = () => new GemmaWorker(),
		private readonly terminationDelayMs = 500
	) {}

	isSupported(): boolean {
		return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
	}

	load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void> {
		this.onProgress = onProgress ?? null;
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
					worker.postMessage({ type: 'cancel', id });
					this.pending.delete(id);
					reject(new DOMException('Aborted', 'AbortError'));
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
		if (!this.worker) {
			if (this.loadReject) {
				this.loadReject(new Error('Assistant disposed'));
				this.loadPromise = null;
				this.loadResolve = null;
				this.loadReject = null;
			}
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
		worker.addEventListener('message', (event: MessageEvent<unknown>) => {
			if (generation !== this.workerGeneration) return;
			const data = event.data;
			if (!isValidWorkerResponse(data)) return;
			this.handleMessage(data);
		});
		worker.addEventListener('error', (event: ErrorEvent) => {
			if (generation !== this.workerGeneration) return;
			this.loadReject?.(new Error(event.message || 'Worker error'));
			this.loadPromise = null;
			this.loadResolve = null;
			this.loadReject = null;
		});
		this.worker = worker;
		return worker;
	}

	private handleMessage(message: LlmWorkerResponse): void {
		switch (message.type) {
			case 'progress': {
				if (!Number.isFinite(message.percent) || message.percent < 0 || message.percent > 100)
					return;
				if (typeof message.stage !== 'string') return;
				this.onProgress?.({ stage: message.stage, percent: message.percent });
				break;
			}
			case 'ready': {
				const resolve = this.loadResolve;
				this.loadResolve = null;
				this.loadReject = null;
				this.loadPromise = null;
				resolve?.();
				break;
			}
			case 'token': {
				if (typeof message.delta !== 'string') return;
				if (!Number.isFinite(message.id)) return;
				const entry = this.pending.get(message.id);
				if (!entry) break;
				entry.text += message.delta;
				entry.onToken?.(message.delta, entry.text);
				break;
			}
			case 'result': {
				if (typeof message.text !== 'string') return;
				if (!Number.isFinite(message.id)) return;
				const entry = this.pending.get(message.id);
				if (!entry) break;
				this.detachSignal(entry);
				this.pending.delete(message.id);
				entry.resolve(message.text);
				break;
			}
			case 'error': {
				if (message.id !== undefined && !Number.isFinite(message.id)) return;
				if (typeof message.message !== 'string') return;
				if (message.id === undefined) {
					const reject = this.loadReject;
					this.loadReject = null;
					this.loadResolve = null;
					this.loadPromise = null;
					reject?.(new Error(message.message));
					break;
				}
				const entry = this.pending.get(message.id);
				if (!entry) break;
				this.detachSignal(entry);
				this.pending.delete(message.id);
				entry.reject(new Error(message.message));
				break;
			}
			case 'disposed':
				break;
		}
	}

	private detachSignal(entry: PendingGeneration): void {
		if (entry.signal && entry.onAbort) {
			entry.signal.removeEventListener('abort', entry.onAbort);
		}
	}
}

function isValidWorkerResponse(value: unknown): value is LlmWorkerResponse {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	const type = record.type;
	if (type === 'progress') {
		return (
			typeof record.stage === 'string' &&
			typeof record.percent === 'number' &&
			Number.isFinite(record.percent)
		);
	}
	if (type === 'ready' || type === 'disposed') return true;
	if (type === 'token') {
		return (
			typeof record.id === 'number' &&
			Number.isFinite(record.id) &&
			typeof record.delta === 'string'
		);
	}
	if (type === 'result') {
		return (
			typeof record.id === 'number' && Number.isFinite(record.id) && typeof record.text === 'string'
		);
	}
	if (type === 'error') {
		return (
			typeof record.message === 'string' &&
			(record.id === undefined || (typeof record.id === 'number' && Number.isFinite(record.id)))
		);
	}
	return false;
}

export const gemmaLlmAdapter = new GemmaLlmAdapter();
