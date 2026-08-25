// oxlint-disable
export type CutMode = 'nearestKeyframe' | 'exact';
export type LoopMode = 'off' | 'segment' | 'all';

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
	rotation: number;
	fps: number | null;
	keyframeTimestamps: number[];
	// runtime resolution, not persisted except via handle
	handle?: FileSystemFileHandle;
	file?: File;
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
	rotation: number;
	fps: number | null;
	keyframeTimestamps: number[];
}

export interface QuickCutSegment {
	id: string;
	sourceId: string;
	start: number;
	end: number;
	name?: string;
	enabled?: boolean;
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

export interface QuickCutExportChoice {
	wasLossless: boolean;
	reason: string;
	requiresTranscode: boolean;
}

export interface KeyframeStatus {
	aligned: boolean;
	nearestKeyframe: number | null;
	distance: number | null;
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
