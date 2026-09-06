/**
 * Absolute-phase sample-rate conversion and channel mapping.
 *
 * Mirrors FreeCut canvas-audio.ts's OfflineAudioContext resampling and ITU
 * downmix but exposes a plain-F32 path so chunked, long-duration work can
 * keep the same sample count as a single uninterrupted conversion. No
 * per-chunk rounding leaks into the total length.
 */

const SQRT_HALF = Math.SQRT1_2;

export function expectedOutputFrames(
	inputFrames: number,
	sourceRate: number,
	targetRate: number
): number {
	if (sourceRate === targetRate) return inputFrames;
	if (inputFrames === 0) return 0;
	return Math.round((inputFrames * targetRate) / sourceRate);
}

export function resampleChannelLinear(
	channel: Float32Array,
	sourceRate: number,
	targetRate: number
): Float32Array {
	if (sourceRate === targetRate) return channel.slice();
	const outputFrames = expectedOutputFrames(channel.length, sourceRate, targetRate);
	const output = new Float32Array(outputFrames);
	const ratio = sourceRate / targetRate;
	for (let out = 0; out < outputFrames; out++) {
		const pos = out * ratio;
		const left = Math.floor(pos);
		const frac = pos - left;
		const leftSample = channel[left] ?? 0;
		const rightSample = channel[left + 1] ?? 0;
		output[out] = leftSample * (1 - frac) + rightSample * frac;
	}
	return output;
}

export function resampleAudioChannels(
	channels: Float32Array[],
	sourceRate: number,
	targetRate: number
): Float32Array[] {
	if (sourceRate === targetRate) return channels.map((c) => c.slice());
	return channels.map((channel) => resampleChannelLinear(channel, sourceRate, targetRate));
}

export class AbsolutePhaseResampler {
	private totalInputFed = 0;
	private totalOutputEmitted = 0;
	private pending = new Float32Array(0);
	private pendingStartInputIndex = 0;

	constructor(
		private readonly sourceRate: number,
		private readonly targetRate: number
	) {}

	processChunk(chunk: Float32Array, isLast: boolean): Float32Array {
		if (chunk.length === 0 && !isLast) return new Float32Array(0);
		const newPending = new Float32Array(this.pending.length + chunk.length);
		newPending.set(this.pending, 0);
		newPending.set(chunk, this.pending.length);
		this.pending = newPending;
		this.totalInputFed += chunk.length;
		const desiredTotalOutput = expectedOutputFrames(
			this.totalInputFed,
			this.sourceRate,
			this.targetRate
		);
		const output = new Float32Array(Math.max(0, desiredTotalOutput - this.totalOutputEmitted));
		let outputFrames = 0;
		while (this.totalOutputEmitted < desiredTotalOutput) {
			const srcPos = (this.totalOutputEmitted * this.sourceRate) / this.targetRate;
			const left = Math.floor(srcPos);
			const frac = srcPos - left;
			const localLeft = left - this.pendingStartInputIndex;
			const leftSample = this.pending[localLeft];
			const rightSample = this.pending[localLeft + 1];
			const leftExists = localLeft >= 0 && localLeft < this.pending.length;
			const rightExists = localLeft + 1 >= 0 && localLeft + 1 < this.pending.length;
			if (!leftExists && !rightExists) break;
			if (!isLast && !rightExists) break;
			const l = leftExists ? leftSample! : 0;
			const r = rightExists ? rightSample! : 0;
			output[outputFrames++] = l * (1 - frac) + r * frac;
			this.totalOutputEmitted++;
		}
		if (isLast) {
			while (this.totalOutputEmitted < desiredTotalOutput) {
				const srcPos = (this.totalOutputEmitted * this.sourceRate) / this.targetRate;
				const left = Math.floor(srcPos);
				const frac = srcPos - left;
				const localLeft = left - this.pendingStartInputIndex;
				const l = this.pending[localLeft] ?? 0;
				const r = this.pending[localLeft + 1] ?? 0;
				output[outputFrames++] = l * (1 - frac) + r * frac;
				this.totalOutputEmitted++;
			}
			this.pending = new Float32Array(0);
			this.pendingStartInputIndex = this.totalInputFed;
		} else {
			const lastEmittedSrcPos =
				this.totalOutputEmitted > 0
					? ((this.totalOutputEmitted - 1) * this.sourceRate) / this.targetRate
					: -1;
			const keepFrom = Math.max(0, Math.floor(lastEmittedSrcPos) - 1);
			const discardCount = Math.max(0, keepFrom - this.pendingStartInputIndex);
			if (discardCount > 0) {
				this.pending = this.pending.slice(discardCount);
				this.pendingStartInputIndex += discardCount;
			}
			if (this.pending.length > 8192) {
				const maxKeep = 8192;
				const drop = this.pending.length - maxKeep;
				this.pending = this.pending.slice(drop);
				this.pendingStartInputIndex += drop;
			}
		}
		return outputFrames === output.length ? output : output.slice(0, outputFrames);
	}

	flush(): Float32Array {
		if (this.pending.length === 0) return new Float32Array(0);
		return this.processChunk(new Float32Array(0), true);
	}

	reset(): void {
		this.totalInputFed = 0;
		this.totalOutputEmitted = 0;
		this.pending = new Float32Array(0);
		this.pendingStartInputIndex = 0;
	}
}

/** ITU-R BS.775 Lo/Ro downmix: L,R,C,Ls,Rs,Lr,Rr -> stereo. LFE dropped. */
export function downmixToStereo(source: readonly Float32Array[]): Float32Array[] {
	const [L, R, C, _LFE, Ls, Rs, Lr, Rr] = source;
	const length = L?.length ?? R?.length ?? C?.length ?? Ls?.length ?? Rs?.length ?? 0;
	if (length === 0) return [new Float32Array(0), new Float32Array(0)];
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		let lo = L?.[i] ?? 0;
		let ro = R?.[i] ?? 0;
		const c = C?.[i];
		if (c !== undefined) {
			lo += SQRT_HALF * c;
			ro += SQRT_HALF * c;
		}
		const ls = Ls?.[i];
		if (ls !== undefined) lo += SQRT_HALF * ls;
		const rs = Rs?.[i];
		if (rs !== undefined) ro += SQRT_HALF * rs;
		const lr = Lr?.[i];
		if (lr !== undefined) lo += SQRT_HALF * lr;
		const rr = Rr?.[i];
		if (rr !== undefined) ro += SQRT_HALF * rr;
		left[i] = lo;
		right[i] = ro;
	}
	return [left, right];
}

export function downmixToOutputChannels(
	source: readonly Float32Array[],
	outputChannels: number
): Float32Array[] {
	if (source.length === 0) return [];
	if (outputChannels <= 0) return [];
	if (source.length === outputChannels) return source.map((c) => c.slice());
	if (source.length === 1) {
		const mono = source[0]!;
		return Array.from({ length: outputChannels }, () => mono.slice());
	}
	if (outputChannels === 2) return downmixToStereo(source);
	if (outputChannels === 1) {
		const stereo = downmixToStereo(source);
		const left = stereo[0]!;
		const right = stereo[1]!;
		const mono = new Float32Array(left.length);
		for (let i = 0; i < mono.length; i++) mono[i] = (left[i]! + right[i]!) * 0.5;
		return [mono];
	}
	const out: Float32Array[] = [];
	for (let c = 0; c < outputChannels; c++)
		out.push(source[c]?.slice() ?? new Float32Array(source[0]!.length));
	return out;
}

export function ensureStereo(channels: Float32Array[]): Float32Array[] {
	return downmixToOutputChannels(channels, 2);
}
