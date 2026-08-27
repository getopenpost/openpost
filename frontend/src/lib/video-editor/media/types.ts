import { createLogger } from '../workspace-fs/logger';

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

export function normalizeRecordingCaptureMetadata(
	value: unknown
): RecordingCaptureMetadata | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const candidate = value as Partial<RecordingCaptureMetadata>;
	if (candidate.version !== 1) return undefined;
	if (candidate.kind !== 'screen' && candidate.kind !== 'camera' && candidate.kind !== 'microphone')
		return undefined;
	if (typeof candidate.capturedAt !== 'string') return undefined;
	const result: RecordingCaptureMetadata = {
		version: 1,
		kind: candidate.kind,
		capturedAt: candidate.capturedAt
	};
	if (candidate.cursor) {
		const cursor = candidate.cursor as Partial<RecordingCaptureMetadata['cursor']>;
		const modes: RecorderCursorMode[] = ['always', 'motion', 'never', 'unsupported', 'unknown'];
		if (
			cursor &&
			typeof cursor.requested === 'string' &&
			typeof cursor.actual === 'string' &&
			typeof cursor.supported === 'boolean' &&
			modes.includes(cursor.requested as RecorderCursorMode) &&
			modes.includes(cursor.actual as RecorderCursorMode)
		) {
			result.cursor = {
				requested: cursor.requested as RecorderCursorMode,
				actual: cursor.actual as RecorderCursorMode,
				supported: cursor.supported
			};
		} else if (candidate.cursor) {
			createLogger('MediaTypes').warn('Dropped invalid cursor capture metadata', cursor);
		}
	}
	if (candidate.systemAudio) {
		const audio = candidate.systemAudio as Partial<RecordingCaptureMetadata['systemAudio']>;
		const statuses: RecordingSystemAudioStatus[] = [
			'not-requested',
			'active',
			'inactive',
			'unavailable',
			'denied'
		];
		if (
			audio &&
			typeof audio.requested === 'boolean' &&
			typeof audio.active === 'boolean' &&
			typeof audio.status === 'string' &&
			statuses.includes(audio.status as RecordingSystemAudioStatus)
		) {
			result.systemAudio = {
				requested: audio.requested,
				active: audio.active,
				status: audio.status as RecordingSystemAudioStatus
			};
		} else if (candidate.systemAudio) {
			createLogger('MediaTypes').warn('Dropped invalid systemAudio capture metadata', audio);
		}
	}
	return result;
}

export function reconcileSystemAudioWithProbe(
	capture: { requested: boolean; active: boolean; status: RecordingSystemAudioStatus },
	hasAudio: boolean
): { active: boolean; status: RecordingSystemAudioStatus } {
	const requested = capture.requested;
	const priorStatus = capture.status;
	const active = hasAudio;
	let status: RecordingSystemAudioStatus;
	if (!requested) {
		status = active ? 'active' : 'not-requested';
	} else if (active) {
		status = 'active';
	} else if (priorStatus === 'denied') {
		status = 'denied';
	} else if (priorStatus === 'unavailable') {
		status = 'unavailable';
	} else {
		status = 'inactive';
	}
	return { active, status };
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
