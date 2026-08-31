import { describe, expect, it } from 'vitest';
import type { WaveformData } from '../media/waveform-client';
import {
	sampleSourceWaveform,
	sourceWaveformDetailWindow,
	sourceWaveformSeekTime
} from './source-audio-waveform';

const waveform: WaveformData = {
	peaks: Float32Array.from({ length: 1_000 }, (_, index) => (index < 500 ? 0.25 : 0.75)),
	durationSeconds: 10,
	samplesPerSecond: 100,
	loadedSamples: 1_000,
	isComplete: true
};

describe('source audio waveform', () => {
	it('samples exact overview and detail windows without reading unloaded peaks', () => {
		expect([...sampleSourceWaveform(waveform, 0, 10, 2)]).toEqual([0.25, 0.75]);
		expect([...sampleSourceWaveform({ ...waveform, loadedSamples: 500 }, 0, 10, 2)]).toEqual([
			0.25, 0
		]);
	});

	it('keeps a twenty-second detail window centered until it reaches an edge', () => {
		expect(sourceWaveformDetailWindow(100, 50)).toEqual({ start: 40, end: 60 });
		expect(sourceWaveformDetailWindow(100, 3)).toEqual({ start: 0, end: 20 });
		expect(sourceWaveformDetailWindow(10, 5)).toEqual({ start: 0, end: 10 });
	});

	it('seeks the full source from the overview and the focused window from the detail', () => {
		const base = {
			clientX: 150,
			rect: { left: 50, top: 20, width: 200 },
			durationSeconds: 100,
			detailStartSeconds: 40,
			detailEndSeconds: 60,
			overviewHeight: 34
		};
		expect(sourceWaveformSeekTime({ ...base, clientY: 30 })).toBe(50);
		expect(sourceWaveformSeekTime({ ...base, clientY: 80 })).toBe(50);
		expect(sourceWaveformSeekTime({ ...base, clientX: -10, clientY: 30 })).toBe(0);
	});
});
