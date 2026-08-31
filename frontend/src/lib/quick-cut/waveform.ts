import { SizedAccessedMemoryCache } from '$lib/video-editor/media/sized-accessed-memory-cache';
import type { WaveformData } from '$lib/video-editor/media/waveform-client';
import type { WaveformWorkerResponse } from '$lib/video-editor/media/waveform-worker';
import { resolveSourceFile } from './source';
import type { QuickCutSource } from './types';

interface CacheEntry {
	data: WaveformData;
	sizeBytes: number;
	lastAccessed: number;
}

const WAVEFORM_CACHE_BYTES = 64 * 1024 * 1024;
const SAMPLES_PER_SECOND = 320;
const cache = new SizedAccessedMemoryCache<CacheEntry>(WAVEFORM_CACHE_BYTES);
const inflight = new Map<string, Promise<WaveformData>>();
const subscribers = new Map<string, Set<(data: WaveformData) => void>>();

type QuickCutWaveformIdentity = Pick<
	QuickCutSource,
	| 'id'
	| 'size'
	| 'lastModified'
	| 'contentFingerprint'
	| 'audioStreams'
	| 'selectedAudioTrackIndices'
>;

export function quickCutWaveformKey(source: QuickCutWaveformIdentity): string {
	const fingerprint =
		source.contentFingerprint ?? `${source.size}:${source.lastModified ?? 'unknown'}`;
	const audioTrack =
		source.selectedAudioTrackIndices?.[0] ?? source.audioStreams[0]?.index ?? 'none';
	return `${source.id}:${fingerprint}:${audioTrack}`;
}

function publish(key: string, data: WaveformData): void {
	cache.add(key, { data, sizeBytes: data.peaks.byteLength, lastAccessed: Date.now() });
	for (const subscriber of subscribers.get(key) ?? []) subscriber(data);
}

export function subscribeQuickCutWaveform(
	source: QuickCutSource,
	subscriber: (data: WaveformData) => void
): () => void {
	const key = quickCutWaveformKey(source);
	const callbacks = subscribers.get(key) ?? new Set<(data: WaveformData) => void>();
	callbacks.add(subscriber);
	subscribers.set(key, callbacks);
	const cached = cache.get(key)?.data;
	if (cached) subscriber(cached);
	return () => {
		callbacks.delete(subscriber);
		if (callbacks.size === 0) subscribers.delete(key);
	};
}

export async function getQuickCutWaveform(source: QuickCutSource): Promise<WaveformData> {
	const key = quickCutWaveformKey(source);
	const existing = cache.get(key)?.data;
	if (existing?.isComplete) return existing;
	const pending = inflight.get(key);
	if (pending) return pending;
	const promise = decodeQuickCutWaveform(source, key);
	inflight.set(key, promise);
	const clearInflight = () => {
		if (inflight.get(key) === promise) inflight.delete(key);
	};
	void promise.then(clearInflight, clearInflight);
	return promise;
}

async function decodeQuickCutWaveform(source: QuickCutSource, key: string): Promise<WaveformData> {
	const file = await resolveSourceFile(source);
	const worker = new Worker(new URL('../video-editor/media/waveform-worker.ts', import.meta.url), {
		type: 'module'
	});
	const requestId = `quick-cut-waveform-${crypto.randomUUID()}`;
	return new Promise<WaveformData>((resolve, reject) => {
		let data: WaveformData | null = null;
		worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
			const message = event.data;
			if (message.requestId !== requestId) return;
			if (message.type === 'init') {
				data = {
					peaks: new Float32Array(message.totalSamples),
					durationSeconds: message.durationSeconds,
					samplesPerSecond: SAMPLES_PER_SECOND,
					loadedSamples: 0,
					isComplete: false
				};
				publish(key, data);
				return;
			}
			if (message.type === 'chunk') {
				if (!data) return;
				data.peaks.set(message.peaks, message.startIndex);
				data = {
					...data,
					loadedSamples: Math.max(data.loadedSamples, message.startIndex + message.peaks.length)
				};
				publish(key, data);
				return;
			}
			if (message.type === 'complete') {
				if (!data) {
					reject(new Error('Waveform decoding completed without samples.'));
					worker.terminate();
					return;
				}
				data = { ...data, loadedSamples: data.peaks.length, isComplete: true };
				publish(key, data);
				resolve(data);
				worker.terminate();
				return;
			}
			if (message.type === 'error') {
				reject(new Error(message.message || 'Waveform decoding failed.'));
				worker.terminate();
			}
		};
		worker.onerror = (event) => {
			reject(new Error(event.message || 'Waveform worker failed.'));
			worker.terminate();
		};
		worker.postMessage({
			type: 'generate',
			requestId,
			file,
			samplesPerSecond: SAMPLES_PER_SECOND,
			trackIndex: source.selectedAudioTrackIndices?.[0] ?? source.audioStreams[0]?.index
		});
	});
}

export function sampleWaveformColumns(
	data: WaveformData,
	width: number,
	startSeconds: number,
	endSeconds: number
): Float32Array {
	const columnCount = Math.max(1, Math.round(width));
	const values = new Float32Array(columnCount);
	const availableSamples = Math.min(data.loadedSamples, data.peaks.length);
	const sourceStart = Math.max(0, Math.floor(startSeconds * data.samplesPerSecond));
	const sourceEnd = Math.min(
		data.peaks.length,
		Math.ceil(Math.max(startSeconds, endSeconds) * data.samplesPerSecond)
	);
	const sourceSamples = sourceEnd - sourceStart;
	if (sourceSamples <= 0) return values;

	for (let column = 0; column < columnCount; column += 1) {
		const start = sourceStart + Math.floor((column / columnCount) * sourceSamples);
		const end = Math.max(
			start + 1,
			sourceStart + Math.ceil(((column + 1) / columnCount) * sourceSamples)
		);
		if (start >= availableSamples) continue;
		let peak = 0;
		for (let sample = start; sample < Math.min(end, availableSamples); sample += 1) {
			peak = Math.max(peak, data.peaks[sample] ?? 0);
		}
		values[column] = peak;
	}
	return values;
}
