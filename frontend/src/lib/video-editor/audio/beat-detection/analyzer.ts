import {
	BEAT_MARKER_COLOR,
	DEFAULT_BEAT_CONFIG,
	DOWNBEAT_MARKER_COLOR,
	type Beat,
	type BeatAnalysisResult,
	type BeatDetectionConfig
} from './types';

function abortIfNeeded(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Beat detection cancelled', 'AbortError');
}

async function yieldToMain(signal?: AbortSignal): Promise<void> {
	abortIfNeeded(signal);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	abortIfNeeded(signal);
}

function rmsWindow(samples: Float32Array, start: number, size: number): number {
	let sum = 0;
	const end = Math.min(samples.length, start + size);
	for (let i = start; i < end; i++) {
		const v = samples[i] ?? 0;
		sum += v * v;
	}
	const count = end - start;
	return count > 0 ? Math.sqrt(sum / count) : 0;
}

function smoothArray(input: Float32Array, radius: number): Float32Array {
	const out = new Float32Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const start = Math.max(0, i - radius);
		const end = Math.min(input.length, i + radius + 1);
		let sum = 0;
		for (let j = start; j < end; j++) sum += input[j] ?? 0;
		out[i] = sum / (end - start);
		if (out[i] !== out[i]) out[i] = 0;
	}
	return out;
}

function median(values: Float32Array): number {
	if (values.length === 0) return 0;
	const copy = Array.from(values).sort((a, b) => a - b);
	const mid = Math.floor(copy.length / 2);
	if (copy.length % 2 === 0) return ((copy[mid - 1] ?? 0) + (copy[mid] ?? 0)) / 2;
	return copy[mid] ?? 0;
}

function mean(values: Float32Array): number {
	if (values.length === 0) return 0;
	let s = 0;
	for (let i = 0; i < values.length; i++) s += values[i] ?? 0;
	return s / values.length;
}

export class BeatAnalyzer {
	private readonly config: BeatDetectionConfig;

	constructor(config: Partial<BeatDetectionConfig> = {}) {
		this.config = { ...DEFAULT_BEAT_CONFIG, ...config };
	}

	async analyzeChannelData(
		samples: Float32Array,
		sampleRate: number,
		duration: number,
		signal?: AbortSignal
	): Promise<BeatAnalysisResult> {
		abortIfNeeded(signal);
		const onsets = await this.detectOnsets(samples, sampleRate, signal);
		abortIfNeeded(signal);
		const { bpm, confidence } = this.calculateBpm(onsets, duration);
		const beats = this.generateBeats(bpm, duration, onsets);
		const downbeats = this.detectDownbeats(beats);
		return { bpm, confidence, beats, duration, downbeats };
	}

	async analyzeAudioBuffer(buffer: AudioBuffer, signal?: AbortSignal): Promise<BeatAnalysisResult> {
		abortIfNeeded(signal);
		const copy = this.mixToMono(buffer);
		return this.analyzeChannelData(copy, buffer.sampleRate, buffer.duration, signal);
	}

	private mixToMono(buffer: AudioBuffer): Float32Array {
		if (buffer.numberOfChannels === 0) return new Float32Array(0);
		if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0));
		const length = buffer.length;
		const mono = new Float32Array(length);
		for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
			const data = buffer.getChannelData(channel);
			for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0);
		}
		const divisor = buffer.numberOfChannels;
		for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) / divisor;
		return mono;
	}

	async analyzeBlob(blob: Blob, signal?: AbortSignal): Promise<BeatAnalysisResult> {
		abortIfNeeded(signal);
		const arrayBuffer = await blob.arrayBuffer();
		abortIfNeeded(signal);
		const audioContext = new AudioContext();
		try {
			const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
			return this.analyzeAudioBuffer(decoded, signal);
		} finally {
			try {
				await audioContext.close();
			} catch {
				// ignore
			}
		}
	}

	private async detectOnsets(
		samples: Float32Array,
		sampleRate: number,
		signal?: AbortSignal
	): Promise<number[]> {
		const { windowSize, hopSize, sensitivity } = this.config;
		if (samples.length < windowSize) return [];
		const numFrames = Math.floor((samples.length - windowSize) / hopSize);
		if (numFrames <= 0) return [];
		const energies = new Float32Array(numFrames);
		for (let i = 0; i < numFrames; i++) {
			energies[i] = rmsWindow(samples, i * hopSize, windowSize);
			if (i % 512 === 0) await yieldToMain(signal);
		}
		abortIfNeeded(signal);
		const smoothed = smoothArray(energies, 2);
		const thresholds = await this.calculateAdaptiveThreshold(smoothed, sensitivity, signal);
		const minFramesBetweenOnsets = Math.floor((sampleRate / hopSize) * 0.1);
		const onsets: number[] = [];
		let lastOnsetFrame = -minFramesBetweenOnsets * 2;
		for (let i = 1; i < smoothed.length - 1; i++) {
			const current = smoothed[i] ?? 0;
			const prev = smoothed[i - 1] ?? 0;
			const next = smoothed[i + 1] ?? 0;
			const localThreshold = thresholds[i] ?? 0;
			const isLocalMax = current > prev && current >= next;
			const isAboveThreshold = current > localThreshold;
			const hasRise = current - prev > localThreshold * 0.3;
			const notTooClose = i - lastOnsetFrame >= minFramesBetweenOnsets;
			if (isLocalMax && isAboveThreshold && hasRise && notTooClose) {
				onsets.push((i * hopSize) / sampleRate);
				lastOnsetFrame = i;
			}
		}
		return onsets;
	}

	private async calculateAdaptiveThreshold(
		energies: Float32Array,
		sensitivity: number,
		signal?: AbortSignal
	): Promise<number[]> {
		const window = 50;
		const thresholds: number[] = new Array(energies.length);
		for (let i = 0; i < energies.length; i++) {
			const start = Math.max(0, i - window);
			const end = Math.min(energies.length, i + window);
			const slice = energies.slice(start, end);
			const med = median(slice);
			const avg = mean(slice);
			const base = med + (avg - med) * (1 - sensitivity);
			thresholds[i] = base * (1.5 - sensitivity * 0.5);
			if (i % 256 === 0) await yieldToMain(signal);
		}
		return thresholds;
	}

	private calculateBpm(onsets: number[], duration: number) {
		if (onsets.length < 4) return { bpm: 120, confidence: 0 };
		const intervals: number[] = [];
		for (let i = 1; i < onsets.length; i++) intervals.push((onsets[i] ?? 0) - (onsets[i - 1] ?? 0));
		const { minBpm, maxBpm } = this.config;
		const minInterval = 60 / maxBpm;
		const maxInterval = 60 / minBpm;
		const valid = intervals.filter((v) => v >= minInterval && v <= maxInterval);
		if (valid.length < 3) return { bpm: 120, confidence: 0 };
		const candidates = new Map<number, number>();
		for (const interval of valid) {
			const bpm = Math.round(60 / interval);
			if (bpm >= minBpm && bpm <= maxBpm) candidates.set(bpm, (candidates.get(bpm) ?? 0) + 1);
			const doubleBpm = Math.round(120 / interval);
			if (doubleBpm >= minBpm && doubleBpm <= maxBpm)
				candidates.set(doubleBpm, (candidates.get(doubleBpm) ?? 0) + 0.5);
			const halfBpm = Math.round(30 / interval);
			if (halfBpm >= minBpm && halfBpm <= maxBpm)
				candidates.set(halfBpm, (candidates.get(halfBpm) ?? 0) + 0.3);
		}
		let bestBpm = 120;
		let bestScore = 0;
		for (const [bpm, score] of candidates) {
			if (score > bestScore) {
				bestScore = score;
				bestBpm = bpm;
			}
		}
		const expectedBeats = (duration * bestBpm) / 60;
		const confidence = Math.min(
			1,
			Math.max(0, 1 - Math.abs(expectedBeats - onsets.length) / Math.max(1, expectedBeats))
		);
		return { bpm: bestBpm, confidence };
	}

	private generateBeats(bpm: number, duration: number, onsets: number[]): Beat[] {
		const interval = 60 / bpm;
		const beats: Beat[] = [];
		let first = 0;
		if (onsets.length > 0) {
			const firstOnset = onsets[0] ?? 0;
			const offsetBeats = Math.round(firstOnset / interval);
			first = firstOnset - offsetBeats * interval;
			while (first < 0) first += interval;
			first = Math.round(first * 1000) / 1000;
		}
		let index = 0;
		for (let time = first; time < duration - 1e-6; time += interval) {
			const t = Math.round(time * 1000) / 1000;
			const nearest = this.findNearestOnset(t, onsets, interval * 0.3);
			const strength = nearest !== null ? 1 : 0.5;
			beats.push({ time: nearest ?? t, strength, index });
			index++;
		}
		return beats;
	}

	private findNearestOnset(time: number, onsets: number[], tolerance: number): number | null {
		let nearest: number | null = null;
		let minDist = tolerance;
		for (const o of onsets) {
			const d = Math.abs(o - time);
			if (d < minDist) {
				minDist = d;
				nearest = o;
			}
		}
		return nearest;
	}

	private detectDownbeats(beats: Beat[]): number[] {
		if (beats.length < 4) return beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
		const strong = beats.filter((b) => b.strength > 0.7);
		if (strong.length > 0) {
			const first = strong[0];
			if (!first) return beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
			const startIdx = beats.findIndex((b) => b.time === first.time);
			const out: number[] = [];
			for (let i = Math.max(0, startIdx); i < beats.length; i += 4) out.push(beats[i]!.time);
			return out;
		}
		return beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
	}

	static mapBeatToFrame(timeSeconds: number, fps: number): number {
		return Math.max(0, Math.round(timeSeconds * fps));
	}

	static beatColor(isDownbeat: boolean): string {
		return isDownbeat ? DOWNBEAT_MARKER_COLOR : BEAT_MARKER_COLOR;
	}
}

export function createBeatAnalyzer(config?: Partial<BeatDetectionConfig>): BeatAnalyzer {
	return new BeatAnalyzer(config);
}
