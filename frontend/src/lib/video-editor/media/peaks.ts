/**
 * Ported from FreeCut (MIT) — maps a decoded peak array onto the pixel
 * width of a timeline clip for the item's source window.
 */

import type { WaveformData } from './waveform-client';

export interface WindowedPeaks {
	/** Interleaved min/max pairs, one pair per output column. */
	columns: Float32Array;
}

const PEAK_BLOCK_SIZE = 64;

interface PeakBlockIndex {
	blocks: Float32Array;
	indexedSamples: number;
}

const peakBlockIndexes = new WeakMap<Float32Array, PeakBlockIndex>();

function blockIndex(waveform: WaveformData): Float32Array {
	let index = peakBlockIndexes.get(waveform.peaks);
	if (!index) {
		index = {
			blocks: new Float32Array(Math.ceil(waveform.peaks.length / PEAK_BLOCK_SIZE)),
			indexedSamples: 0
		};
		peakBlockIndexes.set(waveform.peaks, index);
	}
	const loadedSamples = Math.min(waveform.peaks.length, waveform.loadedSamples);
	for (let sample = index.indexedSamples; sample < loadedSamples; sample += 1) {
		const block = Math.floor(sample / PEAK_BLOCK_SIZE);
		const value = waveform.peaks[sample] ?? 0;
		if (value > (index.blocks[block] ?? 0)) index.blocks[block] = value;
	}
	index.indexedSamples = Math.max(index.indexedSamples, loadedSamples);
	return index.blocks;
}

function maxPeakInRange(
	peaks: Float32Array,
	blocks: Float32Array,
	firstBucket: number,
	lastBucket: number
): number {
	let from = Math.max(0, firstBucket);
	const to = Math.min(peaks.length - 1, lastBucket);
	let max = 0;
	while (from <= to && from % PEAK_BLOCK_SIZE !== 0) {
		max = Math.max(max, peaks[from] ?? 0);
		from += 1;
	}
	while (from + PEAK_BLOCK_SIZE - 1 <= to) {
		max = Math.max(max, blocks[Math.floor(from / PEAK_BLOCK_SIZE)] ?? 0);
		from += PEAK_BLOCK_SIZE;
	}
	while (from <= to) {
		max = Math.max(max, peaks[from] ?? 0);
		from += 1;
	}
	return max;
}

export function peaksForWindow(
	waveform: WaveformData,
	startSourceFrame: number,
	endSourceFrame: number,
	fps: number,
	widthPx: number
): Float32Array {
	const columns = Math.max(1, Math.floor(widthPx));
	const output = new Float32Array(columns * 2);
	const sourceDurationFrames = Math.max(1, endSourceFrame - startSourceFrame);
	const blocks = blockIndex(waveform);
	for (let column = 0; column < columns; column++) {
		const windowStart = (startSourceFrame + (column / columns) * sourceDurationFrames) / fps;
		const windowEnd = (startSourceFrame + ((column + 1) / columns) * sourceDurationFrames) / fps;
		const firstBucket = Math.floor(windowStart * waveform.samplesPerSecond);
		const lastBucket = Math.ceil(windowEnd * waveform.samplesPerSecond) - 1;
		let max = 0;
		if (lastBucket >= 0 && firstBucket <= waveform.peaks.length - 1) {
			max = maxPeakInRange(waveform.peaks, blocks, firstBucket, lastBucket);
		}
		output[column * 2] = -max;
		output[column * 2 + 1] = max;
	}
	return output;
}

/** Map non-linear timeline columns onto exact source-frame boundary pairs. */
export function peaksForMappedWindow(
	waveform: WaveformData,
	sourceFrameBoundaries: Float64Array,
	fps: number
): Float32Array {
	const columns = Math.max(0, sourceFrameBoundaries.length - 1);
	const output = new Float32Array(columns * 2);
	if (columns === 0 || !(fps > 0)) return output;

	const blocks = blockIndex(waveform);
	for (let column = 0; column < columns; column += 1) {
		const firstFrame = sourceFrameBoundaries[column] ?? 0;
		const secondFrame = sourceFrameBoundaries[column + 1] ?? firstFrame;
		const windowStart = Math.min(firstFrame, secondFrame) / fps;
		const windowEnd = Math.max(firstFrame, secondFrame) / fps;
		const firstBucket = Math.floor(windowStart * waveform.samplesPerSecond);
		const lastBucket = Math.max(firstBucket, Math.ceil(windowEnd * waveform.samplesPerSecond) - 1);
		let max = 0;
		if (lastBucket >= 0 && firstBucket <= waveform.peaks.length - 1) {
			max = maxPeakInRange(waveform.peaks, blocks, firstBucket, lastBucket);
		}
		output[column * 2] = -max;
		output[column * 2 + 1] = max;
	}
	return output;
}
