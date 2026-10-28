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
