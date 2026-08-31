import { describe, expect, it } from 'vitest';
import {
	AUDIO_VOLUME_DB_MAX,
	AUDIO_VOLUME_DB_MIN,
	audioVolumeDbFromDrag,
	audioVolumeLinePercent,
	audioVolumeWaveformScale,
	clampAudioVolumeDb,
	formatAudioVolumeDb
} from './audio-volume-line';

describe('timeline audio volume line', () => {
	it('maps the asymmetric decibel range around a centered 0 dB line', () => {
		expect(audioVolumeLinePercent(12)).toBe(12);
		expect(audioVolumeLinePercent(0)).toBe(50);
		expect(audioVolumeLinePercent(-60)).toBe(88);
	});

	it('uses a fine pointer curve and clamps invalid or extreme input', () => {
		expect(audioVolumeDbFromDrag({ startDb: 0, pointerDeltaY: -38, height: 100 })).toBe(7.2);
		expect(audioVolumeDbFromDrag({ startDb: 0, pointerDeltaY: 38, height: 100 })).toBe(-7.2);
		expect(audioVolumeDbFromDrag({ startDb: 0, pointerDeltaY: -1_000, height: 0 })).toBe(
			AUDIO_VOLUME_DB_MAX
		);
		expect(clampAudioVolumeDb(Number.NaN)).toBe(0);
		expect(clampAudioVolumeDb(-1_000)).toBe(AUDIO_VOLUME_DB_MIN);
	});

	it('keeps the waveform readable and formats an exact editing readout', () => {
		expect(audioVolumeWaveformScale(-60)).toBeGreaterThanOrEqual(0.06);
		expect(audioVolumeWaveformScale(0)).toBe(1);
		expect(audioVolumeWaveformScale(12)).toBeLessThanOrEqual(2.5);
		expect(formatAudioVolumeDb(3.04)).toBe('+3.0 dB');
		expect(formatAudioVolumeDb(-6)).toBe('-6.0 dB');
	});
});
