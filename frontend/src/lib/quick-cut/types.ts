import type { Rotation } from 'mediabunny';

export type CutMode = 'nearestKeyframe' | 'exact';
export type LoopMode = 'off' | 'segment' | 'all';

export interface QuickCutVideoStream {
	index: number;
	codec: string | null;
	width: number;
	height: number;
	rotation: Rotation;
	fps: number | null;
}

export interface QuickCutAudioStream {
	index: number;
	codec: string | null;
	sampleRate: number | null;
	channels: number | null;
}

export interface QuickCutSource {
	id: string;
	name: string;
	size: number;
	mimeType: string;
	duration: number;
	width: number;
	height: number;
	videoCodec: string | null;
	audioCodec: string | null;
	sampleRate: number | null;
	channels: number | null;
	rotation: Rotation;
	fps: number | null;
	keyframeTimestamps: number[];
	keyframeState: 'known' | 'unknown' | 'audio-only';
	lastModified?: number;
	contentFingerprint?: string;
	handle?: FileSystemFileHandle;
	file?: File;
	videoStreams: QuickCutVideoStream[];
	audioStreams: QuickCutAudioStream[];
	/** null = video disabled, undefined = auto (first video track if any) */
	selectedVideoTrackIndex?: number | null;
	/** undefined = auto (primary audio if any), empty array = no audio */
	selectedAudioTrackIndices?: number[];
}

export interface QuickCutSourceMetadata {
	id: string;
	name: string;
	size: number;
	mimeType: string;
	duration: number;
	width: number;
	height: number;
	videoCodec: string | null;
	audioCodec: string | null;
	sampleRate: number | null;
	channels: number | null;
	rotation: Rotation;
	fps: number | null;
	keyframeTimestamps: number[];
	keyframeState: 'known' | 'unknown' | 'audio-only';
	lastModified?: number;
	contentFingerprint?: string;
	videoStreams: QuickCutVideoStream[];
	audioStreams: QuickCutAudioStream[];
	selectedVideoTrackIndex?: number | null;
	selectedAudioTrackIndices?: number[];
}

export interface QuickCutSegment {
	id: string;
	sourceId: string;
	start: number;
	end: number;
	name?: string;
	enabled?: boolean;
	/** Overrides the project cut mode for this kept range. */
	cutMode?: CutMode;
}

export interface QuickCutProject {
	version: 1;
	id: string;
	name: string;
	sources: QuickCutSourceMetadata[];
	segments: QuickCutSegment[];
	cutMode: CutMode;
	merge: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface SegmentValidationError {
	segmentId: string;
	kind:
		| 'start_negative'
		| 'end_beyond_duration'
		| 'end_not_after_start'
		| 'zero_length'
		| 'overlap'
		| 'invalid_time'
		| 'missing_source';
	message: string;
}

export interface QuickCutPreflight {
	eligible: boolean;
	reason: string;
	outputFormat: 'mp4' | 'webm' | 'mov' | 'mkv';
	requiresTranscode: boolean;
	estimatedBytes: number;
	snapInfo: Array<{
		segmentId: string;
		snappedStart: number;
		delta: number;
		direction: 'before' | 'after' | 'exact';
	}>;
}

export interface QuickCutPerSegmentPreflight {
	segmentId: string;
	requiresTranscode: boolean;
	reason: string;
	snappedStart: number | null;
}

export interface QuickCutScratchArtifact {
	scratchPath: string;
	fileName: string;
	scratchFile: File;
	wasLossless: boolean;
	reason: string;
	estimatedBytes: number;
}
