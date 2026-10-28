/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening */
import type {
	TimelineItem,
	TimelineTrack,
	SubComposition,
	AudioDuckingSettings
} from '../project/types';

export const DUCKING_DEFAULT_ATTACK_SEC = 0.08;
export const DUCKING_DEFAULT_RELEASE_SEC = 0.25;
export const DUCKING_MIN_DB = -60;
export const DUCKING_MAX_DB = 0;
export const DUCKING_MAX_ATTACK_SEC = 5;
export const DUCKING_MAX_RELEASE_SEC = 5;

export type { AudioDuckingSettings } from '../project/types';

type DuckableMixEntry = {
	itemId: string;
	trackId?: string;
	ducking?: AudioDuckingSettings;
	duckStartSeconds?: number;
	duckEndSeconds?: number;
	duckTrackAliases?: string[];
};

export interface MixEntryDuckWindow {
	itemId: string;
	trackId?: string;
	trackAliases?: string[];
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

export function collectMixEntryDuckWindows(entries: DuckableMixEntry[]): MixEntryDuckWindow[] {
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
			trackAliases: entry.duckTrackAliases ?? (entry.trackId ? [entry.trackId] : undefined),
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
	target: {
		itemId: string;
		trackId?: string;
		trackAliases?: string[];
		duckTrackAliases?: string[];
	},
	windows: MixEntryDuckWindow[]
): number {
	let deepestDb = 0;
	const targetAliases =
		(target as { trackAliases?: string[]; duckTrackAliases?: string[] }).trackAliases ??
		(target as { trackAliases?: string[]; duckTrackAliases?: string[] }).duckTrackAliases ??
		(target.trackId ? [target.trackId] : []);
	for (const w of windows) {
		if (w.itemId === target.itemId) continue;
		if (w.targetTrackIds) {
			const matches = targetAliases.some((alias) => w.targetTrackIds!.includes(alias));
			const directMatch = w.targetTrackIds.includes(target.trackId ?? '');
			if (!matches && !directMatch) continue;
		}
		const db = duckGainDbAtTime(timeSeconds, w);
		if (db < deepestDb) deepestDb = db;
	}
	return deepestDb === 0 ? 1 : Math.pow(10, deepestDb / 20);
}
