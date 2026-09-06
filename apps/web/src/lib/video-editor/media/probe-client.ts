/**
 * Main-thread client for the media probe worker.
 *
 * Ported from FreeCut (MIT) patterns; one worker per import batch.
 */

import type { MediaProbeResult } from './probe.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (r: MediaProbeResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (
			event: MessageEvent<{ id: number; ok: boolean; result?: MediaProbeResult; error?: string }>
		) => {
			const entry = pending.get(event.data.id);
			if (!entry) return;
			pending.delete(event.data.id);
			if (event.data.ok && event.data.result) entry.resolve(event.data.result);
			else entry.reject(new Error(event.data.error ?? 'Media probe failed'));
		};
		worker.onerror = (event) => {
			for (const entry of pending.values()) entry.reject(new Error(event.message));
			pending.clear();
		};
	}
	return worker;
}

export function probeMediaFile(file: File): Promise<MediaProbeResult> {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		getWorker().postMessage({ id, file });
	});
}
