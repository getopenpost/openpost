/**
 * Progressive waveform decoder adapted from FreeCut (MIT).
 *
 * The worker emits fixed-size peak chunks while decoding so long recordings
 * become visible before the full source has finished. Requests carry stable
 * ids and can be aborted without letting stale results reach a newer decode.
 */

import { Input, AudioSampleSink, ALL_FORMATS, BlobSource } from 'mediabunny';
import { ensureAc3DecoderForCodec } from './ac3-decoder';

export interface WaveformGenerateRequest {
	type: 'generate';
	requestId: string;
	file: File;
	samplesPerSecond: number;
	binDurationSeconds?: number;
	trackIndex?: number;
}

export interface WaveformAbortRequest {
	type: 'abort';
	requestId: string;
}

export type WaveformWorkerRequest = WaveformGenerateRequest | WaveformAbortRequest;

export interface WaveformInitMessage {
	type: 'init';
	requestId: string;
	durationSeconds: number;
	totalSamples: number;
}

export interface WaveformChunkMessage {
	type: 'chunk';
	requestId: string;
	startIndex: number;
	peaks: Float32Array;
}

export interface WaveformCompleteMessage {
	type: 'complete';
	requestId: string;
	maxPeak: number;
}

export interface WaveformProgressMessage {
	type: 'progress';
	requestId: string;
	progress: number;
}

export interface WaveformErrorMessage {
	type: 'error';
	requestId: string;
	message: string;
}

export type WaveformWorkerResponse =
	| WaveformInitMessage
	| WaveformChunkMessage
	| WaveformCompleteMessage
	| WaveformProgressMessage
	| WaveformErrorMessage;

const activeRequests = new Map<string, { aborted: boolean }>();

function progress(requestId: string, value: number): void {
	const message: WaveformProgressMessage = {
		type: 'progress',
		requestId,
		progress: value
	};
	self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WaveformWorkerRequest>): Promise<void> => {
	if (event.data.type === 'abort') {
		const active = activeRequests.get(event.data.requestId);
		if (active) active.aborted = true;
		return;
	}

	const { requestId, file, samplesPerSecond, binDurationSeconds = 30, trackIndex } = event.data;
	const state = { aborted: false };
	activeRequests.set(requestId, state);
	let input: Input | null = null;

	try {
		progress(requestId, 0.02);
		input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const audioTracks = await input.getAudioTracks();
		const audioTrack =
			trackIndex === undefined ? await input.getPrimaryAudioTrack() : audioTracks[trackIndex];
		if (!audioTrack) throw new Error('No audio track found');
		await ensureAc3DecoderForCodec(audioTrack.codec);
		if (state.aborted) throw new DOMException('Waveform decoding cancelled', 'AbortError');

		const durationSeconds = await audioTrack.computeDuration();
		const totalSamples = Math.max(1, Math.ceil(durationSeconds * samplesPerSecond));
		const peaks = new Float32Array(totalSamples);
		const chunkSize = Math.max(1, Math.round(samplesPerSecond * binDurationSeconds));
		const fallbackSampleRate = audioTrack.sampleRate > 0 ? audioTrack.sampleRate : 48_000;
		const sink = new AudioSampleSink(audioTrack);
		let processedEndSeconds = 0;
		let nextChunkStart = 0;
		let maxPeak = 0;
		let lastProgress = 0.1;

		const init: WaveformInitMessage = {
			type: 'init',
			requestId,
			durationSeconds,
			totalSamples
		};
		self.postMessage(init);
		progress(requestId, 0.1);

		const emitChunk = (startIndex: number, endIndex: number): void => {
			if (endIndex <= startIndex) return;
			const chunk = peaks.slice(startIndex, endIndex);
			const message: WaveformChunkMessage = {
				type: 'chunk',
				requestId,
				startIndex,
				peaks: chunk
			};
			self.postMessage(message, { transfer: [chunk.buffer] });
		};

		for await (const sample of sink.samples()) {
			try {
				if (state.aborted) {
					throw new DOMException('Waveform decoding cancelled', 'AbortError');
				}
				const frameCount = sample.numberOfFrames;
				const channelCount = Math.max(1, sample.numberOfChannels);
				const sampleRate = sample.sampleRate > 0 ? sample.sampleRate : fallbackSampleRate;
				const sampleStart = Number.isFinite(sample.timestamp)
					? Math.max(0, sample.timestamp)
					: processedEndSeconds;
				const channel = new Float32Array(frameCount);

				for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
					sample.copyTo(channel, {
						planeIndex: channelIndex,
						format: 'f32-planar'
					});
					for (let frame = 0; frame < frameCount; frame += 1) {
						const outputIndex = Math.min(
							totalSamples - 1,
							Math.floor((sampleStart + frame / sampleRate) * samplesPerSecond)
						);
						const peak = Math.abs(channel[frame] ?? 0);
						if (peak > (peaks[outputIndex] ?? 0)) peaks[outputIndex] = peak;
						if (peak > maxPeak) maxPeak = peak;
					}
				}

				processedEndSeconds = Math.max(
					processedEndSeconds,
					sampleStart + (sample.duration > 0 ? sample.duration : frameCount / sampleRate)
				);
				const completedSamples = Math.min(
					totalSamples,
					Math.floor(processedEndSeconds * samplesPerSecond)
				);
				while (nextChunkStart + chunkSize <= completedSamples) {
					const endIndex = nextChunkStart + chunkSize;
					emitChunk(nextChunkStart, endIndex);
					nextChunkStart = endIndex;
				}
				const nextProgress =
					0.1 + Math.min(0.85, (processedEndSeconds / Math.max(durationSeconds, 0.001)) * 0.85);
				if (nextProgress - lastProgress >= 0.01) {
					lastProgress = nextProgress;
					progress(requestId, nextProgress);
				}
			} finally {
				sample.close();
			}
		}

		if (state.aborted) throw new DOMException('Waveform decoding cancelled', 'AbortError');
		if (nextChunkStart < totalSamples) emitChunk(nextChunkStart, totalSamples);
		progress(requestId, 1);
		const complete: WaveformCompleteMessage = {
			type: 'complete',
			requestId,
			maxPeak
		};
		self.postMessage(complete);
	} catch (error) {
		if (!(error instanceof Error && error.name === 'AbortError')) {
			const message: WaveformErrorMessage = {
				type: 'error',
				requestId,
				message: error instanceof Error ? error.message : 'Waveform decoding failed'
			};
			self.postMessage(message);
		}
	} finally {
		input?.dispose();
		activeRequests.delete(requestId);
	}
};
