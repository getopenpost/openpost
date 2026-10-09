import { getSharedPreviewAudioContext } from './preview-audio-graph';
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { ensureAc3DecoderForCodec, isAc3AudioCodec } from '$lib/video-editor/media/ac3-decoder';

const decodedByUrl = new Map<string, Promise<AudioBuffer>>();
interface ReversedAudioWindow {
	buffer: AudioBuffer;
	startFrame: number;
	endFrame: number;
}

const reversedByUrl = new Map<string, ReversedAudioWindow>();
const reversedCacheByteLimit = 32 * 1024 * 1024;
let reversedCacheBytes = 0;

function reversedWindowBytes(window: ReversedAudioWindow): number {
	return window.buffer.length * window.buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

function removeReversedWindow(key: string): void {
	const window = reversedByUrl.get(key);
	if (!window) return;
	reversedCacheBytes -= reversedWindowBytes(window);
	reversedByUrl.delete(key);
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
	let pending = decodedByUrl.get(key);
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
			});
		decodedByUrl.set(key, pending);
		pending.catch(() => decodedByUrl.delete(key));
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
	const decoded = await decodedPreviewAudio(url, audioCodec);
	const startFrame = Math.max(
		0,
		Math.min(decoded.length, Math.floor(startSeconds * decoded.sampleRate))
	);
	const endFrame = Math.max(
		startFrame,
		Math.min(decoded.length, Math.ceil(endSeconds * decoded.sampleRate))
	);
	const cached = reversedByUrl.get(key);
	if (cached && cached.startFrame <= startFrame && cached.endFrame >= endFrame) {
		// Refresh insertion order so eviction removes the least recently used source.
		reversedByUrl.delete(key);
		reversedByUrl.set(key, cached);
		return cached;
	}
	removeReversedWindow(key);
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
	const window = { buffer, startFrame, endFrame };
	const bytes = reversedWindowBytes(window);
	if (bytes <= reversedCacheByteLimit) {
		while (reversedCacheBytes + bytes > reversedCacheByteLimit) {
			const oldest = reversedByUrl.keys().next().value;
			if (oldest === undefined) break;
			removeReversedWindow(oldest);
		}
		reversedByUrl.set(key, window);
		reversedCacheBytes += bytes;
	}
	return window;
}
