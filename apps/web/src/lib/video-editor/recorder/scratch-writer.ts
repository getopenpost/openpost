import type { ScratchWriteRequest, ScratchWriteResponse } from './scratch-writer.worker';

const WORKER_RESPONSE_TIMEOUT_MS = 30_000;

export class ScratchWriter {
	private nextId = 0;
	private failure: Error | null = null;
	private pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
	private worker = new Worker(new URL('./scratch-writer.worker.ts', import.meta.url), {
		type: 'module'
	});

	constructor() {
		this.worker.onmessage = (event: MessageEvent<ScratchWriteResponse>) => {
			const response = event.data;
			const pending = this.pending.get(response.id);
			if (!pending) return;
			this.pending.delete(response.id);
			if (response.error) {
				pending.reject(new DOMException(response.error.message, response.error.name));
			} else pending.resolve();
		};
		this.worker.onerror = (event) => this.terminate(new Error(event.message));
		this.worker.onmessageerror = () =>
			this.terminate(new Error('Recording storage response failed'));
	}

	open(handle: FileSystemFileHandle): Promise<void> {
		return this.request({ id: ++this.nextId, type: 'open', handle });
	}

	write(chunk: Blob): Promise<void> {
		return this.request({ id: ++this.nextId, type: 'write', chunk });
	}

	async close(): Promise<void> {
		try {
			await this.request({ id: ++this.nextId, type: 'close' });
		} finally {
			this.terminate();
		}
	}

	terminate(error = new Error('Recording storage is closed')): void {
		this.failure = error;
		this.worker.terminate();
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private request(request: ScratchWriteRequest): Promise<void> {
		if (this.failure) return Promise.reject(this.failure);
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => this.terminate(new Error('Recording storage response timeout')),
				WORKER_RESPONSE_TIMEOUT_MS
			);
			this.pending.set(request.id, {
				resolve: () => {
					clearTimeout(timeout);
					resolve();
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				}
			});
			try {
				this.worker.postMessage(request);
			} catch (error) {
				this.terminate(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}
}

export async function openScratchWriter(
	handle: FileSystemFileHandle
): Promise<ScratchWriter | null> {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Browser worker capability boundary.
	if (typeof Worker === 'undefined') return null;
	let writer: ScratchWriter | undefined;
	try {
		writer = new ScratchWriter();
		await writer.open(handle);
		return writer;
	} catch {
		writer?.terminate();
		// Browsers without synchronous OPFS retain the durable atomic-file writer.
		return null;
	}
}
