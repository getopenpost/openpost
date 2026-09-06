import type { WaveformData } from '../media/waveform-client';

const DETAIL_WINDOW_SECONDS = 20;
const MIN_DETAIL_WINDOW_RATIO = 0.12;
const PEAK_BLOCK_SIZE = 64;

interface PeakBlockIndex {
	blocks: Float32Array;
	indexedSamples: number;
}

const peakBlockIndexes = new WeakMap<Float32Array, PeakBlockIndex>();

export interface SourceWaveformWindow {
	start: number;
	end: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function waveformBlockIndex(waveform: WaveformData): Float32Array {
	let index = peakBlockIndexes.get(waveform.peaks);
	if (!index) {
		index = {
			blocks: new Float32Array(Math.ceil(waveform.peaks.length / PEAK_BLOCK_SIZE)),
			indexedSamples: 0
		};
		peakBlockIndexes.set(waveform.peaks, index);
	}
	const loaded = Math.min(waveform.loadedSamples, waveform.peaks.length);
	for (let sample = index.indexedSamples; sample < loaded; sample += 1) {
		const block = Math.floor(sample / PEAK_BLOCK_SIZE);
		index.blocks[block] = Math.max(index.blocks[block] ?? 0, Math.abs(waveform.peaks[sample] ?? 0));
	}
	index.indexedSamples = Math.max(index.indexedSamples, loaded);
	return index.blocks;
}

function maxPeakInRange(
	peaks: Float32Array,
	blocks: Float32Array,
	firstSample: number,
	lastSample: number
): number {
	let from = Math.max(0, firstSample);
	const to = Math.min(peaks.length - 1, lastSample);
	let peak = 0;
	while (from <= to && from % PEAK_BLOCK_SIZE !== 0) {
		peak = Math.max(peak, Math.abs(peaks[from] ?? 0));
		from += 1;
	}
	while (from + PEAK_BLOCK_SIZE - 1 <= to) {
		peak = Math.max(peak, blocks[Math.floor(from / PEAK_BLOCK_SIZE)] ?? 0);
		from += PEAK_BLOCK_SIZE;
	}
	while (from <= to) {
		peak = Math.max(peak, Math.abs(peaks[from] ?? 0));
		from += 1;
	}
	return peak;
}

export function sourceWaveformDetailWindow(
	durationSeconds: number,
	currentTimeSeconds: number
): SourceWaveformWindow {
	if (durationSeconds <= 0) return { start: 0, end: 0 };
	const windowDuration = Math.min(
		durationSeconds,
		Math.max(durationSeconds * MIN_DETAIL_WINDOW_RATIO, DETAIL_WINDOW_SECONDS)
	);
	const start = clamp(
		clamp(currentTimeSeconds, 0, durationSeconds) - windowDuration / 2,
		0,
		Math.max(0, durationSeconds - windowDuration)
	);
	return { start, end: Math.min(durationSeconds, start + windowDuration) };
}

export function sampleSourceWaveform(
	waveform: WaveformData,
	startSeconds: number,
	endSeconds: number,
	width: number
): Float32Array {
	const columns = Math.max(0, Math.floor(width));
	const output = new Float32Array(columns);
	const loaded = Math.min(waveform.loadedSamples, waveform.peaks.length);
	const blocks = waveformBlockIndex(waveform);
	const start = clamp(startSeconds, 0, waveform.durationSeconds);
	const end = clamp(endSeconds, start, waveform.durationSeconds);
	if (columns === 0 || loaded === 0 || end <= start || waveform.samplesPerSecond <= 0)
		return output;

	for (let column = 0; column < columns; column += 1) {
		const bucketStart = Math.max(
			0,
			Math.floor((start + ((end - start) * column) / columns) * waveform.samplesPerSecond)
		);
		const bucketEnd = Math.min(
			loaded,
			Math.max(
				bucketStart + 1,
				Math.ceil((start + ((end - start) * (column + 1)) / columns) * waveform.samplesPerSecond)
			)
		);
		output[column] = clamp(
			maxPeakInRange(waveform.peaks, blocks, bucketStart, bucketEnd - 1),
			0,
			1
		);
	}
	return output;
}

export function sourceWaveformSeekTime(input: {
	clientX: number;
	clientY: number;
	rect: Pick<DOMRect, 'left' | 'top' | 'width'>;
	durationSeconds: number;
	detailStartSeconds: number;
	detailEndSeconds: number;
	overviewHeight: number;
}): number {
	if (input.rect.width <= 0 || input.durationSeconds <= 0) return 0;
	const progress = clamp((input.clientX - input.rect.left) / input.rect.width, 0, 1);
	if (input.clientY - input.rect.top <= input.overviewHeight) {
		return progress * input.durationSeconds;
	}
	return input.detailStartSeconds + progress * (input.detailEndSeconds - input.detailStartSeconds);
}
