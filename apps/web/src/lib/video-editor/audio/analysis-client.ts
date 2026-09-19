import type { AudioSilenceRange } from './audio-silence';
import type { AudioAnalysisOptions, AudioAnalysisResponse } from './analysis-types';

/** Each request owns a worker, so cancellation also releases decoder and model memory. */
export function analyzeAudioBlob(
	blob: Blob,
	options: AudioAnalysisOptions
): Promise<AudioSilenceRange[]> {
	options.signal?.throwIfAborted();
	const { signal, onProgress, ...settings } = options;
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
		const cleanup = () => {
			signal?.removeEventListener('abort', abort);
			worker.terminate();
		};
		const abort = () => {
			cleanup();
			reject(new DOMException('Audio analysis cancelled', 'AbortError'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.onmessage = (event: MessageEvent<AudioAnalysisResponse>) => {
			if (event.data.type === 'progress') {
				onProgress?.(event.data.progress);
				return;
			}
			cleanup();
			if (event.data.type === 'result') resolve(event.data.ranges);
			else reject(new Error(event.data.message));
		};
		worker.onerror = (event) => {
			cleanup();
			reject(new Error(event.message || 'Audio analysis failed'));
		};
		worker.postMessage({ blob, options: settings });
	});
}
