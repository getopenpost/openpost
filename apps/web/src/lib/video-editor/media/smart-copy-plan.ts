import {
	AUDIO_CODECS,
	MkvOutputFormat,
	MovOutputFormat,
	Mp4OutputFormat,
	VIDEO_CODECS,
	WebMOutputFormat,
	type AudioCodec,
	type OutputFormat,
	type VideoCodec
} from 'mediabunny';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import type { MediaMetadata } from './types';
import {
	appendResolvedAudioEqSources,
	getAudioEqSettings,
	isAudioEqStageActive
} from '../audio/audio-eq';
import { isAudioPitchShiftActive, getAudioPitchShiftSemitones } from '../audio/audio-pitch';

export type SmartCopyFormat = 'webm' | 'mp4' | 'mov' | 'mkv';

export interface SmartCopySettings {
	format?: SmartCopyFormat;
	codec?: VideoCodec;
	width?: number;
	height?: number;
	range?: { startFrame: number; endFrame: number };
	subtitleMode?: 'none' | 'burn' | 'sidecar' | 'embedded';
}

export type SmartCopyBlocker =
	| 'no-timeline'
	| 'empty-range'
	| 'timeline-layout'
	| 'missing-media'
	| 'edited-video'
	| 'edited-audio'
	| 'transition'
	| 'subtitles'
	| 'dimensions'
	| 'video-codec'
	| 'audio-codec'
	| 'keyframe';

export interface SmartCopyPlan {
	media: MediaMetadata;
	videoItem: TimelineItem;
	audioItem?: TimelineItem;
	format: SmartCopyFormat;
	videoCodec: VideoCodec;
	audioCodec?: AudioCodec;
	includeAudio: boolean;
	startFrame: number;
	endFrame: number;
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	durationSeconds: number;
	keyframeToleranceSeconds: number;
	subtitleMode: 'none' | 'sidecar';
}

export type SmartCopyAssessment =
	| { eligible: true; plan: SmartCopyPlan }
	| { eligible: false; blocker: SmartCopyBlocker };

const closeTo = (left: number, right: number, tolerance = 0.001): boolean =>
	Math.abs(left - right) <= tolerance;

function outputFormat(format: SmartCopyFormat): OutputFormat {
	switch (format) {
		case 'webm':
			return new WebMOutputFormat();
		case 'mp4':
			return new Mp4OutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'mkv':
			return new MkvOutputFormat();
	}
}

function videoCodec(codec: string): VideoCodec | null {
	const normalized = codec.toLowerCase();
	if (normalized === 'h264' || normalized === 'avc1') return 'avc';
	if (normalized === 'h265' || normalized === 'hvc1' || normalized === 'hev1') return 'hevc';
	return VIDEO_CODECS.find((candidate) => candidate === normalized) ?? null;
}

function audioCodec(codec: string | undefined): AudioCodec | null {
	if (!codec) return null;
	const normalized = codec.toLowerCase();
	return AUDIO_CODECS.find((candidate) => candidate === normalized) ?? null;
}

function defaultCodec(format: SmartCopyFormat): VideoCodec {
	return format === 'webm' ? 'vp9' : 'avc';
}

function projectEnd(items: readonly TimelineItem[]): number {
	return items.reduce((maximum, item) => Math.max(maximum, item.from + item.durationInFrames), 0);
}

function activeTrackIds(tracks: readonly TimelineTrack[]): Set<string> {
	const solo = tracks.filter((track) => track.solo);
	return new Set((solo.length > 0 ? solo : tracks).map((track) => track.id));
}

function activeItems(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	startFrame: number,
	endFrame: number
): TimelineItem[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const byId = new Map(resolvedTracks.map((track) => [track.id, track]));
	const activeIds = activeTrackIds(resolvedTracks);
	return items.filter((item) => {
		const track = byId.get(item.trackId);
		return Boolean(
			track &&
			activeIds.has(track.id) &&
			track.visible &&
			item.from < endFrame &&
			startFrame < item.from + item.durationInFrames
		);
	});
}

function neutralCrop(item: TimelineItem): boolean {
	return (
		!item.crop ||
		[item.crop.top, item.crop.right, item.crop.bottom, item.crop.left].every(
			(value) => value === undefined || closeTo(value, 0)
		)
	);
}

function neutralTransform(item: TimelineItem, media: MediaMetadata): boolean {
	const transform = item.transform;
	if (!transform) return true;
	const width = transform.width ?? media.width;
	const height = transform.height ?? media.height;
	return (
		closeTo(transform.x ?? 0, 0) &&
		closeTo(transform.y ?? 0, 0) &&
		closeTo(width, media.width) &&
		closeTo(height, media.height) &&
		closeTo(transform.anchorX ?? width / 2, width / 2) &&
		closeTo(transform.anchorY ?? height / 2, height / 2) &&
		closeTo(transform.rotation ?? 0, 0) &&
		!transform.flipHorizontal &&
		!transform.flipVertical &&
		closeTo(transform.scaleX ?? 1, 1) &&
		closeTo(transform.scaleY ?? 1, 1) &&
		closeTo(transform.opacity ?? 1, 1) &&
		closeTo(transform.cornerRadius ?? 0, 0)
	);
}

function unmodifiedVideo(item: TimelineItem, media: MediaMetadata): boolean {
	return (
		closeTo(item.speed ?? 1, 1) &&
		(item.speedRamp?.length ?? 0) === 0 &&
		!item.isReversed &&
		neutralTransform(item, media) &&
		neutralCrop(item) &&
		!item.cornerPin &&
		closeTo(item.fadeIn ?? 0, 0) &&
		closeTo(item.fadeOut ?? 0, 0) &&
		(item.blendMode === undefined || item.blendMode === 'normal') &&
		!item.effects?.some((effect) => effect.enabled) &&
		!item.keyframes &&
		!item.vectorKeyframes &&
		!item.motionModifiers?.some((modifier) => modifier.enabled) &&
		!item.propertyLinks?.length &&
		!item.expressions?.length &&
		!item.textMotion
	);
}

function isTrackEqActive(track: TimelineTrack): boolean {
	return (
		track.audioEq !== undefined &&
		appendResolvedAudioEqSources(undefined, track.audioEq).some(isAudioEqStageActive)
	);
}

function isBusEqActive(busAudioEq?: import('../audio/types').AudioEqSettings | null): boolean {
	return (
		busAudioEq !== undefined &&
		busAudioEq !== null &&
		appendResolvedAudioEqSources(undefined, busAudioEq).some(isAudioEqStageActive)
	);
}

function unmodifiedAudio(item: TimelineItem, track: TimelineTrack): boolean {
	const volume = (item.volume ?? 1) * (track.volume ?? 1);
	const hasClipEq = appendResolvedAudioEqSources(undefined, getAudioEqSettings(item)).some(
		isAudioEqStageActive
	);
	const hasTrackEq = isTrackEqActive(track);
	return (
		closeTo(item.speed ?? 1, 1) &&
		(item.speedRamp?.length ?? 0) === 0 &&
		!item.isReversed &&
		!isAudioPitchShiftActive(getAudioPitchShiftSemitones(item)) &&
		!hasClipEq &&
		!hasTrackEq &&
		(volume === 0 || closeTo(volume, 1)) &&
		closeTo(item.audioFadeIn ?? 0, 0) &&
		closeTo(item.audioFadeOut ?? 0, 0) &&
		!item.keyframes &&
		!item.vectorKeyframes &&
		!item.motionModifiers?.some((modifier) => modifier.enabled) &&
		!item.propertyLinks?.length &&
		!item.expressions?.length
	);
}

function matchingCompanion(video: TimelineItem, audio: TimelineItem): boolean {
	return (
		Boolean(video.linkedGroupId) &&
		video.linkedGroupId === audio.linkedGroupId &&
		video.mediaId === audio.mediaId &&
		video.from === audio.from &&
		video.durationInFrames === audio.durationInFrames &&
		(video.sourceStart ?? 0) === (audio.sourceStart ?? 0) &&
		video.sourceEnd === audio.sourceEnd &&
		(video.sourceFps ?? 0) === (audio.sourceFps ?? 0)
	);
}

function alignedKeyframe(media: MediaMetadata, seconds: number, tolerance: number): boolean {
	if (seconds <= tolerance) return true;
	return Boolean(
		media.keyframeTimestamps?.some((timestamp) => closeTo(timestamp, seconds, tolerance))
	);
}

export function assessSmartCopy(
	project: Project,
	settings: SmartCopySettings,
	mediaList: readonly MediaMetadata[]
): SmartCopyAssessment {
	const timeline = project.timeline;
	if (!timeline) return { eligible: false, blocker: 'no-timeline' };
	if (timeline.masterMuted || !closeTo(timeline.masterVolumeDb ?? 0, 0)) {
		return { eligible: false, blocker: 'edited-audio' };
	}
	if (isBusEqActive(timeline.busAudioEq)) {
		return { eligible: false, blocker: 'edited-audio' };
	}
	if (effectiveMediaTracks(timeline.tracks).some(isTrackEqActive)) {
		return { eligible: false, blocker: 'edited-audio' };
	}
	if (timeline.compositions?.some((composition) => isBusEqActive(composition.busAudioEq))) {
		return { eligible: false, blocker: 'edited-audio' };
	}
	if (
		timeline.compositions?.some((composition) =>
			effectiveMediaTracks(composition.tracks).some(isTrackEqActive)
		)
	) {
		return { eligible: false, blocker: 'edited-audio' };
	}
	const fps = project.metadata.fps;
	const startFrame = Math.max(0, Math.floor(settings.range?.startFrame ?? 0));
	const endFrame = Math.min(
		projectEnd(timeline.items),
		Math.ceil(settings.range?.endFrame ?? projectEnd(timeline.items))
	);
	if (endFrame <= startFrame) return { eligible: false, blocker: 'empty-range' };

	const active = activeItems(timeline.items, timeline.tracks, startFrame, endFrame);
	const videos = active.filter((item) => item.type === 'video');
	const audio = active.filter((item) => item.type === 'audio');
	const subtitles = active.filter((item) => item.type === 'subtitle');
	if (videos.length !== 1 || audio.length > 1) {
		return { eligible: false, blocker: 'timeline-layout' };
	}
	if (
		active.some(
			(item) => !videos.includes(item) && !audio.includes(item) && !subtitles.includes(item)
		)
	) {
		return { eligible: false, blocker: 'timeline-layout' };
	}

	const video = videos[0]!;
	if (video.from > startFrame || video.from + video.durationInFrames < endFrame) {
		return { eligible: false, blocker: 'timeline-layout' };
	}
	const companion = audio[0];
	if (companion && !matchingCompanion(video, companion)) {
		return { eligible: false, blocker: 'timeline-layout' };
	}
	if (!video.mediaId) return { eligible: false, blocker: 'missing-media' };
	const media = mediaList.find((candidate) => candidate.id === video.mediaId);
	if (!media) return { eligible: false, blocker: 'missing-media' };
	if (!unmodifiedVideo(video, media)) return { eligible: false, blocker: 'edited-video' };

	const trackById = new Map(
		effectiveMediaTracks(timeline.tracks).map((track) => [track.id, track])
	);
	const videoTrack = trackById.get(video.trackId);
	if (!videoTrack) return { eligible: false, blocker: 'timeline-layout' };
	if (companion) {
		const companionTrack = trackById.get(companion.trackId);
		if (!companionTrack || !unmodifiedAudio(companion, companionTrack)) {
			return { eligible: false, blocker: 'edited-audio' };
		}
	} else if (!unmodifiedAudio(video, videoTrack)) {
		return { eligible: false, blocker: 'edited-audio' };
	}

	if (
		timeline.transitions?.some(
			(transition) => transition.fromItemId === video.id || transition.toItemId === video.id
		)
	) {
		return { eligible: false, blocker: 'transition' };
	}
	const requestedSubtitleMode = settings.subtitleMode ?? 'burn';
	if (
		subtitles.length > 0 &&
		requestedSubtitleMode !== 'none' &&
		requestedSubtitleMode !== 'sidecar'
	) {
		return { eligible: false, blocker: 'subtitles' };
	}

	const width = settings.width ?? project.metadata.width;
	const height = settings.height ?? project.metadata.height;
	if (
		width !== project.metadata.width ||
		height !== project.metadata.height ||
		width !== media.width ||
		height !== media.height
	) {
		return { eligible: false, blocker: 'dimensions' };
	}

	const format = settings.format ?? 'webm';
	const sourceVideoCodec = videoCodec(media.codec);
	const requestedVideoCodec = settings.codec ?? defaultCodec(format);
	const formatInfo = outputFormat(format);
	if (
		!sourceVideoCodec ||
		sourceVideoCodec !== requestedVideoCodec ||
		!formatInfo.getSupportedVideoCodecs().includes(sourceVideoCodec)
	) {
		return { eligible: false, blocker: 'video-codec' };
	}

	const activeAudioItem = companion ?? video;
	const activeAudioTrack = trackById.get(activeAudioItem.trackId)!;
	const audioVolume = (activeAudioItem.volume ?? 1) * (activeAudioTrack.volume ?? 1);
	const includeAudio =
		media.audioCodecSupported !== false &&
		!activeAudioTrack.muted &&
		audioVolume > 0 &&
		Boolean(media.audioCodec);
	const sourceAudioCodec = includeAudio ? audioCodec(media.audioCodec) : null;
	if (
		includeAudio &&
		(!sourceAudioCodec || !formatInfo.getSupportedAudioCodecs().includes(sourceAudioCodec))
	) {
		return { eligible: false, blocker: 'audio-codec' };
	}

	const sourceFps = video.sourceFps && video.sourceFps > 0 ? video.sourceFps : media.fps || fps;
	const sourceStartSeconds = (video.sourceStart ?? 0) / sourceFps + (startFrame - video.from) / fps;
	const sourceEndSeconds = (video.sourceStart ?? 0) / sourceFps + (endFrame - video.from) / fps;
	const keyframeToleranceSeconds = Math.max(0.001, 0.5 / Math.max(1, sourceFps));
	if (!alignedKeyframe(media, sourceStartSeconds, keyframeToleranceSeconds)) {
		return { eligible: false, blocker: 'keyframe' };
	}

	return {
		eligible: true,
		plan: {
			media,
			videoItem: video,
			audioItem: companion,
			format,
			videoCodec: sourceVideoCodec,
			audioCodec: sourceAudioCodec ?? undefined,
			includeAudio,
			startFrame,
			endFrame,
			sourceStartSeconds,
			sourceEndSeconds,
			durationSeconds: sourceEndSeconds - sourceStartSeconds,
			keyframeToleranceSeconds,
			subtitleMode: requestedSubtitleMode === 'sidecar' ? 'sidecar' : 'none'
		}
	};
}
