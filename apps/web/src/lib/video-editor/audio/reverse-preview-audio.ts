import { SizedAccessedMemoryCache } from '../media/sized-accessed-memory-cache';
import { getSharedPreviewAudioContext } from './preview-audio-graph';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { ensureAc3DecoderForCodec, isAc3AudioCodec } from '$lib/video-editor/media/ac3-decoder';

interface CachedPreviewAudio {
	buffer: AudioBuffer;
	sizeBytes: number;
	lastAccessed: number;
}
interface ReversedAudioWindow extends CachedPreviewAudio {
	sourceLength: number;
	startFrame: number;
	endFrame: number;
}

const decodedCacheByteLimit = 64 * 1024 * 1024;
const reversedCacheByteLimit = 32 * 1024 * 1024;
const decodedByUrl = new SizedAccessedMemoryCache<CachedPreviewAudio>(decodedCacheByteLimit);
const reversedByUrl = new SizedAccessedMemoryCache<ReversedAudioWindow>(reversedCacheByteLimit);
const pendingDecodes = new Map<string, Promise<AudioBuffer>>();

function audioBufferBytes(buffer: AudioBuffer): number {
	return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

function sourceWindowFrames(
	length: number,
	sampleRate: number,
	startSeconds: number,
	endSeconds: number
) {
	const startFrame = Math.max(0, Math.min(length, Math.floor(startSeconds * sampleRate)));
	const endFrame = Math.max(startFrame, Math.min(length, Math.ceil(endSeconds * sampleRate)));
	return { startFrame, endFrame };
}

function cachedReversedWindow(
	key: string,
	startSeconds: number,
	endSeconds: number
): ReversedAudioWindow | null {
	const cached = reversedByUrl.get(key);
	if (!cached) return null;
	const { startFrame, endFrame } = sourceWindowFrames(
		cached.sourceLength,
		cached.buffer.sampleRate,
		startSeconds,
		endSeconds
	);
	return cached.startFrame <= startFrame && cached.endFrame >= endFrame ? cached : null;
}

export function previewAudioContext(): AudioContext {
	const context = getSharedPreviewAudioContext();
	if (!context) throw new Error('Web Audio is unavailable in this browser.');
	return context;
}

async function decodeWithMediabunny(blob: Blob): Promise<AudioBuffer> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Preview source has no audio track.');
		await ensureAc3DecoderForCodec(track.codec);
		const chunks: Float32Array[][] = [];
		let totalFrames = 0;
		let sampleRate = track.sampleRate || 48_000;
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				sampleRate = sample.sampleRate || sampleRate;
				const planes: Float32Array[] = [];
				for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
					const plane = new Float32Array(sample.numberOfFrames);
					sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
					planes.push(plane);
				}
				chunks.push(planes);
				totalFrames += sample.numberOfFrames;
			} finally {
				sample.close();
			}
		}
		const channelCount = Math.max(1, chunks[0]?.length ?? track.numberOfChannels ?? 1);
		const buffer = previewAudioContext().createBuffer(
			channelCount,
			Math.max(1, totalFrames),
			sampleRate
		);
		for (let channel = 0; channel < channelCount; channel += 1) {
			const output = buffer.getChannelData(channel);
			let offset = 0;
			for (const planes of chunks) {
				const plane = planes[channel] ?? planes[0];
				if (plane) output.set(plane, offset);
				offset += plane?.length ?? 0;
			}
		}
		return buffer;
	} finally {
		input.dispose?.();
	}
}

export async function decodedPreviewAudio(url: string, audioCodec?: string): Promise<AudioBuffer> {
	const key = `${audioCodec ?? ''}\u0000${url}`;
	const cached = decodedByUrl.get(key);
	if (cached) return cached.buffer;
	let pending = pendingDecodes.get(key);
	if (!pending) {
		pending = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`Could not read preview audio (${response.status}).`);
				return response.blob();
			})
			.then(async (blob) => {
				if (isAc3AudioCodec(audioCodec)) return decodeWithMediabunny(blob);
				try {
					return await previewAudioContext().decodeAudioData(await blob.arrayBuffer());
				} catch {
					return decodeWithMediabunny(blob);
				}
			})
			.then((buffer) => {
				const sizeBytes = audioBufferBytes(buffer);
				// Oversized active buffers belong to their callers, not the retained cache.
				if (sizeBytes <= decodedCacheByteLimit)
					decodedByUrl.add(key, { buffer, sizeBytes, lastAccessed: Date.now() });
				return buffer;
			})
			.finally(() => pendingDecodes.delete(key));
		pendingDecodes.set(key, pending);
	}
	return pending;
}

/** Reuse a covering trim window, retaining at most 32 MiB of reversed samples. */
export async function reversedPreviewAudio(
	url: string,
	startSeconds: number,
	endSeconds: number,
	audioCodec?: string
): Promise<ReversedAudioWindow> {
	const key = `${audioCodec ?? ''}\u0000${url}`;
	const cached = cachedReversedWindow(key, startSeconds, endSeconds);
	if (cached) return cached;
	const decoded = await decodedPreviewAudio(url, audioCodec);
	// Another clip may have prepared this window while the shared decode was pending.
	const concurrent = cachedReversedWindow(key, startSeconds, endSeconds);
	if (concurrent) return concurrent;
	const { startFrame, endFrame } = sourceWindowFrames(
		decoded.length,
		decoded.sampleRate,
		startSeconds,
		endSeconds
	);
	reversedByUrl.delete(key);
	const buffer = previewAudioContext().createBuffer(
		decoded.numberOfChannels,
		Math.max(1, endFrame - startFrame),
		decoded.sampleRate
	);
	for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
		const source = decoded.getChannelData(channel);
		const target = buffer.getChannelData(channel);
		for (let frame = 0; frame < endFrame - startFrame; frame++) {
			target[frame] = source[endFrame - frame - 1]!;
		}
	}
	const sizeBytes = audioBufferBytes(buffer);
	const window = {
		buffer,
		sourceLength: decoded.length,
		startFrame,
		endFrame,
		sizeBytes,
		lastAccessed: Date.now()
	};
	if (sizeBytes <= reversedCacheByteLimit) reversedByUrl.add(key, window);
	return window;
}
