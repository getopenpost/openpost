import type { TimelineItem } from '../project/types';

export interface AudioNoiseReductionFieldSource {
	audioNoiseReductionEnabled?: boolean;
	audioNoiseReductionAmount?: number;
}

export interface AudioNoiseReductionSettings {
	enabled?: boolean;
	amount?: number;
}

export interface ResolvedAudioNoiseReductionSettings {
	enabled: boolean;
	amount: number;
}

export const NOISE_REDUCTION_AMOUNT_MIN = 0;
export const NOISE_REDUCTION_AMOUNT_MAX = 100;
export const NOISE_REDUCTION_DEFAULT_AMOUNT = 50;

export const NOISE_REDUCTION_FRAME_SIZE = 1024;
export const NOISE_REDUCTION_HOP_SIZE = 512;
const FRAME_SIZE = NOISE_REDUCTION_FRAME_SIZE;
const HOP_SIZE = NOISE_REDUCTION_HOP_SIZE;
const FFT_SIZE = FRAME_SIZE;
const BIN_COUNT = FFT_SIZE / 2 + 1;
const NOISE_PERCENTILE = 0.25;
const MIN_MAG_EPS = 1e-12;
const MAX_TOTAL_FRAMES = 48_000 * 60 * 30;

export function clampNoiseReductionAmount(value: number): number {
	if (!Number.isFinite(value)) return NOISE_REDUCTION_DEFAULT_AMOUNT;
	return Math.max(
		NOISE_REDUCTION_AMOUNT_MIN,
		Math.min(NOISE_REDUCTION_AMOUNT_MAX, Math.round(value))
	);
}

export function resolveNoiseReductionSettings(
	source?: AudioNoiseReductionFieldSource | AudioNoiseReductionSettings | null
): ResolvedAudioNoiseReductionSettings {
	if (!source) return { enabled: false, amount: NOISE_REDUCTION_DEFAULT_AMOUNT };
	const enabled =
		('audioNoiseReductionEnabled' in source ? source.audioNoiseReductionEnabled : undefined) ??
		('enabled' in source ? source.enabled : undefined) ??
		false;
	const rawAmount =
		('audioNoiseReductionAmount' in source ? source.audioNoiseReductionAmount : undefined) ??
		('amount' in source ? source.amount : undefined) ??
		NOISE_REDUCTION_DEFAULT_AMOUNT;
	return { enabled: !!enabled, amount: clampNoiseReductionAmount(rawAmount) };
}

export function isNoiseReductionActive(
	settings?: ResolvedAudioNoiseReductionSettings | null
): boolean {
	if (!settings || !settings.enabled) return false;
	return settings.amount > 0;
}

export function hasNoiseReductionOverride(source?: AudioNoiseReductionFieldSource | null): boolean {
	if (!source) return false;
	return (
		source.audioNoiseReductionEnabled !== undefined ||
		source.audioNoiseReductionAmount !== undefined
	);
}

export function buildNoiseReductionPatch(
	settings: AudioNoiseReductionSettings
): Partial<TimelineItem> {
	const patch: Partial<TimelineItem> = {};
	if (settings.enabled !== undefined) patch.audioNoiseReductionEnabled = !!settings.enabled;
	if (settings.amount !== undefined)
		patch.audioNoiseReductionAmount = clampNoiseReductionAmount(settings.amount);
	return patch;
}

function reverseBits(value: number, bits: number): number {
	let reversed = 0;
	for (let i = 0; i < bits; i++) {
		reversed = (reversed << 1) | (value & 1);
		value >>= 1;
	}
	return reversed;
}

function fftInPlace(real: Float64Array, imag: Float64Array, invert: boolean): void {
	const n = real.length;
	const bits = Math.log2(n);
	if (!Number.isInteger(bits)) throw new Error('FFT size must be power of two');
	for (let i = 0; i < n; i++) {
		const j = reverseBits(i, bits);
		if (j > i) {
			const tr = real[i]!;
			real[i] = real[j]!;
			real[j] = tr;
			const ti = imag[i]!;
			imag[i] = imag[j]!;
			imag[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = ((2 * Math.PI) / len) * (invert ? 1 : -1);
		const wLenReal = Math.cos(angle);
		const wLenImag = Math.sin(angle);
		for (let i = 0; i < n; i += len) {
			let wReal = 1;
			let wImag = 0;
			for (let j = 0; j < len / 2; j++) {
				const uReal = real[i + j]!;
				const uImag = imag[i + j]!;
				const vReal = real[i + j + len / 2]! * wReal - imag[i + j + len / 2]! * wImag;
				const vImag = real[i + j + len / 2]! * wImag + imag[i + j + len / 2]! * wReal;
				real[i + j] = uReal + vReal;
				imag[i + j] = uImag + vImag;
				real[i + j + len / 2] = uReal - vReal;
				imag[i + j + len / 2] = uImag - vImag;
				const nextWReal = wReal * wLenReal - wImag * wLenImag;
				const nextWImag = wReal * wLenImag + wImag * wLenReal;
				wReal = nextWReal;
				wImag = nextWImag;
			}
		}
	}
	if (invert) {
		for (let i = 0; i < n; i++) {
			real[i]! /= n;
			imag[i]! /= n;
		}
	}
}

function hannWindowPeriodic(size: number): Float64Array {
	const win = new Float64Array(size);
	for (let i = 0; i < size; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
	return win;
}

const HANN = hannWindowPeriodic(FRAME_SIZE);

export function hannReconstructWithGainOne(
	channels: Float32Array[],
	sampleRate: number
): Float32Array[] {
	if (channels.length === 0 || (channels[0]?.length ?? 0) === 0)
		return channels.map((c) => c.slice());
	const pad = NOISE_REDUCTION_HOP_SIZE;
	const padded = channels.map((ch) => {
		const p = new Float32Array(ch.length + pad);
		p.set(ch, pad);
		return p;
	});
	const proc = new StreamingNoiseReduction(
		channels.length,
		sampleRate,
		{
			enabled: true,
			amount: 0
		},
		{ unityGain: true }
	);
	const outPadded = proc.process(
		padded.map((c) => c.slice()),
		true
	);
	const len = channels[0]!.length;
	return outPadded.map((ch) => ch.slice(pad, pad + len));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Noise reduction cancelled.', 'AbortError');
}

export interface QueueInvariants {
	inPending: number;
	outPending: number;
	overlap: number;
	totalInput: number;
	totalEmitted: number;
}

function quantile(sorted: Float64Array, q: number): number {
	if (sorted.length === 0) return 0;
	const pos = q * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	if (lo === hi) return sorted[lo]!;
	const frac = pos - lo;
	return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export class StreamingNoiseReduction {
	private readonly amount: number;
	private readonly sampleRate: number;
	private readonly channelCount: number;
	private readonly floorGain: number;
	private readonly overSubtraction: number;
	private persistentFloor: number | null = null;
	private prevGain: Float64Array;
	private inChunks: Float32Array[][];
	private inOffsets: number[];
	private inLengths: number[];
	private outChunks: Float32Array[][];
	private outLengths: number[];
	private overlap: Float32Array[];
	private totalInput = 0;
	private totalEmitted = 0;

	constructor(
		channelCount: number,
		sampleRate: number,
		settings: ResolvedAudioNoiseReductionSettings,
		options?: { unityGain?: boolean }
	) {
		this.channelCount = Math.max(1, channelCount);
		this.sampleRate = sampleRate;
		this.amount = settings.amount;
		if (options?.unityGain) {
			this.overSubtraction = 0;
			this.floorGain = 1;
			this.prevGain = new Float64Array(BIN_COUNT);
			this.prevGain.fill(1);
		} else {
			const normalized = settings.amount / 100;
			this.overSubtraction = 1 + normalized * 2;
			this.floorGain = 0.02 + (1 - normalized) * 0.12;
			this.prevGain = new Float64Array(BIN_COUNT);
			this.prevGain.fill(1);
		}
		this.inChunks = Array.from({ length: this.channelCount }, () => []);
		this.inOffsets = Array.from({ length: this.channelCount }, () => 0);
		this.inLengths = Array.from({ length: this.channelCount }, () => 0);
		this.outChunks = Array.from({ length: this.channelCount }, () => []);
		this.outLengths = Array.from({ length: this.channelCount }, () => 0);
		this.overlap = Array.from(
			{ length: this.channelCount },
			() => new Float32Array(FRAME_SIZE - HOP_SIZE)
		);
	}

	getQueueInvariants(): QueueInvariants {
		return {
			inPending: this.inLengths[0] ?? 0,
			outPending: this.outLengths[0] ?? 0,
			overlap: this.overlap[0]?.length ?? 0,
			totalInput: this.totalInput,
			totalEmitted: this.totalEmitted
		};
	}

	private appendInput(channels: Float32Array[]): void {
		for (let c = 0; c < this.channelCount; c++) {
			const chunk = channels[c] ?? channels[0] ?? new Float32Array(0);
			if (chunk.length === 0) continue;
			this.inChunks[c]!.push(chunk);
			this.inLengths[c]! += chunk.length;
		}
		this.totalInput += channels[0]?.length ?? 0;
	}

	private peekInputFrame(c: number, out: Float64Array): boolean {
		if ((this.inLengths[c] ?? 0) < FRAME_SIZE) return false;
		let pos = 0;
		let chunkIdx = 0;
		// oxlint-disable-next-line eslint/prefer-const -- off advances per chunk
		let off = this.inOffsets[c] ?? 0;
		while (pos < FRAME_SIZE) {
			const chunk = this.inChunks[c]![chunkIdx];
			if (!chunk) break;
			const avail = chunk.length - off;
			const take = Math.min(avail, FRAME_SIZE - pos);
			for (let i = 0; i < take; i++) out[pos + i] = chunk[off + i] ?? 0;
			pos += take;
			if (take === avail) {
				chunkIdx++;
				off = 0;
			} else {
				off += take;
			}
		}
		return pos === FRAME_SIZE;
	}

	private consumeInput(hop: number): void {
		for (let c = 0; c < this.channelCount; c++) {
			let remain = hop;
			while (remain > 0 && this.inChunks[c]!.length > 0) {
				const first = this.inChunks[c]![0]!;
				const off = this.inOffsets[c] ?? 0;
				const avail = first.length - off;
				if (avail > remain) {
					this.inOffsets[c] = off + remain;
					remain = 0;
				} else {
					this.inChunks[c]!.shift();
					this.inOffsets[c] = 0;
					remain -= avail;
				}
			}
			this.inLengths[c]! -= hop;
			if (this.inLengths[c]! < 0) this.inLengths[c] = 0;
		}
	}

	private pushOutput(c: number, hopChunk: Float32Array): void {
		this.outChunks[c]!.push(hopChunk);
		this.outLengths[c]! += hopChunk.length;
	}

	private drainOutput(want: number): Float32Array[] {
		const result: Float32Array[] = [];
		for (let c = 0; c < this.channelCount; c++) {
			const out: Float32Array = new Float32Array(want);
			let pos = 0;
			while (pos < want && this.outChunks[c]!.length > 0) {
				const first = this.outChunks[c]![0]!;
				const take = Math.min(first.length - 0, want - pos);
				if (first.length === take) {
					out.set(first, pos);
					this.outChunks[c]!.shift();
				} else {
					out.set(first.subarray(0, take), pos);
					this.outChunks[c]![0] = first.subarray(take);
				}
				pos += take;
			}
			this.outLengths[c]! -= pos;
			result.push(out.slice(0, pos));
			if (pos < want) {
				const padded = new Float32Array(want);
				padded.set(result[c]!, 0);
				result[c] = padded;
			}
		}
		this.totalEmitted += want;
		return result;
	}

	private processFrames(signal?: AbortSignal): void {
		const tmpFrame = new Float64Array(FRAME_SIZE);
		while ((this.inLengths[0] ?? 0) >= FRAME_SIZE) {
			throwIfAborted(signal);
			const framesReal: Float64Array[] = [];
			const framesImag: Float64Array[] = [];
			const mags: Float64Array[] = [];
			for (let c = 0; c < this.channelCount; c++) {
				const real = new Float64Array(FFT_SIZE);
				const imag = new Float64Array(FFT_SIZE);
				for (let i = 0; i < FRAME_SIZE; i++) tmpFrame[i] = 0;
				let p = 0;
				let chunkIdx = 0;
				// oxlint-disable-next-line eslint/prefer-const -- off advances per chunk
				let off = this.inOffsets[c] ?? 0;
				while (p < FRAME_SIZE) {
					const chunk = this.inChunks[c]![chunkIdx];
					if (!chunk) break;
					const avail = chunk.length - off;
					const take = Math.min(avail, FRAME_SIZE - p);
					for (let i = 0; i < take; i++) tmpFrame[p + i] = chunk[off + i] ?? 0;
					p += take;
					if (take === avail) {
						chunkIdx++;
						off = 0;
					} else {
						off += take;
					}
				}
				for (let i = 0; i < FRAME_SIZE; i++) real[i] = (tmpFrame[i] ?? 0) * (HANN[i] ?? 0);
				fftInPlace(real, imag, false);
				framesReal.push(real);
				framesImag.push(imag);
				const mag = new Float64Array(BIN_COUNT);
				for (let k = 0; k < BIN_COUNT; k++) mag[k] = Math.hypot(real[k] ?? 0, imag[k] ?? 0);
				mags.push(mag);
			}

			const linkedMag = new Float64Array(BIN_COUNT);
			for (let k = 0; k < BIN_COUNT; k++) {
				let sum = 0;
				for (let c = 0; c < this.channelCount; c++) sum += mags[c]![k] ?? 0;
				linkedMag[k] = sum / this.channelCount;
			}
			const sorted = Float64Array.from(linkedMag).sort();
			const candidate = quantile(sorted, NOISE_PERCENTILE);
			if (this.persistentFloor === null) this.persistentFloor = candidate;
			else {
				if (candidate < this.persistentFloor) {
					this.persistentFloor = this.persistentFloor * 0.85 + candidate * 0.15;
				} else {
					this.persistentFloor = this.persistentFloor * 0.995 + candidate * 0.005;
				}
			}
			const floor = this.persistentFloor ?? candidate;
			const normalized = this.amount / 100;
			const scalarFloor = floor * (0.9 + normalized * 0.6);

			const gain = new Float64Array(BIN_COUNT);
			for (let k = 0; k < BIN_COUNT; k++) {
				const freqHz = (k * this.sampleRate) / FFT_SIZE;
				const hissBias = freqHz > 4000 ? 1.2 : freqHz < 200 ? 0.7 : 1;
				const noise = scalarFloor * hissBias;
				const mag = linkedMag[k] ?? MIN_MAG_EPS;
				let g = 1 - (this.overSubtraction * noise) / (mag + MIN_MAG_EPS);
				if (!Number.isFinite(g)) g = this.floorGain;
				g = Math.max(this.floorGain, Math.min(1, g));
				const smoothed = this.prevGain[k]! * 0.65 + g * 0.35;
				this.prevGain[k] = smoothed;
				gain[k] = smoothed;
			}

			for (let c = 0; c < this.channelCount; c++) {
				const real = framesReal[c]!;
				const imag = framesImag[c]!;
				for (let k = 0; k < BIN_COUNT; k++) {
					const g = gain[k] ?? 1;
					real[k]! *= g;
					imag[k]! *= g;
					if (k > 0 && k < BIN_COUNT - 1) {
						const mirror = FFT_SIZE - k;
						real[mirror]! *= g;
						imag[mirror]! *= g;
					}
				}
				fftInPlace(real, imag, true);
			}

			for (let c = 0; c < this.channelCount; c++) {
				const real = framesReal[c]!;
				const ov = this.overlap[c]!;
				for (let i = 0; i < HOP_SIZE; i++) real[i]! += ov[i] ?? 0;
				const hopOut = new Float32Array(HOP_SIZE);
				for (let i = 0; i < HOP_SIZE; i++) hopOut[i] = real[i] ?? 0;
				this.pushOutput(c, hopOut);
				const newOv = new Float32Array(FRAME_SIZE - HOP_SIZE);
				for (let i = 0; i < FRAME_SIZE - HOP_SIZE; i++) newOv[i] = real[HOP_SIZE + i] ?? 0;
				this.overlap[c] = newOv;
			}

			this.consumeInput(HOP_SIZE);
		}
	}

	process(channels: Float32Array[], isLast = false, signal?: AbortSignal): Float32Array[] {
		throwIfAborted(signal);
		const inputLen = channels[0]?.length ?? 0;

		if (channels.length === 0 && !isLast) return [];
		if (inputLen === 0 && !isLast) return channels.map(() => new Float32Array(0));
		if (inputLen > 0) this.appendInput(channels);
		if (isLast && this.totalInput > 0 && this.totalInput < FRAME_SIZE) {
			const result: Float32Array[] = [];
			for (let c = 0; c < this.channelCount; c++) {
				const len = this.inLengths[c] ?? 0;
				const buf = new Float32Array(len);
				let pos = 0;
				const off = this.inOffsets[c] ?? 0;
				for (let idx = 0; idx < this.inChunks[c]!.length; idx++) {
					const chunk = this.inChunks[c]![idx]!;
					const avail = idx === 0 ? chunk.length - off : chunk.length;
					const start = idx === 0 ? off : 0;
					buf.set(chunk.subarray(start, start + avail), pos);
					pos += avail;
				}
				this.inChunks[c] = [];
				this.inOffsets[c] = 0;
				this.inLengths[c] = 0;
				this.outChunks[c] = [];
				this.outLengths[c] = 0;
				result.push(buf);
			}
			this.totalEmitted = this.totalInput;
			for (let c = 0; c < this.channelCount; c++) this.overlap[c] = new Float32Array(0);
			return result;
		}

		this.processFrames(signal);

		if (isLast) {
			while (this.totalEmitted + (this.outLengths[0] ?? 0) < this.totalInput) {
				throwIfAborted(signal);
				let needPad = false;
				for (let c = 0; c < this.channelCount; c++) {
					if ((this.inLengths[c] ?? 0) < FRAME_SIZE) needPad = true;
				}
				if (needPad) {
					for (let c = 0; c < this.channelCount; c++) {
						const len = this.inLengths[c] ?? 0;
						if (len < FRAME_SIZE) {
							const padLen = FRAME_SIZE - len;
							const pad = new Float32Array(padLen);
							this.inChunks[c]!.push(pad);
							this.inLengths[c]! += padLen;
						}
					}
				}
				const prevOut = this.outLengths[0] ?? 0;
				this.processFrames(signal);
				if ((this.outLengths[0] ?? 0) === prevOut) break;
				if (this.totalEmitted + (this.outLengths[0] ?? 0) >= this.totalInput) break;
			}
			const want = this.totalInput - this.totalEmitted;
			if (want <= 0) {
				for (let c = 0; c < this.channelCount; c++) {
					this.inChunks[c] = [];
					this.inOffsets[c] = 0;
					this.inLengths[c] = 0;
					this.outChunks[c] = [];
					this.outLengths[c] = 0;
					this.overlap[c] = new Float32Array(0);
				}
				return this.channelCount === 1
					? [new Float32Array(0)]
					: Array.from({ length: this.channelCount }, () => new Float32Array(0));
			}
			const result: Float32Array[] = [];
			for (let c = 0; c < this.channelCount; c++) {
				const outLen = this.outLengths[c] ?? 0;
				const take = Math.min(want, outLen);
				const buf = new Float32Array(take);
				let pos = 0;
				while (pos < take && this.outChunks[c]!.length > 0) {
					const first = this.outChunks[c]![0]!;
					const need = take - pos;
					if (first.length <= need) {
						buf.set(first, pos);
						pos += first.length;
						this.outChunks[c]!.shift();
					} else {
						buf.set(first.subarray(0, need), pos);
						this.outChunks[c]![0] = first.subarray(need);
						pos += need;
					}
				}
				this.outLengths[c]! -= pos;
				result.push(Float32Array.from(buf, (v) => Math.max(-1, Math.min(1, v))));
			}
			this.totalEmitted += want;
			if (this.totalEmitted >= this.totalInput) {
				for (let c = 0; c < this.channelCount; c++) {
					this.inChunks[c] = [];
					this.inOffsets[c] = 0;
					this.inLengths[c] = 0;
					this.outChunks[c] = [];
					this.outLengths[c] = 0;
					this.overlap[c] = new Float32Array(0);
				}
			}
			return result;
		}

		const want = Math.min(inputLen, this.outLengths[0] ?? 0);
		if (want === 0) return channels.map(() => new Float32Array(0));
		const result: Float32Array[] = [];
		for (let c = 0; c < this.channelCount; c++) {
			const buf = new Float32Array(want);
			let pos = 0;
			while (pos < want && this.outChunks[c]!.length > 0) {
				const first = this.outChunks[c]![0]!;
				const need = want - pos;
				if (first.length <= need) {
					buf.set(first, pos);
					pos += first.length;
					this.outChunks[c]!.shift();
				} else {
					buf.set(first.subarray(0, need), pos);
					this.outChunks[c]![0] = first.subarray(need);
					pos += need;
				}
			}
			this.outLengths[c]! -= pos;
			result.push(buf);
		}
		this.totalEmitted += want;
		return result;
	}

	flush(signal?: AbortSignal): Float32Array[] {
		return this.process([], true, signal);
	}
}

export async function applyNoiseReduction(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal
): Promise<Float32Array[]> {
	if (!isNoiseReductionActive(settings)) return channels.map((c) => c.slice());
	if (sampleRate <= 0 || channels.length === 0 || (channels[0]?.length ?? 0) === 0)
		return channels.map((c) => c.slice());
	const total = channels[0]!.length;
	if (total > MAX_TOTAL_FRAMES) throw new Error('Noise reduction input too long');
	if (total < FRAME_SIZE) {
		return channels.map((c) => c.slice());
	}
	const proc = new StreamingNoiseReduction(channels.length, sampleRate, settings);
	const chunkSize = 24000;
	const outParts: Float32Array[][] = [];
	let offset = 0;
	let yields = 0;
	while (offset < total) {
		throwIfAborted(signal);
		const len = Math.min(chunkSize, total - offset);
		const chunk = channels.map((ch) => ch.slice(offset, offset + len));
		const isLast = offset + len >= total;
		const out = proc.process(chunk, isLast, signal);
		if (out[0]?.length) outParts.push(out);
		offset += len;
		if (++yields % 8 === 0) {
			await new Promise<void>((r) => setTimeout(r, 0));
			throwIfAborted(signal);
		}
	}
	const result: Float32Array[] = Array.from(
		{ length: channels.length },
		() => new Float32Array(total)
	);
	for (let c = 0; c < channels.length; c++) {
		let pos = 0;
		for (const part of outParts) {
			const p = part[c]!;
			result[c]!.set(p, pos);
			pos += p.length;
		}
		if (pos !== total) {
			const trimmed = result[c]!.slice(0, pos);
			const padded = new Float32Array(total);
			padded.set(trimmed, 0);
			result[c] = padded;
		}
	}
	return result;
}

export function applyNoiseReductionSync(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal
): Float32Array[] {
	if (!isNoiseReductionActive(settings)) return channels.map((c) => c.slice());
	if (sampleRate <= 0 || channels.length === 0 || (channels[0]?.length ?? 0) === 0)
		return channels.map((c) => c.slice());
	const total = channels[0]!.length;
	if (total > MAX_TOTAL_FRAMES) throw new Error('Noise reduction input too long');
	if (total < FRAME_SIZE) return channels.map((c) => c.slice());
	if (total > 48000 * 60 * 2) {
		throw new Error(
			'Synchronous noise reduction fallback limit exceeded for long clip; use worker'
		);
	}
	const proc = new StreamingNoiseReduction(channels.length, sampleRate, settings);
	const chunkSize = 24000;
	const outParts: Float32Array[][] = [];
	let offset = 0;
	while (offset < total) {
		throwIfAborted(signal);
		const len = Math.min(chunkSize, total - offset);
		const chunk = channels.map((ch) => ch.slice(offset, offset + len));
		const isLast = offset + len >= total;
		const out = proc.process(chunk, isLast, signal);
		if (out[0]?.length) outParts.push(out);
		offset += len;
	}
	const result: Float32Array[] = Array.from(
		{ length: channels.length },
		() => new Float32Array(total)
	);
	for (let c = 0; c < channels.length; c++) {
		let pos = 0;
		for (const part of outParts) {
			const p = part[c]!;
			result[c]!.set(p, pos);
			pos += p.length;
		}
		if (pos !== total) {
			const trimmed = result[c]!.slice(0, pos);
			const padded = new Float32Array(total);
			padded.set(trimmed, 0);
			result[c] = padded;
		}
	}
	return result;
}
