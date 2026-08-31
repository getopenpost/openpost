/**
 * Media metadata types for the workspace media pool.
 *
 * Ported from FreeCut (MIT) — types/storage.ts, trimmed to v1.
 */

/**
 * How the media file is stored:
 * - 'handle':    references the user's original file on disk (linked source)
 * - 'workspace': source bytes copied into the workspace folder (collected source)
 */
export type MediaStorageType = 'handle' | 'workspace';

export interface MediaAttribution {
	provider: string;
	author?: string;
	authorUrl?: string;
	sourceId?: string;
	license: string;
	licenseUrl?: string;
}

export type RecorderCursorMode = 'always' | 'motion' | 'never' | 'unsupported' | 'unknown';

export type RecordingSystemAudioStatus =
	| 'not-requested'
	| 'active'
	| 'inactive'
	| 'unavailable'
	| 'denied';

export interface RecordingCaptureMetadata {
	version: 1;
	kind: 'screen' | 'camera' | 'microphone';
	capturedAt: string;
	cursor?: {
		requested: RecorderCursorMode;
		actual: RecorderCursorMode;
		supported: boolean;
	};
	systemAudio?: {
		requested: boolean;
		active: boolean;
		status: RecordingSystemAudioStatus;
	};
}

export interface VideoFrameRateMetrics {
	underlyingFrameRate: number | null;
	bestGuessFrameRate: number;
	minFrameRate: number;
	maxFrameRate: number;
	averageFrameRate: number;
	medianFrameRate: number;
	frameRateIsConstant: boolean;
	probedPacketCount: number;
}

export interface MediaMetadata {
	id: string;
	storageType: MediaStorageType;
	/**
	 * FileSystemFileHandle for direct disk access (when storageType === 'handle').
	 * Stored in IndexedDB — requires permission re-request on new sessions.
	 * Non-serializable; stripped on save and re-attached on load.
	 */
	fileHandle?: FileSystemFileHandle;
	contentHash?: string;
	fileLastModified?: number;
	fileName: string;
	fileSize: number;
	mimeType: string;
	duration: number;
	width: number;
	height: number;
	fps: number;
	/** Timestamp-derived source frame-rate truth. Absent on media imported before MediaBunny 1.54. */
	frameRateMetrics?: VideoFrameRateMetrics;
	codec: string;
	bitrate: number;
	audioCodec?: string;
	audioCodecSupported?: boolean;
	videoCodecSupported?: boolean;
	previewAudioConformedAt?: number;
	/**
	 * Sorted keyframe timestamps in seconds, extracted at import time via
	 * mediabunny EncodedPacketSink. Used for adaptive seek backtracking.
	 */
	keyframeTimestamps?: number[];
	gopInterval?: number;
	/** Native Lottie frame count. Present only when tags includes `lottie`. */
	lottieTotalFrames?: number;
	/** Composited animation frames. Present only for animated GIF/WebP images. */
	animationFrameCount?: number;
	lottieMarkers?: Array<{ name: string; start: number; duration: number }>;
	attribution?: MediaAttribution;
	tags: string[];
	capture?: RecordingCaptureMetadata;
}
