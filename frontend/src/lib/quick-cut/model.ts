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
	const merged: QuickCutSegment[] = [];
	let current: QuickCutSegment | null = null;
	for (const seg of segments) {
		if (!seg.enabled) {
			if (current) {
				merged.push(current);
				current = null;
			}
			merged.push({ ...seg });
			continue;
		}
		if (!current) {
			current = { ...seg };
			continue;
		}
		const canMerge =
			current.sourceId === seg.sourceId &&
			seg.start <= current.end &&
			seg.enabled !== false &&
			current.enabled !== false;
		if (canMerge) {
			current = {
				...current,
				end: Math.max(current.end, seg.end),
				name: current.name ?? seg.name
			};
		} else {
			merged.push(current);
			current = { ...seg };
		}
	}
	if (current) merged.push(current);
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
	const durationById = new Map<string, number>();
	if (sources instanceof Map) {
		for (const [k, v] of sources) durationById.set(k, v);
	} else if (Array.isArray(sources)) {
		for (const s of sources) {
			if ('id' in s && 'duration' in s) {
				// SAFETY: s has id/duration per in check, safe per validation
				const sid = (s as { id: string }).id;
				// SAFETY: s has id/duration per in check, safe per validation
				const dur = (s as { duration: number }).duration;
				durationById.set(sid, dur);
			}
		}
	} else {
		for (const seg of segments) durationById.set(seg.sourceId, duration);
	}
	for (const seg of segments) {
		if (!seg.sourceId || !durationById.has(seg.sourceId)) {
			errors.push({
				segmentId: seg.id,
				kind: 'missing_source',
				message: 'Segment references missing source.'
			});
			continue;
		}
		const d = durationById.get(seg.sourceId)!;
		errors.push(...validateSegment(seg, d));
	}
	const enabled = segments.filter((s) => s.enabled !== false);
	const bySource = new Map<string, QuickCutSegment[]>();
	for (const seg of enabled) {
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
	const enabled = segments.filter((s) => s.enabled !== false);
	const bySource = new Map<string, QuickCutSegment[]>();
	for (const seg of enabled) {
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
) {
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
) {
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

export function findSnapKeyframe(time: number, keyframes: number[]) {
	if (keyframes.length === 0) return { snapped: time, delta: 0, direction: 'unknown' as const };
	let before: number | null = null;
	let after: number | null = null;
	for (const kf of keyframes) {
		if (kf <= time) before = kf;
		if (kf >= time && after === null) after = kf;
	}
	// SAFETY: validated shape before cast
	if (before === null)
		return { snapped: after!, delta: after! - time, direction: 'after' as const };
	// SAFETY: validated shape before cast
	if (after === null)
		return { snapped: before, delta: before - time, direction: 'before' as const };
	const dBefore = time - before;
	const dAfter = after - time;
	if (dBefore <= dAfter)
		return {
			snapped: before,
			delta: before - time,
			// SAFETY: validated shape before cast
			direction: before === time ? ('exact' as const) : ('before' as const)
		};
	// SAFETY: validated shape before cast
	return { snapped: after, delta: after - time, direction: 'after' as const };
}

export function keyframeStatusForSegment(segment: QuickCutSegment, keyframes: number[]) {
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
	return segments
		.filter((s) => s.enabled !== false)
		.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
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
	merge: boolean,
	sources?: QuickCutSource[] | QuickCutSourceMetadata[]
) {
	if (segments.length === 0) return { wasLossless: false, reason: 'No segments selected.' };
	const tolerance = 0.06;
	const getKfs = (sid: string): number[] => {
		if (Array.isArray(keyframesBySource)) return keyframesBySource;
		return keyframesBySource.get(sid) ?? [];
	};
	const getState = (sid: string): 'known' | 'unknown' | 'audio-only' => {
		if (!sources) return 'known';
		// SAFETY: sources is QuickCutSource[] per overload, safe per type guard
		const src =
			(sources as QuickCutSource[]).find((s) => s.id === sid) ??
			((sources as QuickCutSourceMetadata[]).find((s) => s.id === sid) as
				| QuickCutSource
				| QuickCutSourceMetadata
				| undefined);
		// SAFETY: keyframeState is known/unknown/audio-only per probed source
		return (src?.keyframeState as 'known' | 'unknown' | 'audio-only') ?? 'unknown';
	};
	const isAligned = (time: number, sid: string): boolean => {
		if (time <= tolerance) return true;
		const state = getState(sid);
		if (state === 'unknown') return false;
		if (state === 'audio-only') return true;
		const kfs = getKfs(sid);
		return findNearestKeyframe(time, kfs, tolerance).aligned;
	};
	if (cutMode === 'exact') {
		for (const seg of segments) {
			const state = getState(seg.sourceId);
			if (state === 'unknown') {
				return {
					wasLossless: false,
					reason: `Keyframe index unknown for ${seg.sourceId.slice(0, 6)}; exact cut requires re-encode.`
				};
			}
			if (state === 'audio-only') continue;
			if (!isAligned(seg.start, seg.sourceId)) {
				return {
					wasLossless: false,
					reason: `Start ${seg.start.toFixed(2)}s is not on a keyframe. Exact cut will re-encode.`
				};
			}
		}
		return { wasLossless: true, reason: 'All starts are on keyframes. Stream copy is possible.' };
	}
	for (const seg of segments) {
		const state = getState(seg.sourceId);
		if (state === 'unknown') {
			return {
				wasLossless: false,
				reason: `Keyframe index unknown; cannot claim lossless for ${seg.sourceId.slice(0, 6)}.`
			};
		}
		if (state === 'audio-only') continue;
		const kfs = getKfs(seg.sourceId);
		const { aligned, distance } = findNearestKeyframe(seg.start, kfs, tolerance);
		if (!aligned && distance !== null && distance > tolerance) {
			const snap = findSnapKeyframe(seg.start, kfs);
			if (snap.direction === 'unknown') {
				return {
					wasLossless: false,
					reason: `Unknown keyframe data for ${seg.sourceId.slice(0, 6)}.`
				};
			}
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
	const enabled = segments.filter((s) => s.enabled !== false);
	const sizeById = new Map<string, { size: number; duration: number }>();
	for (const s of sources) sizeById.set(s.id, { size: s.size, duration: s.duration });
	let total = 0;
	for (const seg of enabled) {
		const meta = sizeById.get(seg.sourceId);
		if (!meta || meta.duration <= 0) total += 5 * 1024 * 1024;
		else total += ((seg.end - seg.start) / meta.duration) * meta.size;
	}
	return Math.ceil(total * 1.08);
}
