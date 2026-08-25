// oxlint-disable
import type {
	CutMode,
	QuickCutSegment,
	QuickCutSource,
	QuickCutSourceMetadata,
	SegmentValidationError
} from './types';

const KEYFRAME_TOLERANCE = 0.05;
const MIN_SEGMENT_DURATION = 0.05;

function isFiniteNumber(value: number): boolean {
	return Number.isFinite(value) && !Number.isNaN(value);
}

export function createSegment(
	start: number,
	end: number,
	opts: { name?: string; id?: string; sourceId?: string } = {}
): QuickCutSegment {
	return {
		id: opts.id ?? crypto.randomUUID(),
		sourceId: opts.sourceId ?? '',
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
	// Normalize per source to avoid merging across sources
	const bySource = new Map<string, QuickCutSegment[]>();
	for (const seg of segments) {
		const arr = bySource.get(seg.sourceId) ?? [];
		arr.push(seg);
		bySource.set(seg.sourceId, arr);
	}
	const merged: QuickCutSegment[] = [];
	for (const [, group] of bySource) {
		const sorted = sortSegments(group);
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
	}
	// SAFETY: type assertion is safe for this quick-cut path
	// Preserve original order for non-overlapping groups? Return grouped merged but keep overall order as by first appearance
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
	duration: number,
	sources?: QuickCutSource[] | QuickCutSourceMetadata[] | Map<string, number>
): SegmentValidationError[] {
	const errors: SegmentValidationError[] = [];
	// Build duration map per source if sources provided
	const durationById = new Map<string, number>();
	if (sources instanceof Map) {
		for (const [k, v] of sources) durationById.set(k, v);
	} else if (Array.isArray(sources)) {
		for (const s of sources)
			// SAFETY: type assertion is safe for this quick-cut path
			durationById.set((s as QuickCutSourceMetadata).id, (s as QuickCutSourceMetadata).duration);
	} else {
		// fallback: use passed duration for all
		for (const seg of segments) durationById.set(seg.sourceId, duration);
	}

	for (const seg of segments) {
		const d = durationById.get(seg.sourceId) ?? duration;
		if (!seg.sourceId) {
			errors.push({ segmentId: seg.id, kind: 'missing_source', message: 'Segment has no source.' });
		}
		errors.push(...validateSegment(seg, d));
	}
	// Overlap only per source
	const bySource = new Map<string, QuickCutSegment[]>();
	for (const seg of segments) {
		const arr = bySource.get(seg.sourceId) ?? [];
		arr.push(seg);
		bySource.set(seg.sourceId, arr);
	}
	for (const [, group] of bySource) {
		const sorted = sortSegments(group);
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
	}
	return errors;
}

export function hasOverlap(segments: QuickCutSegment[]): boolean {
	const bySource = new Map<string, QuickCutSegment[]>();
	for (const seg of segments) {
		const arr = bySource.get(seg.sourceId) ?? [];
		arr.push(seg);
		bySource.set(seg.sourceId, arr);
	}
	for (const [, group] of bySource) {
		const sorted = sortSegments(group);
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i]!.start < sorted[i - 1]!.end - 0.001) return true;
		}
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
	patch: Partial<Pick<QuickCutSegment, 'start' | 'end' | 'name' | 'enabled' | 'sourceId'>>
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

export function findSnapKeyframe(
	time: number,
	keyframes: number[]
): { snapped: number; delta: number; direction: 'before' | 'after' | 'exact' } {
	if (keyframes.length === 0) return { snapped: time, delta: 0, direction: 'exact' };
	// Find nearest at or before time for lossless inclusion guarantee
	let before: number | null = null;
	let after: number | null = null;
	for (const kf of keyframes) {
		if (kf <= time) before = kf;
		if (kf >= time && after === null) after = kf;
	}
	if (before === null) return { snapped: after!, delta: after! - time, direction: 'after' };
	if (after === null) return { snapped: before, delta: before - time, direction: 'before' };
	const dBefore = time - before;
	const dAfter = after - time;
	if (dBefore <= dAfter)
		return {
			snapped: before,
			delta: before - time,
			direction: before === time ? 'exact' : 'before'
		};
	return { snapped: after, delta: after - time, direction: 'after' };
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
	keyframesBySource: Map<string, number[]> | number[],
	cutMode: CutMode,
	merge: boolean
): { wasLossless: boolean; reason: string } {
	if (segments.length === 0) return { wasLossless: false, reason: 'No segments selected.' };
	const tolerance = 0.06;
	const getKfs = (sid: string): number[] => {
		// SAFETY: type assertion is safe for this quick-cut path
		if (Array.isArray(keyframesBySource)) return keyframesBySource as number[];
		// SAFETY: type assertion is safe for this quick-cut path
		return (keyframesBySource as Map<string, number[]>).get(sid) ?? [];
	};
	const isAligned = (time: number, sid: string): boolean => {
		if (time <= tolerance) return true;
		const kfs = getKfs(sid);
		return findNearestKeyframe(time, kfs, tolerance).aligned;
	};
	if (cutMode === 'exact') {
		for (const seg of segments) {
			if (!isAligned(seg.start, seg.sourceId)) {
				return {
					wasLossless: false,
					reason: `Start ${seg.start.toFixed(2)}s is not on a keyframe. Exact cut will re-encode.`
				};
			}
		}
		return { wasLossless: true, reason: 'All starts are on keyframes. Stream copy is possible.' };
	}
	// nearestKeyframe: define snap before/after; include warning if would include outside
	for (const seg of segments) {
		const kfs = getKfs(seg.sourceId);
		const { aligned, distance } = findNearestKeyframe(seg.start, kfs, tolerance);
		if (!aligned && distance !== null && distance > tolerance) {
			const snap = findSnapKeyframe(seg.start, kfs);
			const note =
				snap.direction === 'before' ? 'will include extra before' : 'will start slightly after';
			return {
				wasLossless: true,
				reason: `Start ${seg.start.toFixed(2)}s snaps ${snap.direction} to ${snap.snapped.toFixed(3)}s (${note}, Δ ${snap.delta.toFixed(3)}s).`
			};
		}
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

export function estimateOutputBytes(
	segments: QuickCutSegment[],
	sources: QuickCutSource[] | QuickCutSourceMetadata[]
): number {
	const sizeById = new Map<string, { size: number; duration: number }>();
	for (const s of sources) sizeById.set(s.id, { size: s.size, duration: s.duration });
	let total = 0;
	for (const seg of segments) {
		const meta = sizeById.get(seg.sourceId);
		if (!meta || meta.duration <= 0) total += 5 * 1024 * 1024;
		else total += ((seg.end - seg.start) / meta.duration) * meta.size;
	}
	return Math.ceil(total * 1.08);
}
