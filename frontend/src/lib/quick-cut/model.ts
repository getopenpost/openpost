import type { CutMode, QuickCutSegment, SegmentValidationError } from './types';

const KEYFRAME_TOLERANCE = 0.05;
const MIN_SEGMENT_DURATION = 0.05;

function isFiniteNumber(value: number): boolean {
	return Number.isFinite(value) && !Number.isNaN(value);
}

export function createSegment(
	start: number,
	end: number,
	opts: { name?: string; id?: string } = {}
): QuickCutSegment {
	return {
		id: opts.id ?? crypto.randomUUID(),
		start,
		end,
		name: opts.name,
		enabled: true
	};
}

export function sortSegments(segments: QuickCutSegment[]): QuickCutSegment[] {
	return [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function normalizeSegments(segments: QuickCutSegment[]): QuickCutSegment[] {
	if (segments.length === 0) return [];
	const sorted = sortSegments(segments);
	const merged: QuickCutSegment[] = [];
	let current = { ...sorted[0]! };
	for (let i = 1; i < sorted.length; i++) {
		const next = sorted[i]!;
		if (next.start <= current.end) {
			current = {
				...current,
				end: Math.max(current.end, next.end),
				name: current.name ?? next.name
			};
		} else {
			merged.push(current);
			current = { ...next };
		}
	}
	merged.push(current);
	return merged;
}

export function validateSegment(
	segment: QuickCutSegment,
	duration: number
): SegmentValidationError[] {
	const errors: SegmentValidationError[] = [];
	if (!isFiniteNumber(segment.start) || !isFiniteNumber(segment.end)) {
		errors.push({
			segmentId: segment.id,
			kind: 'invalid_time',
			message: 'Start and end must be finite numbers.'
		});
		return errors;
	}
	if (segment.start < 0) {
		errors.push({
			segmentId: segment.id,
			kind: 'start_negative',
			message: 'Start time cannot be negative.'
		});
	}
	if (segment.end > duration + 0.001) {
		errors.push({
			segmentId: segment.id,
			kind: 'end_beyond_duration',
			message: 'End time is beyond the source duration.'
		});
	}
	if (segment.end <= segment.start) {
		errors.push({
			segmentId: segment.id,
			kind: 'end_not_after_start',
			message: 'End must be after start.'
		});
	}
	if (segment.end - segment.start < MIN_SEGMENT_DURATION) {
		errors.push({
			segmentId: segment.id,
			kind: 'zero_length',
			message: 'Segment is too short.'
		});
	}
	return errors;
}

export function validateSegments(
	segments: QuickCutSegment[],
	duration: number
): SegmentValidationError[] {
	const errors: SegmentValidationError[] = [];
	for (const seg of segments) {
		errors.push(...validateSegment(seg, duration));
	}
	const sorted = sortSegments(segments);
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1]!;
		const cur = sorted[i]!;
		if (cur.start < prev.end - 0.001) {
			errors.push({
				segmentId: cur.id,
				kind: 'overlap',
				message: `Segment overlaps ${prev.name ?? prev.id.slice(0, 6)}.`
			});
		}
	}
	return errors;
}

export function hasOverlap(segments: QuickCutSegment[]): boolean {
	const sorted = sortSegments(segments);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i]!.start < sorted[i - 1]!.end - 0.001) return true;
	}
	return false;
}

export function addSegment(
	segments: QuickCutSegment[],
	newSegment: QuickCutSegment,
	options: { allowOverlap?: boolean } = {}
): { segments: QuickCutSegment[]; error?: string } {
	const withoutOverlap = options.allowOverlap ? false : hasOverlap([...segments, newSegment]);
	if (withoutOverlap) {
		return {
			segments,
			error: 'Segments cannot overlap. Adjust the range or enable normalization.'
		};
	}
	return { segments: [...segments, newSegment] };
}

export function removeSegment(segments: QuickCutSegment[], id: string): QuickCutSegment[] {
	return segments.filter((s) => s.id !== id);
}

export function reorderSegment(
	segments: QuickCutSegment[],
	fromIndex: number,
	toIndex: number
): QuickCutSegment[] {
	if (fromIndex < 0 || fromIndex >= segments.length || toIndex < 0 || toIndex >= segments.length) {
		return segments;
	}
	const next = [...segments];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved!);
	return next;
}

export function editSegment(
	segments: QuickCutSegment[],
	id: string,
	patch: Partial<Pick<QuickCutSegment, 'start' | 'end' | 'name' | 'enabled'>>
): QuickCutSegment[] {
	return segments.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function moveSegmentBy(
	segment: QuickCutSegment,
	delta: number,
	duration: number
): QuickCutSegment {
	const length = segment.end - segment.start;
	let start = segment.start + delta;
	let end = start + length;
	if (start < 0) {
		start = 0;
		end = length;
	}
	if (end > duration) {
		end = duration;
		start = Math.max(0, end - length);
	}
	return { ...segment, start, end };
}

export function findNearestKeyframe(
	time: number,
	keyframes: number[],
	tolerance = KEYFRAME_TOLERANCE
): { nearest: number | null; distance: number | null; aligned: boolean } {
	if (keyframes.length === 0) return { nearest: null, distance: null, aligned: false };
	let nearest = keyframes[0]!;
	let dist = Math.abs(time - nearest);
	for (const kf of keyframes) {
		const d = Math.abs(time - kf);
		if (d < dist) {
			dist = d;
			nearest = kf;
		}
	}
	return { nearest, distance: dist, aligned: dist <= tolerance };
}

export function keyframeStatusForSegment(
	segment: QuickCutSegment,
	keyframes: number[]
): { start: ReturnType<typeof findNearestKeyframe>; end: ReturnType<typeof findNearestKeyframe> } {
	return {
		start: findNearestKeyframe(segment.start, keyframes),
		end: findNearestKeyframe(segment.end, keyframes)
	};
}

export function snapToKeyframe(time: number, keyframes: number[]): number {
	const { nearest } = findNearestKeyframe(time, keyframes, 10);
	return nearest ?? time;
}

export function totalKeptDuration(segments: QuickCutSegment[]): number {
	return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

export function formatTimecode(seconds: number): string {
	if (!isFiniteNumber(seconds)) return '00:00.0';
	const sign = seconds < 0 ? '-' : '';
	const abs = Math.abs(seconds);
	const m = Math.floor(abs / 60);
	const s = abs % 60;
	return `${sign}${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function assessExport(
	segments: QuickCutSegment[],
	keyframes: number[],
	cutMode: CutMode,
	merge: boolean
): { wasLossless: boolean; reason: string } {
	if (segments.length === 0) return { wasLossless: false, reason: 'No segments selected.' };
	const tolerance = 0.06;
	const isAligned = (time: number): boolean => {
		if (time <= tolerance) return true;
		return findNearestKeyframe(time, keyframes, tolerance).aligned;
	};
	if (cutMode === 'exact') {
		for (const seg of segments) {
			if (!isAligned(seg.start)) {
				return {
					wasLossless: false,
					reason: `Start ${seg.start.toFixed(2)}s is not on a keyframe. Exact cut will re-encode.`
				};
			}
		}
		return { wasLossless: true, reason: 'All starts are on keyframes. Stream copy is possible.' };
	}
	for (const seg of segments) {
		const { aligned, distance } = findNearestKeyframe(seg.start, keyframes, tolerance);
		if (!aligned && distance !== null && distance > tolerance) {
			return {
				wasLossless: true,
				reason: `Start ${seg.start.toFixed(2)}s will snap to keyframe (Δ ${distance.toFixed(3)}s).`
			};
		}
	}
	if (merge && segments.length > 1 && cutMode === 'exact') {
		for (const seg of segments)
			if (!isAligned(seg.start))
				return {
					wasLossless: false,
					reason: 'Merged exact cuts with non-keyframe starts will be re-encoded.'
				};
	}
	return { wasLossless: true, reason: 'Lossless copy using nearest keyframes.' };
}

export function parseTimecode(input: string): number | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const parts = trimmed.split(':');
	if (parts.length === 1) {
		const v = Number(parts[0]);
		return isFiniteNumber(v) ? v : null;
	}
	if (parts.length === 2) {
		const m = Number(parts[0]);
		const s = Number(parts[1]);
		if (!isFiniteNumber(m) || !isFiniteNumber(s)) return null;
		return m * 60 + s;
	}
	if (parts.length === 3) {
		const h = Number(parts[0]);
		const m = Number(parts[1]);
		const s = Number(parts[2]);
		if (!isFiniteNumber(h) || !isFiniteNumber(m) || !isFiniteNumber(s)) return null;
		return h * 3600 + m * 60 + s;
	}
	return null;
}
