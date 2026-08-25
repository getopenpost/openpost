/**
 * Bounded audio mixdown for long timelines and long source files.
 *
 * Decodes only the source windows needed for active MixEntries, processes
 * speed/pitch/EQ/reverse/gain/transition in fixed-size chunks, and mixes
 * overlapping entries into stereo 48 kHz chunks without ever allocating the
 * full timeline buffer.
 */

import { processAudioChannels } from './process-audio';
import { transitionGainAtProgress } from './transition-crossfade';
import type { MixEntry, GainPoint } from '../media/render-plan';

export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;
export const BOUNDED_AUDIO_CHUNK_FRAMES = 48_000; // 1 second
export const BOUNDED_AUDIO_FAST_PATH_MAX_FRAMES = 48_000 * 30; // 30 sec
export const BOUNDED_AUDIO_FAST_PATH_MAX_BYTES =
	BOUNDED_AUDIO_FAST_PATH_MAX_FRAMES * MIX_CHANNELS * 4;

export interface DecodedWindow {
	channels: Float32Array[];
	sampleRate: number;
}

export type DecodeWindowFn = (
	mediaId: string,
	startSeconds: number,
	durationSeconds: number
) => Promise<DecodedWindow | null>;

// Instrumentation for tests
let _peakBufferedFrames = 0;
let _currentBufferedFrames = 0;
let _peakBufferedBytes = 0;
let _currentBufferedBytes = 0;
let _totalDecodedFrames = 0;
let _totalOutputFrames = 0;

export function getPeakBufferedFrames(): number {
	return _peakBufferedFrames;
}
export function getPeakBufferedBytes(): number {
	return _peakBufferedBytes;
}
export function getTotalDecodedFrames(): number {
	return _totalDecodedFrames;
}
export function getTotalOutputFrames(): number {
	return _totalOutputFrames;
}
export function resetPeakBuffered(): void {
	_peakBufferedFrames = 0;
	_currentBufferedFrames = 0;
	_peakBufferedBytes = 0;
	_currentBufferedBytes = 0;
	_totalDecodedFrames = 0;
	_totalOutputFrames = 0;
}
function trackAlloc(frames: number): void {
	_currentBufferedFrames += frames;
	_peakBufferedFrames = Math.max(_peakBufferedFrames, _currentBufferedFrames);
	_currentBufferedBytes += frames * 4;
	_peakBufferedBytes = Math.max(_peakBufferedBytes, _currentBufferedBytes);
}
function trackFree(frames: number): void {
	_currentBufferedFrames -= frames;
	_currentBufferedBytes -= frames * 4;
	if (_currentBufferedFrames < 0) _currentBufferedFrames = 0;
	if (_currentBufferedBytes < 0) _currentBufferedBytes = 0;
}
function allocFloat32(size: number): Float32Array {
	trackAlloc(size);
	return new Float32Array(size);
}
function freeFloat32(arr: Float32Array | null | undefined): void {
	if (!arr) return;
	trackFree(arr.length);
}

function gainAtTime(points: readonly GainPoint[], time: number): number {
	if (points.length === 0) return 1;
	const sorted = [...points].sort((a, b) => a.whenSeconds - b.whenSeconds);
	if (time <= sorted[0]!.whenSeconds) return Math.max(0, sorted[0]!.value);
	for (let i = 1; i < sorted.length; i++) {
		const right = sorted[i]!;
		if (time > right.whenSeconds) continue;
		const left = sorted[i - 1]!;
		const duration = right.whenSeconds - left.whenSeconds;
		if (duration <= 0) return Math.max(0, right.value);
		const progress = (time - left.whenSeconds) / duration;
		const v = left.value + (right.value - left.value) * progress;
		return Math.max(0, v);
	}
	return Math.max(0, sorted[sorted.length - 1]!.value);
}

function transitionGainAtTime(
	spans: readonly {
		startSeconds: number;
		durationSeconds: number;
		isIncoming: boolean;
		dipToSilence: boolean;
	}[],
	time: number
): number {
	let gain = 1;
	for (const span of spans) {
		if (time < span.startSeconds || time >= span.startSeconds + span.durationSeconds) continue;
		const progress =
			span.durationSeconds > 0 ? (time - span.startSeconds) / span.durationSeconds : 1;
		gain *= transitionGainAtProgress(progress, span.isIncoming, span.dipToSilence);
		if (gain === 0) return 0;
	}
	return Math.max(0, gain);
}

// Per-entry persistent state for SoundTouch continuity (speed/pitch)
interface EntryAudioState {
	playbackRate: number;
	pitchSemitones: number;
	sampleRate: number;
}
const entryAudioStates = new Map<string, EntryAudioState>();

export interface BoundedMixOptions {
	signal?: AbortSignal;
	onProgress?: (framesDone: number, totalFrames: number) => void;
	chunkFrames?: number;
}

export async function mixBoundedAudioToChunks(
	entries: readonly MixEntry[],
	durationSeconds: number,
	decodeWindow: DecodeWindowFn,
	sink: {
		addChunk(channels: Float32Array[], startFrame: number): Promise<void>;
		close(): Promise<void>;
	},
	options: BoundedMixOptions = {}
): Promise<void> {
	const totalFrames = Math.max(0, Math.ceil(durationSeconds * MIX_SAMPLE_RATE));
	if (entries.length === 0 || totalFrames === 0) {
		await sink.close();
		return;
	}
	const chunkFrames = options.chunkFrames ?? BOUNDED_AUDIO_CHUNK_FRAMES;
	const signal = options.signal;
	function throwIfAborted(): void {
		if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
	}
	let framesDone = 0;
	let chunkStart = 0;
	let closed = false;
	let hasReadable = false;
	const closeOnce = async (isError: boolean): Promise<void> => {
		if (closed) return;
		closed = true;
		if (isError) return;
		await sink.close();
	};
	// Clear per-entry state at start of new mix
	entryAudioStates.clear();
	try {
		while (chunkStart < totalFrames) {
			throwIfAborted();
			const chunkEnd = Math.min(totalFrames, chunkStart + chunkFrames);
			const chunkSize = chunkEnd - chunkStart;
			const chunkStartSec = chunkStart / MIX_SAMPLE_RATE;
			const chunkEndSec = chunkEnd / MIX_SAMPLE_RATE;
			const mixL = allocFloat32(chunkSize);
			const mixR = allocFloat32(chunkSize);
			try {
				for (const entry of entries) {
					throwIfAborted();
					const entryStart = entry.whenSeconds;
					const entryEnd = entry.whenSeconds + entry.durationSeconds;
					const overlapStart = Math.max(chunkStartSec, entryStart);
					const overlapEnd = Math.min(chunkEndSec, entryEnd);
					if (overlapEnd <= overlapStart) continue;
					const overlapDuration = overlapEnd - overlapStart;
					const offsetInEntry = overlapStart - entryStart;
					const playbackRate = entry.playbackRate;
					let sourceStart: number;
					let sourceDuration: number;
					const reversed = entry.reversed;
					if (reversed) {
						const sourceEnd = entry.sourceOffsetSeconds;
						const sliceEnd = sourceEnd - offsetInEntry * playbackRate;
						const sliceStart = sliceEnd - overlapDuration * playbackRate;
						sourceStart = sliceStart;
						sourceDuration = overlapDuration * playbackRate;
					} else {
						sourceStart = entry.sourceOffsetSeconds + offsetInEntry * playbackRate;
						sourceDuration = overlapDuration * playbackRate;
					}
					let padLeftFrames = 0;
					if (sourceStart < 0) {
						padLeftFrames = Math.round(-sourceStart * MIX_SAMPLE_RATE);
						sourceDuration += sourceStart;
						sourceStart = 0;
					}
					if (sourceDuration <= 0) continue;
					const decoded = await decodeWindow(entry.mediaId, sourceStart, sourceDuration);
					if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
					if (
						!decoded ||
						decoded.channels.length === 0 ||
						(decoded.channels[0]?.length ?? 0) === 0
					) {
						continue;
					}
					hasReadable = true;
					const decodedFrames = decoded.channels[0]?.length ?? 0;
					_totalDecodedFrames += decodedFrames;
					// Take ownership of decoded channels (they are already allocated, count them)
					// eslint-disable-next-line prefer-const -- reassigned for reversed/resampled
					let channels: Float32Array[] = decoded.channels;
					let sampleRate = decoded.sampleRate;
					// Track decoded allocation
					const decodedAlloc = channels.reduce((s, c) => s + c.length, 0);
					trackAlloc(decodedAlloc);
					let processed: Float32Array[] = channels;
					let processedOwned = false;
					try {
						if (reversed) {
							const rev: Float32Array[] = [];
							for (const ch of channels) {
								const r = allocFloat32(ch.length);
								for (let i = 0; i < ch.length; i++) r[i] = ch[ch.length - 1 - i] ?? 0;
								rev.push(r);
							}
							for (const ch of channels) freeFloat32(ch);
							trackFree(decodedAlloc);
							processed = rev;
							processedOwned = true;
							trackAlloc(rev.reduce((s, c) => s + c.length, 0));
						}
						if (sampleRate !== MIX_SAMPLE_RATE) {
							const ratio = sampleRate / MIX_SAMPLE_RATE;
							const expectedFrames = Math.max(1, Math.round((processed[0]?.length ?? 0) / ratio));
							const resampled: Float32Array[] = [];
							for (const ch of processed) {
								const dst = allocFloat32(expectedFrames);
								for (let i = 0; i < expectedFrames; i++) {
									const srcPos = i * ratio;
									const idx = Math.floor(srcPos);
									const frac = srcPos - idx;
									const a = ch[idx] ?? 0;
									const b = ch[Math.min(ch.length - 1, idx + 1)] ?? 0;
									dst[i] = a + (b - a) * frac;
								}
								resampled.push(dst);
							}
							for (const ch of processed) freeFloat32(ch);
							if (processed === channels) trackFree(decodedAlloc);
							processed = resampled;
							processedOwned = true;
							sampleRate = MIX_SAMPLE_RATE;
						}
						const needsProcessing =
							Math.abs(playbackRate - 1) > 0.0001 ||
							Math.abs(entry.pitchShiftSemitones) > 0.0001 ||
							(entry.audioEqStages && entry.audioEqStages.length > 0);
						if (needsProcessing) {
							const before = processed.reduce((s, c) => s + c.length, 0);
							// processAudioChannels internally allocates new arrays; we track before/after
							const out = await processAudioChannels(processed, {
								speed: playbackRate,
								pitchShiftSemitones: entry.pitchShiftSemitones,
								sampleRate,
								eqStages: entry.audioEqStages
							});
							// Free input
							for (const ch of processed) freeFloat32(ch);
							if (!processedOwned) trackFree(before);
							processed = out;
							processedOwned = true;
							trackAlloc(processed.reduce((s, c) => s + c.length, 0));
							const expected = Math.round(overlapDuration * MIX_SAMPLE_RATE);
							if (processed[0] && processed[0].length !== expected) {
								const fixed: Float32Array[] = [];
								for (const ch of processed) {
									if (ch.length === expected) {
										fixed.push(ch);
									} else if (ch.length > expected) {
										const out2 = allocFloat32(expected);
										out2.set(ch.subarray(0, expected));
										freeFloat32(ch);
										trackFree(ch.length);
										fixed.push(out2);
									} else {
										const out2 = allocFloat32(expected);
										out2.set(ch);
										freeFloat32(ch);
										trackFree(ch.length);
										fixed.push(out2);
									}
								}
								processed = fixed;
							}
						} else if (!processedOwned) {
							processedOwned = true;
						}
						const outFrames = processed[0]?.length ?? 0;
						if (outFrames === 0) {
							for (const ch of processed) freeFloat32(ch);
							continue;
						}
						for (let i = 0; i < Math.min(outFrames, chunkSize); i++) {
							const timelineTime = overlapStart + i / MIX_SAMPLE_RATE;
							const baseGain = gainAtTime(entry.gainPoints, timelineTime);
							const transGain = transitionGainAtTime(entry.transitionGainSpans, timelineTime);
							const gain = baseGain * transGain;
							if (gain === 0) continue;
							const mixIndex = Math.round((timelineTime - chunkStartSec) * MIX_SAMPLE_RATE);
							if (mixIndex < 0 || mixIndex >= chunkSize) continue;
							let srcIndex = i;
							if (padLeftFrames > 0) {
								if (i < padLeftFrames) continue;
								srcIndex = i - padLeftFrames;
								if (srcIndex < 0 || srcIndex >= outFrames) continue;
							}
							const left = processed[0]?.[srcIndex] ?? 0;
							const right = processed[1]?.[srcIndex] ?? processed[0]?.[srcIndex] ?? 0;
							mixL[mixIndex] = (mixL[mixIndex] ?? 0) + left * gain;
							mixR[mixIndex] = (mixR[mixIndex] ?? 0) + right * gain;
						}
						for (const ch of processed) freeFloat32(ch);
					} catch (inner) {
						for (const ch of processed) {
							try {
								freeFloat32(ch);
							} catch (_error) {
								// Ignore free errors; buffer may already be freed
							}
						}
						throw inner;
					}
				}
				_totalOutputFrames += chunkSize;
				await sink.addChunk([mixL, mixR], chunkStart);
			} finally {
				freeFloat32(mixL);
				freeFloat32(mixR);
			}
			framesDone = chunkEnd;
			options.onProgress?.(framesDone, totalFrames);
			chunkStart = chunkEnd;
		}
		if (!hasReadable && entries.length > 0) {
			throw new Error('The audio mix is empty.');
		}
		await closeOnce(false);
	} catch (error) {
		await closeOnce(true);
		throw error;
	}
}

export async function streamMixdownToAudioSource(
	entries: readonly MixEntry[],
	durationSeconds: number,
	decodeWindow: DecodeWindowFn,
	audioSource: { add: (sample: import('mediabunny').AudioSample) => Promise<void>; close(): void },
	signal?: AbortSignal,
	onProgress?: (done: number, total: number) => void
): Promise<void> {
	const totalFrames = Math.max(0, Math.ceil(durationSeconds * MIX_SAMPLE_RATE));
	let framesFed = 0;
	let addClosed = false;
	const wrappedSink = {
		async addChunk(channels: Float32Array[], startFrame: number) {
			if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
			const frameCount = channels[0]?.length ?? 0;
			if (frameCount === 0) return;
			const planar = allocFloat32(frameCount * MIX_CHANNELS);
			try {
				for (let c = 0; c < MIX_CHANNELS; c++) {
					const ch = channels[c] ?? channels[0];
					if (!ch) continue;
					planar.set(ch, c * frameCount);
				}
				const { AudioSample } = await import('mediabunny');
				const sample = new AudioSample({
					data: planar,
					format: 'f32-planar',
					numberOfChannels: MIX_CHANNELS,
					sampleRate: MIX_SAMPLE_RATE,
					timestamp: startFrame / MIX_SAMPLE_RATE
				});
				try {
					if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
					await audioSource.add(sample);
					framesFed += frameCount;
					onProgress?.(framesFed, totalFrames);
				} finally {
					sample.close();
				}
			} finally {
				freeFloat32(planar);
			}
		},
		async close() {
			if (addClosed) return;
			addClosed = true;
			audioSource.close();
		}
	};
	try {
		await mixBoundedAudioToChunks(entries, durationSeconds, decodeWindow, wrappedSink, {
			signal,
			onProgress,
			chunkFrames: BOUNDED_AUDIO_CHUNK_FRAMES
		});
	} catch (error) {
		try {
			audioSource.close();
		} catch (_error) {
			// Ignore close errors during cancellation
		}
		throw error;
	}
}
