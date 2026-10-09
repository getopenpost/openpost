import { timerAudioEntries } from '../timers/audio';
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread */
/**
 * Pure planning math for the multi-track rendered export: output duration,
 * frame→source-time mapping, audio mixdown scheduling, transition blending,
 * paint order, and cue selection.
 *
 * Ported from FreeCut (MIT) - features/export/utils/timeline-to-composition.ts,
 * canvas-transitions.ts, and canvas-audio.ts (segment extraction), retargeted
 * to OpenPost's TimelineItem model.
 */

import type {
	Project,
	SubtitleCue,
	SubComposition,
	ProjectTimeline,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import type { AudioEqSettings } from '../audio/types';
import type { ResolvedAudioNoiseReductionSettings } from '../audio/audio-noise-reduction';
import { resolveNoiseReductionSettings } from '../audio/audio-noise-reduction';
import { activeValueAt } from '../timeline/keyframe-interpolation';
import {
	hasVariableSpeed,
	playbackRateAtTimelineOffset,
	playbackRateCurve,
	sourceFrameToTimelineOffset,
	timelineOffsetToSourceFrame
} from '../timeline/source-time-map';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import {
	calculateTransitionProgress,
	nonOverlappingTransitions,
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
import type { AudioEffect } from '../audio/audio-effects';
import { normalizeAudioEffects } from '../audio/audio-effects';
import { mixerDbToGain } from '../audio/mixer-utils';
import {
	normalizeAudioDucking,
	type AudioDuckingSettings,
	DUCKING_DEFAULT_ATTACK_SEC,
	DUCKING_DEFAULT_RELEASE_SEC
} from '../audio/audio-ducking';

/** One scheduled clip in the offline audio mixdown. */
export interface MixEntry {
	toneFrequency?: number;
	ducking?: AudioDuckingSettings;
	duckStartSeconds?: number;
	duckEndSeconds?: number;
	duckTrackAliases?: string[];
	itemId: string;
	mediaId: string;
	/** Root mixer track used by preview channel strips. */
	trackId?: string;
	/** Timeline seconds where playback starts in the mixdown. */
	whenSeconds: number;
	/** Seconds into the source media where this clip begins. */
	sourceOffsetSeconds: number;
	/** Maximum source-time remainder introduced by rounding a clip to timeline frames. */
	sourceFrameDuration?: number;
	/** Source seconds played per real second (the item's speed). */
	playbackRate: number;
	/** Output-relative tempo samples for a persisted variable-speed curve. */
	playbackRateCurve?: Array<{ atSeconds: number; rate: number }>;
	/** Exact source window consumed by a variable-speed entry. */
	sourceWindowStartSeconds?: number;
	sourceWindowEndSeconds?: number;
	/** Independent pitch offset. Tempo remains owned by playbackRate. */
	pitchShiftSemitones: number;
	/** Ordered outer-to-inner parametric EQ stages. */
	audioEqStages: ResolvedAudioEqSettings[];
	/** Ordered audio effect rack shared by preview and export. */
	audioEffects: AudioEffect[];
	/** Per-clip noise reduction applied before time-stretch and EQ. */
	noiseReduction?: ResolvedAudioNoiseReductionSettings;
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
		gainPoints: entry.gainPoints.map((point) => ({
			...point,
			value: point.value * gain
		})),
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

/** Export snapshots include authored Motion holds after the last layer ends. */
export function projectOutputDurationFrames(project: Project): number {
	return Math.max(
		outputDurationFrames(project.timeline?.items ?? []),
		Number.isFinite(project.duration) ? Math.round(project.duration * project.metadata.fps) : 0
	);
}

export function isVisibleAtFrame(item: TimelineItem, frame: number): boolean {
	return frame >= item.from && frame < item.from + item.durationInFrames;
}

/** Source-media seconds shown by a timeline item at an absolute timeline frame. */
export function frameToSourceSeconds(item: TimelineItem, frame: number, fps: number): number {
	if (hasVariableSpeed(item)) {
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const sourceFrame = timelineOffsetToSourceFrame(item, frame - item.from, fps);
		const upperFrame =
			item.sourceDuration === undefined ? Number.POSITIVE_INFINITY : item.sourceDuration - 1;
		return Math.min(upperFrame, Math.max(0, sourceFrame)) / sourceFps;
	}
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
	return planSequenceMixdown(
		items,
		tracks,
		fps,
		nonOverlappingTransitions(transitions, new Map(items.map((item) => [item.id, item]))),
		busAudioEq
	);
}

function planSequenceMixdown(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	fps: number,
	transitions: TimelineTransition[],
	busAudioEq?: AudioEqSettings | null
): MixEntry[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const anySolo = resolvedTracks.some((track) => track.solo);
	const entries: MixEntry[] = [];
	for (const item of items) {
		if (item.timer) {
			const track = trackById.get(item.trackId);
			if (track && isAudible(track, anySolo)) entries.push(...timerAudioEntries(item, track, fps));
		}
		if (!AUDIO_BEARING_TYPES.has(item.type) || !item.mediaId || item.audioDetached) continue;
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
		const variableSpeed = hasVariableSpeed(item);
		const variableSourceStart = variableSpeed
			? timelineOffsetToSourceFrame(item, startFrame - item.from, fps)
			: undefined;
		const variableSourceEnd = variableSpeed
			? timelineOffsetToSourceFrame(item, endFrame - item.from, fps)
			: undefined;
		const sourceWindowStartSeconds = variableSpeed
			? Math.max(
					0,
					(item.isReversed ? (variableSourceEnd ?? 0) + 1 : (variableSourceStart ?? 0)) / sourceFps
				)
			: undefined;
		const sourceWindowEndSeconds = variableSpeed
			? Math.max(
					sourceWindowStartSeconds ?? 0,
					(item.isReversed ? (variableSourceStart ?? 0) + 1 : (variableSourceEnd ?? 0)) / sourceFps
				)
			: undefined;
		const rateCurve = variableSpeed
			? [
					{
						atSeconds: 0,
						rate: playbackRateAtTimelineOffset(item, startFrame - item.from, fps)
					},
					...playbackRateCurve(item, fps)
						.filter(
							(point) =>
								item.from + point.offsetFrames > startFrame &&
								item.from + point.offsetFrames < endFrame
						)
						.map((point) => ({
							atSeconds: (item.from + point.offsetFrames - startFrame) / fps,
							rate: point.rate
						})),
					{
						atSeconds: (endFrame - startFrame) / fps,
						rate: playbackRateAtTimelineOffset(item, endFrame - item.from, fps)
					}
				]
			: undefined;
		const previewGainPoints = volumeGainPoints(item, 1, fps, startFrame, endFrame);
		const mixerTrackGain = track.volume ?? 1;
		const rawDucking = item.audioDucking;
		const ducking = normalizeAudioDucking(rawDucking)
			? { ...normalizeAudioDucking(rawDucking)! }
			: undefined;
		const duckStartSeconds = ducking ? item.from / fps : undefined;
		const duckEndSeconds = ducking ? (item.from + item.durationInFrames) / fps : undefined;
		entries.push({
			ducking,
			duckStartSeconds,
			duckEndSeconds,
			itemId: item.id,
			mediaId: item.mediaId,
			trackId: track.id,
			whenSeconds: startFrame / fps,
			sourceOffsetSeconds: variableSpeed
				? item.isReversed
					? (sourceWindowEndSeconds ?? 0)
					: (sourceWindowStartSeconds ?? 0)
				: item.isReversed
					? Math.max(
							0,
							(item.sourceEnd ??
								(item.sourceStart ?? 0) + (item.durationInFrames / fps) * speed * sourceFps) /
								sourceFps +
								(beforeFrames / fps) * speed
						)
					: Math.max(0, (item.sourceStart ?? 0) / sourceFps - (beforeFrames / fps) * speed),
			sourceFrameDuration: speed / fps,
			playbackRate: variableSpeed
				? playbackRateAtTimelineOffset(item, startFrame - item.from, fps)
				: speed,
			playbackRateCurve: rateCurve,
			sourceWindowStartSeconds,
			sourceWindowEndSeconds,
			pitchShiftSemitones: getAudioPitchShiftSemitones(item),
			audioEqStages: appendResolvedAudioEqSources(
				undefined,
				busAudioEq,
				track.audioEq,
				getAudioEqSettings(item)
			),
			audioEffects: normalizeAudioEffects(item.audioEffects),
			noiseReduction: resolveNoiseReductionSettings(item),
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
	const itemsById = new Map(items.map((item) => [item.id, item]));
	transitions = nonOverlappingTransitions(transitions, itemsById);
	const entries = planSequenceMixdown(items, tracks, fps, transitions, busAudioEq);
	const resolvedTracks = effectiveMediaTracks(tracks);
	const compositionById = new Map(compositions.map((composition) => [composition.id, composition]));
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	const anySolo = resolvedTracks.some((track) => track.solo);
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
		const sourceFps =
			wrapper.sourceFps && wrapper.sourceFps > 0 ? wrapper.sourceFps : composition.fps;
		const wrapperStart = wrapper.from / fps;
		const timingItem: TimelineItem = {
			...wrapper,
			sourceFps,
			sourceEnd:
				wrapper.sourceEnd ??
				Math.min(
					composition.durationInFrames,
					(wrapper.sourceStart ?? 0) +
						(wrapper.durationInFrames / fps) * (wrapper.speed ?? 1) * sourceFps
				)
		};
		// Audio uses continuous source boundaries. Reverse video lookup subtracts one
		// source frame to select a picture; undo that adjustment for sample windows.
		const sourceSecondAt = (timelineSeconds: number) =>
			(timelineOffsetToSourceFrame(timingItem, (timelineSeconds - wrapperStart) * fps, fps) +
				(wrapper.isReversed ? 1 : 0)) /
			composition.fps;
		const timelineSecondAt = (sourceSeconds: number) =>
			wrapperStart +
			sourceFrameToTimelineOffset(timingItem, sourceSeconds * composition.fps, fps) / fps;
		const firstSourceSecond = sourceSecondAt(wrapperStart);
		const lastSourceSecond = sourceSecondAt(wrapperStart + wrapper.durationInFrames / fps);
		const sourceStart = Math.max(0, Math.min(firstSourceSecond, lastSourceSecond));
		const sourceEnd = Math.min(
			composition.durationInFrames / composition.fps,
			Math.max(firstSourceSecond, lastSourceSecond)
		);
		const sliced = sliceMixEntries(childEntries, sourceStart, sourceEnd);
		const wrapperGains = volumeGainPoints(
			wrapper,
			1,
			fps,
			wrapper.from,
			wrapper.from + wrapper.durationInFrames
		);
		const wrapperRatePoints = playbackRateCurve(timingItem, fps);
		const mixerTrackGain = track.volume ?? 1;
		const wrapperPitch = getAudioPitchShiftSemitones(wrapper);
		const outerSpans = transitionGainSpansForItem(wrapper, transitions, itemsById, fps);
		for (const entry of sliced) {
			const mapChildTime = (seconds: number) => timelineSecondAt(sourceStart + seconds);
			const childStart = entry.whenSeconds;
			const childEnd = childStart + entry.durationSeconds;
			const whenSeconds = Math.min(mapChildTime(childStart), mapChildTime(childEnd));
			const endSeconds = Math.max(mapChildTime(childStart), mapChildTime(childEnd));
			const durationSeconds = endSeconds - whenSeconds;
			const childTimeAt = (seconds: number) => sourceSecondAt(seconds) - sourceStart;
			const rateAt = (seconds: number) =>
				((entry.playbackRateCurve
					? curveRateAt(entry.playbackRateCurve, childTimeAt(seconds) - childStart)
					: entry.playbackRate) *
					playbackRateAtTimelineOffset(timingItem, (seconds - wrapperStart) * fps, fps) *
					sourceFps) /
				composition.fps;
			const variableRate = hasVariableSpeed(wrapper) || Boolean(entry.playbackRateCurve);
			const curveTimes = variableRate
				? [
						whenSeconds,
						endSeconds,
						// Products of two varying rates are not linear between their knots.
						// Sample at the output frame cadence as well as both authored curves.
						...Array.from(
							{ length: Math.ceil(durationSeconds * fps) },
							(_, index) => whenSeconds + index / fps
						),
						...wrapperRatePoints.map((point) => wrapperStart + point.offsetFrames / fps),
						...(entry.playbackRateCurve ?? []).map((point) =>
							mapChildTime(childStart + point.atSeconds)
						)
					]
						.filter((seconds) => seconds >= whenSeconds && seconds <= endSeconds)
						.sort((a, b) => a - b)
				: [];
			const rateCurve = variableRate
				? [...new Set(curveTimes)].map((seconds) => ({
						atSeconds: seconds - whenSeconds,
						rate: rateAt(seconds)
					}))
				: undefined;
			const sourceDistance = entry.playbackRateCurve
				? curveSourceDistance(entry.playbackRateCurve, 0, entry.durationSeconds)
				: entry.durationSeconds * entry.playbackRate;
			const oppositeSourceOffset =
				entry.sourceOffsetSeconds + (entry.reversed ? -1 : 1) * sourceDistance;
			const sourceOffsetSeconds = wrapper.isReversed
				? oppositeSourceOffset
				: entry.sourceOffsetSeconds;
			const gainTimes = [
				whenSeconds,
				endSeconds,
				...entry.gainPoints.map((point) => mapChildTime(point.whenSeconds)),
				...wrapperGains.map((point) => point.whenSeconds)
			]
				.filter((seconds) => seconds >= whenSeconds && seconds <= endSeconds)
				.sort((a, b) => a - b);
			const childGains = entry.gainPoints.toSorted(
				(left, right) => left.whenSeconds - right.whenSeconds
			);
			const previewGainPoints = [...new Set(gainTimes)].map((seconds) => ({
				whenSeconds: seconds,
				value:
					sortedGainValueAtTime(childGains, childTimeAt(seconds)) *
					sortedGainValueAtTime(wrapperGains, seconds)
			}));
			const mappedDuckStart =
				entry.duckStartSeconds === undefined ? undefined : mapChildTime(entry.duckStartSeconds);
			const mappedDuckEnd =
				entry.duckEndSeconds === undefined ? undefined : mapChildTime(entry.duckEndSeconds);
			const duckStartSeconds =
				mappedDuckStart === undefined || mappedDuckEnd === undefined
					? undefined
					: Math.min(mappedDuckStart, mappedDuckEnd);
			const duckEndSeconds =
				mappedDuckStart === undefined || mappedDuckEnd === undefined
					? undefined
					: Math.max(mappedDuckStart, mappedDuckEnd);
			const childTrackId = entry.trackId;
			const baseAliases = entry.duckTrackAliases ?? (childTrackId ? [childTrackId] : []);
			const duckTrackAliases = Array.from(
				new Set([
					wrapper.trackId,
					`${wrapper.id}/${childTrackId}`,
					...baseAliases.map((alias) => (alias.includes('/') ? alias : `${wrapper.id}/${alias}`))
				])
			);
			let namespacedDucking = entry.ducking;
			if (entry.ducking?.targetTrackIds) {
				const compositionTrackIds = new Set(composition.tracks.map((t) => t.id));
				namespacedDucking = {
					...entry.ducking,
					targetTrackIds: entry.ducking.targetTrackIds.map((id) =>
						compositionTrackIds.has(id) ? `${wrapper.id}/${id}` : id
					)
				};
			}
			entries.push({
				...entry,
				ducking: namespacedDucking,
				duckStartSeconds,
				duckEndSeconds,
				duckTrackAliases,
				trackId: wrapper.trackId,
				itemId: `${wrapper.id}/${entry.itemId}`,
				whenSeconds,
				sourceOffsetSeconds,
				reversed: entry.reversed !== (wrapper.isReversed === true),
				playbackRate: rateAt(whenSeconds),
				playbackRateCurve: rateCurve,
				sourceWindowStartSeconds: rateCurve
					? Math.min(entry.sourceOffsetSeconds, oppositeSourceOffset)
					: undefined,
				sourceWindowEndSeconds: rateCurve
					? Math.max(entry.sourceOffsetSeconds, oppositeSourceOffset)
					: undefined,
				pitchShiftSemitones: entry.pitchShiftSemitones + wrapperPitch,
				audioEqStages: prependResolvedAudioEqSources(
					entry.audioEqStages,
					busAudioEq,
					track.audioEq,
					getAudioEqSettings(wrapper)
				),
				audioEffects: (() => {
					const outer = normalizeAudioEffects(wrapper.audioEffects);
					return outer.length > 0 ? [...outer, ...entry.audioEffects] : entry.audioEffects;
				})(),
				durationSeconds,
				gainPoints: previewGainPoints.map((point) => ({
					...point,
					value: point.value * mixerTrackGain
				})),
				previewGainPoints,
				mixerTrackGain,
				transitionGainSpans: [
					...entry.transitionGainSpans.map((span) => {
						const start = mapChildTime(span.startSeconds);
						const end = mapChildTime(span.startSeconds + span.durationSeconds);
						return {
							...span,
							startSeconds: Math.min(start, end),
							durationSeconds: Math.abs(end - start),
							isIncoming: span.isIncoming !== (wrapper.isReversed === true)
						};
					}),
					...outerSpans
				]
			});
		}
	}
	return entries;
}

function gainValueAtTime(points: GainPoint[], time: number): number {
	return sortedGainValueAtTime(
		points.toSorted((left, right) => left.whenSeconds - right.whenSeconds),
		time
	);
}

function sortedGainValueAtTime(points: GainPoint[], time: number): number {
	if (points.length === 0) return 1;
	if (time <= points[0]!.whenSeconds) return points[0]!.value;
	let low = 0;
	let high = points.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (points[mid]!.whenSeconds <= time) low = mid + 1;
		else high = mid;
	}
	const left = points[low - 1]!;
	const right = points[low];
	if (!right) return left.value;
	const progress = (time - left.whenSeconds) / (right.whenSeconds - left.whenSeconds);
	return left.value + (right.value - left.value) * progress;
}

function curveRateAt(curve: NonNullable<MixEntry['playbackRateCurve']>, seconds: number): number {
	if (seconds <= curve[0]!.atSeconds) return curve[0]!.rate;
	let low = 1;
	let high = curve.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (curve[mid]!.atSeconds < seconds) low = mid + 1;
		else high = mid;
	}
	const right = curve[low];
	if (!right) return curve.at(-1)!.rate;
	const left = curve[low - 1]!;
	const duration = right.atSeconds - left.atSeconds;
	if (duration <= 0) return right.rate;
	return left.rate + ((seconds - left.atSeconds) / duration) * (right.rate - left.rate);
}

function curveSourceDistance(
	curve: NonNullable<MixEntry['playbackRateCurve']>,
	startSeconds: number,
	endSeconds: number
): number {
	if (endSeconds <= startSeconds || curve.length === 0) return 0;
	const first = curve[0]!;
	const last = curve.at(-1)!;
	let distance = Math.max(0, Math.min(endSeconds, first.atSeconds) - startSeconds) * first.rate;
	for (let index = 1; index < curve.length; index++) {
		const left = curve[index - 1]!;
		const right = curve[index]!;
		if (left.atSeconds >= endSeconds) break;
		const start = Math.max(startSeconds, left.atSeconds);
		const end = Math.min(endSeconds, right.atSeconds);
		if (end <= start) continue;
		const slope = (right.rate - left.rate) / (right.atSeconds - left.atSeconds);
		const startRate = left.rate + (start - left.atSeconds) * slope;
		const endRate = left.rate + (end - left.atSeconds) * slope;
		distance += ((startRate + endRate) / 2) * (end - start);
	}
	return distance + Math.max(0, endSeconds - Math.max(startSeconds, last.atSeconds)) * last.rate;
}

function slicePlaybackRateCurve(
	curve: NonNullable<MixEntry['playbackRateCurve']>,
	startSeconds: number,
	durationSeconds: number
): NonNullable<MixEntry['playbackRateCurve']> {
	const endSeconds = startSeconds + durationSeconds;
	return [
		{ atSeconds: 0, rate: curveRateAt(curve, startSeconds) },
		...curve
			.filter((point) => point.atSeconds > startSeconds && point.atSeconds < endSeconds)
			.map((point) => ({
				...point,
				atSeconds: point.atSeconds - startSeconds
			})),
		{ atSeconds: durationSeconds, rate: curveRateAt(curve, endSeconds) }
	];
}

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
		const slicedDuration = overlapEnd - overlapStart;
		const curve = entry.playbackRateCurve;
		const skippedSourceSeconds = curve
			? curveSourceDistance(curve, 0, skipped)
			: skipped * entry.playbackRate;
		const slicedSourceSeconds = curve
			? curveSourceDistance(curve, skipped, skipped + slicedDuration)
			: slicedDuration * entry.playbackRate;
		const sourceOffsetSeconds =
			entry.sourceOffsetSeconds + (entry.reversed ? -1 : 1) * skippedSourceSeconds;
		const sourceWindowStartSeconds = curve
			? entry.reversed
				? sourceOffsetSeconds - slicedSourceSeconds
				: sourceOffsetSeconds
			: entry.sourceWindowStartSeconds;
		const sourceWindowEndSeconds = curve
			? entry.reversed
				? sourceOffsetSeconds
				: sourceOffsetSeconds + slicedSourceSeconds
			: entry.sourceWindowEndSeconds;
		const startGain = gainValueAtTime(entry.gainPoints, overlapStart);
		const previewStartGain = gainValueAtTime(entry.previewGainPoints, overlapStart);
		const gainPoints = [
			{ whenSeconds: overlapStart - startSeconds, value: startGain },
			...entry.gainPoints
				.filter((point) => point.whenSeconds > overlapStart && point.whenSeconds < overlapEnd)
				.map((point) => ({
					...point,
					whenSeconds: point.whenSeconds - startSeconds
				})),
			{
				whenSeconds: overlapEnd - startSeconds,
				value: gainValueAtTime(entry.gainPoints, overlapEnd)
			}
		];
		const previewGainPoints = [
			{ whenSeconds: overlapStart - startSeconds, value: previewStartGain },
			...entry.previewGainPoints
				.filter((point) => point.whenSeconds > overlapStart && point.whenSeconds < overlapEnd)
				.map((point) => ({
					...point,
					whenSeconds: point.whenSeconds - startSeconds
				})),
			{
				whenSeconds: overlapEnd - startSeconds,
				value: gainValueAtTime(entry.previewGainPoints, overlapEnd)
			}
		];
		let slicedDucking = entry.ducking;
		let slicedDuckStart = entry.duckStartSeconds;
		let slicedDuckEnd = entry.duckEndSeconds;
		const slicedDuckAliases = entry.duckTrackAliases;
		if (slicedDucking && slicedDuckStart !== undefined && slicedDuckEnd !== undefined) {
			const release = slicedDucking.releaseSec ?? DUCKING_DEFAULT_RELEASE_SEC;
			const duckStart = slicedDuckStart;
			const duckEndPlusRelease = slicedDuckEnd + release;
			if (duckEndPlusRelease <= startSeconds || duckStart >= endSeconds) {
				slicedDucking = undefined;
				slicedDuckStart = undefined;
				slicedDuckEnd = undefined;
			} else {
				slicedDuckStart = duckStart - startSeconds;
				slicedDuckEnd = slicedDuckEnd - startSeconds;
			}
		}
		return [
			{
				...entry,
				ducking: slicedDucking,
				duckStartSeconds: slicedDuckStart,
				duckEndSeconds: slicedDuckEnd,
				duckTrackAliases: slicedDuckAliases,
				whenSeconds: overlapStart - startSeconds,
				sourceOffsetSeconds,
				sourceWindowStartSeconds,
				sourceWindowEndSeconds,
				playbackRate: curve ? curveRateAt(curve, skipped) : entry.playbackRate,
				playbackRateCurve: curve
					? slicePlaybackRateCurve(curve, skipped, slicedDuration)
					: undefined,
				durationSeconds: slicedDuration,
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
		const clipFade = audioClipFadeGainAtFrame(item, frame, fps, {
			includeEnd: true
		});
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
 * Mute and solo affect audibility, not visual visibility.
 */
export function paintOrder(
	items: TimelineItem[] = [],
	tracks: TimelineTrack[] = []
): TimelineItem[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const trackById = new Map(resolvedTracks.map((track) => [track.id, track]));
	return items
		.filter((item) => {
			const track = trackById.get(item.trackId);
			return track !== undefined && track.visible !== false;
		})
		.sort(
			(a, b) => (trackById.get(b.trackId)?.order ?? 0) - (trackById.get(a.trackId)?.order ?? 0)
		);
}

/** The cue(s) showing at an absolute timeline frame (normally zero or one). */
export function selectCuesAtFrame(cues: SubtitleCue[], frame: number): SubtitleCue[] {
	return cues.filter((cue) => cue.startFrame <= frame && frame < cue.endFrame);
}
