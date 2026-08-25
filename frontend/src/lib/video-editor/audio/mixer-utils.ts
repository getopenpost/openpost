export const FADER_DB_MIN = -60;
export const FADER_DB_MAX = 12;
export const FADER_DB_RANGE = FADER_DB_MAX - FADER_DB_MIN;
export const CLIP_DB = 0;

export function clampDb(db: number): number {
	if (!Number.isFinite(db)) return 0;
	return Math.max(FADER_DB_MIN, Math.min(FADER_DB_MAX, db));
}

export function dbToGain(db: number): number {
	if (!Number.isFinite(db)) return 1;
	if (db <= FADER_DB_MIN) return 0;
	return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
	if (!Number.isFinite(gain) || gain <= 0) return FADER_DB_MIN;
	if (gain <= 0.000999) return FADER_DB_MIN;
	const db = 20 * Math.log10(gain);
	return Math.max(FADER_DB_MIN, Math.min(FADER_DB_MAX, db));
}

export function dbToFaderPercent(db: number): number {
	if (!Number.isFinite(db)) return 83.333;
	const clamped = clampDb(db);
	if (clamped <= FADER_DB_MIN) return 0;
	if (clamped >= FADER_DB_MAX) return 100;
	return ((clamped - FADER_DB_MIN) / FADER_DB_RANGE) * 100;
}

export function faderPercentToDb(percent: number): number {
	const clamped = Math.max(0, Math.min(100, percent));
	return (clamped / 100) * FADER_DB_RANGE + FADER_DB_MIN;
}

export function formatFaderDb(db: number): string {
	if (!Number.isFinite(db)) return '+0.0';
	if (db <= FADER_DB_MIN + 0.05) return '-inf';
	return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function formatMeterDb(level: number): string {
	if (level <= 0.000001) return '-inf dB';
	const db = 20 * Math.log10(Math.max(0.000001, level));
	if (db <= FADER_DB_MIN) return '-inf dB';
	return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function linearLevelToPercent(level: number): number {
	if (level <= 0.000001) return 0;
	const db = 20 * Math.log10(level);
	const clamped = Math.max(FADER_DB_MIN, Math.min(6, db));
	// Map -60..6 dB to 0..100
	return ((clamped - FADER_DB_MIN) / (6 - FADER_DB_MIN)) * 100;
}

export function isClippingGain(gain: number): boolean {
	return gain > 1.0001;
}

export function isClippingDb(db: number): boolean {
	return db > 0.05;
}

export function isClippingLevel(level: number): boolean {
	return level > 1.0001;
}

export function nextClippingHold(isClipping: boolean, wasClipping: boolean, holdMs = 1200): boolean {
	if (isClipping) return true;
	if (!wasClipping) return false;
	return false;
}
