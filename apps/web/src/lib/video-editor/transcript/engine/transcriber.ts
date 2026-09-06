import { TranscriptionBridge } from './bridge';
import { DEFAULT_TRANSCRIPTION_MODEL, resolveTranscriptionEngine } from './models';
import type { ResolvedTranscriptionEngine, TranscriptSegment, TranscribeOptions } from './types';

export class BrowserTranscriber {
	private readonly defaults: TranscribeOptions;

	constructor(defaults: TranscribeOptions = {}) {
		this.defaults = defaults;
	}

	transcribe(file: File, options: TranscribeOptions = {}): TranscriptionJob {
		return new TranscriptionJob(file, { ...this.defaults, ...options });
	}
}

export class TranscriptionJob implements AsyncIterable<TranscriptSegment> {
	readonly resolved: ResolvedTranscriptionEngine;
	private readonly file: File;
	private readonly options: TranscribeOptions;
	private readonly queue: TranscriptSegment[] = [];
	private bridge: TranscriptionBridge | null = null;
	private wake: (() => void) | null = null;
	private failure: Error | null = null;
	private done = false;
	private started = false;
	private abortCleanup: (() => void) | null = null;

	constructor(file: File, options: TranscribeOptions) {
		this.file = file;
		this.options = options;
		this.resolved = resolveTranscriptionEngine(
			options.model ?? DEFAULT_TRANSCRIPTION_MODEL,
			options.language
		);
		if (this.resolved.fallbackReason) options.onFallback?.(this.resolved);
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<TranscriptSegment> {
		this.start();
		while (true) {
			const next = this.queue.shift();
			if (next) yield next;
			else if (this.failure) throw this.failure;
			else if (this.done) return;
			else await new Promise<void>((resolve) => (this.wake = resolve));
		}
	}

	async collect(): Promise<TranscriptSegment[]> {
		const segments: TranscriptSegment[] = [];
		for await (const segment of this) segments.push(segment);
		return segments;
	}

	cancel(reason = 'Transcription cancelled'): void {
		if (this.done || this.failure) return;
		this.bridge?.cancel();
		this.failure = new DOMException(reason, 'AbortError');
		this.cleanup();
		this.notify();
	}

	private start(): void {
		if (this.started) return;
		this.started = true;
		if (this.options.signal?.aborted) {
			this.cancel();
			return;
		}
		const abort = (): void => this.cancel();
		this.options.signal?.addEventListener('abort', abort, { once: true });
		this.abortCleanup = () => this.options.signal?.removeEventListener('abort', abort);
		this.bridge = new TranscriptionBridge({
			onSegment: (segment) => {
				this.queue.push(segment);
				this.options.onSegment?.(segment);
				this.notify();
			},
			onProgress: (event) => this.options.onProgress?.(event),
			onRuntimeInfo: (info) => this.options.onRuntimeInfo?.(info),
			onDone: () => {
				this.done = true;
				this.cleanup();
				this.notify();
			},
			onError: (message) => {
				this.failure = new Error(message);
				this.cleanup();
				this.notify();
			}
		});
		try {
			this.bridge.start(
				this.file,
				this.resolved.model,
				this.options.language,
				this.options.quantization ?? 'hybrid',
				this.resolved.engine,
				this.options.sourceStartSeconds,
				this.options.sourceEndSeconds
			);
		} catch (error) {
			this.failure = error instanceof Error ? error : new Error(String(error));
			this.cleanup();
			this.notify();
		}
	}

	private cleanup(): void {
		this.abortCleanup?.();
		this.abortCleanup = null;
	}

	private notify(): void {
		const wake = this.wake;
		this.wake = null;
		wake?.();
	}
}
