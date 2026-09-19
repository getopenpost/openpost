import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { ensureAc3DecoderForCodec } from '../media/ac3-decoder';

function abortError(): DOMException {
	return new DOMException('Silence analysis cancelled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError();
}

/** Decode a source-time range with channels and timestamp gaps intact for analysis. */
export async function decodeAudioBlobRangeForAnalysis(
	blob: Blob,
	startSeconds = 0,
	endSeconds = Number.POSITIVE_INFINITY,
	signal?: AbortSignal,
	audioTrackIndex?: number
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	throwIfAborted(signal);
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(blob)
	});
	try {
		const track =
			audioTrackIndex === undefined
				? await input.getPrimaryAudioTrack()
				: (await input.getAudioTracks())[audioTrackIndex];
		if (!track) throw new Error('No audio track');
		return await decodeTrackRange(track, startSeconds, endSeconds, signal);
	} finally {
		input.dispose?.();
	}
}

const ANALYSIS_CHUNK_SECONDS = 16;

/** Decode bounded chunks while keeping one container open. Offsets are source time. */
export async function* decodeAudioChunksForAnalysis(blob: Blob, audioTrackIndex?: number) {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track =
			audioTrackIndex === undefined
				? await input.getPrimaryAudioTrack()
				: (await input.getAudioTracks())[audioTrackIndex];
		if (!track) throw new Error('No audio track');
		const duration = await track.computeDuration();
		for (let start = 0; start < duration; start += ANALYSIS_CHUNK_SECONDS) {
			const end = Math.min(duration, start + ANALYSIS_CHUNK_SECONDS);
			yield { audio: await decodeTrackRange(track, start, end), start, duration };
		}
	} finally {
		input.dispose();
	}
}

async function decodeTrackRange(
	track: InputAudioTrack,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<import('./audio-silence').AudioBufferLike> {
	await ensureAc3DecoderForCodec(track.codec);
	const duration = await track.computeDuration();
	const start = Math.min(duration, Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0));
	const requestedEnd = Number.isFinite(endSeconds) ? endSeconds : duration;
	const end = Math.min(duration, Math.max(start, requestedEnd));
	const sink = new AudioSampleSink(track);
	let totalFrames = 0;
	let sampleRate = track.sampleRate || 48_000;
	const chunks: Array<{ offset: number; planes: Float32Array[] }> = [];
	let channelCount = track.numberOfChannels || 1;
	for await (const sample of sink.samples(start, end)) {
		try {
			throwIfAborted(signal);
			if (chunks.length > 0 && sample.sampleRate !== sampleRate) {
				throw new Error('Audio sample rate changed during range decoding');
			}
			sampleRate = sample.sampleRate;
			const sampleEnd = sample.timestamp + sample.duration;
			const overlapStart = Math.max(start, sample.timestamp);
			const overlapEnd = Math.min(end, sampleEnd);
			const frameOffset = Math.max(
				0,
				Math.min(
					sample.numberOfFrames,
					Math.ceil((overlapStart - sample.timestamp) * sampleRate - 1e-7)
				)
			);
			const frameEnd = Math.max(
				frameOffset,
				Math.min(
					sample.numberOfFrames,
					Math.ceil((overlapEnd - sample.timestamp) * sampleRate - 1e-7)
				)
			);
			const frames = frameEnd - frameOffset;
			if (frames === 0) continue;
			channelCount = sample.numberOfChannels;
			const planes: Float32Array[] = [];
			for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
				const plane = new Float32Array(frames);
				sample.copyTo(plane, {
					format: 'f32-planar',
					planeIndex: channel,
					frameOffset,
					frameCount: frames
				});
				planes.push(plane);
			}
			const offset = Math.max(0, Math.round((overlapStart - start) * sampleRate));
			chunks.push({ offset, planes });
			totalFrames = Math.max(totalFrames, offset + frames);
		} finally {
			sample.close();
		}
	}
	throwIfAborted(signal);
	const length = Math.max(totalFrames, Math.round((end - start) * sampleRate));
	const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
	for (const chunk of chunks) {
		chunk.planes.forEach((plane, index) => channels[index]?.set(plane, chunk.offset));
	}
	return {
		duration: length / sampleRate,
		length,
		numberOfChannels: channels.length,
		sampleRate,
		getChannelData: (index) => channels[index]!
	};
}
