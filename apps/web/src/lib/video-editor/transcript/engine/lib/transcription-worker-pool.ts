import type { TranscriptionEngine } from '../types';
import { localAiRuntimeRegistry } from '../../../local-ai/runtime-registry';

// Transcription model load + compile is the dominant per-job cost: Parakeet's 1.24 GB
// encoder takes ~20s to compile on WebGPU, and even Whisper re-downloads/re-instantiates
// its pipeline if the worker is recreated each job. Keeping one worker per engine resident
// lets the worker reuse its already-compiled sessions across jobs (each worker early-returns
// on re-init when the model is unchanged). Workers are evicted after a period of inactivity
// so they don't hold model memory forever.

const IDLE_EVICT_MS = 120_000;

const workerFactories = {
	whisper: () =>
		new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' }),
	parakeet: () =>
		new Worker(new URL('../workers/parakeet.worker.ts', import.meta.url), { type: 'module' })
} satisfies Record<TranscriptionEngine, () => Worker>;

const workers: Partial<Record<TranscriptionEngine, Worker>> = {};
const idleTimers: Partial<Record<TranscriptionEngine, ReturnType<typeof setTimeout>>> = {};
const unloadListeners = {
	whisper: new Set<() => void>(),
	parakeet: new Set<() => void>()
} satisfies Record<TranscriptionEngine, Set<() => void>>;

function clearIdleTimer(engine: TranscriptionEngine): void {
	const timer = idleTimers[engine];
	if (timer !== undefined) {
		clearTimeout(timer);
		delete idleTimers[engine];
	}
}

/** Get the shared worker for an engine, creating it and cancelling any pending eviction. */
export function acquireTranscriptionWorker(engine: TranscriptionEngine): Worker {
	clearIdleTimer(engine);
	let worker = workers[engine];
	if (!worker) {
		worker = workerFactories[engine]();
		workers[engine] = worker;
	}
	return worker;
}

/** Mark an engine's worker idle: keep it warm briefly, then evict to free model memory. */
export function releaseTranscriptionWorker(engine: TranscriptionEngine): void {
	if (!workers[engine]) return;
	clearIdleTimer(engine);
	idleTimers[engine] = setTimeout(() => disposeTranscriptionWorker(engine), IDLE_EVICT_MS);
}

/** Notify an active bridge when model memory is explicitly unloaded. */
export function onTranscriptionWorkerUnload(
	engine: TranscriptionEngine,
	listener: () => void
): () => void {
	unloadListeners[engine].add(listener);
	return () => unloadListeners[engine].delete(listener);
}

/** Tear an engine's worker down immediately (errors, cancellation, explicit unload). */
export function disposeTranscriptionWorker(engine: TranscriptionEngine): void {
	clearIdleTimer(engine);
	const worker = workers[engine];
	delete workers[engine];
	for (const listener of [...unloadListeners[engine]]) listener();
	unloadListeners[engine].clear();
	worker?.terminate();
}

export function hasTranscriptionWorker(engine: TranscriptionEngine): boolean {
	return workers[engine] !== undefined;
}

for (const engine of ['whisper', 'parakeet'] as const) {
	localAiRuntimeRegistry.register({
		id: engine,
		label: engine === 'whisper' ? 'Whisper transcription' : 'Parakeet transcription',
		isLoaded: () => hasTranscriptionWorker(engine),
		unload: () => disposeTranscriptionWorker(engine)
	});
}
