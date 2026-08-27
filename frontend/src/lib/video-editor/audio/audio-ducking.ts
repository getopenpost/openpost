/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening */
import type { TimelineItem, TimelineTrack, SubComposition } from '../project/types';
import type { MixEntry } from '../media/render-plan';

export const DUCKING_DEFAULT_ATTACK_SEC = 0.08;
export const DUCKING_DEFAULT_RELEASE_SEC = 0.25;
export const DUCKING_MIN_DB = -60;
export const DUCKING_MAX_DB = 0;
export const DUCKING_MAX_ATTACK_SEC = 5;
export const DUCKING_MAX_RELEASE_SEC = 5;

export interface AudioDuckingSettings {
	duckOthersDb: number;
	attackSec?: number;
	releaseSec?: number;
	targetTrackIds?: string[];
}

export interface DuckingSource {
	itemId: string;
	trackId: string;
	startFrame: number;
	endFrame: number;
	duckDb: number;
	attackFrames: number;
	releaseFrames: number;
	targetTrackIds?: string[];
}

export interface MixEntryDuckWindow {
	itemId: string;
	trackId?: string;
	startSeconds: number;
	endSeconds: number;
	duckDb: number;
	attackSeconds: number;
	releaseSeconds: number;
	targetTrackIds?: string[];
}

function clampDb(value: number): number {
	if (!Number.isFinite(value)) return DUCKING_MIN_DB;
	return Math.min(DUCKING_MAX_DB, Math.max(DUCKING_MIN_DB, value));
}

function clampAttack(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DUCKING_DEFAULT_ATTACK_SEC;
	return Math.min(DUCKING_MAX_ATTACK_SEC, Math.max(0, value));
}

function clampRelease(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DUCKING_DEFAULT_RELEASE_SEC;
	return Math.min(DUCKING_MAX_RELEASE_SEC, Math.max(0, value));
}

export function normalizeAudioDucking(
	raw: AudioDuckingSettings | null | undefined
): AudioDuckingSettings | undefined {
	if (!raw || typeof raw.duckOthersDb !== 'number' || !Number.isFinite(raw.duckOthersDb))
		return undefined;
	const duckOthersDb = clampDb(raw.duckOthersDb);
	if (!(duckOthersDb < 0)) return undefined;
	const out: AudioDuckingSettings = { duckOthersDb };
	const attackSec = clampAttack(raw.attackSec);
	const releaseSec = clampRelease(raw.releaseSec);
	if (Math.abs(attackSec - DUCKING_DEFAULT_ATTACK_SEC) > 1e-6) out.attackSec = attackSec;
	if (Math.abs(releaseSec - DUCKING_DEFAULT_RELEASE_SEC) > 1e-6) out.releaseSec = releaseSec;
	if (raw.targetTrackIds && raw.targetTrackIds.length > 0) {
		const ids = [
			...new Set(raw.targetTrackIds.filter((id) => typeof id === 'string' && id.length > 0))
		];
		if (ids.length > 0) out.targetTrackIds = ids;
	}
	return out;
}

export function isValidAudioDucking(raw: unknown): boolean {
	if (!raw || typeof raw !== 'object') return false;
	const candidate = raw as Record<string, unknown>;
	return (
		typeof candidate.duckOthersDb === 'number' &&
		Number.isFinite(candidate.duckOthersDb) &&
		(candidate.duckOthersDb as number) < 0 &&
		(candidate.duckOthersDb as number) >= DUCKING_MIN_DB
	);
}

export function dbToGain(db: number): number {
	if (db <= DUCKING_MIN_DB) return 0;
	return Math.pow(10, db / 20);
}

function isAudibleTrack(track: TimelineTrack, anySolo: boolean): boolean {
	if (track.muted || track.visible === false) return false;
	if (!anySolo) return true;
	return track.solo;
}

function isAudioBearingItem(item: TimelineItem): boolean {
	return item.type === 'audio' || item.type === 'video';
}

function duckingSourceFromItem(
	item: TimelineItem,
	trackId: string,
	fps: number,
	window?: { startFrame: number; endFrame: number }
): DuckingSource | null {
	const raw = (item as TimelineItem & { audioDucking?: AudioDuckingSettings }).audioDucking;
	const normalized = normalizeAudioDucking(raw);
	if (!normalized) return null;
	if (!isAudioBearingItem(item)) return null;
	return {
		itemId: item.id,
		trackId,
		startFrame: window?.startFrame ?? item.from,
		endFrame: window?.endFrame ?? item.from + item.durationInFrames,
		duckDb: normalized.duckOthersDb,
		attackFrames: (normalized.attackSec ?? DUCKING_DEFAULT_ATTACK_SEC) * fps,
		releaseFrames: (normalized.releaseSec ?? DUCKING_DEFAULT_RELEASE_SEC) * fps,
		...(normalized.targetTrackIds ? { targetTrackIds: normalized.targetTrackIds } : {})
	};
}

interface WrapperTiming {
	compFrom: number;
	wrapperSpeed: number;
	wrapperSourceFps: number;
	sourceOffset: number;
	wrapperSourceEnd: number;
}

function resolveWrapper(item: TimelineItem, fps: number): WrapperTiming {
	const wrapperSpeed = item.speed ?? 1;
	const wrapperSourceFps = item.sourceFps ?? fps;
	const sourceOffset = item.sourceStart ?? 0;
	return {
		compFrom: item.from,
		wrapperSpeed,
		wrapperSourceFps,
		sourceOffset,
		wrapperSourceEnd:
			item.sourceEnd ??
			sourceOffset + (item.durationInFrames / fps) * wrapperSpeed * wrapperSourceFps
	};
}

interface NestedWindow {
	overlapStart: number;
	overlapEnd: number;
	effectiveStart: number;
	effectiveEnd: number;
	effectiveDuration: number;
	effectiveSourceStart: number;
}

function timelineToSourceFrames(
	frames: number,
	speed: number,
	fps: number,
	sourceFps: number
): number {
	if (speed === 0) return 0;
	return (frames / fps) * speed * sourceFps;
}

function sourceToTimelineFrames(
	sourceFrames: number,
	speed: number,
	sourceFps: number,
	fps: number
): number {
	if (sourceFps === 0) return 0;
	return (sourceFrames / sourceFps / speed) * fps;
}

function mapNestedWindow(
	subItem: TimelineItem,
	wrapper: WrapperTiming,
	fps: number
): NestedWindow | null {
	const { sourceOffset, wrapperSourceEnd, compFrom, wrapperSpeed, wrapperSourceFps } = wrapper;
	const overlapStart = Math.max(subItem.from, sourceOffset);
	const overlapEnd = Math.min(subItem.from + subItem.durationInFrames, wrapperSourceEnd);
	if (overlapEnd <= overlapStart) return null;
	const effectiveStart =
		compFrom +
		sourceToTimelineFrames(overlapStart - sourceOffset, wrapperSpeed, wrapperSourceFps, fps);
	const effectiveEnd =
		compFrom +
		sourceToTimelineFrames(overlapEnd - sourceOffset, wrapperSpeed, wrapperSourceFps, fps);
	const effectiveDuration = Math.max(1, effectiveEnd - effectiveStart);
	const baseSourceStart = subItem.sourceStart ?? 0;
	const effectiveSourceStart =
		baseSourceStart +
		timelineToSourceFrames(
			overlapStart - subItem.from,
			subItem.speed ?? 1,
			wrapperSourceFps,
			subItem.sourceFps ?? wrapperSourceFps
		);
	return {
		overlapStart,
		overlapEnd,
		effectiveStart,
		effectiveEnd,
		effectiveDuration,
		effectiveSourceStart
	};
}

function buildNestedWrapper(
	subItem: TimelineItem,
	window: NestedWindow,
	wrapper: WrapperTiming
): TimelineItem {
	return {
		...subItem,
		from: window.effectiveStart,
		durationInFrames: window.effectiveDuration,
		speed: (subItem.speed ?? 1) * wrapper.wrapperSpeed,
		sourceStart: window.effectiveSourceStart,
		sourceFps: subItem.sourceFps ?? wrapper.wrapperSourceFps,
		...(subItem.sourceEnd !== undefined && {
			sourceEnd: Math.max(
				window.effectiveSourceStart + 1,
				subItem.sourceEnd -
					timelineToSourceFrames(
						subItem.from + subItem.durationInFrames - window.overlapEnd,
						subItem.speed ?? 1,
						wrapper.wrapperSourceFps,
						subItem.sourceFps ?? wrapper.wrapperSourceFps
					)
			)
		})
	};
}

function collectNested(
	wrapperItem: TimelineItem,
	rootTrackId: string,
	fps: number,
	visited: ReadonlySet<string>,
	compositionsById: Map<string, SubComposition>
): DuckingSource[] {
	if (!wrapperItem.compositionId || visited.has(wrapperItem.compositionId)) return [];
	const subComp = compositionsById.get(wrapperItem.compositionId);
	if (!subComp) return [];
	const wrapper = resolveWrapper(wrapperItem, fps);
	const nestedVisited = new Set(visited);
	nestedVisited.add(wrapperItem.compositionId);
	const sources: DuckingSource[] = [];
	for (const subItem of subComp.items) {
		const subTrack = subComp.tracks.find((t) => t.id === subItem.trackId);
		if (subTrack?.muted === true) continue;
		const win = mapNestedWindow(subItem, wrapper, fps);
		if (!win) continue;
		if (subItem.compositionId) {
			const own = duckingSourceFromItem(subItem, rootTrackId, fps, {
				startFrame: win.effectiveStart,
				endFrame: win.effectiveEnd
			});
			if (own) sources.push(own);
			sources.push(
				...collectNested(
					buildNestedWrapper(subItem, win, wrapper),
					rootTrackId,
					fps,
					nestedVisited,
					compositionsById
				)
			);
			continue;
		}
		const source = duckingSourceFromItem(subItem, rootTrackId, fps, {
			startFrame: win.effectiveStart,
			endFrame: win.effectiveEnd
		});
		if (source) sources.push(source);
	}
	return sources;
}

export function collectDuckingSources(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	fps: number,
	compositions: SubComposition[] = []
): DuckingSource[] {
	const compositionsById = new Map(compositions.map((c) => [c.id, c]));
	const anySolo = tracks.some((t) => t.solo);
	return tracks
		.filter((track) => isAudibleTrack(track, anySolo))
		.flatMap((track) =>
			(items.filter((item) => item.trackId === track.id) ?? []).flatMap((item) => {
				const own = duckingSourceFromItem(item, track.id, fps);
				const sources = own ? [own] : [];
				if (item.compositionId) {
					sources.push(...collectNested(item, track.id, fps, new Set(), compositionsById));
				}
				return sources;
			})
		);
}

function duckingSourceGainDb(frame: number, source: DuckingSource): number {
	if (frame < source.startFrame || frame > source.endFrame + source.releaseFrames) return 0;
	if (source.attackFrames > 0 && frame < source.startFrame + source.attackFrames) {
		const progress = (frame - source.startFrame) / source.attackFrames;
		return source.duckDb * progress;
	}
	if (frame <= source.endFrame) return source.duckDb;
	if (source.releaseFrames <= 0) return 0;
	const progress = (frame - source.endFrame) / source.releaseFrames;
	return source.duckDb * (1 - progress);
}

export function duckGainAtFrame(
	frame: number,
	sources: readonly DuckingSource[],
	target: { itemId: string; trackId: string }
): number {
	let deepestDb = 0;
	for (const source of sources) {
		if (source.itemId === target.itemId) continue;
		if (source.targetTrackIds && !source.targetTrackIds.includes(target.trackId)) continue;
		const db = duckingSourceGainDb(frame, source);
		if (db < deepestDb) deepestDb = db;
	}
	return deepestDb === 0 ? 1 : dbToGain(deepestDb);
}

export function duckGainDbAtFrame(
	frame: number,
	sources: readonly DuckingSource[],
	target: { itemId: string; trackId: string }
): number {
	let deepestDb = 0;
	for (const source of sources) {
		if (source.itemId === target.itemId) continue;
		if (source.targetTrackIds && !source.targetTrackIds.includes(target.trackId)) continue;
		const db = duckingSourceGainDb(frame, source);
		if (db < deepestDb) deepestDb = db;
	}
	return deepestDb;
}

export function applyDuckingToSamples(
	samples: Float32Array,
	sources: readonly DuckingSource[],
	target: { itemId: string; trackId: string },
	segmentStartFrame: number,
	fps: number,
	sampleRate: number
): Float32Array {
	const spanFrames = (samples.length / sampleRate) * fps;
	const applicable = sources.filter(
		(source) =>
			source.itemId !== target.itemId &&
			(!source.targetTrackIds || source.targetTrackIds.includes(target.trackId)) &&
			source.startFrame < segmentStartFrame + spanFrames &&
			source.endFrame + source.releaseFrames > segmentStartFrame
	);
	if (applicable.length === 0) return samples;
	const output = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		const frame = segmentStartFrame + (i / sampleRate) * fps;
		let db = 0;
		for (const source of applicable) {
			const gdb = duckingSourceGainDb(frame, source);
			if (gdb < db) db = gdb;
		}
		output[i] = db === 0 ? samples[i]! : samples[i]! * dbToGain(db);
	}
	return output;
}

function duckGainDbAtTime(timeSeconds: number, source: MixEntryDuckWindow): number {
	if (timeSeconds < source.startSeconds) return 0;
	if (timeSeconds > source.endSeconds + source.releaseSeconds) return 0;
	if (source.attackSeconds > 0 && timeSeconds < source.startSeconds + source.attackSeconds) {
		const progress = (timeSeconds - source.startSeconds) / source.attackSeconds;
		return source.duckDb * progress;
	}
	if (timeSeconds <= source.endSeconds) return source.duckDb;
	if (source.releaseSeconds <= 0) return 0;
	const progress = (timeSeconds - source.endSeconds) / source.releaseSeconds;
	return source.duckDb * (1 - progress);
}

export function collectMixEntryDuckWindows(entries: MixEntry[]): MixEntryDuckWindow[] {
	return entries
		.filter(
			(entry) =>
				entry.ducking &&
				entry.duckStartSeconds !== undefined &&
				entry.duckEndSeconds !== undefined &&
				entry.ducking.duckOthersDb < 0
		)
		.map((entry) => ({
			itemId: entry.itemId,
			trackId: entry.trackId,
			startSeconds: entry.duckStartSeconds!,
			endSeconds: entry.duckEndSeconds!,
			duckDb: entry.ducking!.duckOthersDb,
			attackSeconds: entry.ducking!.attackSec ?? DUCKING_DEFAULT_ATTACK_SEC,
			releaseSeconds: entry.ducking!.releaseSec ?? DUCKING_DEFAULT_RELEASE_SEC,
			...(entry.ducking!.targetTrackIds ? { targetTrackIds: entry.ducking!.targetTrackIds } : {})
		}));
}

export function mixEntryDuckGainAtTime(
	timeSeconds: number,
	target: { itemId: string; trackId?: string },
	windows: MixEntryDuckWindow[]
): number {
	let deepestDb = 0;
	for (const w of windows) {
		if (w.itemId === target.itemId) continue;
		if (w.targetTrackIds && !w.targetTrackIds.includes(target.trackId ?? '')) continue;
		const db = duckGainDbAtTime(timeSeconds, w);
		if (db < deepestDb) deepestDb = db;
	}
	return deepestDb === 0 ? 1 : Math.pow(10, deepestDb / 20);
}
