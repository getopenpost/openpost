/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread */
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
	SubComposition,
	ProjectTimeline,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import type { AudioEqSettings } from '../audio/types';
import { activeValueAt } from '../timeline/keyframe-interpolation';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import {
	calculateTransitionProgress,
	resolveTransitionWindow
} from '../timeline/transition-planner';
import {
	hasLinkedAudioCompanion,
	transitionAudioExtentForItem,
	transitionGainSpansForItem,
	type TransitionGainSpan
} from '../audio/transition-crossfade';
import { audioClipFadeGainAtFrame } from './clip-fades';
import {
	appendResolvedAudioEqSources,
	getAudioEqSettings,
	prependResolvedAudioEqSources
} from '../audio/audio-eq';
import { getAudioPitchShiftSemitones } from '../audio/audio-pitch';
import type { ResolvedAudioEqSettings } from '../audio/types';
import { mixerDbToGain } from '../audio/mixer-utils';
import { normalizeAudioDucking, type AudioDuckingSettings } from '../audio/audio-ducking';

/** One scheduled clip in the offline audio mixdown. */
export interface MixEntry {
	/** Duck-source settings carried by this entry when it should attenuate others. */
	ducking?: AudioDuckingSettings;
	itemId: string;
	mediaId: string;
	/** Root mixer track used by preview channel strips. */
	trackId?: string;
	/** Timeline seconds where playback starts in the mixdown. */
	whenSeconds: number;
	/** Seconds into the source media where this clip begins. */
	sourceOffsetSeconds: number;
	/** Source seconds played per real second (the item's speed). */
	playbackRate: number;
	/** Independent pitch offset. Tempo remains owned by playbackRate. */
	pitchShiftSemitones: number;
	/** Ordered outer-to-inner parametric EQ stages. */
	audioEqStages: ResolvedAudioEqSettings[];
	/** Read the source window backward while keeping timeline time forward. */
	reversed: boolean;
	/** Real seconds this clip occupies in the mixdown. */
	durationSeconds: number;
	gainPoints: GainPoint[];
	/** Preview automation before the current root track fader. */
	previewGainPoints: GainPoint[];
	/** Current root track fader baked into gainPoints for export. */
	mixerTrackGain: number;
	transitionGainSpans: TransitionGainSpan[];
}

export function masterBusGain(
	timeline: Pick<ProjectTimeline, 'masterVolumeDb' | 'masterMuted'> | undefined
): number {
	return timeline?.masterMuted ? 0 : mixerDbToGain(timeline?.masterVolumeDb ?? 0);
}

export function applyMixEntryGain(entries: MixEntry[], gain: number): MixEntry[] {
	if (gain === 1) return entries;
	return entries.map((entry) => ({
		...entry,
		gainPoints: entry.gainPoints.map((point) => ({ ...point, value: point.value * gain })),
		previewGainPoints: entry.previewGainPoints.map((point) => ({
			...point,
			value: point.value * gain
		}))
	}));
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
	transition: TimelineTransition;
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
	const sourceStart = item.sourceStart ?? 0;
	const sourceDistance = ((frame - item.from) / fps) * speed * sourceFps;
	if (!item.isReversed) return (sourceStart + sourceDistance) / sourceFps;
	const sourceEnd =
		item.sourceEnd ?? sourceStart + (item.durationInFrames / fps) * speed * sourceFps;
	const upperFrame =
		item.sourceDuration === undefined ? Number.POSITIVE_INFINITY : item.sourceDuration - 1;
	return Math.min(upperFrame, Math.max(0, sourceEnd - 1 - sourceDistance)) / sourceFps;
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
 *
 * Audio EQ stages are ordered outer-to-inner: bus -> track -> clip.
 */
export function planMixdown(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	fps: number,
	transitions: TimelineTransition[] = [],
	busAudioEq?: AudioEqSettings | null
): MixEntry[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const anySolo = resolvedTracks.some((track) => track.solo);
	const entries: MixEntry[] = [];
	for (const item of items) {
		if (!AUDIO_BEARING_TYPES.has(item.type) || !item.mediaId) continue;
		if (hasLinkedAudioCompanion(item, items)) continue;
		const track = trackById.get(item.trackId);
		if (!track || !isAudible(track, anySolo)) continue;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const speed = item.speed ?? 1;
		const { beforeFrames, afterFrames } = transitionAudioExtentForItem(
			item,
			transitions,
			itemsById,
			fps
		);
		const startFrame = item.from - beforeFrames;
		const endFrame = item.from + item.durationInFrames + afterFrames;
		const previewGainPoints = volumeGainPoints(item, 1, fps, startFrame, endFrame);
		const mixerTrackGain = track.volume ?? 1;
		const rawDucking = (item as TimelineItem & { audioDucking?: AudioDuckingSettings })
			.audioDucking;
		const ducking = normalizeAudioDucking(rawDucking)
			? { ...normalizeAudioDucking(rawDucking)! }
			: undefined;
		entries.push({
			ducking,
			itemId: item.id,
			mediaId: item.mediaId,
			trackId: track.id,
			whenSeconds: startFrame / fps,
			sourceOffsetSeconds: item.isReversed
				? Math.max(
						0,
						(item.sourceEnd ??
							(item.sourceStart ?? 0) + (item.durationInFrames / fps) * speed * sourceFps) /
							sourceFps +
							(beforeFrames / fps) * speed
					)
				: Math.max(0, (item.sourceStart ?? 0) / sourceFps - (beforeFrames / fps) * speed),
			playbackRate: speed,
			pitchShiftSemitones: getAudioPitchShiftSemitones(item),
			audioEqStages: appendResolvedAudioEqSources(
				undefined,
				busAudioEq,
				track.audioEq,
				getAudioEqSettings(item)
			),
			reversed: item.isReversed === true,
			durationSeconds: (endFrame - startFrame) / fps,
			gainPoints: previewGainPoints.map((point) => ({
				...point,
				value: point.value * mixerTrackGain
			})),
			previewGainPoints,
			mixerTrackGain,
			transitionGainSpans: transitionGainSpansForItem(item, transitions, itemsById, fps)
		});
	}
	return entries;
}

function hasCompositionAudioCompanion(item: TimelineItem, items: TimelineItem[]): boolean {
	return (
		item.type === 'composition' &&
		item.compositionId !== undefined &&
		items.some(
			(candidate) =>
				candidate.type === 'audio' &&
				candidate.compositionId === item.compositionId &&
				candidate.from === item.from &&
				candidate.durationInFrames === item.durationInFrames &&
				(item.linkedGroupId ? candidate.linkedGroupId === item.linkedGroupId : true)
		)
	);
}

/** Flatten reusable sequence audio to leaf media entries for preview and export. */
export function planNestedMixdown(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	fps: number,
	transitions: TimelineTransition[] = [],
	compositions: SubComposition[] = [],
	ancestry: ReadonlySet<string> = new Set(),
	busAudioEq?: AudioEqSettings | null
): MixEntry[] {
	const entries = planMixdown(items, tracks, fps, transitions, busAudioEq);
	const resolvedTracks = effectiveMediaTracks(tracks);
	const compositionById = new Map(compositions.map((composition) => [composition.id, composition]));
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	const anySolo = resolvedTracks.some((track) => track.solo);
	const itemsById = new Map(items.map((item) => [item.id, item]));
	for (const wrapper of items) {
		if (!wrapper.compositionId || (wrapper.type !== 'composition' && wrapper.type !== 'audio'))
			continue;
		if (wrapper.type === 'composition' && hasCompositionAudioCompanion(wrapper, items)) continue;
		if (ancestry.has(wrapper.compositionId)) continue;
		const composition = compositionById.get(wrapper.compositionId);
		if (!composition) continue;
		const track = trackById.get(wrapper.trackId);
		if (!track || !isAudible(track, anySolo)) continue;
		const childEntries = applyMixEntryGain(
			planNestedMixdown(
				composition.items,
				composition.tracks,
				composition.fps,
				composition.transitions,
				compositions,
				new Set([...ancestry, wrapper.compositionId]),
				composition.busAudioEq
			),
			composition.masterMuted ? 0 : mixerDbToGain(composition.masterVolumeDb ?? 0)
		);
		const sourceFps = wrapper.sourceFps ?? composition.fps;
		const wrapperSpeed = wrapper.speed && wrapper.speed > 0 ? wrapper.speed : 1;
		const sourceStart = (wrapper.sourceStart ?? 0) / sourceFps;
		const sourceEndByDuration = sourceStart + (wrapper.durationInFrames / fps) * wrapperSpeed;
		const sourceEnd = Math.min(
			(wrapper.sourceEnd ?? composition.durationInFrames) / sourceFps,
			sourceEndByDuration
		);
		const sliced = sliceMixEntries(childEntries, sourceStart, sourceEnd);
		const wrapperStart = wrapper.from / fps;
		const wrapperGain = wrapper.volume ?? 1;
		const mixerTrackGain = track.volume ?? 1;
		const wrapperPitch = getAudioPitchShiftSemitones(wrapper);
		const outerSpans = transitionGainSpansForItem(wrapper, transitions, itemsById, fps);
		for (const entry of sliced) {
			const previewGainPoints = entry.gainPoints.map((point) => ({
				whenSeconds: wrapperStart + point.whenSeconds / wrapperSpeed,
				value: point.value * wrapperGain
			}));
			entries.push({
				...entry,
				// Preserve nested ducking; wrapper's own duck is not audio-bearing (composition type) so child entries already carry theirs.
				trackId: wrapper.trackId,
				itemId: `${wrapper.id}/${entry.itemId}`,
				whenSeconds: wrapperStart + entry.whenSeconds / wrapperSpeed,
				playbackRate: entry.playbackRate * wrapperSpeed,
				pitchShiftSemitones: entry.pitchShiftSemitones + wrapperPitch,
				audioEqStages: prependResolvedAudioEqSources(
					entry.audioEqStages,
					busAudioEq,
					track.audioEq,
					getAudioEqSettings(wrapper)
				),
				durationSeconds: entry.durationSeconds / wrapperSpeed,
				gainPoints: previewGainPoints.map((point) => ({
					...point,
					value: point.value * mixerTrackGain
				})),
				previewGainPoints,
				mixerTrackGain,
				transitionGainSpans: [
					...entry.transitionGainSpans.map((span) => ({
						...span,
						startSeconds: wrapperStart + span.startSeconds / wrapperSpeed,
						durationSeconds: span.durationSeconds / wrapperSpeed
					})),
					...outerSpans
				]
			});
		}
	}
	return entries;
}

function gainValueAtTime(points: GainPoint[], time: number): number {
	const sorted = points.toSorted((left, right) => left.whenSeconds - right.whenSeconds);
	if (sorted.length === 0) return 1;
	if (time <= sorted[0]!.whenSeconds) return sorted[0]!.value;
	for (let index = 1; index < sorted.length; index++) {
		const right = sorted[index]!;
		if (time > right.whenSeconds) continue;
		const left = sorted[index - 1]!;
		const duration = right.whenSeconds - left.whenSeconds;
		if (duration <= 0) return right.value;
		const progress = (time - left.whenSeconds) / duration;
		return left.value + (right.value - left.value) * progress;
	}
	return sorted[sorted.length - 1]!.value;
}

/** Restrict absolute mix entries to an export range without resetting automation. */
export function sliceMixEntries(
	entries: MixEntry[],
	startSeconds: number,
	endSeconds: number
): MixEntry[] {
	return entries.flatMap((entry) => {
		const entryEnd = entry.whenSeconds + entry.durationSeconds;
		const overlapStart = Math.max(startSeconds, entry.whenSeconds);
		const overlapEnd = Math.min(endSeconds, entryEnd);
		if (overlapEnd <= overlapStart) return [];
		const skipped = overlapStart - entry.whenSeconds;
		const startGain = gainValueAtTime(entry.gainPoints, overlapStart);
		const previewStartGain = gainValueAtTime(entry.previewGainPoints, overlapStart);
		const gainPoints = [
			{ whenSeconds: 0, value: startGain },
			...entry.gainPoints
				.filter((point) => point.whenSeconds > overlapStart && point.whenSeconds <= overlapEnd)
				.map((point) => ({
					...point,
					whenSeconds: point.whenSeconds - startSeconds
				}))
		];
		const previewGainPoints = [
			{ whenSeconds: 0, value: previewStartGain },
			...entry.previewGainPoints
				.filter((point) => point.whenSeconds > overlapStart && point.whenSeconds <= overlapEnd)
				.map((point) => ({ ...point, whenSeconds: point.whenSeconds - startSeconds }))
		];
		return [
			{
				...entry,
				whenSeconds: overlapStart - startSeconds,
				sourceOffsetSeconds:
					entry.sourceOffsetSeconds + (entry.reversed ? -1 : 1) * skipped * entry.playbackRate,
				durationSeconds: overlapEnd - overlapStart,
				gainPoints,
				previewGainPoints,
				transitionGainSpans: entry.transitionGainSpans.map((span) => ({
					...span,
					startSeconds: span.startSeconds - startSeconds
				}))
			}
		];
	});
}

function volumeGainPoints(
	item: TimelineItem,
	trackVolume: number,
	fps: number,
	startFrame: number,
	endFrame: number
): GainPoint[] {
	const baseGain = (item.volume ?? 1) * trackVolume;
	const track = item.keyframes?.volume;
	const hasClipFade = (item.audioFadeIn ?? 0) > 0 || (item.audioFadeOut ?? 0) > 0;
	if ((!track || track.frames.length === 0) && !hasClipFade) {
		return [{ whenSeconds: startFrame / fps, value: baseGain }];
	}
	const points: GainPoint[] = [];
	const seen = new Set<number>();
	for (let frame = startFrame; frame <= endFrame; frame++) {
		const animated = track && track.frames.length > 0 ? activeValueAt(item, 'volume', frame) : null;
		const clipFade =
			frame === item.from + item.durationInFrames && (item.audioFadeOut ?? 0) > 0
				? 0
				: audioClipFadeGainAtFrame(item, frame, fps);
		const whenSeconds = frame / fps;
		if (seen.has(whenSeconds)) continue;
		seen.add(whenSeconds);
		points.push({
			whenSeconds,
			value: (animated ?? item.volume ?? 1) * trackVolume * clipFade
		});
	}
	return points.length > 0 ? points : [{ whenSeconds: startFrame / fps, value: baseGain }];
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
		const progress = calculateTransitionProgress(
			frame - window.startFrame,
			window.durationInFrames,
			transition.timing,
			transition.bezierPoints
		);
		return {
			outgoingId: from.id,
			incomingId: to.id,
			progress,
			type: transition.type,
			transition
		};
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
	const resolvedTracks = effectiveMediaTracks(tracks);
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	const anySolo = resolvedTracks.some((track) => track.solo);
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
