import { describe, expect, it } from 'vitest';
import { peaksForMappedWindow, peaksForWindow } from './peaks';
import type { WaveformData } from './waveform-client';

function waveform(peaks: number[]): WaveformData {
	return {
		peaks: Float32Array.from(peaks),
		durationSeconds: peaks.length / 50,
		samplesPerSecond: 50,
		loadedSamples: peaks.length,
		isComplete: true
	};
}

describe('peaksForWindow', () => {
	it('produces one min/max pair per column with symmetric amplitude', () => {
		// 4 seconds of peaks at 50/s; each 1s plateau lands in one output column.
		const plateau = (value: number): number[] => Array.from({ length: 50 }, () => value);
		const peaks = waveform([...plateau(0.1), ...plateau(0.5), ...plateau(0.9), ...plateau(0.2)]);
		const columns = peaksForWindow(peaks, 0, 4 * 30, 30, 4);
		expect(columns.length).toBe(8);
		expect(columns[1]).toBeCloseTo(0.1);
		expect(columns[3]).toBeCloseTo(0.5);
		expect(columns[5]).toBeCloseTo(0.9);
		expect(columns[6]).toBeCloseTo(-0.2);
	});

	it('clamps windows outside the decoded material to silence', () => {
		const peaks = waveform([0.5]);
		const columns = peaksForWindow(peaks, -100, -50, 30, 2);
		expect(columns.every((value) => value === 0)).toBe(true);
	});

	it('returns at least one column even for zero width requests', () => {
		const peaks = waveform([0.3]);
		expect(peaksForWindow(peaks, 0, 30, 30, 0).length).toBe(2);
	});

	it('indexes long ranges and extends the index as progressive chunks arrive', () => {
		const peaks = new Float32Array(4_096);
		peaks[1_777] = 0.75;
		const progressive: WaveformData = {
			peaks,
			durationSeconds: peaks.length / 500,
			samplesPerSecond: 500,
			loadedSamples: 2_000,
			isComplete: false
		};
		const first = peaksForWindow(progressive, 0, 300, 30, 1);
		expect(first[1]).toBeCloseTo(0.75);

		peaks[3_333] = 0.95;
		progressive.loadedSamples = peaks.length;
		progressive.isComplete = true;
		const completed = peaksForWindow(progressive, 0, 300, 30, 1);
		expect(completed[1]).toBeCloseTo(0.95);
	});
});

describe('peaksForMappedWindow', () => {
	it('samples each timeline column through its exact source-frame boundaries', () => {
		const plateau = (value: number): number[] => Array.from({ length: 50 }, () => value);
		const peaks = waveform([...plateau(0.1), ...plateau(0.5), ...plateau(0.9), ...plateau(0.2)]);

		const columns = peaksForMappedWindow(peaks, Float64Array.from([0, 30, 90, 120]), 30);

		expect(columns.length).toBe(6);
		expect(columns[1]).toBeCloseTo(0.1);
		expect(columns[3]).toBeCloseTo(0.9);
		expect(columns[5]).toBeCloseTo(0.2);
	});

	it('keeps reverse source boundaries in timeline display order', () => {
		const plateau = (value: number): number[] => Array.from({ length: 50 }, () => value);
		const peaks = waveform([...plateau(0.1), ...plateau(0.5), ...plateau(0.9), ...plateau(0.2)]);

		const columns = peaksForMappedWindow(peaks, Float64Array.from([120, 90, 30, 0]), 30);

		expect(columns[1]).toBeCloseTo(0.2);
		expect(columns[3]).toBeCloseTo(0.9);
		expect(columns[5]).toBeCloseTo(0.1);
	});
});
