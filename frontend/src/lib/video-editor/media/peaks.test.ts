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

	it('samples each timeline column through its exact source-frame boundaries', () => {
		const plateau = (value: number): number[] => Array.from({ length: 50 }, () => value);
		const peaks = waveform([...plateau(0.1), ...plateau(0.5), ...plateau(0.9), ...plateau(0.2)]);

		const columns = peaksForMappedWindow(peaks, Float64Array.from([0, 30, 90, 120]), 30);

		expect(columns.length).toBe(6);
		expect(columns[1]).toBeCloseTo(0.1);
		expect(columns[3]).toBeCloseTo(0.9);
		expect(columns[5]).toBeCloseTo(0.2);
	});
});
