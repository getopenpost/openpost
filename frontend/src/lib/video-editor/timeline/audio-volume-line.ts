/** Per-clip volume-line math shared by pointer and keyboard timeline edits. */

export const AUDIO_VOLUME_DB_MIN = -60;
export const AUDIO_VOLUME_DB_MAX = 12;

const AUDIO_VOLUME_PADDING_PERCENT = 12;
const AUDIO_VOLUME_CENTER_DB = 0;
const AUDIO_VOLUME_FINE_ADJUST_MULTIPLIER = 0.2;

function bounds(height: number) {
	const safeHeight = Number.isFinite(height) && height > 0 ? height : 100;
	const top = (safeHeight * AUDIO_VOLUME_PADDING_PERCENT) / 100;
	const bottom = safeHeight - top;
	return { top, bottom, center: (top + bottom) / 2 };
}

export function clampAudioVolumeDb(value: number): number {
	const finite = Number.isFinite(value) ? value : 0;
	return Math.min(AUDIO_VOLUME_DB_MAX, Math.max(AUDIO_VOLUME_DB_MIN, Math.round(finite * 10) / 10));
}

export function audioVolumeLinePercent(valueDb: number): number {
	const value = clampAudioVolumeDb(valueDb);
	const { top, bottom, center } = bounds(100);
	if (value >= AUDIO_VOLUME_CENTER_DB) {
		const ratio = (AUDIO_VOLUME_DB_MAX - value) / AUDIO_VOLUME_DB_MAX;
		return top + ratio * (center - top);
	}
	const ratio = (AUDIO_VOLUME_CENTER_DB - value) / -AUDIO_VOLUME_DB_MIN;
	return center + ratio * (bottom - center);
}

export function audioVolumeDbFromDrag(params: {
	startDb: number;
	pointerDeltaY: number;
	height: number;
}): number {
	const { top, bottom } = bounds(params.height);
	const usableHeight = Math.max(1, bottom - top);
	const pointerDelta = Number.isFinite(params.pointerDeltaY) ? params.pointerDeltaY : 0;
	const range = AUDIO_VOLUME_DB_MAX - AUDIO_VOLUME_DB_MIN;
	return clampAudioVolumeDb(
		params.startDb - (pointerDelta / usableHeight) * range * AUDIO_VOLUME_FINE_ADJUST_MULTIPLIER
	);
}

export function audioVolumeWaveformScale(valueDb: number): number {
	const scale = Math.pow(10, clampAudioVolumeDb(valueDb) / 40);
	return Math.min(2.5, Math.max(0.06, scale));
}

export function formatAudioVolumeDb(valueDb: number): string {
	const value = clampAudioVolumeDb(valueDb);
	return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}
