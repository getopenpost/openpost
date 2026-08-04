export function hashLocalFile(file: File, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const id = crypto.randomUUID();
		const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
		const abort = () => {
			worker.terminate();
			reject(signal?.reason ?? new DOMException('Hashing cancelled.', 'AbortError'));
		};
		worker.onmessage = (event) => {
			const message = event.data as Record<string, unknown>;
			if (message.id !== id) return;
			if (message.type === 'complete') {
				signal?.removeEventListener('abort', abort);
				worker.terminate();
				resolve(String(message.sha256 ?? ''));
			} else if (message.type === 'error') {
				signal?.removeEventListener('abort', abort);
				worker.terminate();
				reject(new Error(String(message.message ?? 'The source hash could not be calculated.')));
			}
		};
		worker.onerror = (event) => {
			signal?.removeEventListener('abort', abort);
			worker.terminate();
			reject(new Error(event.message || 'The source hash worker failed.'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ id, file });
	});
}
