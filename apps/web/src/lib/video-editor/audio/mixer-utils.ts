export const MIXER_MIN_DB = -60;
export const MIXER_MAX_DB = 12;

export function clampMixerDb(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(MIXER_MAX_DB, Math.max(MIXER_MIN_DB, value));
}

export function mixerDbToGain(value: number): number {
	const db = clampMixerDb(value);
	return db <= MIXER_MIN_DB ? 0 : Math.pow(10, db / 20);
}

export function mixerGainToDb(value: number): number {
	if (!Number.isFinite(value) || value <= Math.pow(10, MIXER_MIN_DB / 20)) {
		return MIXER_MIN_DB;
	}
	return clampMixerDb(20 * Math.log10(value));
}

export function mixerDbToFaderPercent(value: number): number {
	return ((clampMixerDb(value) - MIXER_MIN_DB) / (MIXER_MAX_DB - MIXER_MIN_DB)) * 100;
}

export function mixerFaderPercentToDb(value: number): number {
	const percent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
	return MIXER_MIN_DB + (percent / 100) * (MIXER_MAX_DB - MIXER_MIN_DB);
}

export function formatMixerDb(value: number): string {
	const db = clampMixerDb(value);
	if (db <= MIXER_MIN_DB) return '-inf';
	return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function meterLevelToPercent(value: number): number {
	if (!Number.isFinite(value) || value <= 0.001) return 0;
	const db = Math.min(6, Math.max(-60, 20 * Math.log10(value)));
	return ((db + 60) / 66) * 100;
}

export interface MeterBallistics {
	left: number;
	right: number;
	peakLeft: number;
	peakRight: number;
	holdLeftMs: number;
	holdRightMs: number;
	clippedUntil: number;
	lastTime: number;
}

export function createMeterBallistics(): MeterBallistics {
	return {
		left: 0,
		right: 0,
		peakLeft: 0,
		peakRight: 0,
		holdLeftMs: 0,
		holdRightMs: 0,
		clippedUntil: 0,
		lastTime: 0
	};
}

function advanceMeterChannel(
	display: number,
	peak: number,
	holdMs: number,
	target: number,
	deltaSeconds: number
): [number, number, number] {
	const nextDisplay =
		target >= display
			? display + (target - display) * (1 - Math.exp(-deltaSeconds / 0.02))
			: Math.max(target, display - deltaSeconds * 1.25);
	if (nextDisplay >= peak) return [nextDisplay, nextDisplay, 350];
	if (holdMs > 0) return [nextDisplay, peak, Math.max(0, holdMs - deltaSeconds * 1000)];
	return [nextDisplay, Math.max(nextDisplay, peak - deltaSeconds * 0.9), 0];
}

export function advanceMeterBallistics(
	state: MeterBallistics,
	targetLeft: number,
	targetRight: number,
	now: number
): void {
	const deltaSeconds = state.lastTime > 0 ? Math.min(0.05, (now - state.lastTime) / 1000) : 1 / 60;
	state.lastTime = now;
	[state.left, state.peakLeft, state.holdLeftMs] = advanceMeterChannel(
		state.left,
		state.peakLeft,
		state.holdLeftMs,
		Math.max(0, targetLeft),
		deltaSeconds
	);
	[state.right, state.peakRight, state.holdRightMs] = advanceMeterChannel(
		state.right,
		state.peakRight,
		state.holdRightMs,
		Math.max(0, targetRight),
		deltaSeconds
	);
	if (targetLeft > 1 || targetRight > 1) state.clippedUntil = now + 1200;
}
