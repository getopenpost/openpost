import type { VideoProjectDocumentV1 } from '@openpost/video-project';
import type { LosslessExportOptions } from './lossless-exporter';

interface WorkerProgress {
	type: 'progress';
	fraction: number;
}

interface WorkerComplete {
	type: 'complete';
	file: File;
}

interface WorkerFailure {
	type: 'error';
	name: string;
	message: string;
	stack?: string;
}

type WorkerResponse = WorkerProgress | WorkerComplete | WorkerFailure;

export async function exportQuickCut(
	project: VideoProjectDocumentV1,
	options: LosslessExportOptions = {}
): Promise<File> {
	if (typeof Worker === 'undefined') {
		const { exportQuickCutLosslessly } = await import('./lossless-exporter');
		return await exportQuickCutLosslessly(project, options);
	}

	const exportWorker = new Worker(new URL('./lossless-export.worker.ts', import.meta.url), {
		type: 'module',
		name: 'openpost-quick-cut-export'
	});
	try {
		return await runWorker(exportWorker, project, options);
	} catch (cause) {
		// Some browsers expose File System Access on the window but cannot clone a
		// handle into a worker. Retain direct-to-disk output on the main thread for
		// that narrow capability mismatch.
		if (cause instanceof DOMException && cause.name === 'DataCloneError') {
			const { exportQuickCutLosslessly } = await import('./lossless-exporter');
			return await exportQuickCutLosslessly(project, options);
		}
		throw cause;
	} finally {
		exportWorker.terminate();
	}
}

function runWorker(
	worker: Worker,
	project: VideoProjectDocumentV1,
	options: LosslessExportOptions
): Promise<File> {
	return new Promise<File>((resolve, reject) => {
		let settled = false;
		let cancellationFallback: ReturnType<typeof setTimeout> | undefined;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			if (cancellationFallback) clearTimeout(cancellationFallback);
			options.signal?.removeEventListener('abort', abort);
			callback();
		};
		const abort = () => {
			worker.postMessage({ type: 'cancel' });
			cancellationFallback = setTimeout(
				() =>
					finish(() =>
						reject(options.signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
					),
				3_000
			);
		};
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			if (event.data.type === 'progress') {
				options.onProgress?.(event.data.fraction);
				return;
			}
			if (event.data.type === 'complete') {
				const file = event.data.file;
				finish(() => resolve(file));
				return;
			}
			if (options.signal?.aborted) {
				finish(() => reject(options.signal?.reason ?? new DOMException('Cancelled', 'AbortError')));
				return;
			}
			const error = new Error(event.data.message);
			error.name = event.data.name;
			if (event.data.stack) error.stack = event.data.stack;
			finish(() => reject(error));
		};
		worker.onerror = (event) => {
			finish(() => reject(event.error ?? new Error(event.message || 'Quick Cut worker failed.')));
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		if (options.signal?.aborted) {
			abort();
			return;
		}
		worker.postMessage({
			type: 'export',
			project,
			projectID: options.projectID,
			format: options.format,
			outputFileHandle: options.outputFileHandle
		});
	});
}
