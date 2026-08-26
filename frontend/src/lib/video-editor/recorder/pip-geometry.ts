/**
 * PiP geometry for screen+camera compositing.
 *
 * Normalized coordinates (0..1) relative to screen canvas so the same
 * geometry applies to preview and the 30fps MediaRecorder composite output.
 * Draggable placement replaces the prior hard-coded bottom-right.
 */

const STORAGE_KEY = 'openpost-video-editor-pip-geometry-v1';

export interface PipGeometry {
	/** Normalized left (0..1) */
	x: number;
	/** Normalized top (0..1) */
	y: number;
	/** Normalized width (0.1..0.5) */
	width: number;
	/** Aspect preserved; height derived from width * pipAspect, clamped to canvas */
	placement: 'custom';
}

export const PIP_DEFAULT: PipGeometry = {
	x: 0.74,
	y: 0.72,
	width: 0.22,
	placement: 'custom'
};

const MIN_W = 0.1;
const MAX_W = 0.45;
const MIN_MARGIN = 0.008;

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

export function clampPipGeometry(value: Partial<PipGeometry>): PipGeometry {
	const width = clamp(value.width ?? PIP_DEFAULT.width, MIN_W, MAX_W);
	const x = clamp(value.x ?? PIP_DEFAULT.x, MIN_MARGIN, 1 - width - MIN_MARGIN);
	const safeY = clamp(value.y ?? PIP_DEFAULT.y, MIN_MARGIN, 0.92);
	return { x, y: safeY, width, placement: 'custom' };
}

export function pipRectForCanvas(
	geometry: PipGeometry,
	canvasWidth: number,
	canvasHeight: number,
	sourceAspect: number
): PipGeometry & { height: number } {
	const w = Math.round(canvasWidth * clamp(geometry.width, MIN_W, MAX_W));
	const h = Math.round(w / Math.max(0.5, Math.min(2.5, sourceAspect || 1.78)));
	const maxX = Math.max(0, canvasWidth - w - Math.round(canvasWidth * MIN_MARGIN));
	const maxY = Math.max(0, canvasHeight - h - Math.round(canvasHeight * MIN_MARGIN));
	const x = Math.round(clamp(geometry.x, MIN_MARGIN, 1) * canvasWidth);
	const y = Math.round(clamp(geometry.y, MIN_MARGIN, 1) * canvasHeight);
	return {
		x: Math.max(0, Math.min(maxX, x)),
		y: Math.max(0, Math.min(maxY, y)),
		width: w,
		height: h,
		placement: 'custom'
	};
}

export function loadPipGeometry(): PipGeometry {
	// SAFETY: localStorage is browser storage boundary
	if (typeof localStorage === 'undefined') return PIP_DEFAULT;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return PIP_DEFAULT;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return PIP_DEFAULT;
		// SAFETY: parsed is JSON boundary, validated field-by-field below
		// SAFETY: parsed is JSON boundary, validated field-by-field below
		const candidate = parsed as Record<string, unknown>;
		return clampPipGeometry({
			x: isNumber(candidate.x) ? candidate.x : undefined,
			y: isNumber(candidate.y) ? candidate.y : undefined,
			width: isNumber(candidate.width) ? candidate.width : undefined
		});
	} catch {
		return PIP_DEFAULT;
	}
}

export function savePipGeometry(geometry: PipGeometry): void {
	// SAFETY: localStorage is browser storage boundary
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(clampPipGeometry(geometry)));
	} catch {
		// Quota or private mode — silently keep in-memory default.
	}
}

export function pipGeometryStorageKeyForTesting(): string {
	return STORAGE_KEY;
}
