/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- I/O boundary parser for persisted capture metadata, validated at runtime */
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- I/O boundary parser for persisted capture metadata (unknown JSON)
export function normalizeRecordingCaptureMetadata(
	value: unknown
): RecordingCaptureMetadata | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	// SAFETY: value is verified non-null object, safe to read as record
	const raw = value as Record<string, unknown>;
	if (raw.version !== 1) return undefined;
	const kind = raw.kind;
	if (kind !== 'screen' && kind !== 'camera' && kind !== 'microphone') return undefined;
	const capturedAt = raw.capturedAt;
	if (typeof capturedAt !== 'string') return undefined;
	const result: RecordingCaptureMetadata = {
		version: 1,
		kind,
		capturedAt
	};
	const rawCursor = raw.cursor;
	if (rawCursor !== undefined) {
		if (typeof rawCursor === 'object' && rawCursor !== null && !Array.isArray(rawCursor)) {
			// SAFETY: rawCursor verified as object
			const cursorRecord = rawCursor as Record<string, unknown>;
			const requested = cursorRecord.requested;
			const actual = cursorRecord.actual;
			const supported = cursorRecord.supported;
			const isMode = (v: unknown): v is RecorderCursorMode =>
				v === 'always' || v === 'motion' || v === 'never' || v === 'unsupported' || v === 'unknown';
			if (isMode(requested) && isMode(actual) && typeof supported === 'boolean') {
				result.cursor = { requested, actual, supported };
			} else {
				createLogger('MediaTypes').warn('Dropped invalid cursor capture metadata', rawCursor);
			}
		} else {
			createLogger('MediaTypes').warn('Dropped invalid cursor capture metadata', rawCursor);
		}
	}
	const rawAudio = raw.systemAudio;
	if (rawAudio !== undefined) {
		if (typeof rawAudio === 'object' && rawAudio !== null && !Array.isArray(rawAudio)) {
			// SAFETY: rawAudio verified as object
			const audioRecord = rawAudio as Record<string, unknown>;
			const requested = audioRecord.requested;
			const active = audioRecord.active;
			const status = audioRecord.status;
			const isStatus = (v: unknown): v is RecordingSystemAudioStatus =>
				v === 'not-requested' ||
				v === 'active' ||
				v === 'inactive' ||
				v === 'unavailable' ||
				v === 'denied';
			if (typeof requested === 'boolean' && typeof active === 'boolean' && isStatus(status)) {
				result.systemAudio = { requested, active, status };
			} else {
				createLogger('MediaTypes').warn('Dropped invalid systemAudio capture metadata', rawAudio);
			}
		} else {
			createLogger('MediaTypes').warn('Dropped invalid systemAudio capture metadata', rawAudio);
		}
	}
	return result;
}

export interface ReconciledSystemAudio {
	active: boolean;
	status: RecordingSystemAudioStatus;
}

export function reconcileSystemAudioWithProbe(
	capture: { requested: boolean; active: boolean; status: RecordingSystemAudioStatus },
	hasAudio: boolean
): ReconciledSystemAudio {
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
	return { active, status } satisfies ReconciledSystemAudio;
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
