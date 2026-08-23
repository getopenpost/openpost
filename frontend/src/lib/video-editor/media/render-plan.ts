/**
 * Pure planning math for the multi-track rendered export: output duration,
 * frame→source-time mapping, audio mixdown scheduling, transition blending,
 * paint order, and cue selection.
 *
 * Ported from FreeCut (MIT) — features/export/utils/timeline-to-composition.ts,
 * canvas-transitions.ts, and canvas-audio.ts (segment extraction), retargeted
 * to OpenPost's TimelineItem model.
 */

import type {
	SubtitleCue,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { activeValueAt } from '../timeline/actions/keyframes';
import { resolveTransitionWindow } from '../timeline/transition-planner';
import { audioCrossfadeGainAtFrame } from '../audio/transition-crossfade';

/** One scheduled clip in the offline audio mixdown. */
export interface MixEntry {
	itemId: string;
	mediaId: string;
	/** Timeline seconds where playback starts in the mixdown. */
	whenSeconds: number;
	/** Seconds into the source media where this clip begins. */
	sourceOffsetSeconds: number;
	/** Source seconds played per real second (the item's speed). */
	playbackRate: number;
	/** Real seconds this clip occupies in the mixdown. */
	durationSeconds: number;
	gainPoints: GainPoint[];
}

export interface GainPoint {
	whenSeconds: number;
	value: number;
}

export interface TransitionBlend {
	outgoingId: string;
	incomingId: string;
	progress: number;
	type: TimelineTransition['type'];
}

export function outputDurationFrames(items: TimelineItem[]): number {
	return items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0);
}

export function isVisibleAtFrame(item: TimelineItem, frame: number): boolean {
	return frame >= item.from && frame < item.from + item.durationInFrames;
}

/** Source-media seconds shown by a timeline item at an absolute timeline frame. */
export function frameToSourceSeconds(item: TimelineItem, frame: number, fps: number): number {
	const speed = item.speed ?? 1;
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
	return (item.sourceStart ?? 0) / sourceFps + ((frame - item.from) / fps) * speed;
}

function isAudible(track: TimelineTrack, anySolo: boolean): boolean {
	if (track.muted || track.visible === false) return false;
	if (!anySolo) return true;
	return track.solo;
}

const AUDIO_BEARING_TYPES: ReadonlySet<TimelineItem['type']> = new Set(['video', 'audio']);

/**
 * Schedule every audible clip for the OfflineAudioContext mixdown. Clips on
 * muted tracks drop out; solo tracks mute everything non-soloed. Static
 * volume × track volume forms the baseline gain, and keyframed volume
 * becomes per-point gain automation.
 */
export function planMixdown(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	fps: number,
	transitions: TimelineTransition[] = []
): MixEntry[] {
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const anySolo = tracks.some((track) => track.solo);
	const entries: MixEntry[] = [];
	for (const item of items) {
		if (!AUDIO_BEARING_TYPES.has(item.type) || !item.mediaId) continue;
		const track = trackById.get(item.trackId);
		if (!track || !isAudible(track, anySolo)) continue;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const speed = item.speed ?? 1;
		entries.push({
			itemId: item.id,
			mediaId: item.mediaId,
			whenSeconds: item.from / fps,
			sourceOffsetSeconds: (item.sourceStart ?? 0) / sourceFps,
			playbackRate: speed,
			durationSeconds: item.durationInFrames / fps,
			gainPoints: volumeGainPoints(item, track.volume ?? 1, fps, transitions, itemsById)
		});
	}
	return entries;
}

function volumeGainPoints(
	item: TimelineItem,
	trackVolume: number,
	fps: number,
	transitions: TimelineTransition[] = [],
	itemsById: Map<string, TimelineItem> = new Map()
): GainPoint[] {
	const baseGain = (item.volume ?? 1) * trackVolume;
	const track = item.keyframes?.volume;
	if (!track || track.frames.length === 0) {
		// Single-point clips still need exact endpoint crossfades at window boundaries.
		// Emit per-frame points when transitions touch this clip so the automation
		// can hit 1→0 and 0→1 exactly.
		const needsPerFrame = transitions.some((t) => {
			const from = itemsById.get(t.fromItemId);
			const to = itemsById.get(t.toItemId);
			if (!from || !to) return false;
			const window = resolveTransitionWindow(t, from, to);
			if (!window) return false;
			return (
				item.id === t.fromItemId ||
				item.id === t.toItemId ||
				isLinkedParticipant(item, t, itemsById)
			);
		});
		if (!needsPerFrame) return [{ whenSeconds: item.from / fps, value: baseGain }];
		const points: GainPoint[] = [];
		for (let frame = 0; frame <= item.durationInFrames; frame++) {
			const whenSeconds = Math.round(((item.from + frame) / fps) * 1000) / 1000;
			const crossfade = audioCrossfadeGainAtFrame(item, item.from + frame, transitions, itemsById);
			points.push({ whenSeconds, value: baseGain * crossfade });
		}
		return points;
	}
	const points: GainPoint[] = [];
	const seen = new Set<number>();
	for (let frame = 0; frame <= item.durationInFrames; frame++) {
		const animated = activeValueAt(item, 'volume', item.from + frame);
		if (animated === null) continue;
		const whenSeconds = Math.round(((item.from + frame) / fps) * 1000) / 1000;
		if (seen.has(whenSeconds)) continue;
		seen.add(whenSeconds);
		const crossfade = audioCrossfadeGainAtFrame(item, item.from + frame, transitions, itemsById);
		points.push({ whenSeconds, value: animated * crossfade });
	}
	return points.length > 0 ? points : [{ whenSeconds: item.from / fps, value: baseGain }];
}

function isLinkedParticipant(
	item: TimelineItem,
	transition: TimelineTransition,
	itemsById: Map<string, TimelineItem>
): boolean {
	if (!item.linkedGroupId) return false;
	const from = itemsById.get(transition.fromItemId);
	const to = itemsById.get(transition.toItemId);
	if (
		from &&
		item.linkedGroupId === from.linkedGroupId &&
		item.from === from.from &&
		item.durationInFrames === from.durationInFrames
	)
		return true;
	if (
		to &&
		item.linkedGroupId === to.linkedGroupId &&
		item.from === to.from &&
		item.durationInFrames === to.durationInFrames
	)
		return true;
	return false;
}

/**
 * Transition state at an absolute timeline frame, computed against an explicit
 * item map so export can run without touching live store state.
 */
export function transitionBlendAtFrame(
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>,
	frame: number
): TransitionBlend | null {
	for (const transition of transitions) {
		const from = itemsById.get(transition.fromItemId);
		const to = itemsById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window || frame < window.startFrame || frame >= window.endFrame) continue;
		const progress = Math.min(
			1,
			(frame - window.startFrame) / Math.max(1, window.durationInFrames)
		);
		return { outgoingId: from.id, incomingId: to.id, progress, type: transition.type };
	}
	return null;
}

/**
 * Items sorted bottom-layer-first for painting: tracks later in the order
 * list paint first, so the overlay track (order 0) ends up topmost.
 */
export function paintOrder(
	items: TimelineItem[] = [],
	tracks: TimelineTrack[] = []
): TimelineItem[] {
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	const anySolo = tracks.some((track) => track.solo);
	return items
		.filter((item) => {
			const track = trackById.get(item.trackId);
			return track !== undefined && (anySolo ? track.solo : track.visible !== false);
		})
		.sort(
			(a, b) => (trackById.get(b.trackId)?.order ?? 0) - (trackById.get(a.trackId)?.order ?? 0)
		);
}

/** The cue(s) showing at an absolute timeline frame (normally zero or one). */
export function selectCuesAtFrame(cues: SubtitleCue[], frame: number): SubtitleCue[] {
	return cues.filter((cue) => cue.startFrame <= frame && frame < cue.endFrame);
}
