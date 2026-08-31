import { applyAudioEqStages } from './audio-eq';
import { applyAudioEffectStages } from './audio-effects';
import type { AudioEffect } from './audio-effects';
import {
	applyNoiseReduction,
	applyNoiseReductionSync,
	type ResolvedAudioNoiseReductionSettings
} from './audio-noise-reduction';
import { getAudioPitchRatioFromSemitones, isAudioPitchShiftActive } from './audio-pitch';
import type { ResolvedAudioEqSettings } from './types';

export interface AudioProcessOptions {
	speed: number;
	pitchShiftSemitones: number;
	sampleRate: number;
	eqStages?: ReadonlyArray<ResolvedAudioEqSettings>;
	audioEffects?: AudioEffect[];
	noiseReduction?: ResolvedAudioNoiseReductionSettings;
	signal?: AbortSignal;
}

/**
 * Clip stage order: noise reduction -> retime (tempo/pitch) -> clip EQ/effects.
 * Track/bus EQ and sidechain duck gain run after this in the mixer.
 * Rebase seam: this branch predates the integrated audio rack/ducking work;
 * keep both clip noiseReduction and ducking fields and preserve the order above.
 * Sharing the overlap search keeps left and right in phase.
 */
export async function processAudioChannels(
	channels: Float32Array[],
	options: AudioProcessOptions
): Promise<Float32Array[]> {
	const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
	let processed = channels;
	// Noise reduction before time-stretch preserves temporal characteristics.
	if (options.noiseReduction) {
		const total = processed[0]?.length ?? 0;
		// Use cooperative async for long clips to keep UI responsive; sync fallback for short
		if (total > 48000 * 60 * 2) {
			processed = await applyNoiseReduction(
				processed,
				options.sampleRate,
				options.noiseReduction,
				options.signal
			);
		} else {
			processed = applyNoiseReductionSync(
				processed,
				options.sampleRate,
				options.noiseReduction,
				options.signal
			);
		}
	}
	if (
		processed.length > 0 &&
		(processed[0]?.length ?? 0) > 0 &&
		(Math.abs(speed - 1) > 0.0001 || isAudioPitchShiftActive(options.pitchShiftSemitones))
	) {
		processed = await timeStretchChannels(
			processed,
			speed,
			getAudioPitchRatioFromSemitones(options.pitchShiftSemitones)
		);
	}
	const eqProcessed = applyAudioEqStages(processed, options.sampleRate, options.eqStages);
	return applyAudioEffectStages(eqProcessed, options.sampleRate, options.audioEffects);
}

async function timeStretchChannels(
	channels: Float32Array[],
	tempo: number,
	pitchRatio: number
): Promise<Float32Array[]> {
	const { TimeStretchFilter, TimeStretchProcessor } = await import('./time-stretch');
	const channelCount = channels.length;
	const inputFrames = channels[0]?.length ?? 0;
	const left = channels[0]!;
	const right = channels[1] ?? left;

	const processor = new TimeStretchProcessor();
	processor.tempo = tempo;
	processor.pitch = pitchRatio;
	processor.rate = 1;
	let inputOffsetFrames = 0;
	const source = {
		extract(target: Float32Array, requestedFrames: number): number {
			const availableFrames = inputFrames - inputOffsetFrames;
			const frames = Math.min(requestedFrames, availableFrames);
			for (let frame = 0; frame < frames; frame++) {
				const sourceFrame = inputOffsetFrames + frame;
				target[frame * 2] = left[sourceFrame] ?? 0;
				target[frame * 2 + 1] = right[sourceFrame] ?? 0;
			}
			inputOffsetFrames += frames;
			// SoundTouch consumes fixed 16,384-frame input windows. A silent tail
			// flushes its overlap buffers instead of dropping the final window.
			return requestedFrames;
		}
	};
	const filter = new TimeStretchFilter(source, processor);
	const expectedFrames = Math.max(1, Math.floor(inputFrames / tempo));
	const outputs = Array.from({ length: channelCount }, () => new Float32Array(expectedFrames));
	const chunkFrames = 4096;
	const chunk = new Float32Array(chunkFrames * 2);
	let outputFrames = 0;
	while (outputFrames < expectedFrames) {
		const frames = filter.extract(chunk, Math.min(chunkFrames, expectedFrames - outputFrames));
		if (frames <= 0) break;
		for (let frame = 0; frame < frames; frame++) {
			const outputFrame = outputFrames + frame;
			outputs[0]![outputFrame] = chunk[frame * 2] ?? 0;
			if (channelCount > 1) outputs[1]![outputFrame] = chunk[frame * 2 + 1] ?? 0;
			for (let channel = 2; channel < channelCount; channel++) {
				outputs[channel]![outputFrame] = chunk[frame * 2] ?? 0;
			}
		}
		outputFrames += frames;
	}
	return outputFrames === expectedFrames
		? outputs
		: outputs.map((channel) => channel.slice(0, outputFrames));
}

interface QueuedInterleavedChunk {
	samples: Float32Array;
	frameOffset: number;
}

class StreamingStereoSource {
	private readonly chunks: QueuedInterleavedChunk[] = [];
	private final = false;

	push(channels: Float32Array[]): number {
		const frames = channels[0]?.length ?? 0;
		if (frames === 0) return 0;
		const left = channels[0]!;
		const right = channels[1] ?? left;
		const samples = new Float32Array(frames * 2);
		for (let frame = 0; frame < frames; frame++) {
			samples[frame * 2] = left[frame] ?? 0;
			samples[frame * 2 + 1] = right[frame] ?? 0;
		}
		this.chunks.push({ samples, frameOffset: 0 });
		return frames;
	}

	finish(): void {
		this.final = true;
	}

	extract(target: Float32Array, requestedFrames: number): number {
		let written = 0;
		while (written < requestedFrames && this.chunks.length > 0) {
			const chunk = this.chunks[0]!;
			const chunkFrames = chunk.samples.length / 2;
			const available = chunkFrames - chunk.frameOffset;
			const frames = Math.min(requestedFrames - written, available);
			const sourceStart = chunk.frameOffset * 2;
			target.set(chunk.samples.subarray(sourceStart, sourceStart + frames * 2), written * 2);
			written += frames;
			chunk.frameOffset += frames;
			if (chunk.frameOffset === chunkFrames) this.chunks.shift();
		}
		if (this.final && written < requestedFrames) {
			target.fill(0, written * 2, requestedFrames * 2);
			return requestedFrames;
		}
		return written;
	}
}

/**
 * Persistent SoundTouch stream for bounded export chunks. It keeps overlap,
 * rate-transposer, and FIFO history until the clip ends, so chunk boundaries
 * do not become audible edit points.
 */
export class StreamingTimeStretch {
	private totalInputFrames = 0;
	private totalOutputFrames = 0;
	private finished = false;

	private constructor(
		private readonly source: StreamingStereoSource,
		private readonly filter: { extract(target: Float32Array, numFrames: number): number },
		private readonly processor: { tempo: number },
		private readonly channelCount: number,
		private tempo: number
	) {}

	static async create(
		channelCount: number,
		tempo: number,
		pitchRatio: number
	): Promise<StreamingTimeStretch> {
		const { TimeStretchFilter, TimeStretchProcessor } = await import('./time-stretch');
		const source = new StreamingStereoSource();
		const processor = new TimeStretchProcessor();
		processor.tempo = tempo;
		processor.pitch = pitchRatio;
		processor.rate = 1;
		return new StreamingTimeStretch(
			source,
			new TimeStretchFilter(source, processor),
			processor,
			Math.max(1, channelCount),
			tempo
		);
	}

	setTempo(tempo: number): void {
		if (!Number.isFinite(tempo) || tempo <= 0) return;
		this.tempo = tempo;
		this.processor.tempo = tempo;
	}

	process(
		channels: Float32Array[],
		isLast = false,
		expectedTotalOutputFrames?: number
	): Float32Array[] {
		if (this.finished) throw new Error('Cannot append audio after the time-stretch stream ended');
		this.totalInputFrames += this.source.push(channels);
		if (isLast) {
			this.source.finish();
			this.finished = true;
		}
		const expectedTotal = isLast
			? Math.max(0, expectedTotalOutputFrames ?? Math.floor(this.totalInputFrames / this.tempo))
			: Number.POSITIVE_INFINITY;
		const parts: Float32Array[][] = Array.from({ length: this.channelCount }, () => []);
		let produced = 0;
		const chunkFrames = 4096;
		while (this.totalOutputFrames < expectedTotal) {
			const requested = isLast
				? Math.min(chunkFrames, expectedTotal - this.totalOutputFrames)
				: chunkFrames;
			const interleaved = new Float32Array(requested * 2);
			const frames = this.filter.extract(interleaved, requested);
			if (frames <= 0) break;
			const channelsOut = Array.from({ length: this.channelCount }, () => new Float32Array(frames));
			for (let frame = 0; frame < frames; frame++) {
				channelsOut[0]![frame] = interleaved[frame * 2] ?? 0;
				if (this.channelCount > 1) channelsOut[1]![frame] = interleaved[frame * 2 + 1] ?? 0;
				for (let channel = 2; channel < this.channelCount; channel++) {
					channelsOut[channel]![frame] = interleaved[frame * 2] ?? 0;
				}
			}
			for (let channel = 0; channel < this.channelCount; channel++) {
				parts[channel]!.push(channelsOut[channel]!);
			}
			produced += frames;
			this.totalOutputFrames += frames;
			if (frames < requested && !isLast) break;
		}
		return parts.map((channelParts) => {
			const output = new Float32Array(produced);
			let offset = 0;
			for (const part of channelParts) {
				output.set(part, offset);
				offset += part.length;
			}
			return output;
		});
	}
}
