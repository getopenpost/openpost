import type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage } from './types';
import type { LlmWorkerResponse } from './worker-protocol';
import GemmaWorker from './gemma-worker.ts?worker';

const DEFAULT_MAX_TOKENS = 512;

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
	readonly label = 'Gemma 3n E2B (on-device)';

	private worker: Worker | null = null;
	private loadPromise: Promise<void> | null = null;
	private loadResolve: (() => void) | null = null;
	private loadReject: ((error: Error) => void) | null = null;
	private onProgress: ((progress: LlmLoadProgress) => void) | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, PendingGeneration>();

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
				maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
				temperature: options.temperature ?? 0,
				topP: options.topP ?? 0.9
			});
		});
	}

	dispose(): void {
		if (!this.worker) return;
		this.worker.postMessage({ type: 'dispose' });
		const worker = this.worker;
		this.worker = null;
		this.loadPromise = null;
		this.loadResolve = null;
		this.loadReject = null;
		for (const [, entry] of this.pending) {
			this.detachSignal(entry);
			entry.reject(new Error('Assistant disposed'));
		}
		this.pending.clear();
		setTimeout(() => worker.terminate(), 500);
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new GemmaWorker();
		worker.addEventListener('message', (event: MessageEvent<unknown>) => {
			const data = event.data as Record<string, unknown> | null;
			if (!data || typeof data.type !== 'string') return;
			this.handleMessage(data as LlmWorkerResponse);
		});
		worker.addEventListener('error', (event: ErrorEvent) => {
			this.loadReject?.(new Error(event.message || 'Worker error'));
		});
		this.worker = worker;
		return worker;
	}

	private handleMessage(message: LlmWorkerResponse): void {
		switch (message.type) {
			case 'progress':
				this.onProgress?.({ stage: message.stage, percent: message.percent });
				break;
			case 'ready':
				this.loadResolve?.();
				break;
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
				entry.resolve(message.text);
				break;
			}
			case 'error': {
				if (message.id === undefined) {
					this.loadReject?.(new Error(message.message));
					this.loadPromise = null;
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

export const gemmaLlmAdapter = new GemmaLlmAdapter();
