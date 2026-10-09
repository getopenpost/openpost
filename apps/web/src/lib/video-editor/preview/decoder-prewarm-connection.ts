import type {
	DecoderPrewarmDecodeRequest,
	DecoderPrewarmWorkerResponse
} from './decoder-prewarm.worker';

type DecodedFrames = Extract<DecoderPrewarmWorkerResponse, { type: 'decoded' }>['entries'];

interface PendingDecode {
	id: string;
	resolve: (frames: DecodedFrames) => void;
	reject: (error: Error) => void;
	cleanup: () => void;
}

/** Owns one decoder worker and its single active request. The caller serializes work. */
export class PreviewDecoderConnection {
	private worker: Worker | null = null;
	private pending: PendingDecode | null = null;
	private sequence = 0;

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(new URL('./decoder-prewarm.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker = worker;
		worker.addEventListener('message', (event: MessageEvent<DecoderPrewarmWorkerResponse>) => {
			const response = event.data;
			const pending = this.pending;
			if (worker !== this.worker || !pending || response.requestId !== pending.id) {
				if (response.type === 'decoded') {
					for (const entry of response.entries) entry.bitmap.close();
				}
				return;
			}
			if (response.type === 'error') {
				this.fail(worker, new Error(response.error));
			} else if (response.type === 'decoded') {
				this.pending = null;
				pending.cleanup();
				pending.resolve(response.entries);
			}
		});
		worker.addEventListener('error', (event: ErrorEvent) => {
			this.fail(worker, event.error instanceof Error ? event.error : new Error(event.message));
		});
		worker.addEventListener('messageerror', () => {
			this.fail(worker, new Error('Preview decoder response could not be read.'));
		});
		return worker;
	}

	private fail(worker: Worker, error: Error): void {
		if (this.worker !== worker) return;
		this.worker = null;
		worker.terminate();
		const pending = this.pending;
		this.pending = null;
		pending?.cleanup();
		pending?.reject(error);
	}

	warm(): void {
		const worker = this.getWorker();
		try {
			worker.postMessage({ type: 'warm', requestId: `preview-warm-${++this.sequence}` });
		} catch (error) {
			this.fail(worker, error instanceof Error ? error : new Error(String(error)));
		}
	}

	decode(
		request: Omit<DecoderPrewarmDecodeRequest, 'type' | 'requestId'>,
		signal: AbortSignal
	): Promise<DecodedFrames> {
		if (signal.aborted) return Promise.resolve([]);
		if (this.pending) return Promise.reject(new Error('Preview decoder is already busy.'));
		const worker = this.getWorker();
		const requestId = `preview-prewarm-${++this.sequence}`;
		return new Promise((resolve, reject) => {
			const abort = () => this.fail(worker, new DOMException('Preview closed.', 'AbortError'));
			const timeout = setTimeout(() => {
				this.fail(worker, new Error('Preview decoder prewarm timed out.'));
			}, 8_000);
			this.pending = {
				id: requestId,
				resolve,
				reject,
				cleanup: () => {
					clearTimeout(timeout);
					signal.removeEventListener('abort', abort);
				}
			};
			signal.addEventListener('abort', abort, { once: true });
			try {
				worker.postMessage({
					...request,
					type: 'decode',
					requestId
				} satisfies DecoderPrewarmDecodeRequest);
			} catch (error) {
				this.fail(worker, error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	clear(): void {
		if (this.worker) this.fail(this.worker, new DOMException('Preview closed.', 'AbortError'));
	}
}
